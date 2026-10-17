export type Freshness =
  "just_published" | "recent" | "old" | "unknown" | "invalid";
export type QueryType = "keyword" | "search_url";
export type PublicationStatus =
  "valid" | "missing" | "untrusted" | "invalid" | "future";
export type Availability =
  "active" | "sold" | "removed" | "unavailable" | "unknown";
export type Condition = "new" | "excellent" | "used" | "damaged" | "unknown";
export type Mode = "automatic" | "manual" | "combined";
export interface Product {
  support?: "supported" | "partial" | "generic";
  ambiguous?: boolean;
  brand: string | null;
  model: string | null;
  category: string;
  storage: number | null;
  edition: string | null;
  color: string | null;
  condition: Condition;
  confidence: number;
  batteryHealth: number | null;
  box: boolean | null;
  charger: boolean | null;
  faceId: string | null;
  key: string | null;
}
export interface RawListing {
  returnedLocation?: string | null;
  externalId: string;
  provider: string;
  marketplace: "facebook";
  url: string;
  title: string;
  description: string;
  price: number | null;
  originalUrl?: string;
  country?: string | null;
  publicationStatus?: PublicationStatus;
  queryType?: QueryType;
  snapshotId?: string | null;
  currency: string;
  images: string[];
  city: string;
  latitude: number | null;
  longitude: number | null;
  sellerId: string | null;
  publishedAt: string | null;
  // "badge": recência vinda de um selo do FB ("Acabou de chegar"), sem hora
  // exata; a UI mostra um rótulo grosseiro em vez de "há X minutos".
  publicationSource: "provider" | "unknown" | "badge";
  publicationConfidence: number;
  availability: Availability;
  availabilityCheckedAt?: string;
  condition?: Condition;
  demo: boolean;
}
export interface Listing extends RawListing {
  id: string;
  firstSeenAt: string;
  lastSeenAt: string;
  baseline: boolean;
  product: Product;
  fingerprint: string;
  seenBy: string[];
  previousPrice: number | null;
  lastValidPrice?: number | null;
  priceChangedAt: string | null;
}
export interface Costs {
  fuel?: number;
  commissionPct?: number;
  transport: number;
  maintenance: number;
  cleaning: number;
  packaging: number;
  other: number;
  feePct: number;
}
export interface Monitor {
  intent?: "personal" | "resale";
  identificationMode?: "catalog" | "generic";
  negativeMode?: "literal" | "contextual";
  version?: number;
  archived?: boolean;
  notifyNew?: boolean;
  notifyDrops?: boolean;
  product?: string;
  expectedQuickSalePrice?: number | null;
  minProfit?: number;
  maxListingAgeMinutes?: number | null;
  resultsPerSearch?: number;
  costs?: Costs | null;
  providerFilters?: Record<string, string | number>;
  providerContractFingerprint?: string;
  id: string;
  name: string;
  query: string;
  queryType?: QueryType;
  searchUrl?: string | null;
  aliases: string[];
  negatives: string[];
  minPrice: number;
  maxPrice: number;
  city: string;
  radiusKm: number;
  latitude: number | null;
  longitude: number | null;
  condition: Condition | "any" | "working";
  active: boolean;
  mode: Mode;
  manualPrice: number | null;
  strongPrice: number | null;
  ultraPrice: number | null;
  minRoi: number;
  maxRisk: number;
  minLiquidity: number;
  minScore: number;
  intervalSeconds: number;
  provider: string;
  revision: number;
}
export interface Settings extends Costs {
  minRoi: number;
  maxRisk: number;
  minScore: number;
  cooldownMinutes: number;
  profile: string;
}
export interface Comparable {
  id: string;
  title: string;
  price: number | null;
  similarity: number;
  included: boolean;
  reason: string;
}
export interface Pricing {
  automaticBase?: number | null;
  source?: "manual" | "automatic" | "hybrid" | "insufficient";
  count: number;
  candidates: number;
  mean: number | null;
  median: number | null;
  p5: number | null;
  p25: number | null;
  p75: number | null;
  market: number | null;
  quickSale: number | null;
  recommendedBuy: number | null;
  exceptionalBuy: number | null;
  confidence: number;
  comparables: Comparable[];
  explanation: string[];
  calibrated: boolean;
}
export interface Contribution {
  label: string;
  points: number;
}
export interface Analysis {
  displayExpiresAt?: string | null;
  publicationEligible?: boolean;
  classification?:
    "financial_opportunity" | "within_budget" | "needs_review" | "rejected";
  budgetEligible?: boolean;
  notificationEligible?: boolean;
  matchReasons?: { code: string; evidence: string }[];
  monitorId?: string;
  monitorName?: string;
  maxPurchasePrice?: number;
  strongPurchasePrice?: number;
  ultraPurchasePrice?: number;
  requestedLocation?: string;
  maxListingAgeMinutes?: number | null;
  priceTier?: "interesting" | "strong" | "ultra" | "above_limit";
  listingId: string;
  freshness: Freshness;
  ageMinutes: number | null;
  risk: number;
  risks: string[];
  score: number;
  contributions: Contribution[];
  pricing: Pricing;
  liquidity: number | null;
  liquidityLabel: string;
  grossProfit: number | null;
  totalCosts: number | null;
  netProfit: number | null;
  roi: number | null;
  capitalRoi: number | null;
  eligible: boolean;
  ultra: boolean;
  event: "new" | "price_drop" | "baseline";
  blocked: string[];
  quality: number;
  confidenceReasons: string[];
  discoveryDelaySeconds: number | null;
}
export interface Opportunity {
  listing: Listing;
  analysis: Analysis;
}
export interface Alert {
  id: string;
  listingId: string;
  title: string;
  createdAt: string;
  score: number;
  event: string;
  priority: "standard" | "strong" | "ultra";
  read: boolean;
  demo: boolean;
  availability?: Availability;
  confidence?: number;
  price?: number | null;
  maxPurchase?: number;
  expectedSale?: number | null;
  netProfit?: number | null;
  roi?: number | null;
  publishedAt?: string | null;
}
export interface Purchase {
  id: string;
  listingId: string;
  title: string;
  paid: number;
  costs: number;
  boughtAt: string;
  soldFor: number | null;
  soldAt: string | null;
  estimated: number | null;
  estimateSource?: Pricing["source"];
  automaticBaseEstimate?: number | null;
  estimatedProfit?: number | null;
  advertisedPrice?: number | null;
  note?: string;
  saleFees?: number;
  additionalCosts?: number;
}
export const DEFAULT_SETTINGS: Settings = {
  fuel: 0,
  commissionPct: 0,
  transport: 0,
  maintenance: 0,
  cleaning: 0,
  packaging: 0,
  other: 0,
  feePct: 0,
  minRoi: 20,
  maxRisk: 35,
  minScore: 65,
  cooldownMinutes: 60,
  profile: "balanced",
};
