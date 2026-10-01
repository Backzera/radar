> **Documento histórico da V1.1.** Preservado para referência; comandos, fluxos e evidências não homologam a versão de desenvolvimento atual. Consulte [os guias atuais](../README.md) e a [matriz de implementação](implementation-status.md) antes de operar.

# MARKET RADAR — contratos e decisões do motor

Data da análise: 10/09/2026. Documento de implementação para o owner, sem integração ou implementação do Site. Valores e limiares abaixo são parâmetros iniciais de engenharia, sujeitos a validação com dados reais; não representam probabilidades calibradas ou preços reais de mercado.

## Invariantes que devem ser implementados primeiro

1. `publishedAt` e `firstSeenAt` são fatos diferentes e nunca se substituem. Descoberta nova não comprova publicação nova.
2. O bootstrap é por `monitorId + providerId + searchRevision`. Um novo provider, expansão material da busca ou mudança de região exige um baseline próprio.
3. Identidade canônica do anúncio é global por marketplace, não por provider; primeira observação por monitor/provider fica em tabela separada.
4. Só preço integral em dinheiro pode alimentar margens automáticas. Entrada, parcela, troca, valor de acessório e preço ambíguo bloqueiam o cálculo até revisão.
5. iPhone 15, Plus, Pro e Pro Max são variantes distintas; PS5 standard, Slim, Pro e edições com/sem leitor também. Armazenamento ausente é `null`, nunca um padrão imaginado.
6. A oportunidade avaliada não pode entrar no seu próprio conjunto de comparáveis. Repetições, snapshots e vários providers do mesmo anúncio não aumentam a amostra.
7. Venda rápida baseada em preços anunciados é uma hipótese de precificação com ajuste explícito. Não é venda observada e não possui prazo de venda comprovado.
8. Falha de busca, paginação incompleta e ausência de um item em resultados ranqueados não significam venda ou remoção.
9. Risco é um índice independente; risco baixo por falta de evidência não significa vendedor confiável.
10. Baseline e dados insuficientes bloqueiam urgência mesmo quando uma regra de preço ou score alto é satisfeita.

## Contratos TypeScript mínimos

```ts
type Id = string;
type ISODate = string; // ISO 8601 com timezone, UTC persistido
type BRLCents = number; // inteiro seguro, finito, >= 0; validar na borda
type Confidence = number; // 0..1: qualidade de evidência, não probabilidade
type Marketplace = "facebook" | "mercadolivre" | "olx" | "demo";
type Availability = "active" | "sold" | "removed" | "unavailable" | "unknown";

interface PublicationEvidence {
  exactAt: ISODate | null;
  earliestAt: ISODate | null;
  latestAt: ISODate | null;
  source:
    | "provider_exact"
    | "provider_relative"
    | "provider_date"
    | "documented_delta"
    | "unknown";
  precision: "second" | "minute" | "hour" | "day" | "unknown";
  rawValue: string | null;
  observedAt: ISODate;
  confidence: Confidence;
}

interface RawListing {
  externalId: string;
  marketplace: Marketplace;
  providerId: Id;
  canonicalUrl: string;
  title: string;
  description: string;
  advertisedPriceCents: BRLCents | null;
  currency: string;
  priceKind:
    | "cash_total"
    | "installment"
    | "down_payment"
    | "trade"
    | "from_price"
    | "accessory_only"
    | "ambiguous";
  publication: PublicationEvidence;
  firstSeenAt: ISODate;
  lastSeenAt: ISODate;
  availability: Availability;
  availabilityCheckedAt: ISODate | null;
  sellerId: string | null;
  imageUrls: string[];
  imageHashes: string[];
  location: { city: string | null; lat: number | null; lng: number | null };
}

interface MonitorProviderState {
  monitorId: Id;
  providerId: Id;
  searchRevision: number;
  baselineStartedAt: ISODate;
  baselineCompletedAt: ISODate | null;
  phase: "bootstrap" | "live" | "degraded" | "paused";
  lastSuccessfulPollAt: ISODate | null;
  cursor: string | null;
  coveredWindow: { from: ISODate; through: ISODate } | null;
}

interface Observation {
  canonicalListingId: Id;
  monitorId: Id;
  providerId: Id;
  searchRevision: number;
  observedAt: ISODate;
  baseline: boolean;
  priceCents: BRLCents | null;
  contentHash: string;
  availability: Availability;
}

interface ProductVariant {
  category: "smartphone" | "console" | "notebook" | "other" | "unknown";
  brand: string | null;
  family: string | null;
  generation: string | null;
  edition: string | null; // standard | plus | pro | pro_max | slim etc.
  storageGB: number | null;
  discDrive: "included" | "absent" | "unknown";
  condition: "new" | "excellent" | "good" | "fair" | "damaged" | "unknown";
  color: string | null;
  batteryHealth: number | null;
  accessories: Record<string, boolean | null>;
  confidence: Confidence;
  evidence: {
    field: string;
    value: unknown;
    source: "title" | "description" | "vision" | "human";
    excerpt?: string;
    confidence: Confidence;
  }[];
  conflicts: string[];
}

interface FreshnessResult {
  category: "just_published" | "recent" | "old" | "unknown";
  ageMinutesMin: number | null;
  ageMinutesMax: number | null;
  firstSeenMinutesAgo: number;
  isNewToMonitor: boolean;
  isBaseline: boolean;
  urgencyEligible: boolean;
  confidence: Confidence;
  reasons: string[];
}

interface Comparable {
  listingId: Id;
  sellerId: string | null;
  priceCents: BRLCents;
  similarity: Confidence;
  weight: number;
  eligible: boolean;
  exclusions: string[];
  outlier: boolean;
  priceBasis: "asking" | "confirmed_sale";
  observedAt: ISODate;
}

interface PricingResult {
  status: "sufficient" | "limited" | "insufficient";
  basis: "asking_prices" | "confirmed_sales" | "hybrid";
  rawCount: number;
  usableCount: number;
  independentSellerCount: number;
  effectiveSampleSize: number;
  meanCents: BRLCents | null;
  medianCents: BRLCents | null;
  p05Cents: BRLCents | null;
  p25Cents: BRLCents | null;
  p75Cents: BRLCents | null;
  marketEstimateCents: BRLCents | null;
  quickSaleEstimateCents: BRLCents | null;
  scenarioLowCents: BRLCents | null;
  scenarioHighCents: BRLCents | null;
  quickSaleHorizonDays: number | null; // null sem vendas calibradas
  confidence: Confidence;
  assumptions: { code: string; description: string; factor?: number }[];
  comparables: Comparable[];
  version: string;
}

interface CostPolicy {
  purchaseFixedCents: BRLCents; // transporte, reparo, limpeza pré-venda
  saleFixedCents: BRLCents; // embalagem e outros custos da venda
  saleFeeRate: number; // fração 0..1 aplicada ao preço de venda
  contingencyCents: BRLCents;
  targetROIRate: number;
  minimumProfitCents: BRLCents;
  roiBasis: "purchase_price" | "invested_capital";
}

interface ProfitEstimate {
  buyCents: BRLCents;
  saleCents: BRLCents;
  grossProfitCents: number;
  totalCostsCents: BRLCents;
  netProfitCents: number; // pode ser negativo
  investedCapitalCents: BRLCents;
  roiOnPurchase: number | null;
  roiOnCapital: number | null;
  recommendedMaxBuyCents: BRLCents;
}

interface ScoreContribution {
  code: string;
  label: string;
  points: number;
  maximum?: number;
  evidence: string;
}

interface Evaluation {
  opportunityScore: number;
  riskScore: number;
  riskEvidenceCoverage: Confidence;
  actionable: boolean;
  class: "ultra" | "strong" | "interesting" | "normal" | "weak" | "review";
  contributions: ScoreContribution[];
  riskFactors: ScoreContribution[];
  blockers: string[];
  freshness: FreshnessResult;
  pricing: PricingResult;
  profit: ProfitEstimate | null;
  evaluationVersion: string;
}

interface AlertDecision {
  send: boolean;
  event: "new_listing" | "price_drop" | "manual_threshold";
  priority: "normal" | "high" | "ultra";
  dedupeKey: string;
  reasons: string[];
  suppressedBy: string[];
  publicationClaim: string; // nunca usar firstSeen como "publicado há"
}
```

Todos os motores recebem `now` por parâmetro. Proibir `Date.now()` internamente torna recência, scheduler e testes determinísticos. Não colocar tokens nem objetos brutos de provider em mensagens de frontend.

## Recência e baseline

Fluxo recomendado:

1. Obter lease do par monitor/provider para impedir polls concorrentes. Criar estado `bootstrap` de forma transacional se ainda não existe.
2. Persistir todas as páginas cobertas pela busca e marcar respectivas observações `baseline=true`. A coleta inicial não produz alertas, inclusive para itens cuja data parece recente.
3. Só completar baseline após uma coleta válida do escopo prometido pelo provider. API sem paginação completa ainda pode operar, mas o sistema não deve inferir publicação apenas por diferenças entre conjuntos de resultados.
4. Falha entre páginas mantém bootstrap incompleto; o retry idempotente continua sem alertar. Expor "Preparando histórico" no UI.
5. Após o baseline, um ID novo dispara análise, não urgência. Para urgência é preciso publicação com evidência suficiente e disponibilidade compatível.
6. `firstSeenAt` canônico é o mínimo entre observações; `lastSeenAt` é o máximo. Uma nova evidência de provider não deve rejuvenescer anúncio antigo.
7. Datas de criação e atualização são campos separados. Nunca tratar edição, bump, refresh ou price drop como nova publicação.

Categorias propostas, configuráveis:

- `just_published`: toda a faixa de idade possível está entre 0 e 15 minutos.
- `recent`: não satisfaz a anterior, mas toda a faixa possível está entre 0 e 24 horas.
- `old`: menor idade possível é maior que 24 horas.
- `unknown`: evidência ausente, inválida ou intervalo cruza categorias sem garantia de recência.

Uma data somente com dia corresponde a um intervalo naquele timezone; não inventar 00:00 como publicação exata. "Há 2 horas" deve guardar intervalo de precisão compatível com a semântica documentada da fonte. Se desconhecida, conservar o texto e reduzir a confiança. Data no futuro acima da tolerância documentada de relógio fica inválida; não atribuir idade zero. Uma pequena tolerância deve ser registrada como correção técnica de relógio, não apagada silenciosamente.

Inferência `documented_delta` só é aceitável quando o provider oferece um feed completo, ordenado e documentado por criação e o cursor prova a janela. Busca ranqueada não oferece essa garantia. Na primeira versão, usar data explícita ou declarar desconhecida é a opção mais confiável.

Bootstrap é contextual: novo monitor sobre um listing já visto continua baseline naquele monitor, e novo provider não dispara novamente um anúncio já alertado. Expandir termos amplia cobertura e exige baseline apenas do novo escopo; dados antigos podem continuar sendo monitorados normalmente.

## Normalização e falso positivo

Pipeline barato: normalização Unicode NFKD + remoção de diacríticos + espaços entre letras/dígitos + aliases controlados. Separar busca expansiva de identificação: `Apple 15`, `IP15` e `play` podem descobrir candidatos, mas não devem confirmar modelo sem evidência adicional.

Ordem de regras iPhone: `pro max` antes de `pro`, depois `plus`, depois standard. "iPhone quinze" é alias de 15. Extrair armazenamento somente quando associado à unidade GB/TB e ao produto; "iPhone 15 com 2 capas 128 reais" não prova armazenamento. Cor não determina modelo. Armazenamento conflitante entre título e descrição bloqueia comparabilidade estrita.

PS5: reconhecer `ps 5`, `ps5`, `playstation 5` e `play 5`; `vendo meu play` precisa de evidência adicional. Preservar form factor (`standard`, `slim`, `pro`) e `discDrive` como dimensões diferentes. Não deduzir capacidade por geração, não tratar uma foto como prova de armazenamento, nem interpretar "digital" como capacidade. Leitor removível e bundle podem alterar acessórios sem alterar a família do console.

Descrição: "Bateria 86%, acompanha caixa, sem carregador, Face ID funcionando" vira `batteryHealth=86`, `box=true`, `charger=false`, `faceId='working'`. Informação ausente é `null`, não `false`. "Face ID não funciona" deve ter precedência sobre substring "funciona". "Sem iCloud / iCloud livre" não deve ser bloqueado por mera presença da palavra; "bloqueado iCloud" sim. Modelar a negação local em torno do atributo.

Preço: marcar `down_payment` para "entrada de 500", `installment` para "12x 500", `from_price` para "a partir de", `accessory_only` para "somente caixa", `trade` quando sem preço de venda em dinheiro. Se "à vista R$ 2.900 ou entrada de R$ 500" possui preço integral claramente extraível, usar 290000 e preservar ambas as evidências. Nunca multiplicar parcelas e assumir custo total se juros/entrada não estão explicitados.

IA pode resolver texto ambíguo ou fotos promissoras, mas precisa devolver JSON validado com evidências, alternativas e campos desconhecidos. Instruções contidas na descrição do vendedor são dados, nunca comandos para ferramentas.

## Comparáveis e estatística robusta

Antes de estatística, aplicar exclusões fortes: modelo/edição/armazenamento incompatível; novo contra usado; defeituoso contra íntegro; moeda diferente; preço não integral; o anúncio candidato; mesma identidade/fingerprint forte; snapshots repetidos. Não converter ausência de variante em match exato. Preferir três comparáveis corretos a trinta incorretos.

Peso inicial sugerido: `similarity * sourceQuality * freshnessWeight * conditionConfidence`. `freshnessWeight = exp(-daysSinceObservation / 30)` é uma hipótese versionada de decaimento, não uma lei de mercado. Mesma região aumenta similaridade; comparação entre canais de venda exige ajuste de taxas e rótulo do canal. Limitar peso agregado de um vendedor a 15% quando houver vendedores suficientes evita estoque de uma loja dominar o preço; em amostra curta, limitar confiança e expor concentração.

Procedimento:

1. Para n >= 5, calcular mediana e MAD sobre preços únicos elegíveis. MAD é `median(abs(x - median(x)))`. O z-score modificado é `0.6745*(x-mediana)/MAD`; magnitude > 3,5 marca potencial outlier, sem acusar fraude. Esses critérios vêm do [NIST, detecção de outliers](https://itl.nist.gov/div898/handbook/eda/section3/eda35h.htm).
2. Se MAD = 0 e IQR > 0, usar cercas `P25 - 1,5*IQR` e `P75 + 1,5*IQR`. O IQR é a diferença P75−P25; cercas são um indicador de observações extremas, conforme [NIST, box plots](https://itl.nist.gov/div898/handbook/prc/section1/prc16.htm).
3. Se MAD = IQR = 0, não dividir por zero nem excluir todo o conjunto: preços iguais à mediana permanecem; discrepâncias são marcadas para revisão ou recebem peso reduzido. É possível usar banda de 20% como fallback comercial explícito, nunca apresentá-la como resultado estatístico.
4. Calcular estatísticas finais após reduzir peso/excluir anomalias, mantendo lista de excluídos e motivos. Preços muito baratos reais devem permanecer no histórico e no radar, ainda que excluídos do preço central de referência.
5. Quantis de apresentação podem usar interpolação linear determinística `h=(n-1)*p`; quantis ponderados devem ter implementação e definição separadas, por CDF acumulada de pesos. Informar se mediana é ponderada, sem misturar silenciosamente as definições.
6. `effectiveSampleSize = sum(w)^2 / sum(w^2)`. Usar essa amostra efetiva, vendedores independentes, cobertura de atributos e dispersão na confiança. N=300 repetidos de uma loja não é confiança alta.

Política inicial: n utilizável < 3 ⇒ sem estimativa automática; n=3..7 ⇒ estimativa limitada, sem Ultra; n>=8 e amostra efetiva>=6 ⇒ pode precificar, com confiança reduzida por qualidade/concentração/dispersão. P05 só deve alimentar Ultra com amostra efetiva >= 40, elevada qualidade e sensibilidade revisada. Os limiares são hipóteses de produto que precisam de backtest.

## Venda rápida, custos, compra máxima e ROI

Primeira versão com preços anunciados:

`marketEstimate = weightedMedian(comparableAskingPrices)`

`quickSaleEstimate = min(P25, weightedMedian * (1 - configuredQuickSaleDiscount))`

Desconto inicial configurável, por exemplo 8%, é hipótese do usuário/sistema. Exibir "Venda rápida estimada · baseada em anúncios · sem prazo comprovado" e decomposição de dados, percentil e ajuste. Ajuste de condição só quando comparáveis diferem e existe regra explícita; não aplicar duas vezes um desconto de condição já incorporado na seleção. Para condição desconhecida, reduzir confiança e mostrar cenário, sem inventar ajuste preciso.

Faixa baixa/alta de cenário pode variar o preço estimado por parâmetros explícitos. Não chamá-la de intervalo de confiança estatístico sem método apropriado. Preço estimado deve ser arredondado, por exemplo para R$10; cálculos financeiros internos ficam em centavos. Vendas confirmadas futuras podem calibrar `realizedSale / predictedSale`, segmentando variante, condição, região e canal. Não misturar preço removido com preço vendido.

Considere compra B, venda S, custo antecipado K, custo fixo de venda F, comissão fracionária f e reserva C:

```text
lucroBruto = S - B
custosTotais = K + F + round(S*f) + C
lucroLiquido = S - B - custosTotais
capitalInvestido = B + K + C
ROI_sobre_compra = lucroLiquido / B
ROI_sobre_capital = lucroLiquido / capitalInvestido
```

Se denominador for zero, retornar `null`. Não apresentar infinito ou converter para 0%. Reservas podem ser contabilizadas no capital conforme política, mas a escolha precisa ser constante em lucro e compra máxima.

Para ROI mínimo r sobre capital, o preço máximo atende:

`maxBuyROI = floor((S*(1-f)-F)/(1+r) - K - C)`

Para ROI mínimo r sobre preço de compra:

`maxBuyROI = floor((S*(1-f)-F-K-C)/(1+r))`

Para lucro mínimo L: `maxBuyProfit = floor(S*(1-f)-F-K-C-L)`. Compra recomendada = máximo de zero e mínimo entre os limites ROI, lucro e orçamento. Recalcular com centavos e arredondamento de comissão para não exceder meta por erro de um centavo. Compra excepcional pode usar meta de ROI mais alta, com rótulo explícito, sem confundir com preço observado no mercado.

Exemplo pedido: B=2100, S=2950, custos=150 ⇒ lucro=700; ROI/compra=33,33%. Se todos os 150 são pagos antes da venda, ROI/capital=31,11%. Mostrar a base evita que uma fórmula tecnicamente diferente pareça erro.

## Risco independente e oportunidade explicável

Risco deve começar como conjunto de evidências com pesos versionados. Exemplos: preço de entrada +65 e blocker; bloqueio descrito +55 e blocker; título/foto contraditórios +25; preço abaixo de metade da referência +25; pedido de pagamento antecipado +25; defeito declarado +20; imagem duplicada sem prova de mesmo item +10. Agrupar sinais correlacionados para não somar três vezes o mesmo fato. Limitar em 100 e exibir cobertura: "Pouca informação do vendedor" é evidência ausente, não prova de fraude. Não usar "golpe" como decisão automática.

O Opportunity Score pode somar fatores limitados para ranking, com parâmetros explícitos. Exemplo inicial de orçamento de pontos: desconto contra venda rápida 25, ROI líquido 25, lucro absoluto 10, liquidez 10, recência 15, qualidade/comparáveis 10, distância/custo logístico 5. Se quiser considerar risco dentro da oportunidade, adicionar uma penalidade limitada e visível; manter também o índice de risco completo, independente.

Normalizar cada fator por curvas piecewise documentadas e configuráveis. Não dar 25 pontos de ROI porque ROI existe: meta atendida/deficitária precisa influenciar a nota. Registrar cada contribuição com entrada numérica e explicação. Score final é soma de contribuições arredondadas e clamp com ajuste explícito, para que o usuário possa reproduzir exatamente o número.

Dados ausentes não devem ser automaticamente bons. Sem liquidez observada: zero contribuição e motivo "liquidez não calibrada"; no modo demo, qualquer índice simulado precisa estar identificado. Um score heurístico 92/100 não significa 92% de chance de lucro.

Classificação forte deve usar score e gates: lucro/ROI mínimos, risco máximo escolhido, preço integral, correspondência do produto, localização e confiança. Itens financeiramente interessantes mas com risco alto permanecem visíveis como revisão. Baseline/antigo/data desconhecida pode ter score econômico alto, porém não se torna "urgente".

Ultra automático exige simultaneamente preço < P05 confiável, liquidez alta observada, confiança >=0,85, recência <=15min comprovada, risco aceitável, lucro/ROI mínimo e amostra efetiva suficiente. Manual <= limiar Ultra é uma categoria "limiar manual Ultra"; não alegar raridade estatística quando ela não foi demonstrada.

## Alertas, price drop e disponibilidade

Gates comuns: monitor ativo, baseline concluído para a observação relevante, preço integral, produto compatível, item ativo recentemente verificado, canal habilitado, limites de risco e dados atendidos. Regra manual substitui a condição econômica conforme modo, mas não torna antigo recém-publicado ou dispensa baseline.

Três eventos separados:

- `new_listing`: requer recência real conhecida e observação pós-baseline.
- `price_drop`: pode ser item antigo, mas exige snapshot anterior persistido, queda material configurada, timestamp da observação e disponibilidade recente. Mensagem diz "queda detectada agora; publicação antiga/desconhecida".
- `manual_threshold`: deve informar a origem manual, publicação e descoberta separadas. Nunca enviar backlog inicial de todos os itens abaixo do limiar.

Persistir outbox na mesma transação da avaliação. Chave idempotente por usuário/canal + identidade canônica + tipo de evento + marco de preço/versão relevante. Não colocar horário atual na chave, pois destruiria deduplicação. Novo provider, novo poll ou recomputação da mesma avaliação não criam novo alerta.

Novo alerta de price drop após cooldown, por exemplo 6h, requer preço abaixo do último preço alertado por limiar absoluto E percentual configuráveis. Isso evita oscilação 2200→2190→2200→2190 e limita spam. Preferir identificar nova revisão de preço e registrar motivo de supressão, sem apagar avaliação do feed.

Retries de envio com backoff+jitter devem manter mesma idempotency key. Entrega exatamente uma vez em canal externo só é garantível se o canal oferecer deduplicação; caso contrário documentar semântica pelo menos uma vez com proteção local. Falha não deve bloquear outros providers ou análise.

## Liquidez e observação de tempo ativo

Sem dados reais, devolver `unknown` ou "simulado". Contagem de oferta é volume, não demanda. Anúncios que somem dos resultados ranqueados não são eventos de saída confiáveis. Medidas úteis iniciais: duração observada desde primeira visão, número de snapshots válidos, última confirmação ativa e status final explícito.

Estimar "probabilidade de desaparecer" futuramente requer coorte, janela de acompanhamento e tratamento dos ainda ativos como observações censuradas. Não chamar média apenas de itens encerrados de tempo médio de venda: excluir ativos produz viés. `sold` exige status explícito da fonte ou feedback de venda confirmado pelo usuário; `removed`, `unavailable` e `unknown` não entram como vendas confirmadas.

## Custos computacionais e ROI operacional

Cache de normalização por hash de título+descrição+campos, versão de regras/modelo e identidade. Cache visual por hash de imagem e versão, nunca só URL volátil. Atualização de preço refaz margem/score, sem reprocessar imagem idêntica. Estimativa de comparáveis em cache por variante/região/canal/condição e janela, com invalidação por novos preços.

Pipeline: (0) validar/deduplicar/preço/negativos; (1) normalização por regras; (2) consultoria de preços em cache; (3) IA textual só em conflito promissor; (4) visão só se pode mudar decisão econômica relevante. Buscar detalhes somente após filtro barato, respeitando campos e limites de provider. Queries expansivas devem ter orçamento por monitor e registrar novos itens úteis por custo.

Métricas de custo sem inventar preços de fornecedor:

```text
providerCost = calls * costPerCall + returnedRecords * costPerRecord
aiCost = inputTokens/1e6*inputRate + outputTokens/1e6*outputRate + imageCharges
costPerQualifiedAlert = totalVariableCost / qualifiedAlerts
costPerConfirmedPurchase = totalVariableCost / confirmedPurchases
netRealizedContribution = realizedResaleProfit - attributableSystemCost
```

Divisões sem eventos retornam desconhecido, não zero. Preço unitário precisa vir da configuração/documentação do fornecedor escolhido. Medir p50/p95 do tempo descoberta→alerta e tempo de cada estágio; um cache deve reduzir custo sem ocultar idade dos comparáveis.

## 20 testes úteis e determinísticos

| #   | Cenário                                                                       | Resultado obrigatório                                                                                                          |
| --- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| 1   | Primeiro poll retorna 50 anúncios, incluindo 3 publicados há 2min e 8 baratos | Todos entram como baseline; zero alertas; histórico e avaliação ficam disponíveis                                              |
| 2   | Bootstrap falha na segunda página, retry repete primeira                      | Continua bootstrap, sem alertas/duplicatas; só completa após cobertura válida                                                  |
| 3   | Monitor A já live; criar monitor B ou adicionar provider B                    | Novo escopo faz baseline; anúncio existente mantém firstSeen canônico e não reenvia alerta                                     |
| 4   | ID E aparece agora, publishedAt há 30 dias                                    | `old`, isNewToMonitor=true, urgência false; texto não diz publicado agora                                                      |
| 5   | ID E aparece agora sem data, ou somente `updatedAt` há 1min                   | Publicação unknown; firstSeen separado; updatedAt não concede recência                                                         |
| 6   | Publicação exata há 5min, há 2h, há 25h, e futura em 2 dias                   | Classes just_published/recent/old/unknown; futuro não vira idade zero                                                          |
| 7   | Mesma identidade por dois providers e URL com tracking; seller igual          | Um listing, duas observações seen_by, uma avaliação/evento; preserva primeira visão                                            |
| 8   | Títulos idênticos e preços iguais, mas IDs e vendedores distintos             | Não funde automaticamente; fuzzy match é indício, não chave única                                                              |
| 9   | "iphone quinze azul 128GB pouco uso" versus "iPhone 15 Pro Max 256GB"         | Standard 128 e Pro Max 256; não são comparáveis estritos                                                                       |
| 10  | "PS5 Slim Digital" versus "PS5 Slim com leitor" versus "vendo meu play"       | DiscDrive absent/included/unknown; terceiro precisa de revisão; não presume capacidade                                         |
| 11  | "Face ID não funciona, sem carregador, iCloud livre, bateria 86%"             | faceId not_working; charger false; sem falso bloqueio de iCloud; battery 86                                                    |
| 12  | "entrada 500", "12x500", "só caixa 150" e "à vista 2900 ou entrada 500"       | Primeiros três não calculam lucro automático; último usa total explícito 2900                                                  |
| 13  | 20 preços entre 2700–3300, dois preços 500, mais o candidato 2100             | 500 marcados outlier após filtro; candidato excluído do próprio pricing; centro robusto                                        |
| 14  | [3000,3000,3000,3000,3000,500], e [3000,3000,3000]                            | MAD zero não produz NaN; repetidos preservados; baixa amostra/dispersão zero explicada                                         |
| 15  | 300 snapshots de 2 listings e 2 comparáveis independentes                     | Conta identidades únicas, não snapshots; confiança limitada, sem Ultra                                                         |
| 16  | Apenas 2 comparáveis, variante desconhecida ou preço em USD                   | Dados insuficientes/inelegíveis; não fabrica venda rápida em BRL ou ROI                                                        |
| 17  | B=2100/S=2950/K=150/f=0; depois S=2500/f=0,12 e custos altos                  | Primeiro lucro700/ROIcompra33,33%/ROIcapital31,11%; segundo inclui comissão na venda e permite prejuízo                        |
| 18  | Meta ROI capital20%, venda3000, taxa10%, K100,F50,C0                          | Em centavos, MaxBuyROI=floor(265000/1,2-10000)=210833, ou R$2108,33; comprar acima deve falhar meta                            |
| 19  | Mesmo alerta reprocessado, novo provider, retry de canal; oscilação de preço  | Uma chave idempotente; sem repetição; queda material posterior gera evento próprio após cooldown                               |
| 20  | Provider 429/timeout/resultado vazio; depois item some da busca ranqueada     | Backoff e saúde degradada; baseline não termina indevidamente; item não vira vendido/removido; fila dos outros providers segue |

Observação do teste 18: executar inteiramente em centavos e validar o ponto de corte exato pela função de lucro evita divergência do exemplo textual arredondado. Adicionar invariantes no teste de score: contribuições somam valor exibido; 0<=score<=100; risco não muda porque ROI mudou sem nova evidência; nenhum dado insuficiente promove Ultra.

## Referências primárias usadas

- [NIST — Detection of Outliers](https://itl.nist.gov/div898/handbook/eda/section3/eda35h.htm): MAD e z-score modificado, com limiar heurístico de 3,5.
- [NIST — What are outliers in the data?](https://itl.nist.gov/div898/handbook/prc/section1/prc16.htm): IQR e cercas de box plot.

As decisões de baseline, pesos, faixas de recência, políticas de alerta e regras de compra neste documento são propostas de engenharia para o requisito comercial, não alegações extraídas dessas referências. Fontes e taxas de providers reais devem ser validadas pelo responsável pela pesquisa de integrações.
