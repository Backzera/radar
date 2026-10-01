import type { Opportunity } from "./types";
import { publicationWindow } from "./selection";

const translations: [RegExp, string][] = [
  [
    /Baseline/i,
    "Encontrado na primeira busca. Não foi tratado como anúncio recém-publicado.",
  ],
  [
    /Opportunity Score|score abaixo/i,
    "A combinação de preço, estado e informações ainda não atende à sua estratégia.",
  ],
  [/ROI abaixo/i, "O retorno estimado ainda é menor que o objetivo definido."],
  [
    /Lucro líquido abaixo/i,
    "A margem estimada não atinge seu objetivo, ou faltam dados para calculá-la.",
  ],
  [
    /Fora da janela|antig|publication_old/i,
    "O anúncio ultrapassou o período escolhido para este radar.",
  ],
  [
    /Publicação desconhecida|publication_unknown/i,
    "Não conseguimos confirmar quando este anúncio foi publicado.",
  ],
  [
    /Produto insuficientemente|Identificação incompleta/i,
    "Faltam informações para confirmar a versão e estimar a revenda.",
  ],
  [
    /Disponibilidade.*inativa/i,
    "A fonte indicou que este anúncio não está mais disponível.",
  ],
  [
    /Disponibilidade não confirmada/i,
    "Confirme com o vendedor se o item ainda está disponível.",
  ],
  [
    /Preço muito distante/i,
    "O preço é bem menor que as referências. Confira estado, preço integral e vendedor.",
  ],
  [
    /Risco acima/i,
    "Há pontos importantes a conferir antes de considerar a compra.",
  ],
  [
    /Nenhuma busca ativa|Produto ou condição fora/i,
    "Este anúncio não corresponde aos critérios de um radar ativo.",
  ],
  [
    /teto\/faixa|Preço fora/i,
    "O preço está fora do orçamento que você definiu.",
  ],
  [
    /liquidez/i,
    "Ainda não há histórico de vendas suficiente para estimar a velocidade de revenda.",
  ],
  [
    /comparáveis|precificação/i,
    "Ainda não há referências suficientes para uma estimativa automática confiável.",
  ],
];
export function customerReason(reason: string) {
  const known = translations.find(([test]) => test.test(reason));
  if (known) return known[1];
  if (
    /P25|P5|P75|calibra|fator|score|baseline|fingerprint|payload|provider|\+\d.*risco/i.test(
      reason,
    )
  )
    return "A avaliação usa critérios conservadores. Confira as informações do anúncio antes de comprar.";
  return reason.replace(/\(\+\d+ de risco\)/g, "").trim();
}
export function customerDecision(o: Opportunity, now = new Date()) {
  const { listing: l, analysis: a } = o;
  const valid = publicationWindow(l, undefined, now).valid;
  const why = [
    ...(a.monitorName ? [`Corresponde ao radar “${a.monitorName}”.`] : []),
    ...(a.budgetEligible ? ["Está dentro do seu orçamento."] : []),
    ...(valid
      ? ["A publicação está dentro do período máximo de sete dias."]
      : []),
    ...(a.eligible
      ? ["A margem estimada atende à sua estratégia de revenda."]
      : []),
  ];
  const caveats = [
    ...new Set(
      [
        ...a.risks,
        ...a.blocked.filter((r) => !/baseline/i.test(r)),
        ...(a.matchReasons ?? []).map((r) => r.evidence),
      ].map(customerReason),
    ),
  ];
  if (l.product.category === "Smartphones" && l.product.batteryHealth === null)
    caveats.unshift("Saúde da bateria não informada.");
  return {
    why,
    caveats,
    priceSource:
      a.pricing.source === "manual"
        ? "Estimativa de revenda informada por você."
        : a.pricing.source === "hybrid"
          ? "Referência conservadora entre sua estimativa e anúncios semelhantes."
          : a.pricing.quickSale !== null
            ? "Referência conservadora de anúncios semelhantes, não de vendas concluídas."
            : "Ainda faltam referências para estimar a revenda.",
    initial: a.event === "baseline" ? "Encontrado na primeira busca." : null,
  };
}
export function negotiationMessage(o: Opportunity, offer?: number) {
  const product = o.listing.product.model ?? o.listing.title;
  return `Olá! O ${product} ainda está disponível? O valor anunciado é pelo produto completo? Tem algum defeito, reparo ou bloqueio?${o.listing.product.category === "Smartphones" ? " Qual é a saúde da bateria?" : ""}${offer && offer > 0 ? ` Você considera R$ ${offer.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}?` : ""}`;
}
