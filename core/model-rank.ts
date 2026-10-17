// Ranking de modelos do catálogo para a regra "mesma linha, igual ou superior".
//
// Em radares de REVENDA, um anúncio do modelo buscado OU de um mais novo/superior
// da mesma linha, desde que dentro do teto de preço, é uma oportunidade válida —
// não "modelo errado". Ex.: buscando "iPhone 11", um "iPhone 11 Pro" ou um
// "iPhone 13" dentro do preço deve aparecer. O filtro de preço (minPrice/maxPrice)
// continua cortando o que passa do teto; aqui tratamos só da identidade do modelo.
//
// O catálogo (core/catalog.ts) não guarda geração/tier, então derivamos ambos do
// próprio nome do modelo: "<linha> <geração> <tier?>". Quando o nome não encaixa
// nesse formato (tier desconhecido, sem número), não arriscamos a comparação e o
// comportamento exato anterior é mantido.

// Ordem dos tiers dentro de uma mesma geração (quanto maior, "superior").
const TIER_ORDER: Record<string, number> = {
  mini: 0,
  fe: 0,
  "": 1,
  plus: 2,
  pro: 3,
  ultra: 3,
  "pro max": 4,
};

export interface ModelRank {
  family: string;
  gen: number;
  tier: number;
}

/** Extrai { linha, geração, tier } do nome do modelo, ou null se não der para
 * comparar com segurança (sem número ou tier desconhecido). */
export function parseModelRank(
  model: string | null | undefined,
): ModelRank | null {
  if (!model) return null;
  const m = model.trim().match(/^(.*?)\s*(\d{1,4})\s*(.*)$/);
  if (!m) return null;
  const family = m[1].trim().toLowerCase().replace(/\s+/g, " ");
  const gen = Number(m[2]);
  if (!family || !Number.isFinite(gen)) return null;
  const tierKey = m[3].trim().toLowerCase().replace(/\s+/g, " ");
  const tier = TIER_ORDER[tierKey];
  if (tier === undefined) return null; // tier desconhecido: não arrisca comparação
  return { family, gen, tier };
}

/** Verdadeiro quando `listing` é o MESMO modelo ou um SUPERIOR da mesma linha:
 * geração maior, ou mesma geração com tier igual/maior. */
export function isSameOrNewer(
  target: string | null | undefined,
  listing: string | null | undefined,
): boolean {
  const t = parseModelRank(target);
  const l = parseModelRank(listing);
  if (!t || !l || t.family !== l.family) return false;
  return l.gen > t.gen || (l.gen === t.gen && l.tier >= t.tier);
}
