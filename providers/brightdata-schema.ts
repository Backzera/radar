import { z } from "zod";
import type { ProviderQuery } from "../core/provider-query";
import {
  ProviderError,
  type ProviderField,
  type ProviderHealth,
  type ProviderMethodSchema,
} from "./contract";

const scalar = z.union([z.string().max(500), z.number().finite()]);
const fieldSchema = z
  .object({
    name: z.string().max(100),
    type: z.string().optional(),
    required: z.boolean().optional(),
  })
  .passthrough();
const methodSchema = z.object({
  input_schema: z.array(fieldSchema).max(50),
  output_fields: z.array(fieldSchema),
  link: z.string().optional(),
});
const datasetSchema = z.array(
  z.object({
    id: z.string(),
    domain: z.string(),
    scrapers: z.record(z.unknown()),
    scraper_type: z.array(z.string()).optional(),
  }),
);
const textual = ["text", "string", "country", "date", "select", "enum"];
const allowed: Record<string, string[]> = {
  keyword: ["keyword", "city", "radius", "date_listed"],
  search_url: ["url", "country"],
  collect_url: ["url"],
};
function normalizeField(
  raw: z.infer<typeof fieldSchema>,
  mode: string,
  accountPanelConfirmed = false,
): ProviderField {
  const type = raw.type ?? "unknown";
  const choices = raw.enum ?? raw.options;
  let options: (string | number)[] | undefined;
  if (Array.isArray(choices) && choices.length > 0 && choices.length <= 500) {
    const parsed = z
      .array(scalar)
      .safeParse(
        choices.map((v: unknown) =>
          v && typeof v === "object" && "value" in v ? v.value : v,
        ),
      );
    if (parsed.success) options = parsed.data;
  }
  const min = raw.minimum ?? raw.min;
  const max = raw.maximum ?? raw.max;
  const supported =
    allowed[mode].includes(raw.name) &&
    (raw.name === "url"
      ? ["text", "string", "url"].includes(type)
      : raw.name === "keyword"
        ? ["text", "string"].includes(type)
        : raw.name === "radius"
          ? ["number", "integer", "text", "string"].includes(type)
          : textual.includes(type));
  const numeric = ["number", "integer"].includes(type);
  const issue = !supported
    ? "Campo ou tipo ainda não suportado pelo adapter."
    : choices !== undefined && !options
      ? "Opções incompatíveis na metadata."
      : options?.some((value) =>
            numeric
              ? typeof value !== "number" ||
                (type === "integer" && !Number.isInteger(value))
              : typeof value !== "string",
          )
        ? "Tipos das opções divergem do tipo do campo na metadata."
        : raw.name === "date_listed" && !options
          ? "Campo suportado, mas opções não publicadas pela metadata."
          : (min !== undefined &&
                (typeof min !== "number" || !Number.isFinite(min))) ||
              (max !== undefined &&
                (typeof max !== "number" || !Number.isFinite(max))) ||
              (typeof min === "number" && typeof max === "number" && min > max)
            ? "Limites incompatíveis na metadata."
            : undefined;
  return {
    name: raw.name,
    type,
    required: raw.required === true,
    supported:
      supported &&
      (!issue ||
        (raw.name === "date_listed" && !options && choices === undefined)),
    inputEnabled:
      supported &&
      (!issue ||
        (accountPanelConfirmed &&
          raw.name === "date_listed" &&
          choices === undefined &&
          ["text", "string"].includes(type))),
    enumPublished: options !== undefined,
    ...(options
      ? { options, optionsSource: "metadata" as const }
      : accountPanelConfirmed &&
          raw.name === "date_listed" &&
          supported &&
          choices === undefined &&
          ["text", "string"].includes(type)
        ? {
            options: ["Last 24 hours"],
            optionsSource: "account_panel" as const,
          }
        : {}),
    ...(typeof min === "number" && Number.isFinite(min) ? { min } : {}),
    ...(typeof max === "number" && Number.isFinite(max) ? { max } : {}),
    ...(typeof raw.unit === "string" && raw.unit.length <= 80
      ? { unit: raw.unit }
      : {}),
    ...(typeof raw.description === "string"
      ? { description: raw.description.slice(0, 1000) }
      : {}),
    ...(issue ? { issue } : {}),
  };
}
export async function inspectBrightDataMetadata(
  value: unknown,
  dataset: string,
): Promise<ProviderHealth> {
  const parsed = datasetSchema.safeParse(value);
  const item = parsed.success
    ? parsed.data.find(
        (d) =>
          d.id === dataset &&
          ["facebook.com", "www.facebook.com"].includes(d.domain),
      )
    : undefined;
  type Mode = "keyword" | "search_url" | "collect_url";
  const entries: {
    endpointId: string;
    contract: string;
    mode: Mode;
    method: z.infer<typeof methodSchema>;
  }[] = [];
  const declared = item?.scraper_type;
  for (const [endpointId, raw] of Object.entries(item?.scrapers ?? {})) {
    const parsedMethod = methodSchema.safeParse(raw);
    if (!parsedMethod.success) continue;
    const method = parsedMethod.data;
    const keyword = method.input_schema.some(
      (f) => f.name === "keyword" && f.required,
    );
    const url = method.input_schema.some((f) => f.name === "url" && f.required);
    if (keyword === url) continue;
    // Management API keys are executable types. Opaque keys require corroboration
    // by the declared scraper_type and the dataset-specific configuration link.
    let linkMode: Mode | undefined;
    if (method.link) {
      try {
        const link = new URL(method.link);
        if (
          link.protocol !== "https:" ||
          !["brightdata.com", "www.brightdata.com"].includes(link.hostname) ||
          link.username ||
          link.password ||
          link.port ||
          link.search ||
          link.hash
        )
          continue;
        const match = link.pathname.match(
          /^\/cp\/scrapers\/([^/]+)\/(keyword|url|pdp)\/configuration\/?$/,
        );
        if (!match || match[1] !== dataset) continue;
        linkMode =
          match[2] === "keyword"
            ? "keyword"
            : match[2] === "url"
              ? "search_url"
              : "collect_url";
      } catch {
        continue;
      }
    }
    let contract: string | undefined;
    let mode: Mode | undefined;
    if (/^discover_by_[a-z0-9_]+$/.test(endpointId)) {
      contract = endpointId;
      mode = keyword ? "keyword" : "search_url";
    } else if (endpointId === "collect_by_url" && url) {
      contract = endpointId;
      mode = "collect_url";
    } else if (linkMode && declared) {
      mode = linkMode;
      contract = {
        keyword: "discover_by_keyword",
        search_url: "discover_by_url",
        collect_url: "collect_by_url",
      }[mode];
    }
    if (
      !contract ||
      !mode ||
      (declared && !declared.includes(contract)) ||
      (linkMode && linkMode !== mode) ||
      (mode === "keyword" ? !keyword : !url)
    )
      continue;
    if (
      (contract === "discover_by_keyword" && mode !== "keyword") ||
      (contract === "discover_by_url" && mode !== "search_url")
    )
      continue;
    entries.push({ endpointId, contract, mode, method });
  }
  const read = async (
    entry: (typeof entries)[number],
  ): Promise<ProviderMethodSchema> => {
    const { endpointId, contract, mode, method } = entry;
    const fields = method.input_schema.map((f) =>
      normalizeField(f, mode, dataset === "gd_lvt9iwuh6fbcwmx1a"),
    );
    const primary = mode === "keyword" ? "keyword" : "url";
    const issues: string[] = [];
    if (!fields.some((f) => f.name === primary && f.supported))
      issues.push("Campo " + primary + " ausente ou incompatível.");
    if (new Set(fields.map((f) => f.name)).size !== fields.length)
      issues.push("Campos duplicados no contrato.");
    for (const f of fields)
      if (f.required && !f.inputEnabled) issues.push(f.name + ": " + f.issue);
    const output = method.output_fields
      .map((f) => ({ name: f.name, type: f.type }))
      .sort((a, b) => a.name.localeCompare(b.name));
    const hasOutput = (name: string, types: string[]) =>
      output.some(
        (f) => f.name === name && (!f.type || types.includes(f.type)),
      );
    const hasUrl = hasOutput("url", ["url", "text", "string"]);
    const hasTitle = hasOutput("title", ["text", "string"]);
    if (
      !hasUrl ||
      (mode === "collect_url" && !hasTitle) ||
      new Set(output.map((f) => f.name)).size !== output.length
    )
      issues.push(
        mode === "collect_url"
          ? "Saída de detalhe deve declarar URL e título compatíveis."
          : "Saída de descoberta deve declarar uma URL compatível.",
      );
    const outputKind = hasTitle
      ? ("listing" as const)
      : ("url_candidates" as const);
    const canonicalFields = fields
      .map((f) => ({
        name: f.name,
        type: f.type,
        required: f.required,
        supported: f.supported,
        inputEnabled: f.inputEnabled,
        enumPublished: f.enumPublished,
        min: f.min,
        max: f.max,
        unit: f.unit,
        ...(f.options
          ? {
              options: [...new Set(f.options)].sort((a, b) =>
                String(a).localeCompare(String(b)),
              ),
            }
          : {}),
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
    const hash = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(
        JSON.stringify({ dataset, contract, fields: canonicalFields, output }),
      ),
    );
    const fingerprint = [...new Uint8Array(hash)]
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    return {
      contract,
      endpointId,
      ...(mode === "collect_url"
        ? {}
        : { discriminator: contract.replace(/^discover_by_/, "") }),
      outputKind,
      outputFields: output,
      fields,
      fingerprint,
      compatible: issues.length === 0,
      issues,
    };
  };
  const schemas = await Promise.all(entries.map(read));
  const choose = (mode: Mode) => {
    const matches = entries
      .map((entry, i) => ({ entry, schema: schemas[i] }))
      .filter((x) => x.entry.mode === mode);
    const canonical = {
      keyword: "discover_by_keyword",
      search_url: "discover_by_url",
      collect_url: "collect_by_url",
    }[mode];
    const preferred = matches.filter((x) => x.entry.contract === canonical);
    const candidates = preferred.length ? preferred : matches;
    return candidates.length === 1 ? candidates[0].schema : undefined;
  };
  const keywordSchema = choose("keyword"),
    urlSchema = choose("search_url"),
    collectSchema = choose("collect_url");
  const keyword = keywordSchema?.compatible === true,
    search_url = urlSchema?.compatible === true,
    collect_url = collectSchema?.compatible === true;
  return {
    dataset,
    ok: keyword || search_url,
    message: !item
      ? "Dataset inválido ou schema de metadata incompatível."
      : [
          keyword
            ? "Discover by keyword confirmado."
            : "O método keyword não foi encontrado ou é incompatível/ambíguo neste dataset.",
          search_url
            ? "Discover by URL confirmado."
            : "O método Search URL não foi encontrado ou é incompatível/ambíguo neste dataset.",
          ...(keywordSchema?.issues ?? []),
          ...(urlSchema?.issues ?? []),
          "Contrato de descoberta validado; o conteúdo final do snapshot só será comprovado na consulta manual. Nenhuma coleta foi executada nesta validação.",
        ].join(" "),
    methods: { keyword, search_url, collect_url },
    contracts: {
      ...(keyword ? { keyword: keywordSchema.contract } : {}),
      ...(search_url ? { search_url: urlSchema.contract } : {}),
      ...(collect_url ? { collect_url: collectSchema.contract } : {}),
    },
    schemas: {
      ...(keywordSchema ? { keyword: keywordSchema } : {}),
      ...(urlSchema ? { search_url: urlSchema } : {}),
      ...(collectSchema ? { collect_url: collectSchema } : {}),
    },
  };
}

export function buildBrightDataInput(
  schema: ProviderMethodSchema | undefined,
  primary: Record<string, string>,
  filters: Record<string, string | number> = {},
  fingerprint?: string,
): Record<string, string | number> {
  const fail = (message: string): never => {
    const e = new ProviderError(message, false);
    e.phase = "preflight";
    throw e;
  };
  if (!schema?.compatible)
    return fail(
      "O método necessário não foi encontrado ou é incompatível com este dataset.",
    );
  if (fingerprint && fingerprint !== schema.fingerprint)
    return fail(
      "O contrato da Bright Data mudou. Valide novamente a configuração e revise os filtros antes de coletar.",
    );
  const input: Record<string, string | number> = { ...primary };
  for (const [key, value] of Object.entries(filters)) {
    if (Object.hasOwn(primary, key))
      return fail(`Filtro ${key} não pode substituir a entrada principal.`);
    input[key] = value;
  }
  for (const key of Object.keys(input))
    if (!schema.fields.some((f) => f.name === key))
      return fail(`O campo ${key} não existe no contrato atual.`);
  for (const f of schema.fields) {
    const value = input[f.name];
    if (value === undefined) {
      if (f.required)
        return fail(
          `Informe ${f.name}: obrigatório no contrato da Bright Data.`,
        );
      continue;
    }
    if (!f.supported || f.inputEnabled === false)
      return fail(`${f.name}: ${f.issue ?? "campo incompatível"}`);
    const numeric = ["number", "integer"].includes(f.type);
    if (
      numeric
        ? typeof value !== "number" || !Number.isFinite(value)
        : typeof value !== "string" ||
          !value.trim() ||
          value.length > (f.name === "url" ? 4096 : 500)
    )
      return fail(`Valor inválido para ${f.name}; tipo esperado: ${f.type}.`);
    if (f.type === "integer" && !Number.isInteger(value))
      return fail(`${f.name} deve ser inteiro.`);
    if (f.options && !f.options.includes(value))
      return fail(
        `Valor de ${f.name} não está entre as opções do contrato atual.`,
      );
    if (numeric || f.name === "radius") {
      const n = Number(value);
      if (
        !Number.isFinite(n) ||
        (f.name === "radius" && n <= 0) ||
        (f.min !== undefined && n < f.min) ||
        (f.max !== undefined && n > f.max)
      )
        return fail(
          `Valor de ${f.name} inválido ou fora dos limites publicados pelo provider.`,
        );
    }
  }
  return input;
}
/** Fill the native city only when the current contract supports it.
 * Monitors can be saved before the administrator validates the provider.
 * Do not overwrite explicit native filters, infer countries, drop filters,
 * or replace a pinned fingerprint. Paid snapshots retain their exact query.
 */
export function withKeywordCity(
  query: ProviderQuery,
  schema: ProviderMethodSchema | undefined,
  city: string,
): ProviderQuery {
  if (
    query.type !== "keyword" ||
    Object.hasOwn(query.filters ?? {}, "city") ||
    !city.trim() ||
    !schema?.compatible ||
    !schema.fields.some(
      (f) =>
        f.name === "city" &&
        f.supported &&
        f.inputEnabled !== false &&
        ["text", "string"].includes(f.type),
    )
  )
    return query;
  return { ...query, filters: { ...query.filters, city: city.trim() } };
}

export function discoveryInput(
  schema: ProviderMethodSchema | undefined,
  query: ProviderQuery,
) {
  return buildBrightDataInput(
    schema,
    query.type === "keyword" ? { keyword: query.keyword } : { url: query.url },
    query.filters,
    query.contractFingerprint,
  );
}
