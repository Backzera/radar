// Provider "scraper próprio": substitui o Bright Data (pago) por um microserviço
// de scraping sob seu controle (ex.: Python + Scrapling), chamado via SCRAPER_URL.
//
// Decisões para encaixar no pipeline existente SEM refatorar o banco:
//  - Mantém o id interno "brightdata": o worker rejeita itens com provider !==
//    "brightdata" (server/worker.ts), e várias queries usam provider='brightdata'.
//    O rótulo interno continua "brightdata"; a fonte real agora é o seu scraper.
//  - É SÍNCRONO: search() já retorna { complete: true }, sem o ciclo de cursor/poll.
//  - NÃO implementa prepareQuery: assim o worker cai na filtragem LOCAL (cidade,
//    raio, data e preço são aplicados pelo pipeline), sem exigir "schema" de filtros
//    nativos da fonte (que o Bright Data fornecia e o scraper próprio não tem).
//
// O microserviço deve responder POST {SCRAPER_URL}/search com:
//   { items: [ { listingId?, url, title, price, currency?, location?, images?[],
//                publishedAt?, sellerId?, condition? } ] }

import type { RawListing } from "../core/types";
import type {
  MarketplaceProvider,
  SearchRequest,
  SearchResult,
  ProviderHealth,
} from "./contract";
import { ProviderError } from "./contract";
import { canonicalUrl } from "../core/freshness";

function fbItemUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return (
      u.protocol === "https:" &&
      ["facebook.com", "www.facebook.com"].includes(u.hostname) &&
      /^\/marketplace\/item\/\d+\/?$/.test(u.pathname)
    );
  } catch {
    return false;
  }
}

interface ServiceItem {
  listingId?: string;
  url: string;
  title?: string;
  price?: number | null;
  currency?: string;
  location?: string;
  images?: string[];
  publishedAt?: string | null;
  // true quando publishedAt vem de um selo de recência do FB ("Acabou de
  // chegar"), sem hora exata; a UI então mostra um rótulo grosseiro.
  publishedApprox?: boolean;
  sellerId?: string | null;
  condition?: string | null;
}

function mapItem(x: ServiceItem): RawListing | null {
  if (!x || typeof x.url !== "string" || !fbItemUrl(x.url)) return null;
  const id = new URL(x.url).pathname.match(/\/item\/(\d+)/)?.[1];
  if (!id || (x.listingId && String(x.listingId) !== id)) return null;
  const title = (x.title ?? "").trim();
  if (!title) return null;
  const published =
    typeof x.publishedAt === "string" && !Number.isNaN(Date.parse(x.publishedAt))
      ? new Date(x.publishedAt).toISOString()
      : null;
  // Recência por selo do FB (sem hora exata) é confiável para a janela, mas não
  // deve ser exibida como "há X minutos": marcamos como "badge".
  const approx = published !== null && x.publishedApprox === true;
  const images = (x.images ?? [])
    .filter((url) => {
      try {
        const u = new URL(url);
        return (
          u.protocol === "https:" &&
          (u.hostname.endsWith(".fbcdn.net") || u.hostname.endsWith(".fbsbx.com"))
        );
      } catch {
        return false;
      }
    })
    .slice(0, 10);
  const cond = (x.condition ?? "").toLowerCase();
  return {
    externalId: id,
    provider: "brightdata",
    marketplace: "facebook",
    url: canonicalUrl(x.url),
    originalUrl: x.url,
    country: "BR",
    publicationStatus: published ? "valid" : "missing",
    title,
    description: "",
    price:
      typeof x.price === "number" && Number.isFinite(x.price) ? x.price : null,
    currency: (x.currency ?? "BRL").toUpperCase(),
    returnedLocation: x.location ?? null,
    city: (x.location ?? "").split(/,|\s[-–]\s/)[0].trim(),
    latitude: null,
    longitude: null,
    sellerId: x.sellerId != null ? String(x.sellerId) : null,
    images,
    publishedAt: published,
    publicationSource: !published ? "unknown" : approx ? "badge" : "provider",
    // 70 (mínimo confiável) para selo; 80 para idade relativa explícita do FB.
    publicationConfidence: !published ? 0 : approx ? 70 : 80,
    availability: "unknown",
    condition:
      cond.includes("new") && !cond.includes("like new")
        ? "new"
        : cond.includes("used")
          ? "used"
          : "unknown",
    demo: false,
  };
}

export class SelfScraperProvider implements MarketplaceProvider {
  id = "brightdata";
  capabilities = {
    discovery: false,
    publicationTime: true,
    locationFilter: false,
    availability: false,
    images: true,
  };
  constructor(
    private config: { baseUrl?: string; maxRecords?: number },
    private transport: typeof fetch = fetch,
  ) {}

  private base(): string {
    const b = this.config.baseUrl?.trim();
    if (!b)
      throw new ProviderError(
        "Scraper próprio não configurado. Defina SCRAPER_URL no servidor.",
        false,
      );
    return b.replace(/\/+$/, "");
  }

  async healthCheck(): Promise<ProviderHealth> {
    const ok = !!this.config.baseUrl?.trim();
    return {
      dataset: "self-scraper",
      ok,
      message: ok
        ? "Scraper próprio configurado."
        : "Defina SCRAPER_URL para habilitar a coleta.",
      methods: { keyword: true, search_url: true },
    };
  }

  async search(r: SearchRequest): Promise<SearchResult> {
    const base = this.base();
    const q = r.providerQuery ?? { type: "keyword" as const, keyword: r.query };
    const keyword = q.type === "keyword" ? q.keyword : r.query;
    if (!Number.isInteger(r.limit) || r.limit < 1 || r.limit > 100)
      throw new ProviderError(
        "Limite de registros deve estar entre 1 e 100",
        false,
      );
    let resp: Response;
    try {
      resp = await this.transport(`${base}/search`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          query: keyword,
          city: r.city,
          radiusKm: r.radiusKm,
          limit: Math.min(this.config.maxRecords ?? 20, r.limit),
          searchUrl: q.type === "search_url" ? q.url : undefined,
        }),
        signal: AbortSignal.timeout(90000),
      });
    } catch {
      throw new ProviderError(
        "Falha ao contatar o scraper próprio (timeout ou rede).",
        true,
      );
    }
    if (!resp.ok)
      throw new ProviderError(
        `Scraper retornou HTTP ${resp.status}.`,
        [429, 500, 502, 503, 504].includes(resp.status),
      );
    let data: unknown;
    try {
      data = await resp.json();
    } catch {
      throw new ProviderError("Resposta do scraper não é JSON.", false);
    }
    const arr = Array.isArray((data as { items?: unknown })?.items)
      ? (data as { items: unknown[] }).items
      : Array.isArray(data)
        ? data
        : null;
    if (!arr)
      throw new ProviderError("Resposta do scraper sem lista de itens.", false);
    const items = (arr as ServiceItem[])
      .map((x) => mapItem(x))
      .filter((l): l is RawListing => l !== null)
      .map((l) => ({ ...l, queryType: q.type }));
    return {
      items,
      complete: true,
      received: arr.length,
      rejected: arr.length - items.length,
      warnings:
        items.length === 0
          ? ["O scraper não retornou anúncios compatíveis para esta busca."]
          : [],
    };
  }

  async getListing(url: string): Promise<RawListing | null> {
    const base = this.base();
    if (!fbItemUrl(url))
      throw new ProviderError("URL de anúncio Facebook inválida", false);
    let resp: Response;
    try {
      resp = await this.transport(`${base}/listing`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url }),
        signal: AbortSignal.timeout(90000),
      });
    } catch {
      throw new ProviderError("Falha ao contatar o scraper próprio.", true);
    }
    if (resp.status === 404) return null;
    if (!resp.ok)
      throw new ProviderError(`Scraper retornou HTTP ${resp.status}.`, false);
    try {
      return mapItem((await resp.json()) as ServiceItem);
    } catch {
      throw new ProviderError("Resposta de detalhe inválida do scraper.", false);
    }
  }

  getImages(l: RawListing) {
    return l.images;
  }
  getSellerInfo(l: RawListing) {
    return { id: l.sellerId };
  }
  getPublicationTime(l: RawListing) {
    return { value: l.publishedAt, confidence: l.publicationConfidence };
  }
}
