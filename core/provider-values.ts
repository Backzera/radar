import type { PublicationStatus } from "./types";
export function parseBRL(value: unknown): number | null {
  if (typeof value === "number")
    return Number.isFinite(value) && value >= 0 ? value : null;
  if (typeof value !== "string") return null;
  const s = value
    .trim()
    .replace(/^R\$\s*/i, "")
    .replace(/\s/g, "");
  let normalized: string;
  if (/^\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?$/.test(s))
    normalized = s.replaceAll(".", "").replace(",", ".");
  else if (/^\d+(?:,\d{1,2})?$/.test(s)) normalized = s.replace(",", ".");
  else if (/^\d+\.\d{1,2}$/.test(s)) normalized = s;
  else return null;
  const n = Number(normalized);
  return Number.isFinite(n) && n <= 1_000_000 ? n : null;
}
export function parsePublication(
  value: unknown,
  now = new Date(),
): { value: string | null; status: PublicationStatus; confidence: number } {
  if (value == null || value === "")
    return { value: null, status: "missing", confidence: 0 };
  if (typeof value !== "string")
    return { value: null, status: "invalid", confidence: 0 };
  const m = value.match(
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(Z|[+-]\d{2}:?\d{2})$/i,
  );
  if (!m)
    return {
      value: null,
      status: Number.isFinite(Date.parse(value)) ? "untrusted" : "invalid",
      confidence: 0,
    };
  const [, y, month, day, h, min, sec] = m,
    maxDay = new Date(Date.UTC(Number(y), Number(month), 0)).getUTCDate();
  const ms = Date.parse(value);
  if (
    +month < 1 ||
    +month > 12 ||
    +day < 1 ||
    +day > maxDay ||
    +h > 23 ||
    +min > 59 ||
    +sec > 59 ||
    !Number.isFinite(ms)
  )
    return { value: null, status: "invalid", confidence: 0 };
  if (ms > now.getTime())
    return { value: null, status: "future", confidence: 0 };
  return { value: new Date(ms).toISOString(), status: "valid", confidence: 75 };
}
