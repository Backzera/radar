import type { Comparable, Listing, Pricing, Settings } from "./types";
import { priceAnomalies } from "./normalize";
export const cents = (n: number) => Math.round((n + Number.EPSILON) * 100);
export const round = (n: number) => cents(n) / 100;
export function percentile(values: number[], p: number): number | null {
  if (!values.length) return null;
  const a = [...values].sort((x, y) => x - y),
    i = (a.length - 1) * p,
    l = Math.floor(i);
  return a[l] + (a[Math.ceil(i)] - a[l]) * (i - l);
}
export function fixedCosts(s: Settings): number {
  return (
    [
      s.fuel ?? 0,
      s.transport,
      s.maintenance,
      s.cleaning,
      s.packaging,
      s.other,
    ].reduce((sum, n) => sum + cents(n), 0) / 100
  );
}
export function comparableSimilarity(
  a: Listing,
  b: Listing,
  priceInvalid?: boolean,
): { score: number; reason: string } {
  if (a.id === b.id || a.demo !== b.demo)
    return {
      score: 0,
      reason: "Próprio anúncio ou domínio de dados diferente",
    };
  if (!a.product.key || a.product.key !== b.product.key)
    return {
      score: 0,
      reason: "Modelo, armazenamento ou edição incompatível/desconhecido",
    };
  if (
    a.product.condition === "unknown" ||
    b.product.condition === "unknown" ||
    a.product.condition === "damaged" ||
    b.product.condition === "damaged"
  )
    return { score: 0, reason: "Condição incerta ou danificada" };
  if ((a.product.condition === "new") !== (b.product.condition === "new"))
    return { score: 0, reason: "Novo e usado não são comparáveis" };
  if (
    b.currency !== "BRL" ||
    b.price === null ||
    b.price <= 0 ||
    (priceInvalid ?? !!priceAnomalies(b.title, b.description).length)
  )
    return { score: 0, reason: "Preço inválido ou parcial" };
  if (a.sellerId && a.sellerId === b.sellerId)
    return { score: 0, reason: "Mesmo vendedor: evitar duplicação da oferta" };
  let score = 100;
  if (a.city !== b.city) score -= 10;
  if (a.product.condition !== b.product.condition) score -= 7;
  if (!b.sellerId) score -= 5;
  if (b.availability === "unknown") score -= 8;
  return {
    score,
    reason:
      score >= 90
        ? "Mesma variante e condição compatível"
        : "Variante compatível; ajuste por região ou condição",
  };
}
export function priceListing(
  listing: Listing,
  pool: Listing[],
  settings: Settings,
  now = new Date(),
  calibration = 1,
  prepared?: ReadonlyMap<Listing, boolean>,
): Pricing {
  const seenSellers = new Set<string>();
  const seenFingerprints = new Set<string>();
  const comparables: Comparable[] = pool
    .map((l) => {
      const sim = comparableSimilarity(listing, l, prepared?.get(l));
      const ageDays = (now.getTime() - Date.parse(l.lastSeenAt)) / 86400000;
      const duplicate =
        (l.sellerId ? seenSellers.has(l.sellerId) : false) ||
        seenFingerprints.has(l.fingerprint);
      const included =
        sim.score >= 80 &&
        ageDays <= (l.availability === "unknown" ? 7 : 30) &&
        ["active", "unknown"].includes(l.availability) &&
        !duplicate;
      if (included && l.sellerId) seenSellers.add(l.sellerId);
      if (included) seenFingerprints.add(l.fingerprint);
      return {
        id: l.id,
        title: l.title,
        price: l.price,
        similarity: sim.score,
        included,
        reason: duplicate
          ? "Oferta repetida do vendedor/fingerprint"
          : ageDays > 30
            ? "Observação com mais de 30 dias"
            : l.availability === "unknown"
              ? "Preço pedido; disponibilidade desconhecida, confiança reduzida"
              : l.availability !== "active"
                ? "Oferta indisponível"
                : sim.reason,
      };
    })
    .filter((c) => c.similarity > 0);
  const prices = comparables
    .filter((c) => c.included)
    .map((c) => c.price)
    .filter((p): p is number => p !== null);
  const ordered = [...prices].sort((a, b) => a - b);
  const at = (values: number[], p: number): number | null => {
    if (!values.length) return null;
    const i = (values.length - 1) * p,
      lo = Math.floor(i);
    return values[lo] + (values[Math.ceil(i)] - values[lo]) * (i - lo);
  };
  const median = at(ordered, 0.5) ?? 0;
  const mad =
    at(
      prices.map((p) => Math.abs(p - median)).sort((a, b) => a - b),
      0.5,
    ) ?? 0;
  const q25 = at(ordered, 0.25) ?? 0,
    q75 = at(ordered, 0.75) ?? 0;
  const iqr = q75 - q25;
  if (prices.length >= 5)
    for (const c of comparables) {
      if (!c.included || c.price === null) continue;
      const outlier =
        mad > 0
          ? Math.abs((0.6745 * (c.price - median)) / mad) > 3.5
          : iqr > 0
            ? c.price < q25 - 1.5 * iqr || c.price > q75 + 1.5 * iqr
            : c.price < median * 0.65 || c.price > median * 1.5;
      if (outlier) {
        c.included = false;
        c.reason = "Outlier de preço excluído (MAD/IQR)";
      }
    }
  const valid = comparables.filter((c) => c.included),
    clean = valid.map((c) => c.price).filter((p): p is number => p !== null),
    n = clean.length;
  const avgSimilarity = n ? valid.reduce((s, c) => s + c.similarity, 0) / n : 0;
  const availabilityById = new Map(pool.map((l) => [l.id, l.availability]));
  const uncertainShare = valid.length
    ? valid.filter((c) => availabilityById.get(c.id) === "unknown").length /
      valid.length
    : 0;
  const confidence = Math.round(
    Math.min(
      95 - 30 * uncertainShare,
      n < 5 ? n * 9 : 45 + Math.min(40, n * 3) + avgSimilarity / 10,
    ),
  );
  const cleanOrdered = [...clean].sort((a, b) => a - b);
  const stats = {
    mean: n ? round(clean.reduce((a, b) => a + b, 0) / n) : null,
    median: at(cleanOrdered, 0.5),
    p5: at(cleanOrdered, 0.05),
    p25: at(cleanOrdered, 0.25),
    p75: at(cleanOrdered, 0.75),
  };
  const quickSale =
    n >= 5
      ? round(stats.p25! * 0.97 * Math.max(0.8, Math.min(1.05, calibration)))
      : null;
  return {
    ...stats,
    count: n,
    candidates: prices.length,
    market: n >= 5 ? stats.median : null,
    quickSale,
    automaticBase: n >= 5 ? round(stats.p25! * 0.97) : null,
    recommendedBuy:
      quickSale === null
        ? null
        : round(
            Math.max(
              0,
              (quickSale * (1 - settings.feePct / 100) - fixedCosts(settings)) /
                (1 + settings.minRoi / 100),
            ),
          ),
    exceptionalBuy:
      quickSale === null || stats.p5 === null
        ? null
        : round(
            Math.max(
              0,
              Math.min(
                stats.p5 * 0.75,
                (quickSale * (1 - settings.feePct / 100) -
                  fixedCosts(settings)) /
                  1.4,
              ),
            ),
          ),
    confidence,
    comparables,
    calibrated: calibration !== 1,
    explanation: [
      `${n} comparáveis válidos de ${prices.length} candidatos; variante exata e condição compatível.`,
      "Preços anunciados, sem confirmação de venda. Venda rápida é uma hipótese, sem prazo garantido.",
      "Venda rápida = P25 × 0,97 × fator de calibração; mínimo de 5 comparáveis.",
      `Calibração por vendas registradas: ${calibration.toFixed(3)}. Compra máxima considera custos e ROI mínimo ${settings.minRoi}%.`,
    ],
  };
}
