import type { Product, RawListing } from "./types";
import { identifySale } from "./catalog";
import { automaticQueries } from "./query-strategy";
import { fold, withoutNegatedRisks } from "./text";
export { fold } from "./text";
export function normalize(
  raw: Pick<RawListing, "title" | "description" | "condition">,
): Product {
  const sale = identifySale(raw.title, raw.description);
  const text = sale.text;
  const defectText = withoutNegatedRisks(text);
  const model = sale.identity?.model ?? null;
  const brand = sale.identity?.brand ?? null;
  const category = sale.identity?.category ?? "Outros";
  const ps = !!sale.identity?.needsEdition;
  let edition: string | null = ps
    ? /\bdigital\b/.test(text)
      ? "digital"
      : /midia fisica|disco|com leitor/.test(text)
        ? "disc"
        : null
    : null;
  if (sale.identity?.intel) {
    const cpu = text.match(/\bi[3579]\b/)?.[0];
    const screen = text.match(
      /\b(11|12|13|15|16|17)(?:[.,]\d)?\s*(?:polegadas|pol|["”])/,
    )?.[1];
    edition = cpu && screen ? `${cpu}-${screen}` : null;
  }
  const storageMatch = text.match(
    /\b(64|128|256|512|1024)\s*(?:gb|gigas?)\b|\b(1|2)\s*tb\b/,
  );
  const storage = storageMatch
    ? storageMatch[1]
      ? Number(storageMatch[1])
      : Number(storageMatch[2]) * 1024
    : null;
  let condition = raw.condition ?? "unknown";
  if (
    /quebrad|defeito|trincad|somente pecas|para (?:retirada de )?pecas|nao liga|nao funciona/.test(
      defectText,
    )
  )
    condition = "damaged";
  else if (/lacrad|nunca usado/.test(text)) condition = "new";
  else if (/seminovo|pouco uso|excelente|impecavel/.test(text))
    condition = "excellent";
  else if (/usado|uso|bateria/.test(text)) condition = "used";
  const color =
    text.match(
      /\b(azul|preto|branco|prata|cinza|verde|rosa|roxo|dourado)\b/,
    )?.[1] ?? null;
  const battery = text.match(/bateria\s*(?:em|de|com|:)?\s*(\d{2,3})\s*%/);
  const batteryHealth =
    battery && Number(battery[1]) <= 100 ? Number(battery[1]) : null;
  const box = /sem caixa|nao acompanha caixa/.test(text)
    ? false
    : /com caixa|acompanha caixa/.test(text)
      ? true
      : null;
  const charger = /sem carregador|nao acompanha carregador/.test(text)
    ? false
    : /com carregador|acompanha carregador/.test(text)
      ? true
      : null;
  const faceId = /face\s*id\s*(?:nao funciona|com defeito)/.test(text)
    ? "not_working"
    : /face\s*id\s*funcionando/.test(text)
      ? "working"
      : null;
  const needsStorage = category === "Smartphones" || category === "Notebooks";
  const needsEdition = !!ps || !!sale.identity?.intel;
  const confidence = sale.conflict
    ? 40
    : model
      ? 78 +
        (needsStorage ? (storage ? 12 : -20) : 8) +
        (needsEdition ? (edition ? 8 : -20) : 5)
      : 20;
  const key =
    model &&
    !sale.conflict &&
    (!needsStorage || storage) &&
    (!needsEdition || edition)
      ? `${model}|${storage ?? "-"}|${edition ?? "-"}`
      : null;
  return {
    brand,
    model,
    category,
    storage,
    edition,
    color,
    condition,
    confidence,
    batteryHealth,
    box,
    charger,
    faceId,
    key,
    support: !model ? "generic" : key ? "supported" : "partial",
    ambiguous: sale.conflict,
  };
}
export function expandQueries(query: string, aliases: string[] = []): string[] {
  return automaticQueries(query, aliases);
}
export function priceAnomalies(title: string, description: string): string[] {
  const t = withoutNegatedRisks(`${title} ${description}`),
    risks: string[] = [];
  if (
    /\b(entrada|parcelas?|sinal|financiado)\b|a partir de|\d+\s*x\s*(?:de\s*)?(?:r?\$\s*)?\d|valor referente/.test(
      t,
    )
  )
    risks.push("Preço pode representar entrada ou parcela");
  if (
    /somente (?:a )?caixa|so (?:a )?caixa|apenas (?:a )?caixa|somente pecas|para (?:retirada de )?pecas/.test(
      t,
    )
  )
    risks.push("Pode ser caixa ou peças, não o produto completo");
  if (/somente troca|apenas troca|troco por/.test(t))
    risks.push("Oferta de troca, preço não confirmado");
  if (
    /^(?:vendo\s+)?(?:(?:somente|apenas|so)\s+)?(?:a\s+)?(?:controle|dualsense|capa|capinha|carregador|pelicula|caixa vazia|suporte|cabo|bateria|tela|pecas)\b/.test(
      fold(title),
    )
  )
    risks.push("Título indica acessório ou componente, não o produto completo");
  if (/^(?:vendo\s+)?(?:lote|kit|combo)\b/.test(fold(title)))
    risks.push("Kit ou lote: preço unitário não comprovado");
  return risks;
}
