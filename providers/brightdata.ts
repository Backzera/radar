import { confirmedHealth, type InputConfirmation } from "./input-confirmation";
import type { RawListing } from "../core/types";
import type {
  MarketplaceProvider,
  SearchRequest,
  SearchResult,
  DiscoveryCandidate,
} from "./contract";
import { ProviderError } from "./contract";
import { canonicalUrl } from "../core/freshness";
import { z } from "zod";
import { priceAnomalies } from "../core/normalize";
import { parseBRL, parsePublication } from "../core/provider-values";
import { validateSearchUrl } from "../core/provider-query";
import {
  inspectBrightDataMetadata,
  discoveryInput,
  buildBrightDataInput,
} from "./brightdata-schema";
import type { ProviderQuery } from "../core/provider-query";
import type { ProviderHealth } from "./contract";
const rawSchema = z
  .object({
    product_id: z.union([z.string().min(1), z.number().finite()]).nullish(),
    url: z.string().url(),
    title: z.string().trim().min(1).max(500),
    description: z.string().max(30000).nullish(),
    final_price: z.unknown().optional(),
    currency: z.string().nullish(),
    location: z.string().nullish(),
    images: z.array(z.string()).nullish(),
    profile_id: z.union([z.string(), z.number()]).nullish(),
    listing_date: z.string().nullish(),
    condition: z.string().nullish(),
    is_sold: z.boolean().nullish(),
    country_code: z.string().nullish(),
  })
  .passthrough();
export function facebookUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return (
      u.protocol === "https:" &&
      ["facebook.com", "www.facebook.com"].includes(u.hostname) &&
      /^\/marketplace\/item\/\d+\/?$/.test(u.pathname) &&
      value === value.trim() &&
      !/[\u0000-\u0020\\]/.test(value) &&
      !u.username &&
      !u.password &&
      !u.port &&
      !u.hash &&
      ![...u.searchParams].some(
        ([k, v]) =>
          /^(?:next|redirect|redirect_uri|redirect_url|url|href|u|access_token|token|cookie|session)$/i.test(
            k,
          ) || /^(?:https?:|file:|ftp:|\/\/)/i.test(v),
      )
    );
  } catch {
    return false;
  }
}
export function mapFacebook(
  input: unknown,
  now = new Date(),
): RawListing | null {
  const parsed = rawSchema.safeParse(input);
  if (!parsed.success) return null;
  const r = parsed.data;
  if (r.error != null || r.error_code != null || r.errors != null) return null;
  if (
    !facebookUrl(r.url) ||
    (r.country_code && !["BR", "BRA"].includes(r.country_code))
  )
    return null;
  const id = new URL(r.url).pathname.match(/\/item\/(\d+)/)?.[1];
  if (!id || (r.product_id != null && id !== String(r.product_id))) return null;
  const publication = parsePublication(r.listing_date, now);
  const date = publication.value;
  return {
    externalId: id,
    provider: "brightdata",
    marketplace: "facebook",
    url: canonicalUrl(r.url),
    originalUrl: r.url,
    country: r.country_code ?? null,
    publicationStatus: publication.status,
    title: r.title,
    description: r.description ?? "",
    price: r.currency?.toUpperCase() === "BRL" ? parseBRL(r.final_price) : null,
    currency: (r.currency ?? "").toUpperCase(),
    returnedLocation: r.location ?? null,
    city: (r.location ?? "").split(/,|\s[-–]\s/)[0].trim(),
    latitude: null,
    longitude: null,
    sellerId: r.profile_id == null ? null : String(r.profile_id),
    images: (r.images ?? [])
      .filter((url) => {
        try {
          const u = new URL(url);
          return (
            u.protocol === "https:" &&
            (u.hostname.endsWith(".fbcdn.net") ||
              u.hostname.endsWith(".fbsbx.com"))
          );
        } catch {
          return false;
        }
      })
      .slice(0, 10),
    publishedAt: date,
    publicationSource: date ? "provider" : "unknown",
    publicationConfidence: publication.confidence,
    availability:
      r.is_sold === true
        ? "sold"
        : ["active", "sold", "removed", "unavailable"].includes(
              String(r.availability),
            )
          ? (r.availability as RawListing["availability"])
          : "unknown",
    condition:
      r.condition?.toLowerCase().includes("new") &&
      !r.condition?.toLowerCase().includes("like new")
        ? "new"
        : r.condition?.toLowerCase().includes("used")
          ? "used"
          : "unknown",
    demo: false,
  };
}
export function mapFacebookCandidate(
  input: unknown,
): DiscoveryCandidate | null {
  // The observed discovery schema is exactly a URL. Error rows or contradictory
  // details must not bypass the full listing validator through this fallback.
  const result = z.object({ url: z.string().url() }).strict().safeParse(input);
  if (!result.success || !facebookUrl(result.data.url)) return null;
  const id = new URL(result.data.url).pathname.match(/\/item\/(\d+)/)?.[1];
  if (!id) return null;
  return {
    externalId: id,
    provider: "brightdata",
    marketplace: "facebook",
    url: canonicalUrl(result.data.url),
    originalUrl: result.data.url,
  };
}
export class BrightDataProvider implements MarketplaceProvider {
  id = "brightdata";
  private validatedHealth?: ProviderHealth;
  capabilities = {
    discovery: true,
    publicationTime: true,
    locationFilter: false,
    availability: false,
    images: true,
  };
  constructor(
    private config: {
      apiKey?: string;
      rightsConfirmed?: string;
      dataset?: string;
      maxRecords?: number;
      inputConfirmation?: () => Promise<InputConfirmation | null>;
      // Disabled unless an internal caller explicitly accounts for the extra trigger.
      reserveCollectTrigger?: () => Promise<boolean>;
    },
    private transport: typeof fetch = fetch,
  ) {}
  private guard() {
    if (!this.config.apiKey?.trim())
      throw new ProviderError(
        "API Key ausente. Configure BRIGHTDATA_API_KEY no servidor e reinicie a aplicação.",
        false,
      );
    if (this.config.rightsConfirmed !== "true")
      throw new ProviderError(
        "Confirmação de uso pendente. Revise os termos/licenças aplicáveis antes de alterar FACEBOOK_DATA_RIGHTS_CONFIRMED para true.",
        false,
      );
  }
  private async call(path: string, body?: unknown): Promise<unknown> {
    this.guard();
    let response: Response;
    try {
      response = await this.transport(
        `https://api.brightdata.com/datasets/v3/${path}`,
        {
          method: body === undefined ? "GET" : "POST",
          headers: {
            Authorization: `Bearer ${this.config.apiKey}`,
            "Content-Type": "application/json",
          },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
          signal: AbortSignal.timeout(
            path.startsWith("scrape?") ? 75000 : 20000,
          ),
        },
      );
    } catch {
      throw new ProviderError(
        body === undefined
          ? "Timeout de leitura do provider"
          : "Disparo com resultado incerto. Conferir no fornecedor antes de reenviar para evitar cobrança duplicada.",
        body === undefined,
      );
    }
    if (!response.ok) {
      const retry = Number(response.headers.get("retry-after"));
      const failure = new ProviderError(
        `HTTP ${response.status}. ${response.status === 401 ? "A API Key da Bright Data não foi aceita." : response.status === 403 ? "A credencial não possui acesso ao recurso/dataset necessário." : response.status === 429 ? "Limite do provider atingido. Aguarde antes de tentar novamente." : "Falha de comunicação com a Bright Data."}`,
        [409, 429, 500, 502, 503, 504].includes(response.status) &&
          body === undefined,
        Number.isFinite(retry) && retry > 0 ? retry : null,
      );
      failure.phase = path.startsWith("scrapers?")
        ? "preflight"
        : body === undefined
          ? "poll"
          : "trigger";
      failure.code = `brightdata_http_${response.status}`;
      // Explicit rejection allows another conscious attempt after correction.
      // Network failures and 5xx remain ambiguous and must not be redispatched.
      failure.triggerRejected =
        body !== undefined &&
        [400, 401, 403, 404, 422, 429].includes(response.status);
      throw failure;
    }
    const reader = response.body?.getReader();
    if (!reader) throw new ProviderError("Provider sem resposta", false);
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 2_000_000) {
        await reader.cancel();
        throw new ProviderError("Resposta excede limite de 2 MB", false);
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let pos = 0;
    for (const c of chunks) {
      bytes.set(c, pos);
      pos += c.length;
    }
    try {
      return JSON.parse(new TextDecoder().decode(bytes));
    } catch {
      throw new ProviderError("JSON inválido no provider", false);
    }
  }
  async healthCheck(): Promise<ProviderHealth> {
    const dataset = this.config.dataset ?? "gd_lvt9iwuh6fbcwmx1a";
    const result = await this.call(
      `scrapers?dataset_id=${encodeURIComponent(dataset)}`,
    );
    return (this.validatedHealth = await inspectBrightDataMetadata(
      result,
      dataset,
    ));
  }
  async prepareQuery(query: ProviderQuery) {
    try {
      if (query.type === "search_url" && !validateSearchUrl(query.url))
        throw new ProviderError(
          "URL de pesquisa do Facebook Marketplace inválida",
          false,
        );
      const rawHealth = this.validatedHealth ?? (await this.healthCheck());
      const health = confirmedHealth(
        rawHealth,
        this.config.dataset ?? "gd_lvt9iwuh6fbcwmx1a",
        await this.config.inputConfirmation?.(),
      );
      const schema = health.schemas?.[query.type];
      if (
        query.inputConfirmationId &&
        query.inputConfirmationId !== schema?.inputConfirmationId
      ) {
        const error = new ProviderError(
          "A confirmação dos filtros mudou durante a preparação. Confira a configuração antes de solicitar outra busca.",
          false,
        );
        error.code = "native_filters_unconfirmed";
        error.phase = "preflight";
        throw error;
      }
      const input = discoveryInput(schema, query);
      return {
        input,
        contract: schema!.contract,
        fingerprint: schema!.fingerprint,
        ...(schema?.inputConfirmationId
          ? { inputConfirmationId: schema.inputConfirmationId }
          : {}),
        dataset: this.config.dataset ?? "gd_lvt9iwuh6fbcwmx1a",
      };
    } catch (error) {
      const failure =
        error instanceof ProviderError
          ? error
          : new ProviderError("Falha de leitura do contrato do provider");
      failure.phase = "preflight";
      throw failure;
    }
  }
  async search(r: SearchRequest): Promise<SearchResult> {
    const q = r.providerQuery ?? { type: "keyword" as const, keyword: r.query };
    if (q.type === "search_url" && !validateSearchUrl(q.url))
      throw new ProviderError(
        "URL de pesquisa do Facebook Marketplace inválida",
        false,
      );
    if (!Number.isInteger(r.limit) || r.limit < 1 || r.limit > 100)
      throw new ProviderError(
        "Limite de registros deve estar entre 1 e 100",
        false,
      );
    if (!r.cursor) {
      const prepared = await this.prepareQuery(q);
      const params = new URLSearchParams({
        dataset_id: this.config.dataset ?? "gd_lvt9iwuh6fbcwmx1a",
        type: "discover_new",
        discover_by: prepared.contract.replace(/^discover_by_/, ""),
        include_errors: "true",
        limit_per_input: String(
          Math.min(this.config.maxRecords ?? 10, r.limit),
        ),
        limit_multiple_results: String(
          Math.min(this.config.maxRecords ?? 10, r.limit),
        ),
      });
      const result = z
        .object({ snapshot_id: z.string().regex(/^[\w-]+$/) })
        .safeParse(await this.call(`trigger?${params}`, [prepared.input]));
      if (!result.success)
        throw new ProviderError(
          "Disparo sem snapshot_id; verificar fornecedor antes de reenviar.",
          false,
        );
      return {
        items: [],
        complete: false,
        cursor: result.data.snapshot_id,
        warnings: [
          q.type === "keyword"
            ? "Coleta iniciada com os filtros solicitados. Confira a localização retornada; date_listed não substitui a publicação do anúncio."
            : "Coleta iniciada usando a URL original; valide localização e recência retornadas.",
        ],
      };
    }
    if (!/^[\w-]+$/.test(r.cursor))
      throw new ProviderError("Cursor inválido", false);
    const status = z
      .object({
        status: z.string(),
        snapshot_id: z.string().optional(),
        dataset_id: z.string().optional(),
      })
      .safeParse(await this.call(`progress/${r.cursor}`));
    if (!status.success)
      throw new ProviderError("Resposta de progresso inesperada", false);
    if (
      (status.data.snapshot_id && status.data.snapshot_id !== r.cursor) ||
      (status.data.dataset_id &&
        status.data.dataset_id !==
          (this.config.dataset ?? "gd_lvt9iwuh6fbcwmx1a"))
    )
      throw new ProviderError(
        "Identidade de snapshot/dataset divergente",
        false,
      );
    if (["starting", "running"].includes(status.data.status))
      return { items: [], complete: false, cursor: r.cursor, warnings: [] };
    if (status.data.status !== "ready")
      throw new ProviderError(
        "Snapshot com falha ou estado inesperado. Consulte a execução na Bright Data; não foi considerado coleta vazia bem-sucedida.",
        false,
      );
    const data = await this.call(`snapshot/${r.cursor}?format=json`);
    // A ready progress response may precede construction of the downloadable
    // snapshot. Bright Data can return HTTP 200 with a building/running envelope.
    // Poll the SAME snapshot instead of treating it as invalid or triggering again.
    if (
      data &&
      !Array.isArray(data) &&
      typeof data === "object" &&
      "status" in data &&
      ["building", "starting", "running"].includes(String(data.status))
    ) {
      return {
        items: [],
        complete: false,
        cursor: r.cursor,
        warnings: [
          "O arquivo do resultado ainda está sendo preparado pela fonte.",
        ],
      };
    }
    if (!Array.isArray(data) || data.length > 100)
      throw new ProviderError(
        "Contrato de resultados inválido ou orçamento excedido",
        false,
      );
    const items = data
      .map((item) => mapFacebook(item))
      .filter((l): l is RawListing => l !== null)
      .map((l) => ({ ...l, queryType: q.type, snapshotId: r.cursor }));
    const candidates = data
      .map(mapFacebookCandidate)
      .filter((c): c is DiscoveryCandidate => c !== null);
    const qualityErrors: Record<string, number> = {};
    for (const record of data) {
      if (!mapFacebook(record) && !mapFacebookCandidate(record)) {
        const parsed = rawSchema.safeParse(record);
        const reason = !parsed.success
          ? "schema_incompativel"
          : parsed.data.country_code &&
              !["BR", "BRA"].includes(parsed.data.country_code)
            ? "fora_do_Brasil"
            : "url_ou_id_invalido";
        qualityErrors[reason] = (qualityErrors[reason] ?? 0) + 1;
      }
    }
    for (const l of items) {
      for (const reason of priceAnomalies(l.title, l.description))
        qualityErrors[reason] = (qualityErrors[reason] ?? 0) + 1;
      for (const key of [
        l.publicationStatus !== "valid"
          ? `publication_${l.publicationStatus}`
          : null,
        l.price === null ? "price_missing_or_invalid" : null,
        !l.city ? "location_missing" : null,
      ])
        if (key) qualityErrors[key] = (qualityErrors[key] ?? 0) + 1;
    }
    return {
      items,
      complete: true,
      snapshotId: r.cursor,
      received: data.length,
      candidates,
      rejected: data.length - items.length - candidates.length,
      qualityErrors,
      warnings: [
        `${data.length - items.length - candidates.length} registros incompatíveis descartados. ${candidates.length} URLs sem detalhes; nenhum enriquecimento adicional foi disparado. Disponibilidade só é marcada como vendida quando is_sold=true.`,
      ],
    };
  }

  async checkListing(r: {
    url: string;
    cursor?: string;
    reserved: true;
  }): Promise<SearchResult> {
    if (!r.reserved || !facebookUrl(r.url))
      throw new ProviderError("Conferência sem reserva ou URL válida", false);
    if (r.cursor)
      return this.search({
        query: "availability",
        city: "",
        radiusKm: 0,
        sequence: 0,
        limit: 1,
        cursor: r.cursor,
      });
    const health = this.validatedHealth ?? (await this.healthCheck());
    const input = buildBrightDataInput(health.schemas?.collect_url, {
      url: r.url,
    });
    const params = new URLSearchParams({
      dataset_id: this.config.dataset ?? "gd_lvt9iwuh6fbcwmx1a",
      format: "json",
      include_errors: "true",
    });
    const data = await this.call(`scrape?${params}`, {
      input: [input],
      limit_per_input: 1,
    });
    if (Array.isArray(data)) {
      if (data.length > 1)
        throw new ProviderError("Conferência retornou itens excedentes", false);
      return {
        items: data
          .map((x) => mapFacebook(x))
          .filter((x): x is RawListing => x !== null),
        complete: true,
        warnings: [],
      };
    }
    const pending = z
      .object({ snapshot_id: z.string().regex(/^[\w-]+$/) })
      .safeParse(data);
    if (pending.success)
      return {
        items: [],
        complete: false,
        cursor: pending.data.snapshot_id,
        warnings: [],
      };
    throw new ProviderError("Conferência sem confirmação da fonte", false);
  }

  async getListing(url: string): Promise<RawListing | null> {
    if (!facebookUrl(url) || !/\/item\/\d+/.test(new URL(url).pathname))
      throw new ProviderError("URL de anúncio Facebook inválida", false);
    const health = this.validatedHealth ?? (await this.healthCheck());
    const input = buildBrightDataInput(health.schemas?.collect_url, { url });
    if (!this.config.reserveCollectTrigger)
      throw new ProviderError(
        "Enriquecimento desativado. Collect by URL exige reserva separada no orçamento antes de coletar.",
        false,
      );
    if (!(await this.config.reserveCollectTrigger())) {
      const error = new ProviderError(
        "Limite diário atingido para Collect by URL.",
        false,
      );
      error.code = "budget_blocked";
      throw error;
    }
    // The synchronous detail API can yield a snapshot. Do not silently turn that into an empty listing.
    const params = new URLSearchParams({
      dataset_id: this.config.dataset ?? "gd_lvt9iwuh6fbcwmx1a",
      format: "json",
      include_errors: "true",
    });
    const result = await this.call(`scrape?${params}`, {
      input: [input],
      limit_per_input: 1,
    });
    if (Array.isArray(result)) {
      if (result.length !== 1)
        throw new ProviderError(
          "Detalhe retornou cardinalidade inesperada",
          false,
        );
      const listing = mapFacebook(result[0]);
      if (!listing)
        throw new ProviderError("Contrato de detalhe inválido", false);
      return listing;
    }
    const pending = z.object({ snapshot_id: z.string() }).safeParse(result);
    if (pending.success)
      throw new ProviderError(
        `Detalhe assíncrono: snapshot ${pending.data.snapshot_id}. Reconcilie este snapshot antes de solicitar outro enriquecimento.`,
        false,
      );
    throw new ProviderError("Contrato de detalhe inválido", false);
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
