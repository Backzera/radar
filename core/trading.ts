import type { Listing, Purchase } from "./types";
import { cents, percentile } from "./pricing";
export function purchaseOutcome(p: Purchase, now = new Date()) {
  const costCents =
    cents(p.costs) + cents(p.saleFees ?? 0) + cents(p.additionalCosts ?? 0);
  const net =
    p.soldFor === null
      ? null
      : (cents(p.soldFor) - cents(p.paid) - costCents) / 100;
  return {
    costs: costCents / 100,
    net,
    roi:
      net === null || p.paid <= 0
        ? null
        : Math.round((net / p.paid) * 10000) / 100,
    days: Math.max(
      0,
      Math.floor(
        ((p.soldAt ? Date.parse(p.soldAt) : +now) - Date.parse(p.boughtAt)) /
          86400000,
      ),
    ),
    estimateError:
      net === null || p.estimatedProfit == null
        ? null
        : (cents(net) - cents(p.estimatedProfit)) / 100,
    saleError:
      p.soldFor === null || p.estimated === null
        ? null
        : (cents(p.soldFor) - cents(p.estimated)) / 100,
  };
}
export function calibrationFactor(
  l: Listing,
  pool: Listing[],
  purchases: Purchase[],
) {
  const sales = purchases.filter(
    (p) =>
      p.soldFor !== null &&
      (p.estimateSource === "automatic" || p.estimateSource === "hybrid") &&
      Number.isFinite(p.automaticBaseEstimate) &&
      p.automaticBaseEstimate! > 0 &&
      pool.some(
        (b) =>
          b.id === p.listingId && !b.demo && b.product.key === l.product.key,
      ),
  );
  return sales.length >= 5
    ? Math.min(
        1.05,
        Math.max(
          0.8,
          percentile(
            sales.map((p) => p.soldFor! / p.automaticBaseEstimate!),
            0.5,
          ) ?? 1,
        ),
      )
    : 1;
}
