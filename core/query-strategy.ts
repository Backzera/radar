import { identifySale } from "./catalog";
import { fold, words } from "./text";
/** Variações ortográficas preservam modelo, edição e capacidade. Uma por ciclo. */
export function automaticQueries(
  query: string,
  explicit: string[] = [],
): string[] {
  const input = words(query),
    target = identifySale(input, "").identity;
  const capacity = input.match(
    /\b(?:64|128|256|512|1024)\s*gb\b|\b[12]\s*tb\b/,
  )?.[0];
  const edition = /\bdigital\b/.test(input)
    ? "Digital"
    : /com leitor|disco|midia fisica/.test(input)
      ? "com leitor"
      : "";
  const name = target?.model ?? query.trim();
  const full = [name, capacity, target?.needsEdition ? edition : ""]
    .filter(Boolean)
    .join(" ");
  let candidates = [full, query.trim()];
  if (target?.brand === "Apple" && /^iPhone/.test(name))
    candidates.push(
      `Apple ${full}`,
      full.replace(/iPhone\s*/i, "iPhone"),
      full.replace(/iPhone\s*/i, "ip"),
    );
  else if (target?.brand === "Sony")
    candidates.push(
      full.replace(/PlayStation\s*/i, "PS"),
      full.replace(/PlayStation/i, "Play"),
    );
  else if (target?.brand === "Samsung")
    candidates.push(`Samsung ${full}`, full.replace(/^Galaxy /, "Samsung "));
  else if (target?.brand === "Apple") candidates.push(`Apple ${full}`);
  else if (target?.brand === "Microsoft") candidates.push(`Microsoft ${full}`);
  else if (target?.brand === "Fifine") candidates.push(`Microfone ${full}`);
  // Não introduzir versão/capacidade contraditória a partir de aliases legados.
  candidates = candidates.concat(
    explicit.filter((a) => {
      const identified = identifySale(a, "").identity;
      return target
        ? identified?.model === target.model &&
            (!capacity || words(a).includes(capacity)) &&
            (!edition || words(a).includes(fold(edition)))
        : words(a) === input;
    }),
  );
  return [
    ...new Set(
      candidates.map(fold).filter((q) => q.length >= 2 && q.length <= 150),
    ),
  ].slice(0, 6);
}
