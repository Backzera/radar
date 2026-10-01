import type { Monitor, Pricing, Settings } from "./types";
import { cents, fixedCosts } from "./pricing";

export function financialCeilingFor(
  sale: number | null,
  costs: Settings,
  minProfit = 0,
) {
  if (sale === null || !Number.isFinite(sale) || sale < 0) return null;
  const costCents =
    cents(fixedCosts(costs)) +
    Math.round(
      (cents(sale) * (costs.feePct + (costs.commissionPct ?? 0))) / 100,
    );
  return (
    Math.max(
      0,
      Math.min(
        Math.floor((cents(sale) - costCents) / (1 + costs.minRoi / 100)),
        cents(sale) - costCents - cents(minProfit),
      ),
    ) / 100
  );
}

export function purchasePolicy(
  pricing: Pricing,
  settings: Settings,
  monitor?: Monitor,
) {
  const costs: Settings = {
    ...settings,
    ...(monitor?.costs ?? {}),
    minRoi: monitor?.minRoi ?? settings.minRoi,
  };
  const manual = monitor?.expectedQuickSalePrice ?? null;
  const automatic = pricing.quickSale;
  const mode = monitor?.mode ?? "automatic";
  const sale =
    mode === "manual"
      ? manual
      : mode === "combined" && manual !== null
        ? automatic === null
          ? manual
          : Math.min(manual, automatic)
        : automatic;
  const source: Pricing["source"] =
    sale === null
      ? "insufficient"
      : mode === "manual" || (mode === "combined" && automatic === null)
        ? "manual"
        : mode === "combined" && manual !== null
          ? "hybrid"
          : "automatic";
  const feePct = costs.feePct + (costs.commissionPct ?? 0);
  const costCents =
    sale === null
      ? null
      : cents(fixedCosts(costs)) + Math.round((cents(sale) * feePct) / 100);
  const financialCeiling = financialCeilingFor(
    sale,
    costs,
    monitor?.minProfit ?? 0,
  );
  const maximum = monitor?.maxPrice ?? financialCeiling ?? 0;
  const strong =
    monitor?.strongPrice ??
    Math.max(monitor?.ultraPrice ?? 0, Math.floor(cents(maximum) * 0.92) / 100);
  const ultra =
    monitor?.ultraPrice ??
    Math.min(strong, Math.floor(cents(maximum) * 0.8) / 100);
  return {
    sale,
    source,
    costs,
    costCents,
    financialCeiling,
    maximum,
    strong,
    ultra,
  };
}

// Persist new monitor money as integer cents; API/UI continue using BRL.
export function financialStorage(m: Monitor) {
  return JSON.stringify({
    version: 1,
    maxPurchase: cents(m.maxPrice),
    strongPurchase: m.strongPrice === null ? null : cents(m.strongPrice),
    ultraPurchase: m.ultraPrice === null ? null : cents(m.ultraPrice),
    expectedQuickSale:
      m.expectedQuickSalePrice == null ? null : cents(m.expectedQuickSalePrice),
    minProfit: cents(m.minProfit ?? 0),
    costs: m.costs
      ? Object.fromEntries(
          Object.entries(m.costs).map(([k, v]) => [
            k,
            k.endsWith("Pct") ? v : cents(v),
          ]),
        )
      : null,
  });
}
export function restoreFinancials(m: Monitor, data: string | null): Monitor {
  if (!data) return m;
  const f = JSON.parse(data);
  if (f.version !== 1) throw new Error("Versão financeira desconhecida");
  return {
    ...m,
    maxPrice: f.maxPurchase / 100,
    strongPrice: f.strongPurchase === null ? null : f.strongPurchase / 100,
    ultraPrice: f.ultraPurchase === null ? null : f.ultraPurchase / 100,
    expectedQuickSalePrice:
      f.expectedQuickSale === null ? null : f.expectedQuickSale / 100,
    minProfit: f.minProfit / 100,
    costs: f.costs
      ? (Object.fromEntries(
          Object.entries(f.costs).map(([k, v]) => [
            k,
            k.endsWith("Pct") ? v : Number(v) / 100,
          ]),
        ) as unknown as Monitor["costs"])
      : null,
  };
}
