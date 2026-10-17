/** Brand and plans in one place: rename the product or change prices here. */
export const BRAND = {
  name: "Market Radar",
  tagline: "O painel do bricker",
  description:
    "Controle de estoque e lucro para quem compra e revende usados: fotos, custos, vendas, margem e metas num só lugar.",
  /** Shown on the terms and privacy pages; fill in before launching. */
  supportEmail: "",
};

export const PLANS = [
  {
    id: "essencial",
    name: "Essencial",
    priceCents: 2990,
    pitch: "Para organizar o brick e saber o lucro de verdade.",
    features: [
      "Estoque e vendas ilimitados",
      "Fotos de cada produto",
      "Lucro, margem e ROI automáticos",
      "Painel com metas mensais",
      "Exportação para planilha",
    ],
    highlight: false,
  },
  {
    id: "pro",
    name: "Pro",
    priceCents: 3990,
    pitch: "Para quem vive de brick e quer sair na frente.",
    features: [
      "Tudo do Essencial",
      "Radar de oportunidades assim que lançar",
      "Acesso antecipado às novidades",
      "Suporte prioritário",
    ],
    highlight: true,
  },
] as const;
export type PlanId = (typeof PLANS)[number]["id"];

/** Features behind a switch. The radar backend stays in place while off. */
export const FEATURES = { radar: true };
