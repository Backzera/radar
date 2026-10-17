"""Relay local: expõe um proxy HTTP (CONNECT) sem senha em 127.0.0.1 e encaminha
o tráfego por um proxy SOCKS5 AUTENTICADO (usuário/senha).

Por que existe: o navegador do scraper (playwright/Camoufox) não sabe autenticar
em proxy SOCKS5. Então o navegador fala com este relay (local, sem senha) e o
relay cuida da autenticação com o proxy de verdade. O DNS do destino é resolvido
pelo próprio proxy (ATYP=domínio), sem vazar pela máquina.

Python puro, API asyncio moderna (3.10+), sem dependências externas.
"""
import asyncio
import socket
import struct
import threading


async def _socks5_connect(up_host, up_port, dst_host, dst_port, user, pwd):
    reader, writer = await asyncio.open_connection(up_host, up_port)
    # Handshake: oferece "sem auth" (0x00) e "usuário/senha" (0x02).
    methods = b"\x00\x02" if user else b"\x00"
    writer.write(b"\x05" + bytes([len(methods)]) + methods)
    await writer.drain()
    _, method = await reader.readexactly(2)
    if method == 0x02:
        u = (user or "").encode()
        p = (pwd or "").encode()
        writer.write(b"\x01" + bytes([len(u)]) + u + bytes([len(p)]) + p)
        await writer.drain()
        _, status = await reader.readexactly(2)
        if status != 0:
            writer.close()
            raise OSError("falha de autenticacao no proxy SOCKS5")
    elif method != 0x00:
        writer.close()
        raise OSError(f"SOCKS5 recusou os metodos (0x{method:02x})")
    # CONNECT ao destino por NOME (o proxy resolve o DNS).
    d = dst_host.encode()
    writer.write(b"\x05\x01\x00\x03" + bytes([len(d)]) + d + struct.pack(">H", dst_port))
    await writer.drain()
    hdr = await reader.readexactly(4)
    if hdr[1] != 0:
        writer.close()
        raise OSError(f"SOCKS5 CONNECT falhou (0x{hdr[1]:02x})")
    atyp = hdr[3]  # consome o endereço de bind da resposta
    if atyp == 1:
        await reader.readexactly(4 + 2)
    elif atyp == 3:
        ln = (await reader.readexactly(1))[0]
        await reader.readexactly(ln + 2)
    elif atyp == 4:
        await reader.readexactly(16 + 2)
    return reader, writer


async def _pipe(src, dst):
    try:
        while True:
            data = await src.read(65536)
            if not data:
                break
            dst.write(data)
            await dst.drain()
    except Exception:
        pass
    finally:
        try:
            dst.close()
        except Exception:
            pass


def _make_handler(up_host, up_port, user, pwd):
    async def handle(creader, cwriter):
        try:
            line = await creader.readline()
            if not line:
                cwriter.close()
                return
            parts = line.decode("latin1").split()
            while True:  # descarta o resto dos cabeçalhos até a linha em branco
                h = await creader.readline()
                if h in (b"\r\n", b"\n", b""):
                    break
            if len(parts) >= 2 and parts[0].upper() == "CONNECT":
                host, _, port = parts[1].partition(":")
                rreader, rwriter = await _socks5_connect(
                    up_host, up_port, host, int(port or 443), user, pwd
                )
                cwriter.write(b"HTTP/1.1 200 Connection established\r\n\r\n")
                await cwriter.drain()
                await asyncio.gather(_pipe(creader, rwriter), _pipe(rreader, cwriter))
            else:
                # O scraper só usa HTTPS (CONNECT); HTTP simples não é tratado.
                cwriter.write(b"HTTP/1.1 405 Method Not Allowed\r\n\r\n")
                await cwriter.drain()
                cwriter.close()
        except Exception:
            try:
                cwriter.close()
            except Exception:
                pass

    return handle


def start(up_host, up_port, user, pwd, local_port):
    """Sobe o relay numa thread própria (loop asyncio isolado do uvicorn) e só
    retorna quando ele já está escutando em 127.0.0.1:local_port."""
    ready = threading.Event()

    def run():
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)

        async def boot():
            server = await asyncio.start_server(
                _make_handler(up_host, int(up_port), user, pwd), "127.0.0.1", local_port
            )
            ready.set()
            async with server:
                await server.serve_forever()

        try:
            loop.run_until_complete(boot())
        except Exception:
            ready.set()

    threading.Thread(target=run, daemon=True).start()
    ready.wait(timeout=10)
    return local_port


def free_port() -> int:
    s = socket.socket()
    try:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]
    finally:
        s.close()
