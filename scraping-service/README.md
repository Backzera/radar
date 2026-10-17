# scraping-service — fonte própria do Market Radar (Python + Scrapling)

Substitui o Bright Data (pago). O app (Cloudflare Worker) chama este microserviço
pelo provider `providers/self-scraper.ts` via a env **`SCRAPER_URL`**.

Roda **só no seu servidor/VPS**. O usuário final **nunca** loga no Facebook — a
sessão (cookies da conta operadora) fica aqui.

## Rodar

```bash
cd scraping-service
python -m venv .venv && .venv\Scripts\activate   # Windows (Linux: source .venv/bin/activate)
pip install -r requirements.txt
playwright install chromium
uvicorn app:app --port 8000
```

No app, aponte `SCRAPER_URL=http://localhost:8000` (já colocado no `.env.example` e `.dev.vars`).

Teste:
```bash
curl -X POST localhost:8000/search -H 'content-type: application/json' \
  -d '{"query":"iphone 11","city":"","limit":20}'
```

## Contrato (consumido por `providers/self-scraper.ts`)

`POST /search { query, city, radiusKm, limit, searchUrl? }` →
```json
{ "items": [ { "listingId","url","title","price","currency","location",
               "images":[],"publishedAt","sellerId","condition" } ] }
```
`POST /listing { url }` → um item (mesmos campos). `GET /health` → `{ "ok": true }`.

Observações do mapeamento:
- `price` em BRL (número) ou `null`; `currency` = "BRL".
- `publishedAt` vem `null` nos cards de busca (o FB não expõe a data exata ali); o
  filtro de recência (idade do anúncio) é aplicado **localmente** pelo pipeline do app.
- `provider` interno continua "brightdata" no app (compatibilidade); aqui não importa.

## Sessão do Facebook (FB_COOKIES)

A busca do Marketplace com filtros normalmente **exige login**. Faça **uma vez**, com a
conta **operadora** (não a do usuário), e passe os cookies via env `FB_COOKIES`
(JSON no formato Playwright — lista de objetos cookie).

Como gerar rápido com Playwright:
```python
# salvar_cookies.py — rode uma vez, logue na janela, pressione Enter
from playwright.sync_api import sync_playwright
with sync_playwright() as p:
    b = p.chromium.launch(headless=False); ctx = b.new_context(locale="pt-BR")
    pg = ctx.new_page(); pg.goto("https://www.facebook.com/login")
    input("Logue no Facebook, abra o Marketplace e aperte Enter...")
    import json; print(json.dumps(ctx.storage_state()["cookies"]))
```
Copie a saída para `FB_COOKIES` do serviço.

> Dependendo da versão do Scrapling, o nome do parâmetro de cookies pode mudar; o
> ponto de ajuste está em `app.py` → `fetch_page()`.

## Avisos

- Scraping do Facebook pode violar os Termos de Uso; o risco (conta/IP) é seu.
  Use conta dedicada, respeite rate-limit, intervalos de 15–60 min por radar.
- Se `POST /search` responder com `error` de login, os cookies expiraram → refaça.
- Os seletores do FB mudam: se vier 0 itens, ajuste o parsing em `app.py`.
