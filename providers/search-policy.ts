import type { ProviderMethodSchema } from "./contract";
import { ProviderError } from "./contract";
import type { ProviderQuery } from "../core/provider-query";
import { fold } from "../core/text";

/** Labels are interpreted only after the value was supplied by metadata or a
 * scoped administrator confirmation. Unknown numeric codes are not guessed. */
export function publicationDays(value: string | number): 1 | 7 | null {
  if (typeof value !== "string") return null;
  const text = fold(value).replace(/[_-]+/g, " ").replace(/\s+/g, " ");
  if (
    /^(?:(?:last|past) (?:24 hours?|day)|ultimas? 24 horas?|ultimo dia)$/.test(
      text,
    )
  )
    return 1;
  if (
    /^(?:(?:last|past) (?:7 days?|week)|ultimos? 7 dias?|ultima semana)$/.test(
      text,
    )
  )
    return 7;
  return null;
}
export function radiusUnit(
  value: string | undefined,
): "km" | "miles" | "m" | null {
  const unit = fold(value ?? "");
  if (
    [
      "km",
      "kilometer",
      "kilometers",
      "kilometre",
      "kilometres",
      "quilometro",
      "quilometros",
    ].includes(unit)
  )
    return "km";
  if (["mi", "mile", "miles", "milha", "milhas"].includes(unit)) return "miles";
  if (
    ["m", "meter", "meters", "metre", "metres", "metro", "metros"].includes(
      unit,
    )
  )
    return "m";
  return null;
}
export function nativeFilterError(message: string): never {
  const error = new ProviderError(message, false);
  error.phase = "preflight";
  error.code = "native_filters_unconfirmed";
  throw error;
}

/** The monitor's current period is authoritative. No fallback to 24h, no
 * preservation of a stale date_listed and no unfiltered paid request. */
export function nativePublicationPolicy(
  query: ProviderQuery,
  schema: ProviderMethodSchema | undefined,
  requestedMinutes = 10080,
) {
  if (query.type !== "keyword")
    return { query, coverage: "url_filters" as const, days: null, issue: null };
  const days: 1 | 7 = requestedMinutes <= 1440 ? 1 : 7;
  // Fonte própria (scraper sem schema de filtros nativos): a recência é aplicada
  // LOCALMENTE pelo pipeline — o scraper devolve tudo e a busca é filtrada por
  // data depois. É o modo normal de operação, não uma pendência de configuração,
  // então não há bloqueio nem mensagem de erro.
  if (!schema)
    return { query, coverage: "local_only" as const, days: null, issue: null };
  const field = schema?.fields.find(
    (f) => f.name === "date_listed" && f.supported && f.inputEnabled !== false,
  );
  const confirmed = schema?.publicationValues?.[String(days) as "1" | "7"];
  const value =
    confirmed !== undefined && field?.options?.includes(confirmed)
      ? confirmed
      : field?.options?.find((v) => publicationDays(v) === days);
  if (value === undefined)
    return {
      query,
      coverage: "local_only" as const,
      days: null,
      issue: `O período de ${days === 1 ? "24 horas" : "7 dias"} ainda não está confirmado para esta fonte. Confirme o filtro de data na Administração antes de iniciar a coleta.`,
    };
  return {
    query: {
      ...query,
      ...(schema?.inputConfirmationId
        ? { inputConfirmationId: schema.inputConfirmationId }
        : {}),
      filters: { ...query.filters, date_listed: value },
    },
    coverage: "native" as const,
    days,
    issue: null,
  };
}

/** The monitor radius replaces stale native filters. Missing/unknown units are
 * an actionable configuration error, never a reason to silently omit radius. */
export function nativeRadius(
  query: ProviderQuery,
  schema: ProviderMethodSchema | undefined,
  radiusKm: number,
): ProviderQuery {
  if (query.type !== "keyword") return query;
  const field = schema?.fields.find(
    (f) => f.name === "radius" && f.supported && f.inputEnabled !== false,
  );
  if (!field || !["number", "integer", "text", "string"].includes(field.type))
    return nativeFilterError(
      "A fonte não confirmou um campo de raio compatível. Valide a configuração na Administração; a busca não será enviada sem raio.",
    );
  const unit = radiusUnit(field.unit);
  if (!unit)
    return nativeFilterError(
      "A unidade do raio não foi informada pela fonte. Confirme quilômetros, milhas ou metros na Administração. O raio não será omitido e nenhuma coleta será iniciada sem ele.",
    );
  if (!Number.isFinite(radiusKm) || radiusKm <= 0)
    return nativeFilterError("Informe um raio em quilômetros maior que zero.");
  const converted =
    unit === "km"
      ? radiusKm
      : unit === "m"
        ? radiusKm * 1000
        : radiusKm / 1.609344;
  // Preserve unit conversion rather than rounding to an unrelated distance.
  const n = Number(converted.toPrecision(15));
  if (field.type === "integer" && !Number.isInteger(n))
    return nativeFilterError(
      "O raio escolhido não pode ser representado exatamente na unidade inteira exigida pela fonte. Escolha um valor compatível; não faremos arredondamento silencioso.",
    );
  if (
    (field.min !== undefined && n < field.min) ||
    (field.max !== undefined && n > field.max)
  )
    return nativeFilterError(
      "O raio escolhido está fora dos limites publicados pela fonte. Revise o valor; não enviaremos uma distância diferente.",
    );
  const value = ["text", "string"].includes(field.type) ? String(n) : n;
  if (field.options && !field.options.includes(value))
    return nativeFilterError(
      "O raio escolhido não está entre os valores permitidos pela fonte. Revise o raio, sem arredondamento automático.",
    );
  return { ...query, filters: { ...query.filters, radius: value } };
}

export function exactNativeFilters(
  query: ProviderQuery,
  schema: ProviderMethodSchema | undefined,
  minutes: number,
  km: number,
) {
  const temporal = nativePublicationPolicy(query, schema, minutes);
  if (temporal.issue) nativeFilterError(temporal.issue);
  return { ...temporal, query: nativeRadius(temporal.query, schema, km) };
}
