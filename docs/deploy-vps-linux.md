# Market Radar na VPS — dz7.online/brique

Este pacote roda o app numa VPS Linux comum: um servidor Node.js com o banco num arquivo SQLite e as fotos numa pasta. A Cloudflare fica na frente só para DNS e certificado SSL.

```
Visitante ──https──> Cloudflare ──> nginx (porta 80/443) ──> app (127.0.0.1:3010) ──> /opt/brique/data
```

## O que tem no pacote

| Arquivo | Para que serve |
|---|---|
| `app/` | O app pronto (já compilado, com as dependências) |
| `install.sh` | Instala ou atualiza com Docker |
| `docker-compose.yml`, `Dockerfile` | Como o container roda |
| `.env.example` | Configuração (copie para `.env`) |
| `nginx/brique-location.conf` | Bloco para colar no site que já existe no nginx |
| `nginx/dz7.online.conf` | Site completo, se o domínio ainda não estiver no nginx |
| `backup.sh` | Cópia do banco e das fotos |
| `brique.service` | Alternativa sem Docker (systemd) |

Tudo que o app grava fica em `data/`: `brique.sqlite` (banco), `media/` (fotos) e `backups/`.

## Requisitos da VPS

- Linux (Ubuntu 22.04/24.04 ou Debian 12 são os mais simples), 1 GB de RAM é suficiente.
- Docker com o plugin Compose (`docker compose version` deve responder).
- nginx.
- Portas 80 e 443 abertas.

Se faltar algo no Ubuntu/Debian:

```bash
curl -fsSL https://get.docker.com | sh
apt install -y nginx
```

## 1. Enviar e instalar

No seu computador, na pasta do projeto (o arquivo fica em `release/`):

```bash
scp release/brique-linux.tar.gz root@IP-DA-VPS:/opt/
```

Na VPS:

```bash
cd /opt
tar -xzf brique-linux.tar.gz
mv brique-linux brique
cd /opt/brique
bash install.sh
```

Na primeira vez o `install.sh` cria o `.env` e para. Abra o arquivo e coloque **o seu e-mail** em `RADAR_ADMIN_EMAILS`:

```bash
nano .env
```

Depois rode de novo:

```bash
bash install.sh
```

Ele sobe o container, cria o banco e confirma quando o app responder em `http://127.0.0.1:3010/brique`.

## 2. nginx

**Se o dz7.online já tem um site no nginx**, cole o conteúdo de `nginx/brique-location.conf` dentro do bloco `server { ... }` desse site (o arquivo costuma estar em `/etc/nginx/sites-available/`).

**Se o domínio ainda não está no nginx**, use o site completo:

```bash
cp nginx/dz7.online.conf /etc/nginx/sites-available/dz7.online
ln -s /etc/nginx/sites-available/dz7.online /etc/nginx/sites-enabled/
```

Nos dois casos, teste e recarregue:

```bash
nginx -t && systemctl reload nginx
```

## 3. Cloudflare

1. **DNS**: registro `A` com nome `dz7.online` (ou `@`) apontando para o IP da VPS, com a **nuvem laranja (Proxied)** ligada.
2. **SSL/TLS**, escolha um modo:
   - **Flexible**: funciona na hora com a configuração acima (porta 80). A Cloudflare faz o https com o visitante.
   - **Full (strict)** — recomendado: o caminho entre a Cloudflare e a VPS também fica criptografado.
     1. Em *SSL/TLS → Origin Server → Create Certificate*, gere o certificado (15 anos) para `dz7.online` e `*.dz7.online`.
     2. Salve na VPS: o certificado em `/etc/ssl/cloudflare/dz7.online.pem` e a chave em `/etc/ssl/cloudflare/dz7.online.key` (`chmod 600` na chave).
     3. Copie o bloco do app para os snippets: `cp nginx/brique-location.conf /etc/nginx/snippets/`.
     4. Descomente o bloco `listen 443` em `nginx/dz7.online.conf` (ou adicione o `listen 443 ssl` e os dois `ssl_certificate` ao seu site), depois `nginx -t && systemctl reload nginx`.
     5. Só então mude o modo da Cloudflare para **Full (strict)**.
3. Em *SSL/TLS → Edge Certificates*, ligue **Always Use HTTPS**.

## 4. Primeiro acesso

1. Abra `https://dz7.online/brique/cadastro` e crie sua conta **com o mesmo e-mail** que está em `RADAR_ADMIN_EMAILS`.
2. Você entra como administrador: o menu mostra **Usuários**.
3. Se quiser que só você crie contas (vendendo o acesso por fora), em *Usuários* desligue **Cadastro pelo site**.

## Atualizar para uma versão nova

No computador, gere o pacote novo (`npm run vps:build -- --os linux`) e envie. Na VPS:

```bash
cd /opt && rm -rf brique-linux && tar -xzf brique-linux.tar.gz
cd /opt/brique && bash backup.sh
rm -rf app && cp -r /opt/brique-linux/app . && cp /opt/brique-linux/{Dockerfile,docker-compose.yml,install.sh,backup.sh,LEIA-ME.md} .
bash install.sh
```

O `.env` e a pasta `data/` não são tocados. Se a versão nova tiver mudanças no banco, o app faz uma cópia em `data/backups/` antes de aplicá-las.

## Backup

```bash
bash /opt/brique/backup.sh
```

Para rodar todo dia às 3h, `crontab -e` e adicione:

```
0 3 * * * /bin/bash /opt/brique/backup.sh >> /var/log/brique-backup.log 2>&1
```

Os backups ficam em `data/backups/` por 14 dias. Copie-os também para fora da VPS de vez em quando.

**Restaurar**: `docker compose down`, copie o backup escolhido por cima de `data/brique.sqlite` (e extraia o `fotos-*.tar.gz` em `data/` se precisar), depois `docker compose up -d`.

## Sem Docker (opcional)

Com Node.js 24 instalado na VPS:

```bash
useradd --system --home /opt/brique brique
mkdir -p /opt/brique/data && chown -R brique:brique /opt/brique
cp brique.service /etc/systemd/system/
systemctl daemon-reload && systemctl enable --now brique
```

A porta e as pastas estão no `brique.service`. Use os mesmos arquivos do nginx.

## Comandos úteis

```bash
docker compose logs -f brique        # acompanhar os logs
docker compose restart brique        # reiniciar
docker compose ps                    # situação e health check
```

## Problemas comuns

| Sintoma | Causa provável |
|---|---|
| 502 Bad Gateway | App parado: `docker compose ps` e `docker compose logs brique` |
| "Origem da requisição inválida" ao entrar ou salvar | `APP_ORIGIN` no `.env` diferente do endereço usado no navegador (precisa ser `https://dz7.online`, sem barra no final) |
| Erro 525/526 na Cloudflare | Modo **Full (strict)** sem o Certificado de Origem instalado no nginx. Volte para Flexible ou instale o certificado |
| Erro ao enviar foto (413) | Faltou o `client_max_body_size` no bloco do nginx |
| Página sem estilo ou 404 em `/brique/_next/...` | O bloco do nginx não está pegando `/brique`: confira o `location ^~ /brique` |
| Mudou o `BASE_PATH` e quebrou | O prefixo é definido no build: gere o pacote de novo com `npm run vps:build -- --os linux --base /novo` |

## Segurança

- O app só escuta em `127.0.0.1`; o acesso de fora passa pelo nginx.
- Firewall: `ufw allow 22,80,443/tcp && ufw enable`.
- Opcional: aceitar nas portas 80/443 só os IPs da Cloudflare (lista em cloudflare.com/ips), para ninguém contornar o proxy.
- O `.env` e a pasta `data/` ficam só na VPS. Não os envie para repositórios.
