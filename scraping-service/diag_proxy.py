# Diagnóstico do scraper: testa uma busca mostrando se o proxy está ativo e o que
# o Facebook devolveu. NÃO imprime usuário/senha do proxy (só o host:porta).
#
# Rodar (com o MESMO python que roda o scraper), dentro desta pasta:
#   python diag_proxy.py                 -> busca "iphone 12" em Curitiba
#   python diag_proxy.py "ps5" "Sao Paulo"
import sys

try:  # evita travar ao imprimir acentos em consoles cp1252 (Windows)
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

import app

query = sys.argv[1] if len(sys.argv) > 1 else "iphone 12"
city = sys.argv[2] if len(sys.argv) > 2 else "Curitiba"

proxy = app.load_proxy()
print("PROXY:", proxy["server"] if proxy else "(nenhum)")
print("COOKIES:", "sim" if app.load_cookies() else "NAO")
print(f"BUSCA: {query!r} em {city!r}")

try:
    page = app.fetch_page(app.build_url(app.SearchInput(query=query, city=city, limit=10)))
except Exception as e:  # erro de conexão/proxy aparece aqui
    print("ERRO ao abrir a pagina:", repr(e))
    raise SystemExit(1)

url = getattr(page, "url", None)
anchors = len(page.css('a[href*="/marketplace/item/"]'))
texto = (page.get_all_text(separator=" ", strip=True) or "")
print("URL FINAL:", url)
print("LOGIN?:", "sim" if url and "/login" in url else "nao")
print("ANCORAS DE ANUNCIO:", anchors)
print("TEXTO (800):", texto[:800])
