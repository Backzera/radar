import type { QueryType } from "./types";
export class ProviderQueryError extends Error {}
export function searchUrlError(value: string): string | null {
  if (validateSearchUrl(value)) return null;
  try {
    const u = new URL(value);
    if (
      ["facebook.com", "www.facebook.com"].includes(u.hostname) &&
      /^\/marketplace\/item\//.test(u.pathname)
    )
      return "Este é o link de um anúncio. Cole a URL da página de resultados da pesquisa do Marketplace.";
  } catch {
    /* Use the safe generic message below. */
  }
  return "Use uma URL HTTPS da página de resultados do Facebook Marketplace, em facebook.com ou www.facebook.com.";
}
export type ProviderQuery = (
  { type: "keyword"; keyword: string } | { type: "search_url"; url: string }
) & {
  filters?: Record<string, string | number>;
  contractFingerprint?: string;
  inputConfirmationId?: string;
};
export function canonicalProviderFilters(
  filters: Record<string, string | number> = {},
) {
  return Object.fromEntries(
    Object.entries(filters).sort(([a], [b]) => a.localeCompare(b)),
  );
}
// Preserve Facebook filters verbatim. Validate the URL, never fetch it ourselves.
export function validateSearchUrl(value: string): boolean {
  try {
    if (
      value !== value.trim() ||
      value.length > 4096 ||
      /[\u0000-\u0020\\]/.test(value)
    )
      return false;
    const u = new URL(value);
    if (
      u.protocol !== "https:" ||
      !["www.facebook.com", "facebook.com"].includes(u.hostname) ||
      u.port ||
      u.username ||
      u.password ||
      u.hash
    )
      return false;
    if (!/^\/marketplace\/(?:[a-zA-Z0-9_-]+\/)?search\/?$/.test(u.pathname))
      return false;
    for (const [key, val] of u.searchParams) {
      if (
        /^(?:next|redirect|redirect_uri|redirect_url|url|href|u|access_token|token|cookie|session)$/i.test(
          key,
        ) ||
        /^(?:https?:|file:|ftp:|\/\/)/i.test(val)
      )
        return false;
    }
    return true;
  } catch {
    return false;
  }
}
export function providerQuery(
  query: string,
  queryType: QueryType = "keyword",
  url?: string | null,
  filters?: Record<string, string | number>,
  contractFingerprint?: string,
): ProviderQuery {
  const options = {
    ...(filters && Object.keys(filters).length
      ? { filters: canonicalProviderFilters(filters) }
      : {}),
    ...(contractFingerprint ? { contractFingerprint } : {}),
  };
  if (queryType === "search_url") {
    const error = searchUrlError(url ?? "");
    if (error) throw new ProviderQueryError(error);
    return { type: "search_url", url: url!, ...options };
  }
  if (query.trim().length < 2 || query.trim().length > 150)
    throw new ProviderQueryError(
      "Informe uma palavra-chave entre 2 e 150 caracteres.",
    );
  return { type: "keyword", keyword: query.trim(), ...options };
}
