import { z } from "zod";
import { validateSearchUrl, searchUrlError } from "../core/provider-query";
const money = z
  .number()
  .finite()
  .min(0)
  .max(1000000)
  .refine(
    (n) => Math.abs(n * 100 - Math.round(n * 100)) < 0.000001,
    "Use até duas casas decimais",
  );
const costsSchema = z
  .object({
    fuel: money.default(0),
    transport: money,
    maintenance: money,
    cleaning: money,
    packaging: money,
    other: money,
    feePct: z.number().min(0).max(50),
    commissionPct: z.number().min(0).max(50).default(0),
  })
  .strict();
const optionalMoney = money.nullable().default(null);
export const providerFiltersSchema = z
  .record(
    z
      .string()
      .regex(/^[a-z][a-z0-9_]{0,63}$/)
      .refine(
        (key) =>
          !/^(?:keyword|url|dataset_id|type|discover_by|limit.*|.*token.*|.*secret.*|.*key.*|constructor|prototype|__proto__)$/.test(
            key,
          ),
        "Nome de filtro reservado",
      ),
    z.union([z.string().trim().min(1).max(500), z.number().finite()]),
  )
  .refine((filters) => Object.keys(filters).length <= 20, "Até 20 filtros")
  .default({});
export const providerFingerprintSchema = z
  .string()
  .regex(/^[a-f0-9]{64}$/)
  .optional();
export const monitorSchema = z
  .object({
    intent: z.enum(["personal", "resale"]).default("resale"),
    identificationMode: z.enum(["catalog", "generic"]).default("catalog"),
    negativeMode: z.enum(["literal", "contextual"]).default("literal"),
    notifyNew: z.boolean().default(true),
    notifyDrops: z.boolean().default(true),
    archived: z.boolean().default(false),
    product: z.string().trim().max(150).default(""),
    expectedQuickSalePrice: optionalMoney,
    minProfit: money.default(0),
    maxListingAgeMinutes: z
      .union([
        z.literal(15),
        z.literal(30),
        z.literal(60),
        z.literal(180),
        z.literal(360),
        z.literal(720),
        z.literal(1440),
        z.literal(4320),
        z.literal(10080),
      ])
      .nullable()
      .default(1440),
    resultsPerSearch: z.number().int().min(1).max(50).default(10),
    costs: costsSchema.nullable().default(null),
    name: z.string().trim().min(2).max(100),
    query: z.string().trim().max(150).default(""),
    queryType: z.enum(["keyword", "search_url"]).default("keyword"),
    searchUrl: z.string().max(4096).nullable().default(null),
    providerFilters: providerFiltersSchema,
    providerContractFingerprint: providerFingerprintSchema,
    aliases: z.array(z.string().trim().min(1).max(100)).max(6).default([]),
    negatives: z.array(z.string().trim().min(1).max(60)).max(20).default([]),
    minPrice: money.default(0),
    maxPrice: money.default(5000),
    city: z.string().trim().max(100).default(""),
    radiusKm: z.number().min(1).max(500).default(30),
    latitude: z.number().min(-90).max(90).nullable().default(null),
    longitude: z.number().min(-180).max(180).nullable().default(null),
    condition: z
      .enum([
        "new",
        "excellent",
        "used",
        "damaged",
        "unknown",
        "any",
        "working",
      ])
      .default("any"),
    active: z.boolean().default(true),
    mode: z.enum(["automatic", "manual", "combined"]).default("combined"),
    manualPrice: optionalMoney,
    strongPrice: optionalMoney,
    ultraPrice: optionalMoney,
    minRoi: z.number().min(0).max(300).default(20),
    maxRisk: z.number().min(0).max(100).default(35),
    minLiquidity: z.number().min(0).max(100).default(0),
    minScore: z.number().min(0).max(100).default(65),
    intervalSeconds: z.number().int().min(60).max(3600).default(120),
    provider: z.literal("brightdata").default("brightdata"),
  })
  .strict()
  .superRefine((m, ctx) => {
    if (m.queryType === "keyword" && m.query.length < 2)
      ctx.addIssue({
        code: "custom",
        path: ["query"],
        message: "Informe uma palavra-chave",
      });
    if (
      m.queryType === "search_url" &&
      (m.provider !== "brightdata" ||
        !m.searchUrl ||
        !validateSearchUrl(m.searchUrl))
    )
      ctx.addIssue({
        code: "custom",
        path: ["searchUrl"],
        message:
          searchUrlError(m.searchUrl ?? "") ??
          "Use a fonte Facebook · Bright Data para uma URL de pesquisa.",
      });
    if (m.minPrice > m.maxPrice)
      ctx.addIssue({
        code: "custom",
        message: "Preço mínimo maior que máximo",
        path: ["maxPrice"],
      });
    if ((m.latitude === null) !== (m.longitude === null))
      ctx.addIssue({
        code: "custom",
        message: "Informe latitude e longitude juntas",
        path: ["latitude"],
      });
    if (m.mode === "manual" && !m.expectedQuickSalePrice)
      ctx.addIssue({
        code: "custom",
        message: "Modo manual exige venda rápida esperada",
        path: ["expectedQuickSalePrice"],
      });
    if (m.strongPrice !== null && m.strongPrice > m.maxPrice)
      ctx.addIssue({
        code: "custom",
        message: "Compra forte deve ser menor ou igual ao preço máximo",
        path: ["strongPrice"],
      });
    if (m.ultraPrice !== null && m.ultraPrice > (m.strongPrice ?? m.maxPrice))
      ctx.addIssue({
        code: "custom",
        message: "Ultra deve ser menor ou igual ao alerta forte",
        path: ["ultraPrice"],
      });
  });
export const settingsSchema = z
  .object({
    fuel: money.default(0),
    commissionPct: z.number().min(0).max(50).default(0),
    transport: money,
    maintenance: money,
    cleaning: money,
    packaging: money,
    other: money,
    feePct: z.number().min(0).max(90),
    minRoi: z.number().min(0).max(300),
    maxRisk: z.number().min(0).max(100),
    minScore: z.number().min(0).max(100),
    cooldownMinutes: z.number().int().min(1).max(1440),
    profile: z.enum(["balanced", "conservative", "aggressive", "liquidation"]),
  })
  .strict();
export const feedbackSchema = z
  .object({
    listingId: z.string().max(200),
    type: z.enum([
      "bought",
      "passed",
      "false_positive",
      "sold",
      "bad_listing",
      "wrong_price",
      "wrong_product",
    ]),
    note: z.string().max(2000).optional(),
    paid: money.optional(),
    costs: money.optional(),
    soldFor: money.optional(),
    saleFees: money.optional(),
    additionalCosts: money.optional(),
    boughtAt: z.string().datetime().optional(),
    soldAt: z.string().datetime().optional(),
  })
  .strict();
