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
#   SCRAPER_PROXY = proxy opcional para o navegador sair por outro IP (ex.: residencial).
#                Formatos: "host:porta", "host:porta:usuario:senha" ou
#                "socks5://usuario:senha@host:porta". Também pode ficar num
#                arquivo proxy.txt ao lado deste app (ignorado pelo git).
#   SCRAPER_PROXY_SCHEME = esquema quando o proxy não traz um (padrão: socks5).

import json
import os
import re
from datetime import datetime, timedelta, timezone
from urllib.parse import quote

from fastapi import FastAPI
from pydantic import BaseModel
from scrapling.fetchers import StealthyFetcher

import relay

ITEM_RE = re.compile(r"/marketplace/item/(\d+)")
# Selos/rotulos do card que NAO sao o titulo do produto.
BADGE_RE = re.compile(
    r"^(acabou de chegar|hoje|ontem|patrocinad|anúncio|an[uú]ncio|novo!?$|gr[aá]tis|free|"
    r"h[aá] \d|\d+\s*(min|minuto|h|hora|dia|dias|semana|semanas|m[eê]s|meses))",
    re.I,
)
# Recencia: os cards da busca do FB nao trazem data exata, mas trazem um selo de
# "recem publicado" (ex.: "Acabou de chegar") e, em alguns casos, idade relativa
# ("ha 3 dias", "ontem"). Como a busca e ordenada por creation_time_descend, esses
# sinais vindos do proprio FB sao usados para estimar publishedAt. O app (worker)
# so mostra anuncios dentro da janela do radar (ex.: 7 dias); sem esse sinal o item
# fica sem data confirmada e e filtrado — comportamento honesto, nao um palpite.
FRESH_NOW_RE = re.compile(
    r"acabou de chegar|rec[eé]m[- ]?(?:chegad|publicad|anunciad)|novo an[uú]ncio|"
    r"publicado agora|just listed|newly listed",
    re.I,
)
REL_AGE_RE = re.compile(
    r"h[aá]\s+(\d+)\s*(minutos?|min|horas?|h|dias?|semanas?|m[eê]s(?:es)?|meses)\b", re.I
)
_UNIT_MINUTES = {
    "min": 1, "minuto": 1, "minutos": 1,
    "h": 60, "hora": 60, "horas": 60,
    "dia": 1440, "dias": 1440,
    "semana": 10080, "semanas": 10080,
    "mes": 43200, "mês": 43200, "meses": 43200,
}


def _iso(dt: datetime) -> str:
    return dt.strftime("%Y-%m-%dT%H:%M:%SZ")


def parse_published(lines):
    """Estima publishedAt a partir dos sinais de recencia do card do FB.
    Retorna (iso_utc, approx):
      - approx=False: idade relativa explicita do FB ("ha 3 dias", "ontem") -> data confiavel.
      - approx=True: apenas selo de "recem publicado" ("Acabou de chegar", "hoje"),
        sem hora exata -> a UI mostra rotulo grosseiro, nao "ha X minutos".
      - (None, False): o FB nao expos nenhum sinal; o item fica sem data e e filtrado."""
    now = datetime.now(timezone.utc)
    for raw in lines:
        low = raw.strip().lower()
        if not low:
            continue
        if FRESH_NOW_RE.search(low) or low == "hoje":
            return _iso(now), True
        if low == "ontem":
            return _iso(now - timedelta(days=1)), False
        m = REL_AGE_RE.search(low)
        if m:
            unit = m.group(2).lower()
            mins = _UNIT_MINUTES.get(unit)
            if mins:
                return _iso(now - timedelta(minutes=int(m.group(1)) * mins)), False
    return None, False


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
    # 1) via env FB_COOKIES (JSON); 2) via arquivo FB_COOKIES_FILE (padrão fb_cookies.json)
    raw = os.environ.get("FB_COOKIES", "").strip()
    if raw:
        try:
            return json.loads(raw)
        except Exception:
            return None
    path = os.environ.get("FB_COOKIES_FILE", "fb_cookies.json")
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return None


_RELAY = {"server": None}


def _parse_proxy():
    """Lê o proxy de SCRAPER_PROXY ou, se vazio, do arquivo proxy.txt (cwd ou ao
    lado deste app). Formatos aceitos:
      host:porta
      host:porta:usuario:senha
      scheme://host:porta
      scheme://usuario:senha@host:porta
    Sem esquema, usa SCRAPER_PROXY_SCHEME (padrão socks5).
    Retorna (scheme, host, port, user, pwd) ou None. Nunca loga o segredo."""
    raw = os.environ.get("SCRAPER_PROXY", "").strip()
    if not raw:
        here = os.path.dirname(os.path.abspath(__file__))
        for path in (os.path.join(os.getcwd(), "proxy.txt"), os.path.join(here, "proxy.txt")):
            try:
                with open(path, encoding="utf-8") as fh:
                    raw = fh.read().strip()
            except Exception:
                raw = ""
            if raw:
                break
    if not raw:
        return None
    raw = raw.splitlines()[0].strip()  # ignora comentários/linhas extras
    if not raw or raw.startswith("#"):
        return None
    user = pwd = None
    if "://" in raw:
        scheme, rest = raw.split("://", 1)
        if "@" in rest:
            creds, hostport = rest.rsplit("@", 1)
            if ":" in creds:
                user, pwd = creds.split(":", 1)
            else:
                user = creds
        else:
            hostport = rest
        if ":" not in hostport:
            return None
        host, port = hostport.rsplit(":", 1)
    else:
        scheme = os.environ.get("SCRAPER_PROXY_SCHEME", "").strip() or "socks5"
        parts = raw.split(":")
        if len(parts) >= 4:
            host, port, user, pwd = parts[0], parts[1], parts[2], ":".join(parts[3:])
        elif len(parts) == 3:
            host, port, user = parts
        elif len(parts) == 2:
            host, port = parts
        else:
            return None
    return scheme.lower(), host, port, (user or None), pwd


def _ensure_relay(host: str, port: str, user: str, pwd) -> str:
    """O navegador (playwright/Camoufox) NÃO autentica em proxy SOCKS5. Então, para
    um SOCKS5 com usuário/senha, subimos um relay local (relay.py) que resolve a
    autenticação com o proxy e expõe um HTTP SEM senha em 127.0.0.1 — é esse que o
    navegador usa. O relay sobe uma vez por processo."""
    if _RELAY["server"]:
        return _RELAY["server"]
    local_port = int(os.environ.get("SCRAPER_PROXY_RELAY_PORT", "") or 0) or relay.free_port()
    relay.start(host, port, user, pwd, local_port)
    _RELAY["server"] = f"http://127.0.0.1:{local_port}"
    return _RELAY["server"]


def load_proxy():
    """Monta o proxy no formato do Playwright para o navegador sair por outro IP.
    Sem auth, ou auth HTTP(S): usa direto. SOCKS5 com auth: sobe o relay local e
    aponta pra ele. Retorna {server, username?, password?} ou None."""
    parsed = _parse_proxy()
    if not parsed:
        return None
    scheme, host, port, user, pwd = parsed
    if user and scheme.startswith("socks"):
        return {"server": _ensure_relay(host, port, user, pwd)}
    proxy = {"server": f"{scheme}://{host}:{port}"}
    if user:
        proxy["username"] = user
    if pwd is not None:
        proxy["password"] = pwd
    return proxy


def fetch_page(url: str):
    kwargs = dict(headless=True, network_idle=True)
    cookies = load_cookies()
    if cookies:
        kwargs["cookies"] = cookies  # ajuste conforme a versão do Scrapling, se preciso
    proxy = load_proxy()
    if proxy:
        kwargs["proxy"] = proxy
    return StealthyFetcher.fetch(url, **kwargs)


def card_to_item(anchor) -> dict | None:
    href = anchor.attrib.get("href", "")
    m = ITEM_RE.search(href)
    if not m:
        return None
    text = [t for t in anchor.get_all_text(separator="\n", strip=True).split("\n") if t]

    def is_loc(l):
        return bool(re.match(r"^[^,]+,\s*[A-Z]{2}$", l))

    def is_price(l):
        return bool(re.search(r"r\$|gr[aá]tis|free", l, re.I))

    def is_badge(l):
        return bool(BADGE_RE.search(l))

    price_line = next((l for l in text if is_price(l)), "")
    price_idx = next((i for i, l in enumerate(text) if is_price(l)), None)
    # Titulo: no card do FB vem logo DEPOIS do preco (pulando selos/localizacao).
    title = ""
    if price_idx is not None:
        for l in text[price_idx + 1:]:
            if not is_loc(l) and not is_badge(l) and not is_price(l) and len(l) > 3:
                title = l
                break
    if not title:
        cands = [l for l in text if l != price_line and not is_loc(l) and not is_badge(l) and not is_price(l) and len(l) > 3]
        title = max(cands, key=len) if cands else ""
    location = next((l for l in reversed(text) if is_loc(l)), "")
    imgs = anchor.css("img")
    img = imgs[0] if imgs else None
    published_at, published_approx = parse_published(text)
    return {
        "listingId": m.group(1),
        "url": canonical(href),
        "title": title,
        "price": parse_price(price_line),
        "currency": "BRL",
        "location": location,
        "images": [img.attrib.get("src")] if img and img.attrib.get("src") else [],
        # Data exata não vem no card; usamos o sinal de recência do próprio FB
        # ("Acabou de chegar", "há X dias", "ontem"). Sem sinal, fica None.
        # publishedApprox=True marca recência por selo (sem hora exata).
        "publishedAt": published_at,
        "publishedApprox": published_approx,
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


def _first(sel):
    return sel[0] if sel else None


@app.post("/listing")
def listing(inp: ListingInput):
    m = ITEM_RE.search(inp.url)
    if not m:
        return {}, 404
    page = fetch_page(inp.url)
    if "/login" in (getattr(page, "url", "") or ""):
        return {"error": "sessao do Facebook necessaria"}, 503
    title_el = _first(page.css("h1")) or _first(page.css('[role="main"] span'))
    img = _first(page.css('img[src*="fbcdn"]'))
    price = None
    for line in page.get_all_text(separator="\n", strip=True).split("\n"):
        if re.search(r"r\$", line, re.I):
            price = parse_price(line)
            break
    return {
        "listingId": m.group(1),
        "url": canonical(inp.url),
        "title": (str(title_el.text).strip() if title_el else ""),
        "price": price,
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
