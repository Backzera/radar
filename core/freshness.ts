import type { Freshness, Listing, PublicationStatus } from "./types";
export const FRESHNESS_CONFIG = {
  minConfidence: 70,
  justPublishedMinutes: 15,
  recentMinutes: 1440,
} as const;
export function freshness(
  publishedAt: string | null,
  confidence: number,
  now = new Date(),
  status?: PublicationStatus,
): { freshness: Freshness; ageMinutes: number | null } {
  if (status === "future" || status === "invalid")
    return { freshness: "invalid", ageMinutes: null };
  if (status === "untrusted" || status === "missing")
    return { freshness: "unknown", ageMinutes: null };
  if (!publishedAt) return { freshness: "unknown", ageMinutes: null };
  const ms = Date.parse(publishedAt),
    age = (now.getTime() - ms) / 60000;
  if (!Number.isFinite(ms) || age < 0)
    return { freshness: "invalid", ageMinutes: null };
  if (confidence < FRESHNESS_CONFIG.minConfidence)
    return { freshness: "unknown", ageMinutes: null };
  return {
    freshness:
      age <= FRESHNESS_CONFIG.justPublishedMinutes
        ? "just_published"
        : age <= FRESHNESS_CONFIG.recentMinutes
          ? "recent"
          : "old",
    ageMinutes: Math.floor(age),
  };
}
export function discoveryDelay(
  l: Pick<
    Listing,
    | "publishedAt"
    | "firstSeenAt"
    | "publicationConfidence"
    | "publicationStatus"
  >,
): number | null {
  if (
    !l.publishedAt ||
    l.publicationConfidence < FRESHNESS_CONFIG.minConfidence ||
    ["future", "invalid", "untrusted"].includes(l.publicationStatus ?? "")
  )
    return null;
  const pub = Date.parse(l.publishedAt),
    seen = Date.parse(l.firstSeenAt),
    seconds = (seen - pub) / 1000;
  return Number.isFinite(seconds) &&
    seconds >= 0 &&
    seen <= Date.now() &&
    pub <= Date.now()
    ? seconds
    : null;
}
export function delayStatistics(values: (number | null)[]) {
  const a = values
    .filter((x): x is number => x !== null && Number.isFinite(x) && x >= 0)
    .sort((a, b) => a - b);
  const q = (p: number) =>
    a.length ? a[Math.min(a.length - 1, Math.ceil(p * a.length) - 1)] : null;
  return {
    samples: a.length,
    meanSeconds: a.length ? a.reduce((s, x) => s + x, 0) / a.length : null,
    medianSeconds: q(0.5),
    p75Seconds: q(0.75),
    p90Seconds: q(0.9),
    p95Seconds: q(0.95),
    bestSeconds: a[0] ?? null,
    worstSeconds: a.at(-1) ?? null,
  };
}
export function discoveryDelays(listings: Listing[]) {
  return delayStatistics(
    listings.filter((l) => !l.baseline).map(discoveryDelay),
  );
}
export function canonicalUrl(raw: string): string {
  try {
    const u = new URL(raw);
    const id = u.pathname.match(/\/marketplace\/item\/(\d+)/)?.[1];
    if (id) return `https://www.facebook.com/marketplace/item/${id}/`;
    u.search = "";
    u.hash = "";
    return u.toString().replace(/\/$/, "");
  } catch {
    return raw;
  }
}
export function fingerprint(parts: string[]): string {
  const text = parts
    .join("|")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++)
    hash = Math.imul(hash ^ text.charCodeAt(i), 16777619);
  return (hash >>> 0).toString(16);
}
