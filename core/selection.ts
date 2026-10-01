import { freshness } from "./freshness";
import { withoutNegatedRisks } from "./text";
import type { Listing, Monitor } from "./types";

export const MAX_PUBLICATION_MINUTES = 7 * 24 * 60;
/** A data de publicação, nunca a coleta, determina a validade comercial. */
export function publicationWindow(l: Listing, m?: Monitor, now = new Date()) {
  const minutes = Math.min(
    MAX_PUBLICATION_MINUTES,
    m?.maxListingAgeMinutes ?? MAX_PUBLICATION_MINUTES,
  );
  const f = freshness(
    l.publishedAt,
    l.publicationConfidence,
    now,
    l.publicationStatus,
  );
  const trusted =
    f.ageMinutes !== null &&
    !["untrusted", "missing", "future", "invalid"].includes(
      l.publicationStatus ?? "valid",
    );
  const deadline = trusted
    ? Date.parse(l.publishedAt!) + minutes * 60000
    : null;
  return {
    valid: deadline !== null && now.getTime() <= deadline,
    expiresAt: deadline === null ? null : new Date(deadline).toISOString(),
    minutes,
    reason: !trusted
      ? "publication_unknown"
      : now.getTime() > deadline!
        ? "publication_old"
        : null,
  };
}
/** Peças avulsas não são um aparelho completo, mesmo que a palavra-chave coincida. */
export function isPartsOnly(title: string, description: string) {
  const t = withoutNegatedRisks(`${title} ${description}`);
  return /\b(?:para (?:retirada de )?pecas|somente pecas|retirada de pecas|sucata|so pecas|apenas pecas)\b/.test(
    t,
  );
}
export function isWorkingCandidate(l: Listing, m?: Monitor) {
  if (isPartsOnly(l.title, l.description)) return false;
  const text = withoutNegatedRisks(`${l.title} ${l.description}`);
  if (/\b(?:icloud|blacklist|bloquead[oa]|nao liga|nao funciona)\b/.test(text))
    return m?.condition === "damaged";
  return m?.condition === "damaged" || l.product.condition !== "damaged";
}
export function relativePublication(value: string | null, now = new Date()) {
  if (!value || !Number.isFinite(Date.parse(value)))
    return "Data de publicação não informada";
  const minutes = Math.floor((+now - Date.parse(value)) / 60000);
  if (minutes < 0) return "Data de publicação não confirmada";
  if (minutes < 60)
    return minutes <= 1
      ? "Publicado há menos de 2 minutos"
      : `Publicado há ${minutes} minutos`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24)
    return `Publicado há ${hours} ${hours === 1 ? "hora" : "horas"}`;
  const days = Math.floor(hours / 24);
  return `Publicado há ${days} ${days === 1 ? "dia" : "dias"}`;
}
