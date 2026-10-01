import type { RawListing } from "../core/types";
import type {
  MarketplaceProvider,
  SearchRequest,
  SearchResult,
} from "../providers/contract";
import { fold } from "../core/normalize";
export const DEMO_PRODUCTS = [
  {
    query: "iPhone 15",
    title: "iPhone 15 128 GB azul",
    market: 3050,
    buy: 2150,
  },
  {
    query: "PS5",
    title: "PlayStation 5 Slim Digital",
    market: 2800,
    buy: 1890,
  },
  {
    query: "MacBook",
    title: "MacBook Air M1 256 GB prata",
    market: 3900,
    buy: 2750,
  },
  {
    query: "Galaxy",
    title: "Samsung Galaxy S23 128 GB preto",
    market: 2300,
    buy: 1550,
  },
  {
    query: "Nintendo",
    title: "Nintendo Switch OLED branco",
    market: 2100,
    buy: 1420,
  },
  {
    query: "Xbox",
    title: "Xbox Series S 512 GB branco",
    market: 1900,
    buy: 1280,
  },
];
function raw(
  id: string,
  title: string,
  price: number,
  published: string | null,
): RawListing {
  return {
    externalId: id,
    provider: "demo",
    marketplace: "facebook",
    url: `https://demo.invalid/marketplace/item/${id}`,
    title,
    description:
      "Usado em excelente estado. Pouco uso, acompanha caixa. Sem carregador. Retirada em Curitiba. Produto de demonstração; não é anúncio real.",
    price,
    currency: "BRL",
    images: [],
    city: "Curitiba",
    latitude: -25.4284,
    longitude: -49.2733,
    sellerId: `seller-${id}`,
    publishedAt: published,
    publicationSource: published ? "provider" : "unknown",
    publicationConfidence: published ? 100 : 0,
    availability: "active",
    condition: "excellent",
    demo: true,
  };
}
export function demoBaseline(now = new Date()): RawListing[] {
  return DEMO_PRODUCTS.flatMap((p, group) =>
    Array.from({ length: 10 }, (_, i) =>
      raw(
        `demo-${group}-${i}`,
        `${p.title}${i % 3 === 0 ? " com caixa" : ""}`,
        Math.round(p.market * (0.92 + i * 0.018)),
        new Date(now.getTime() - (i + 2) * 86400000).toISOString(),
      ),
    ),
  );
}
export function demoNew(
  group: number,
  sequence: number,
  now = new Date(),
): RawListing {
  const p = DEMO_PRODUCTS[group % DEMO_PRODUCTS.length];
  const l = raw(
    `demo-new-${group}-${sequence}`,
    p.title + (sequence % 7 === 3 ? " entrada facilitada" : " · pouco uso"),
    sequence % 7 === 3 ? 500 : p.buy + (sequence % 4) * 40,
    sequence % 7 === 5
      ? null
      : new Date(now.getTime() - 3 * 60000).toISOString(),
  );
  if (group === 0) l.description += " Bateria 86%, Face ID funcionando.";
  return l;
}
export class MockProvider implements MarketplaceProvider {
  id = "demo";
  capabilities = {
    discovery: true,
    publicationTime: true,
    locationFilter: true,
    availability: true,
    images: false,
  };
  async search(r: SearchRequest): Promise<SearchResult> {
    const group = Math.max(
      0,
      DEMO_PRODUCTS.findIndex(
        (p) =>
          fold(r.query).includes(fold(p.query)) ||
          fold(p.title).includes(fold(r.query)),
      ),
    );
    const base = demoBaseline().filter((l) =>
      l.externalId.startsWith(`demo-${group}-`),
    );
    return {
      items: r.sequence === 0 ? base : [...base, demoNew(group, r.sequence)],
      complete: true,
      warnings: ["Dados simulados: não representam anúncios reais."],
    };
  }
  async getListing() {
    return null;
  }
  getImages(l: RawListing) {
    return l.images;
  }
  getSellerInfo(l: RawListing) {
    return { id: l.sellerId };
  }
  getPublicationTime(l: RawListing) {
    return { value: l.publishedAt, confidence: l.publicationConfidence };
  }
  async healthCheck() {
    return { ok: true, message: "Simulação local, sem custo externo" };
  }
}
