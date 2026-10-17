import { excludedEvidence, withoutNegatedRisks } from "./text";
import { publicationWindow, isWorkingCandidate } from "./selection";
import { automaticQueries } from "./query-strategy";
import { isSameOrNewer } from "./model-rank";
import { words, saleDescription } from "./text";
import { purchasePolicy } from "./purchase-policy";
import type { Analysis, Listing, Monitor, Settings, Pricing } from "./types";
import { freshness, discoveryDelay } from "./freshness";
import { fold, normalize, priceAnomalies } from "./normalize";
import { cents, priceListing, round } from "./pricing";
const clamp = (x: number, min = 0, max = 100) =>
  Math.min(max, Math.max(min, x));
export function distanceKm(
  aLat: number,
  aLon: number,
  bLat: number,
  bLon: number,
) {
  const r = Math.PI / 180,
    dLat = (bLat - aLat) * r,
    dLon = (bLon - aLon) * r;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(aLat * r) * Math.cos(bLat * r) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(h));
}
export function monitorMismatch(
  l: Listing,
  m: Monitor,
): { code: string; evidence: string }[] {
  const reasons: { code: string; evidence: string }[] = [];
  const target = normalize({ title: m.product || m.query, description: "" });
  // Em radares de revenda, aceitamos o modelo buscado OU um superior da mesma
  // linha (ex.: iPhone 11 -> 11 Pro/Pro Max, iPhone 12 -> 13+). O teto de preço,
  // aplicado adiante, corta o que passa do valor. Em "comprar para mim" mantém-se
  // o modelo exato.
  const upgradeAllowed =
    m.intent === "resale" &&
    !!target.model &&
    !l.product.ambiguous &&
    isSameOrNewer(target.model, l.product.model);
  if (l.product.ambiguous)
    reasons.push({
      code: "ambiguous_product",
      evidence:
        "O anúncio menciona mais de um produto. Confira a versão antes de comprar.",
    });
  if (target.model && target.model !== l.product.model && !upgradeAllowed)
    reasons.push({
      code: "product_model",
      evidence: "Modelo diferente ou insuficientemente identificado",
    });
  if (target.storage !== null && target.storage !== l.product.storage)
    reasons.push({
      code: "storage",
      evidence: "Armazenamento diferente ou desconhecido",
    });
  if (target.edition !== null && target.edition !== l.product.edition)
    reasons.push({
      code: "edition",
      evidence: "Versão diferente ou desconhecida",
    });
  const text = words(
      `${l.title} ${saleDescription(l.description)} ${l.product.model ?? ""}`,
    ),
    terms = automaticQueries(m.product || m.query, m.aliases).map(words);
  const match =
    (target.model !== null && target.model === l.product.model) ||
    terms.some(
      (q) =>
        text.includes(q) ||
        q
          .split(" ")
          .filter(Boolean)
          .every((t) => text.includes(t)),
    );
  if (m.queryType !== "search_url" && !match && !upgradeAllowed)
    reasons.push({
      code: "query",
      evidence: "Os termos de pesquisa não correspondem ao anúncio",
    });
  for (const evidence of excludedEvidence(
    l.title,
    l.description,
    m.negatives,
    m.negativeMode,
  ))
    reasons.push({ code: "excluded_term", evidence });
  if (
    m.condition !== "any" &&
    m.condition !== "working" &&
    m.condition !== l.product.condition
  )
    reasons.push({
      code: "condition",
      evidence: "Condição diferente da escolhida",
    });
  if (m.latitude !== null && m.longitude !== null) {
    if (l.latitude === null || l.longitude === null)
      reasons.push({
        code: "location_unknown",
        evidence: "Coordenadas do anúncio não verificadas",
      });
    else if (
      distanceKm(m.latitude, m.longitude, l.latitude, l.longitude) > m.radiusKm
    )
      reasons.push({
        code: "distance",
        evidence: "Fora da distância informada",
      });
  } else if (m.city && fold(m.city) !== fold(l.city))
    reasons.push({
      code: "city",
      evidence: "Cidade retornada diferente ou não informada",
    });
  return reasons;
}
export function matchesMonitor(l: Listing, m: Monitor): boolean {
  return monitorMismatch(l, m).length === 0;
}
export function analyze(
  l: Listing,
  pool: Listing[],
  settings: Settings,
  monitor?: Monitor,
  now = new Date(),
  calibration = 1,
  preparedPricing?: Pricing,
): Analysis {
  const p = preparedPricing
      ? {
          ...preparedPricing,
          comparables: [],
          explanation: [...preparedPricing.explanation],
        }
      : priceListing(
          l,
          pool,
          { ...settings, minRoi: monitor?.minRoi ?? settings.minRoi },
          now,
          calibration,
        ),
    f = freshness(
      l.publishedAt,
      l.publicationConfidence,
      now,
      l.publicationStatus,
    );
  const policy = purchasePolicy(p, settings, monitor);
  p.source = policy.source;
  p.quickSale = policy.sale;
  if (policy.source === "manual") p.calibrated = false;
  p.recommendedBuy = policy.financialCeiling;
  if (policy.source === "manual" || policy.source === "hybrid")
    p.explanation.unshift(
      policy.source === "manual"
        ? "Venda rápida informada pelo usuário; não é uma venda comprovada e não aumenta a confiança dos comparáveis."
        : "Híbrido conservador: menor valor entre venda manual e estimativa com comparáveis reais.",
    );
  const partial = priceAnomalies(l.title, l.description),
    risks = [...partial],
    blocked = [...partial];
  const text = fold(`${l.title} ${l.description}`);
  let risk = partial.length ? 70 : 0;
  if (
    /icloud|bloqueado|blacklist|sem face id|face id nao funciona/.test(
      withoutNegatedRisks(text),
    )
  ) {
    risk += 45;
    risks.push("Há indicação de bloqueio ou função indisponível");
  }
  if (l.product.condition === "damaged") {
    risk += 40;
    risks.push("Dano/defeito mencionado");
  }
  if (l.product.confidence < 70) {
    risk += 18;
    risks.push("Identificação incompleta da variante");
  }
  if (!l.sellerId) {
    risk += 8;
    risks.push("Poucos dados do vendedor");
  }
  if (!l.images.length) {
    risk += 5;
    risks.push("Fotos não disponíveis para inspeção");
  }
  if (l.product.batteryHealth !== null && l.product.batteryHealth < 80) {
    risk += 15;
    risks.push("Bateria abaixo de 80%");
  }
  if (p.median && l.price !== null && l.price < p.median * 0.5) {
    risks.push("Preço muito distante dos comparáveis");
  }
  if (pool.some((b) => b.id !== l.id && b.fingerprint === l.fingerprint)) {
    risk += 15;
    risks.push("Possível anúncio repetido: conferir vendedor e fotos");
  }
  if (l.currency !== "BRL" || l.price === null || l.price <= 0)
    blocked.push("Preço em BRL positivo não confirmado");
  if (["sold", "removed", "unavailable"].includes(l.availability))
    blocked.push("Disponibilidade confirmadamente inativa");
  if (l.availability === "unknown") {
    risk += 6;
    risks.push("Disponibilidade não confirmada (+6 de risco)");
  }
  if (!l.product.model || (policy.source !== "manual" && !l.product.key))
    blocked.push("Produto insuficientemente identificado");
  if (monitor && !matchesMonitor(l, monitor))
    blocked.push("Produto ou condição fora dos critérios do monitor");
  if (monitor && !monitor.active) blocked.push("Monitor pausado");
  if (l.demo) blocked.push("Dados de teste não geram oportunidade operacional");
  risk = clamp(risk);
  const invalidPrice =
    partial.length > 0 ||
    l.currency !== "BRL" ||
    l.price === null ||
    l.price <= 0;
  const sale = invalidPrice ? null : p.quickSale;
  const costs = sale === null ? null : (policy.costCents ?? 0) / 100;
  const gross =
      sale === null || l.price === null
        ? null
        : (cents(sale) - cents(l.price)) / 100,
    net =
      gross === null || costs === null
        ? null
        : (cents(gross) - cents(costs)) / 100;
  const roi =
    net === null || l.price === null || l.price <= 0
      ? null
      : round((net / l.price) * 100);
  const capitalRoi =
    net === null || costs === null || l.price === null
      ? null
      : round((net / (l.price + costs)) * 100);
  // Liquidity stays unknown until enough tracked outcomes exist. Offer volume alone is not demand.
  const liquidity: number | null = null;
  const contribution = (label: string, points: number) => ({
    label,
    points: Math.round(points),
  });
  const contributions = [
    contribution(
      "Desconto sobre venda rápida",
      sale && l.price !== null
        ? clamp(((sale - l.price) / sale) * 100, 0, 30)
        : 0,
    ),
    contribution(
      "ROI líquido após custos",
      roi === null ? 0 : clamp(roi * 0.6, 0, 25),
    ),
    contribution(
      "Recência da publicação",
      f.ageMinutes === null
        ? 0
        : f.ageMinutes <= 15
          ? 25
          : f.ageMinutes <= 60
            ? 22
            : f.ageMinutes <= 180
              ? 18
              : f.ageMinutes <= 720
                ? 12
                : f.ageMinutes <= 1440
                  ? 6
                  : 0,
    ),
    contribution("Confiança dos comparáveis reais", p.confidence * 0.1),
    contribution(
      "Preço abaixo do teto",
      monitor && l.price !== null && l.price <= monitor.maxPrice ? 10 : 0,
    ),
    contribution(
      "Disponibilidade não confirmada",
      l.availability === "unknown" ? -2 : 0,
    ),
    contribution("Identificação do produto", l.product.confidence * 0.1),
    contribution("Localização informada no anúncio", l.city ? 5 : 0),
    contribution("Ajuste de risco", -risk * 0.3),
  ];
  const sumScore = contributions.reduce((s, c) => s + c.points, 0);
  const rawScore = clamp(sumScore);
  if (sumScore !== rawScore)
    contributions.push(
      contribution("Limite do score (0–100)", rawScore - sumScore),
    );
  if (invalidPrice)
    contributions.push(
      contribution("Preço parcial: score financeiro bloqueado", -rawScore),
    );
  const score = invalidPrice ? 0 : rawScore;
  const event =
    l.previousPrice !== null &&
    l.price !== null &&
    l.price < l.previousPrice &&
    l.priceChangedAt &&
    now.getTime() - Date.parse(l.priceChangedAt) < 86400000
      ? "price_drop"
      : l.baseline
        ? "baseline"
        : "new";
  const window = publicationWindow(l, monitor, now);
  const maxAge = window.minutes;
  if (!isWorkingCandidate(l, monitor))
    blocked.push(
      "Produto para peças, com defeito ou bloqueio não aceito neste radar",
    );
  if (f.ageMinutes === null)
    blocked.push("Publicação desconhecida ou inválida: sem urgência");
  else if (
    maxAge !== null &&
    (now.getTime() - Date.parse(l.publishedAt!)) / 60000 > maxAge
  )
    blocked.push("Fora da janela de oportunidade");
  if ((monitor?.minLiquidity ?? 0) > 0 && liquidity === null)
    blocked.push("Histórico insuficiente para comprovar liquidez mínima");
  if (risk > (monitor?.maxRisk ?? settings.maxRisk))
    blocked.push("Risco acima do limite");
  if (
    monitor &&
    l.price !== null &&
    (l.price > monitor.maxPrice || l.price < monitor.minPrice)
  )
    blocked.push("Preço fora do teto/faixa de compra");
  if (net === null || net < (monitor?.minProfit ?? 0))
    blocked.push("Lucro líquido abaixo do mínimo ou indisponível");
  if (
    roi === null ||
    net === null ||
    !l.price ||
    cents(net) * 100 < cents(l.price) * (monitor?.minRoi ?? settings.minRoi)
  )
    blocked.push("ROI abaixo do mínimo ou indisponível");
  if (score < (monitor?.minScore ?? settings.minScore))
    blocked.push("Opportunity Score abaixo do mínimo");
  if (policy.source === "automatic" && p.confidence < 60)
    blocked.push("Dados insuficientes para precificação automática confiável");
  const quality = Math.round(
    clamp(
      (l.product.confidence +
        (f.ageMinutes === null ? 0 : l.publicationConfidence) +
        (policy.source === "manual" ? 60 : p.confidence)) /
        3 -
        (l.availability === "unknown" ? 6 : 0),
    ),
  );
  // Budget matching and financial approval are deliberately distinct.
  const generic = monitor?.identificationMode === "generic" || !l.product.model;
  const personal = monitor?.intent === "personal";
  const budgetEligible =
    !!monitor &&
    monitor.active &&
    !monitor.archived &&
    !l.demo &&
    matchesMonitor(l, monitor) &&
    window.valid &&
    isWorkingCandidate(l, monitor) &&
    partial.length === 0 &&
    !invalidPrice &&
    !l.product.ambiguous &&
    !["sold", "removed", "unavailable"].includes(l.availability) &&
    l.price! >= monitor.minPrice &&
    l.price! <= monitor.maxPrice &&
    risk <= monitor.maxRisk;
  const eligible =
    !!monitor && !generic && !personal && window.valid && blocked.length === 0;
  const notificationEligible = personal
    ? budgetEligible &&
      (event === "price_drop" || !l.baseline) &&
      f.ageMinutes !== null &&
      (maxAge === null || f.ageMinutes <= maxAge)
    : eligible && (event === "price_drop" || !l.baseline) && window.valid;
  const classification = eligible
    ? "financial_opportunity"
    : budgetEligible
      ? "within_budget"
      : invalidPrice ||
          ["sold", "removed", "unavailable"].includes(l.availability)
        ? "rejected"
        : "needs_review";

  const ultraManual =
    eligible &&
    l.price !== null &&
    l.price <= policy.ultra &&
    roi !== null &&
    roi >= Math.max(25, monitor?.minRoi ?? settings.minRoi) &&
    quality >= 60 &&
    risk <= Math.min(35, monitor?.maxRisk ?? settings.maxRisk);
  return {
    displayExpiresAt: window.expiresAt,
    publicationEligible: window.valid,
    classification,
    budgetEligible,
    notificationEligible,
    matchReasons: monitor ? monitorMismatch(l, monitor) : [],
    listingId: l.id,
    monitorId: monitor?.id,
    monitorName: monitor?.name,
    maxPurchasePrice: monitor?.maxPrice,
    strongPurchasePrice: policy.strong,
    ultraPurchasePrice: policy.ultra,
    requestedLocation: String(
      monitor?.providerFilters?.city ?? monitor?.city ?? "",
    ),
    maxListingAgeMinutes: maxAge,
    priceTier:
      l.price === null || l.price > policy.maximum
        ? "above_limit"
        : l.price <= policy.ultra
          ? "ultra"
          : l.price <= policy.strong
            ? "strong"
            : "interesting",
    ...f,
    risk,
    risks,
    score,
    contributions,
    pricing: p,
    liquidity,
    liquidityLabel:
      "Sem histórico suficiente; desaparecimento não comprova venda",
    grossProfit: gross,
    totalCosts: costs,
    netProfit: net,
    roi,
    capitalRoi,
    eligible,
    ultra: !!ultraManual,
    event,
    blocked,
    discoveryDelaySeconds: discoveryDelay(l),
    confidenceReasons: [
      `Identificação do produto: ${l.product.confidence}%`,
      `${p.count} comparáveis; confiança de preço ${p.confidence}%`,
      `Publicação: ${f.freshness}; confiança reportada ${l.publicationConfidence}%`,
      l.city
        ? "Localização retornada pelo anúncio"
        : "Localização não informada",
      l.availability === "unknown"
        ? "Disponibilidade não confirmada; confiança reduzida em 6 pontos"
        : `Disponibilidade: ${l.availability}`,
    ],
    quality,
  };
}
