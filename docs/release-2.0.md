# Market Radar 2.0 RC1: entrega e validação

## Resultado real

Há uma source atualizada e um pacote incremental produzido a partir da SaaS dev.1 com a correção de busca anterior. O código foi alterado e testado nesta execução. Não se trata de um plano sem implementação. Ao mesmo tempo, RC1 é uma versão para teste integrado: não há homologação de site público ou garantia de desempenho do fornecedor.

Base local: `72d6d77`, reconstruída dos dois ZIPs entregues nesta conversa. Branch local: `feat/market-radar-2.0`. Não é um clone do histórico remoto. O GitHub foi apenas consultado e permanecia no commit `e2d456bb38093e148bbb1ccfad955534484899c2`; nenhuma alteração remota ou push foi executado.

Nenhuma chamada real à Bright Data/Telegram foi efetuada. Nenhuma credencial do usuário foi carregada. Seu banco local não está acessível nesta execução; todas as migrations e operações abaixo foram testadas em bancos isolados.

## Principais mudanças

### Seleção correta

A vitrine deixou de ser a lista de tudo que entrou no banco. Exige correspondência com radar ativo, produto/versão, orçamento, condição utilizável, localização verificável e publicação dentro da janela. Existe limite máximo de sete dias mesmo em configurações antigas sem limite. Data ausente, inválida, futura ou não confiável não vira recente.

iPhone 14 não inclui iPhone 13, 14 Pro, 14 Plus ou 14 Pro Max. Armazenamento e edição só são equivalentes quando correspondem à escolha. Partes avulsas não aparecem como aparelho completo. Preço muito baixo sozinho gera atenção, não uma rejeição automática que impediria oportunidades.

A data de publicação rege ordenação por recentes. A expiração também é conferida ao consultar o cache. Quando dois radares têm períodos diferentes, um período expirado não esconde um item ainda válido no outro. Os filtros por radar não herdam o orçamento de outra busca.

### Consultas e custos

Os aliases são gerados por identidade de produto, respeitando capacidade e edição. Uma variação é escolhida por execução, e sua utilidade registrada, sem multiplicar chamadas por sinônimo. Não há expansão silenciosa para outro modelo.

O adaptador seleciona sete dias somente quando essa opção está entre os valores confirmados pelo contrato. Com apenas 24 horas confirmadas, usa a janela mais curta. Sem enum confirmado, o cliente recebe aviso sobre filtro local e possível consumo de itens antigos. O request_snapshot registra a política efetivamente enviada. O mapa é verificado com transporte simulado; a enumeração da conta real não foi consultada nesta entrega.

Raio só é enviado com tipo/unidade compatíveis confirmados. Não há geocodificação universal nesta entrega: sem coordenadas, a seleção por cidade é conservadora, não equivale a um raio real. A referência de preço continua separada da seleção dentro do orçamento, usando os dados compatíveis já persistidos; não foi criado um coletor pago adicional de referência.

### Ativação e interface

Novo radar abre o assistente. Ativar radar e buscar salva uma intenção durável, com identificador idempotente e enqueue persistido. O worker retoma intenções pendentes quando a fonte estiver pronta. Isso dispensa a confirmação repetida da primeira pesquisa. Fonte desligada ou cota bloqueada não são contornadas.

A primeira pesquisa pode mostrar margem adequada, mas não dispara falsa novidade. Radares antigos não ganham chamadas pagas adicionais só porque a source foi atualizada. O modo piloto permite a primeira pesquisa autorizada; acompanhamento periódico posterior requer decisão administrativa de desligar piloto e capacidade disponível.

A home ficou mais compacta, com foco em oportunidades. Cards usam publicação relativa; detalhes apresentam conta da revenda, até quanto pagar, motivos comerciais e pontos a conferir. Fórmulas internas e mensagens de baseline/score não são exibidas diretamente no fluxo principal. Os detalhes técnicos permanecem na administração.

Há reaproveitamento da região e das preferências, pesquisa/paginação no servidor, filtros de histórico/revisão separados e atualização periódica do feed. Marcar interesse/negociação, salvar, descartar, registrar compra e venda usam persistência e controle de versão.

### Negociação e disponibilidade

A mensagem de negociação é preparada para o cliente revisar e copiar; não é enviada automaticamente. O teto de compra e as despesas continuam calculados pelo motor financeiro existente.

O quadro Meus negócios tem interessado, negociação, comprado, à venda e vendido. Não é possível marcar compra/venda apenas arrastando um card sem informar a operação: são exigidos valores reais registrados. A migration recupera compras existentes no quadro sem alterar seus preços.

O anúncio não abre é uma preferência do usuário, não uma declaração global de vendido. A conferência por URL é opcional e desativada por padrão. Quando habilitada administrativamente, há fila, deduplicação, reaproveitamento de consulta recente, teto separado, reserva na cota individual/global, lease, cursor persistido e tratamento de disparo incerto sem repetir cobrança cegamente. Respostas inconclusivas permanecem desconhecidas. Avisos externos pendentes de anúncios expirados ou explicitamente indisponíveis são suprimidos.

A conferência seletiva automática também é opt-in e limitada. A implementação foi testada com simulação, não com sua conta ou com garantia de disponibilidade no clique. Não há promessa de entrega exatamente uma vez em canal externo.

### Operação e experiência administrativa

A cadência efetiva considera a capacidade diária e os radares ativos. Cinco disparos por dia não são apresentados como atualização a cada cinco minutos. Reservas, leases, revisão de monitores, transações e tetos existentes foram preservados.

O painel administrativo acrescenta amostra limitada das últimas 100 execuções da própria conta: recebidos, correspondentes, dentro do orçamento, margem adequada, duplicações, falhas e motivos. São observações, não produtos únicos nem fatura em reais. Não foram inventados preços atuais de serviço ou planos.

## Validação desta execução

| Verificação | Resultado | O que comprova |
|---|---|---|
| Baseline recebido | 158 passaram | Situação antes das mudanças desta execução |
| Casos novos antes das correções | 5 falhas reproduzidas | Vitrine, idade, aliases e decisão financeira inicial |
| Suíte final | **183 passaram; 0 falharam; 0 ignorados** | Regras, fluxos de API/banco com simulação e ferramentas locais |
| TypeScript | Passou | Contratos tipados nos arquivos verificados |
| ESLint | Passou, sem warnings na execução final | Escopo definido pela configuração do projeto |
| Bundle de integração dos componentes | Passou, webpack de testes | Compilação do conjunto real de componentes, não build Vinext de produção |
| Renderização estática do assistente | Passou nos quatro passos | Textos e presença das ações; não cliques reais |
| Atualização local do banco | Passou | Backup WAL, integridade, restauração em destino novo, idempotência, recusa de ambiguidade e rollback de falha SQL |
| Build completo Vinext | **Bloqueado** | Módulo `@rolldown/binding-linux-x64-gnu` ausente nas dependências recebidas; não aprovado |
| Navegador local automatizado | **Bloqueado** | `net::ERR_BLOCKED_BY_ADMINISTRATOR`; não houve inspeção visual completa |
| Bright Data, Telegram e produção | Não executados | Exigem configuração/autorização de teste externo |

Os testes novos incluem: modelo errado, aparelho para peças, anúncio de 35 dias, publicação incerta/futura, sete dias e 24h, primeiro resultado com margem sem alerta de novidade, repetição idempotente de ativação, execução no piloto após habilitação, payload com cidade e período confirmado, isolamento de conta e de orçamento por radar, expiração de cache, etapas de negócio, verificação de disponibilidade, interrupção incerta, retomada do mesmo snapshot com coleta desligada, aviso expirado e migração local segura.

Alguns testes antigos foram ajustados somente onde a política aprovada mudou: baseline passa a permitir avaliação financeira sem permitir aviso de novidade; limite legado ilimitado não permite mais anúncio de vinte dias. A fixture dos testes de entrega utiliza data atual para não depender do dia em que a suíte foi rodada. Testes de recuperação de erros permanecem ativos.

## Desempenho local

| Cenário | Anúncios na base | Cards | JSON (bytes) | Primeira montagem (ms) | Cache (ms) |
|---|---:|---:|---:|---:|---:|
| mixed | 50 | 10 | 34007 | 24 | 1 |
| same | 50 | 50 | 170416 | 31 | 3 |
| unique | 50 | 50 | 171323 | 40 | 5 |
| mixed | 500 | 50 | 170177 | 157 | 4 |
| same | 500 | 50 | 171262 | 217 | 10 |
| unique | 500 | 50 | 172141 | 539 | 9 |
| mixed | 5000 | 50 | 170578 | 1335 | 24 |
| same | 5000 | 50 | 171618 | 2281 | 73 |
| unique | 5000 | 50 | 167172 | 25446 | 81 |

Dados sintéticos, Node 22.16, Linux; sem tráfego do fornecedor. `same` usa mesmo modelo, `mixed` mistura modelos, `unique` tem preços distintos. No cenário mixed com 50 itens, somente dez correspondem ao radar, portanto o retorno menor não é uma comparação equivalente de páginas completas. Todas as páginas medidas ficaram abaixo de 300 KB e sem comparáveis completos embutidos.

A primeira reconstrução com 5.000 preços distintos levou cerca de 25,4 segundos. Isso é uma limitação real de CPU do caminho exato de precificação: não foi mascarada por alteração dos resultados financeiros. O cache ficou em aproximadamente 81 ms nesse cenário. Não anunciar latência comercial com base nestes números nem elevar volume sem otimização e carga de staging. A duplicação quadrática de comparáveis no payload foi removida; o custo de cálculo exato em determinados conjuntos continua relevante.

## Matriz de cobertura

| Requisito | Situação nesta entrega | Arquivos/evidência principal |
|---|---|---|
| Produto/versão exatos, aliases automáticos | Implementado e testado localmente; catálogo extensível, não universal | core/catalog.ts, query-strategy.ts, opportunity.ts; v2-selection/v2-flows |
| Limite sete dias e opção 24h | Implementado no domínio, feed/cache e avisos pendentes | core/selection.ts, freshness.ts; server/feed.ts, notifications.ts |
| Filtro nativo para economizar retorno inútil | Implementado respeitando contrato; payload simulado; sete dias real ainda depende da conta | providers/search-policy.ts; server/worker.ts |
| Ativação já inicia primeira busca | Implementado com intenção durável e idempotência | server/searches.ts, activations.ts, http.ts, supervisor.ts |
| Details sem fórmulas técnicas | Implementado; textos e componentes compilados/renderizados estaticamente | core/customer-copy.ts, components/saas/results-feed.tsx |
| Novo layout e assistente simples | Implementado; sem homologação visual em navegador | app/saas.css, radar-shell.tsx, search-wizard.tsx |
| Negociação e compra até venda | Implementado, persistido e testado entre contas | server/deals.ts, service.ts, deals-panel.tsx |
| Disponibilidade seletiva | Implementado, opt-in e testado por simulação; nenhuma confirmação externa | server/availability.ts, providers/brightdata.ts |
| Alertas seletivos e sem repetição cega | Proteções anteriores mantidas, supressão de expirados e cópia simples adicionadas | server/notifications.ts, ingestion.ts |
| Saúde, cotas e frequência compatível | Implementado e testado localmente; não é SLA de produção | core/service-schedule.ts, supervisor.ts, bootstrap.ts |
| Diagnóstico de qualidade/custo | Contagens úteis implementadas por conta; sem custo financeiro fictício | server/quality.ts, AdminPanel |
| Atualização, backup e recuperação | Implementado/testado em SQLite local isolado | scripts/upgrade-local.mjs, backup.mjs; v2-upgrade.test.mjs |
| Geocodificação, cidade/UF universal | **Parcial**: sugestões simples e restrição conservadora; serviço geográfico não integrado | wizard, monitorMismatch |
| Homologação pública/Windows/fornecedor | **Pendente**: ambiente externo, credenciais e teste visual | docs/implementation-status.md |

F01–F05 e F07 da auditoria anterior mantêm as correções da base; F06 preserva paginação e remoção de comparáveis do feed; F08/F09/F11/F13 foram complementados; F10 permanece dependente da fronteira de autenticação e revisão em staging; F12 não está homologado pelo bloqueio de build; F14/F15 recebem nova interface e documentação. Não classificar todos os achados como encerrados em produção.

## Banco e integridade da entrega

Somente `0006_radar_experience.sql` foi adicionada. As migrations antigas 0000–0005 e os seus snapshots anteriores foram preservados. O snapshot 0006 e journal foram incluídos para manter o schema versionado. A ferramenta de atualização faz backup antes da nova transação; não apaga anúncios nem troca identidades.

O pacote incremental deve reconstruir byte a byte a mesma árvore do pacote completo quando aplicado sobre a base local de entrega. O manifesto contém caminhos, tamanhos e hashes e o relatório de empacotamento registra a conferência. Nenhum node_modules, banco, cache, .git ou .dev.vars integra os ZIPs de source.

## Limites e trabalho de homologação restante

Não foram concluídos cadastro público/recuperação externos, integração de cobrança, geocodificação universal, teste com pessoas leigas, revisão independente da autenticação, teste de carga remoto, restart real do worker em staging, integração Bright Data/Telegram real ou D1 remoto. O coletor independente de referências de preço não foi ligado; referências insuficientes continuam sendo indicadas sem fabricação.

Os alertas têm preferências de novos/quedas e vínculo individual; horários silenciosos e resumos periódicos dedicados ainda não foram implementados. A conclusão da primeira busca é mostrada no painel; não foi acrescentado um envio externo separado “radar pronto”. Reconciliação do fornecedor sete dias/24h é baseada no contrato e na programação de cada radar, não um segundo coletor paralelo independente.

Esses pontos não impedem testar a atualização sobre a instalação atual, mas impedem chamar o conjunto de SaaS público integralmente homologado. Não execute atualizações destrutivas ou consumo real repetido para compensar uma falha de ambiente.

## Próximo teste controlado

Pare os processos, copie o pacote incremental, execute npm run dev e confira a mensagem de backup/migration. Abra o feed: os itens antigos ou incompatíveis já persistidos devem sair de Oportunidades sem desaparecer do histórico. Crie um radar e use Ativar radar e buscar uma vez. O envio real só ocorre com sua configuração administrativa habilitada e cota disponível. Confira resultado e entrada efetivamente enviados à fonte; não altere cotas nem habilite conferência paga adicional apenas para encher a tela.

## Referências do adaptador

Documentação primária consultada: Bright Data, Discover Marketplace listings by keyword; Collect Marketplace listings by URL; Get all scrapers. As páginas descrevem os endpoints e a data listing_date, mas não foram tratadas como prova de todos os valores de enum aceitos na conta do usuário. Não foi utilizado o contrato de outro fornecedor como se fosse Bright Data.

- https://docs.brightdata.com/api-reference/scrapers/social-media-apis/facebook-marketplace-discover-by-keyword
- https://docs.brightdata.com/api-reference/scrapers/social-media-apis/facebook-marketplace-collect-by-url
- https://docs.brightdata.com/api-reference/scrapers/management-apis/get-scrapers
