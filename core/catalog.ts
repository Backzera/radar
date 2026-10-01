import { words, saleDescription } from "./text";
export interface CatalogIdentity {
  brand: string;
  model: string;
  category: string;
  needsStorage: boolean;
  needsEdition?: boolean;
  intel?: boolean;
}
interface Rule {
  pattern: RegExp;
  identify: (m: RegExpMatchArray, text: string) => CatalogIdentity;
}
/** Catálogo explícito e extensível. Reconhecimento não comprova preço nem legitimidade. */
export const catalogRules: Rule[] = [
  {
    pattern:
      /\b(?:iphone\s*|ip\s*|apple\s+)(1[1-9])\s*(pro\s*max|pro|plus|mini)?\b/,
    identify: (m) => ({
      brand: "Apple",
      model: `iPhone ${m[1]}${
        m[2]
          ? " " +
            m[2]
              .replace(/pro\s*max/, "Pro Max")
              .replace(/^pro$/, "Pro")
              .replace(/^plus$/, "Plus")
              .replace(/^mini$/, "Mini")
          : ""
      }`,
      category: "Smartphones",
      needsStorage: true,
    }),
  },
  {
    pattern: /\b(?:ps\s*5|playstation\s*5|play\s*5)\s*(slim|pro)?\b/,
    identify: (m) => ({
      brand: "Sony",
      model:
        m[1] === "slim"
          ? "PlayStation 5 Slim"
          : m[1] === "pro"
            ? "PlayStation 5 Pro"
            : "PlayStation 5",
      category: "Consoles",
      needsStorage: false,
      needsEdition: true,
    }),
  },
  {
    pattern: /\b(?:galaxy\s*|samsung\s*)s\s*(2[0-9])\s*(ultra|plus|fe)?\b/,
    identify: (m) => ({
      brand: "Samsung",
      model: `Galaxy S${m[1]}${m[2] ? " " + m[2].toUpperCase() : ""}`,
      category: "Smartphones",
      needsStorage: true,
    }),
  },
  {
    pattern: /\bmacbook\s*(air|pro)\s*(m[1-5])\b/,
    identify: (m) => ({
      brand: "Apple",
      model: `MacBook ${m[1] === "air" ? "Air" : "Pro"} ${m[2].toUpperCase()}`,
      category: "Notebooks",
      needsStorage: true,
    }),
  },
  {
    pattern: /\bmacbook\s*(air|pro)\s*(20(?:0[6-9]|1[0-9]|20))\b/,
    identify: (m) => ({
      brand: "Apple",
      model: `MacBook ${m[1] === "air" ? "Air" : "Pro"} ${m[2]}`,
      category: "Notebooks",
      needsStorage: true,
      intel: true,
    }),
  },
  {
    pattern: /\bfifine\s*(a8|a6v|k688|k658)\b/,
    identify: (m) => ({
      brand: "Fifine",
      model: `Fifine ${m[1].toUpperCase()}`,
      category: "Microfones",
      needsStorage: false,
    }),
  },
  {
    pattern: /\bnintendo\s*switch\s*(oled|lite|2)?\b/,
    identify: (m) => ({
      brand: "Nintendo",
      model:
        m[1] === "oled"
          ? "Nintendo Switch OLED"
          : m[1] === "lite"
            ? "Nintendo Switch Lite"
            : m[1] === "2"
              ? "Nintendo Switch 2"
              : "Nintendo Switch",
      category: "Consoles",
      needsStorage: false,
    }),
  },
  {
    pattern: /\bxbox\s*series\s*([sx])\b/,
    identify: (m) => ({
      brand: "Microsoft",
      model: `Xbox Series ${m[1].toUpperCase()}`,
      category: "Consoles",
      needsStorage: false,
    }),
  },
];
function identities(text: string) {
  return catalogRules.flatMap((r) => {
    return [...text.matchAll(new RegExp(r.pattern.source, "g"))].map((m) =>
      r.identify(m, text),
    );
  });
}
export function identifySale(title: string, description: string) {
  const t = words(title),
    d = saleDescription(description),
    fromTitle = identities(t),
    fromDescription = identities(d);
  const identity = fromTitle[0] ?? fromDescription[0] ?? null;
  const conflict = [...fromTitle, ...fromDescription].some(
    (p) => identity && p.model !== identity.model,
  );
  // Descrição contraditória não fornece atributos complementares.
  return {
    identity,
    text: conflict ? t : `${t} ${d}`,
    conflict,
    title: t,
    description: conflict ? "" : d,
  };
}
export const catalogExamples = [
  "iPhone 15 128 GB",
  "Galaxy S23 128 GB",
  "PS5 Slim Digital",
  "MacBook Air M1 256 GB",
  "MacBook Pro 2017 i5 256 GB",
  "Fifine A8",
  "Nintendo Switch OLED",
  "Xbox Series S 512 GB",
];
