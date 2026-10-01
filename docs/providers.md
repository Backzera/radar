> **Documento histórico da V1.1.** Preservado para referência; comandos, fluxos e evidências não homologam a versão de desenvolvimento atual. Consulte [os guias atuais](../README.md) e a [matriz de implementação](implementation-status.md) antes de operar.

> Operação atual: somente dados reais, mocks em tests. Last 24 hours é uma opção confirmada pelo usuário no painel da conta; não é enum publicado pela metadata. Veja [real-operation.md](real-operation.md).

# Facebook Marketplace · Bright Data · V1.1

Metadata autenticada consultada em 12/09/2026 com HTTP 200. Dataset `gd_lvt9iwuh6fbcwmx1a`; keyword, Search URL e Collect reconhecidos. Nenhuma coleta paga executada. [Contrato observado e divergência corrigida](brightdata-authenticated-contract.md).

## Métodos e filtros nativos

- **keyword**: usa `discover_by_keyword`, com `keyword` e os filtros opcionais/configurados `city`, `radius`, `date_listed` **somente se publicados na metadata**. Campos obrigatórios precisam ser preenchidos. Não copia cidade/raio comerciais locais para o input do provider.
- **search_url**: usa a URL original da página de resultados, com `country` se confirmado pelo contrato. Não reconstrói filtros internos do Facebook.
- **collect_url**: suporte interno ao `collect_by_url` para um anúncio individual. Não substitui descoberta nem é chamado automaticamente.

**Evidência atual:** city:text obrigatório, radius:number opcional, date_listed:text opcional e country:country opcional foram confirmados. Ambos os discovery declaram apenas url na saída; Collect declara detalhes ricos. A saída resumida não define sozinha o conteúdo final do snapshot. O parser agora distingue essas fases.

A documentação de metadata garante `name`, `type` e `required`, mas não garante enum, unidade ou limites. O adapter lê `enum` ou `options` (valores simples ou objetos com `value`), `minimum/maximum` ou `min/max`, `unit` e `description` **quando presentes**. Metadata incompleta não gera opções presumidas. `date_listed` sem opções continua marcado como suportado, mas com preenchimento indisponível; campo obrigatório sem suporte bloqueia o método. Unidade do raio ausente é mostrada como desconhecida, nunca como km presumido. Confirme-a no painel antes de preencher. Tipos novos ou estruturas não reconhecidas precisam de revisão do adapter com um export sanitizado do schema; nunca envie Authorization.

Dataset documentado: `gd_lvt9iwuh6fbcwmx1a`. [Keyword](https://docs.brightdata.com/api-reference/scrapers/social-media-apis/facebook-marketplace-discover-by-keyword), [descoberta por URL](https://docs.brightdata.com/api-reference/scrapers/social-media-apis/facebook-marketplace-discover-by-url), [collect por URL](https://docs.brightdata.com/api-reference/scrapers/social-media-apis/facebook-marketplace-collect-by-url).

## Contrato confirmado antes do disparo

GET `https://api.brightdata.com/datasets/v3/scrapers?dataset_id=...` com Bearer confirma dataset, domínio, campos, métodos e tipos de entrada quando presentes. Essa leitura não dispara coleta. `discover_by_keyword` determina `discover_by=keyword`. Para URL, o adapter exige método discovery com entrada URL compatível; prioriza `discover_by_url` quando existe, ou exatamente um outro método compatível. Método ausente/ambíguo é bloqueado. `collect_by_url` não substitui discovery. A documentação específica não fornece um sufixo async universal para URL: ele é resolvido pela metadata da conta. O health informa compatibilidade de cada modo separadamente e expõe os schemas normalizados de entrada e saída, sem samples nem secrets. O input é validado antes de reservar orçamento; nomes, tipos, campos obrigatórios, opções e limites incompatíveis bloqueiam o POST. Um fingerprint detecta mudanças desde a última revisão do formulário. [Introspecção oficial](https://docs.brightdata.com/api-reference/scrapers/management-apis/get-scrapers).

POST `/datasets/v3/trigger` usa dataset, `type=discover_new`, discriminador confirmado, `include_errors=true`, `limit_per_input` e `limit_multiple_results`. Corpo: array de um input. Guarda o snapshot antes de polling GET de `progress/{snapshot_id}` e download `snapshot/{snapshot_id}?format=json`. Confere IDs de snapshot/dataset quando retornados. GET temporário pode repetir com backoff; POST ambíguo não repete, inclusive após outro clique no mesmo escopo. Limites locais: 1–100 registros, até 10 no piloto, 2 MB, 30 minutos. [Async](https://docs.brightdata.com/api-reference/rest-api/scraper/asynchronous-requests), [progresso](https://docs.brightdata.com/api-reference/scrapers/management-apis/monitor-progress), [download](https://docs.brightdata.com/api-reference/scrapers/delivery-apis/download-snapshot).

## Mapeamento e qualidade

- ID: deriva da URL estável de item quando `product_id` está ausente; quando presente, deve coincidir com a URL; identidade canônica serve à deduplicação, e `originalUrl` preserva o link retornado.
- Preço: somente `final_price`; aceita número ou BRL textual. Ausente/ilegível/moeda não suportada vira null. Não usa `initial_price` como valor atual.
- Publicação: somente `listing_date` com timestamp completo e timezone, normalizado para UTC. Parser distingue ausente, sem confiança temporal, inválido e futuro. Não usa data do snapshot nem scrape time. Confiança 75 é heurística interna, não certificação.
- País: BR/BRA ou ausente; país incompatível rejeita e é contado. Localização vem de `location`; `returnedLocation` preserva o texto integral e `city` mantém a normalização anterior. Ausente fica vazia. Cada `provider_runs.request_snapshot` guarda filtros solicitados, dataset, contrato, fingerprint e limite, mesmo se nenhum anúncio retornar. `date_listed` é filtro de consulta, nunca data do anúncio. Sem coordenadas inventadas.
- Fotos: URLs HTTPS dos CDNs Facebook permitidos; carregadas diretamente, sem baixar todo o acervo nem proxy arbitrário. Falha mostra fallback.
- Vendedor: `profile_id`; sem coleta adicional de dados privados.
- Disponibilidade: `is_sold:boolean` foi confirmado no contrato. `true` vira `sold`; `false` ou ausente mantém `unknown`, nunca deriva de snapshot `ready`. Adiciona risco moderado +6 e reduz confiança em 6 pontos, mas permite alertas com os demais critérios. Vendido/removido/indisponível confirmados bloqueiam alerta.

Detalhe individual existe via `/scrape`, com timeout de 75s, input de um item e limite no corpo. Não é agendado automaticamente e exige callback interno `reserveCollectTrigger` que autorize/contabilize a chamada adicional antes do POST. A factory da aplicação não fornece esse callback, portanto enriquecimento permanece desligado: a existência de campos de detalhe não autoriza enriquecimento indiscriminado nem uma segunda chamada paga. Resposta async de detalhe é sinalizada explicitamente. [Detalhe Facebook](https://docs.brightdata.com/api-reference/scrapers/social-media-apis/facebook-marketplace-collect-by-url), [contrato síncrono](https://docs.brightdata.com/api-reference/scrapers/synchronous-requests).

## Custos e limites

A tabela consultada informa PAYG US$1,50/1.000 registros e 5.000 registros gratuitos/mês. Confirme elegibilidade, saldo e limite mensal na conta; não há garantia de custo zero. Piloto: 5 disparos/dia × até 10 registros, manual, limite compartilhado por credencial. Nominal de 30 dias: até 1.500 registros solicitados, equivalente a US$2,25 na tarifa citada antes de franquia/impostos. Repetições podem ser cobradas, limites solicitados não garantem a fatura. Reservas ambíguas permanecem contabilizadas. Consultas bloqueadas/preflight não consomem reserva. [Preço oficial](https://brightdata.com/pricing/web-scraper).

O adapter usa a API contratada do fornecedor. Não implementa CAPTCHA, evasão, contas falsas, scraping de sessão do usuário nem login automatizado no Facebook. A confirmação de direitos é do operador e não concede licença da Meta.

## Validação pendente

Coleta manual de cinco registros, uma URL brasileira escolhida pelo operador, qualidade de data/cidade, latência e resultados observados. API key e metadata já foram validadas sem coletar. Enum de date_listed e unidade/limites de radius continuam não publicados. Não inferimos cobertura sem ground truth, venda a partir de desaparecimento, liquidez a partir de quantidade de ofertas nem preços reais a partir de demo. Fonte e método ficam registrados por execução e primeira observação.

Outras fontes continuam fora do escopo da V1.1. A pesquisa anterior sobre Meta, Mercado Livre, OLX e Apify foi preservada em [pesquisa V1](providers-v1-research.md). Para ativar: [guia de teste real](live-facebook-test.md).
