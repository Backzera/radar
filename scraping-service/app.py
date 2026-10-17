# Microserviço de scraping do Facebook Marketplace (fonte própria do Market Radar).
# Substitui o Bright Data: o app (Cloudflare Worker) chama POST /search aqui.
# Usa Scrapling (StealthyFetcher: anti-bot + parser que se adapta a mudanças de layout).
#
# Roda SÓ no seu servidor/VPS. O usuário final NUNCA loga no Facebook: a sessão
# (cookies da conta operadora) fica aqui, em FB_COOKIES.
#
# Contrato de resposta (consumido por providers/self-scraper.ts):
#   POST /search  { query, city, radiusKm, limit, searchUrl? }
#     -> { "items": [ { listingId, url, title, price, currency, location,
#                       images[], publishedAt, sellerId, condition } ] }
#   POST /listing { url } -> item único (mesmos campos) ou 404
#   GET  /health  -> { ok: true }
#
# Rodar:
#   pip install -r requirements.txt
#   playwright install chromium
#   uvicorn app:app --port 8000
#
# Env:
#   FB_COOKIES = JSON (lista de cookies no formato Playwright) da conta operadora.
#                Veja README.md para gerar.

import json
import os
import re
from urllib.parse import quote

from fastapi import FastAPI
from pydantic import BaseModel
from scrapling.fetchers import StealthyFetcher

ITEM_RE = re.compile(r"/marketplace/item/(\d+)")
app = FastAPI(title="market-radar-scraper")


class SearchInput(BaseModel):
    query: str
    city: str | None = None
    radiusKm: float | None = None
    limit: int | None = 60
    searchUrl: str | None = None


class ListingInput(BaseModel):
    url: str


def build_url(inp: SearchInput) -> str:
    if inp.searchUrl:
        return inp.searchUrl
    base = (
        f"https://www.facebook.com/marketplace/{quote(inp.city)}/search"
        if inp.city
        else "https://www.facebook.com/marketplace/search"
    )
    params = [f"query={quote(inp.query)}", "sortBy=creation_time_descend", "exact=false"]
    return f"{base}?{'&'.join(params)}"


def parse_price(text: str):
    if not text:
        return None
    if re.search(r"gr[aá]tis|free", text, re.I):
        return 0
    digits = re.sub(r"[^\d]", "", text.split(",")[0])
    return int(digits) if digits else None


def canonical(href: str) -> str:
    return "https://www.facebook.com" + href.split("?")[0]


def load_cookies():
    raw = os.environ.get("FB_COOKIES", "").strip()
    if not raw:
        return None
    try:
        return json.loads(raw)
    except Exception:
        return None


def fetch_page(url: str):
    kwargs = dict(headless=True, network_idle=True)
    cookies = load_cookies()
    if cookies:
        kwargs["cookies"] = cookies  # ajuste conforme a versão do Scrapling, se preciso
    return StealthyFetcher.fetch(url, **kwargs)


def card_to_item(anchor) -> dict | None:
    href = anchor.attrib.get("href", "")
    m = ITEM_RE.search(href)
    if not m:
        return None
    text = [t.strip() for t in anchor.get_all_text(separator="\n").split("\n") if t.strip()]
    price_line = next((l for l in text if re.search(r"r\$|gr[aá]tis|free", l, re.I)), "")
    title = next(
        (l for l in text
         if l != price_line and not re.match(r"^[^,]+,\s*[A-Z]{2}$", l) and len(l) > 3),
        "",
    )
    location = next((l for l in reversed(text) if re.match(r"^[^,]+,\s*[A-Z]{2}$", l)), "")
    img = anchor.css_first("img")
    return {
        "listingId": m.group(1),
        "url": canonical(href),
        "title": title,
        "price": parse_price(price_line),
        "currency": "BRL",
        "location": location,
        "images": [img.attrib.get("src")] if img and img.attrib.get("src") else [],
        "publishedAt": None,   # cards de busca não expõem data exata; filtro de recência é local
        "sellerId": None,
        "condition": None,
    }


@app.post("/search")
def search(inp: SearchInput):
    page = fetch_page(build_url(inp))
    if "/login" in (getattr(page, "url", "") or ""):
        return {"error": "sessao do Facebook necessaria: configure FB_COOKIES", "items": []}
    seen: dict[str, dict] = {}
    for a in page.css('a[href*="/marketplace/item/"]'):
        item = card_to_item(a)
        if item and item["listingId"] not in seen:
            seen[item["listingId"]] = item
        if len(seen) >= (inp.limit or 60):
            break
    return {"items": list(seen.values())}


@app.post("/listing")
def listing(inp: ListingInput):
    page = fetch_page(inp.url)
    if "/login" in (getattr(page, "url", "") or ""):
        return {"error": "sessao do Facebook necessaria"}, 503
    a = page.css_first('a[href*="/marketplace/item/"]') or page
    # Em detalhe, tentamos extrair do próprio documento.
    m = ITEM_RE.search(inp.url)
    title_el = page.css_first("h1") or page.css_first('[role="main"] span')
    price_el = page.css_first('span:contains("R$")')
    img = page.css_first('img[src*="fbcdn"]')
    if not m:
        return {}, 404
    return {
        "listingId": m.group(1),
        "url": canonical(inp.url),
        "title": (title_el.text.strip() if title_el else ""),
        "price": parse_price(price_el.text if price_el else ""),
        "currency": "BRL",
        "location": "",
        "images": [img.attrib.get("src")] if img and img.attrib.get("src") else [],
        "publishedAt": None,
        "sellerId": None,
        "condition": None,
    }


@app.get("/health")
def health():
    return {"ok": True}
