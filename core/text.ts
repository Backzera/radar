/** Normalização de busca, não normalização de valores monetários. */
export const fold = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
export const words = (s: string) =>
  fold(s)
    .replace(/\bquinze\b/g, "15")
    .replace(/\bquatorze\b/g, "14")
    .replace(/\btreze\b/g, "13");

/** Remove apenas afirmações negativas conhecidas; o texto original permanece na evidência. */
export function withoutNegatedRisks(s: string): string {
  return fold(s)
    .replace(
      /\bsem\s+(?:entrada|parcelas?|sinal)(?:\s+(?:ou|e)\s+(?:entrada|parcelas?|sinal))*\b/g,
      "",
    )
    .replace(
      /\bnao\s+(?:aceito|faco|trabalho com)\s+(?:entrada|parcelas?|parcelamento)\b/g,
      "",
    )
    .replace(
      /\bsem\s+(?:(?:bloqueio|bloqueios)(?:\s+(?:de|do|no))?\s+)?(?:icloud|blacklist)\b/g,
      "",
    )
    .replace(/\bicloud\s+(?:livre|desbloqueado|removido)\b/g, "")
    .replace(/\bdesbloquead[oa]\b/g, "")
    .replace(/\bsem\s+(?:defeitos?|avarias?|trincas?|bloqueios?)\b/g, "")
    .replace(/\bnao\s+(?:esta\s+)?quebrad[oa]\b/g, "");
}
/** A menção de um item desejado em troca não descreve o item anunciado. */
export function saleDescription(s: string): string {
  return words(s).replace(
    /\b(?:troco por|(?:aceito|aceita) (?:troca|trocar)(?: por| em)?|(?:comparado|comparavel|semelhante) (?:ao?|com))\b[^.!?;\n]*/g,
    "",
  );
}
export function excludedEvidence(
  title: string,
  description: string,
  terms: string[],
  mode: "literal" | "contextual" = "literal",
) {
  let text = fold(`${title} ${description}`);
  if (mode === "contextual") {
    const accessoryTitle =
      /^(?:vendo\s+)?(?:(?:somente|so|apenas)\s+)?(?:a\s+)?(?:capa|capinha|pelicula|caixa|controle|carregador|cabo)\b/.test(
        fold(title),
      );
    text = withoutNegatedRisks(text);
    if (!accessoryTitle)
      text = text.replace(
        /\b(?:acompanha|inclui|vai com|com)\s+(?:(?:uma?|o|a)\s+)?(?:capinha|capa|pelicula|carregador|controle|caixa)\b/g,
        "",
      );
  }
  return terms.map(fold).filter((n) => n && text.includes(n));
}
