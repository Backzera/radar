import type { RawListing } from "../core/types";
import type { ProviderQuery } from "../core/provider-query";
export interface SearchRequest {
  query: string;
  providerQuery?: ProviderQuery;
  city: string;
  radiusKm: number;
  cursor?: string;
  sequence: number;
  limit: number;
}
export interface SearchResult {
  items: RawListing[];
  candidates?: DiscoveryCandidate[];
  complete: boolean;
  cursor?: string;
  warnings: string[];
  received?: number;
  rejected?: number;
  qualityErrors?: Record<string, number>;
  snapshotId?: string;
}
export interface DiscoveryCandidate {
  externalId: string;
  provider: string;
  marketplace: string;
  url: string;
  originalUrl: string;
}
export interface ProviderHealth {
  dataset?: string;
  ok: boolean;
  message: string;
  methods?: { keyword: boolean; search_url: boolean; collect_url?: boolean };
  contracts?: { keyword?: string; search_url?: string; collect_url?: string };
  schemas?: Partial<
    Record<"keyword" | "search_url" | "collect_url", ProviderMethodSchema>
  >;
}
export interface ProviderField {
  name: string;
  type: string;
  required: boolean;
  supported: boolean;
  inputEnabled?: boolean;
  enumPublished?: boolean;
  optionsSource?: "metadata" | "account_panel";
  options?: (string | number)[];
  min?: number;
  max?: number;
  unit?: string;
  description?: string;
  issue?: string;
}
export interface ProviderMethodSchema {
  /** Upstream fingerprint stays unchanged; supplemental operator data has its own id. */
  publicationValues?: Partial<Record<"1" | "7", string | number>>;
  inputConfirmationId?: string;
  contract: string;
  endpointId?: string;
  discriminator?: string;
  outputKind?: "url_candidates" | "listing";
  outputFields?: { name: string; type?: string }[];
  fingerprint: string;
  compatible: boolean;
  fields: ProviderField[];
  issues: string[];
}
export interface PreparedProviderQuery {
  contract: string;
  dataset: string;
  fingerprint: string;
  input: Record<string, string | number>;
}
export interface ProviderCapabilities {
  discovery: boolean;
  publicationTime: boolean;
  locationFilter: boolean;
  availability: boolean;
  images: boolean;
}
export interface MarketplaceProvider {
  id: string;
  capabilities: ProviderCapabilities;
  search(request: SearchRequest): Promise<SearchResult>;
  prepareQuery?(query: ProviderQuery): Promise<PreparedProviderQuery>;
  getListing(url: string): Promise<RawListing | null>;
  checkListing?(request: {
    url: string;
    cursor?: string;
    reserved: true;
  }): Promise<SearchResult>;
  getImages(listing: RawListing): string[];
  getSellerInfo(listing: RawListing): { id: string | null };
  getPublicationTime(listing: RawListing): {
    value: string | null;
    confidence: number;
  };
  healthCheck(): Promise<ProviderHealth>;
}
export class ProviderError extends Error {
  triggerRejected = false;
  phase?: "preflight" | "trigger" | "poll";
  code?: string;
  constructor(
    message: string,
    public retryable = true,
    public retryAfter: number | null = null,
  ) {
    super(message);
  }
}
