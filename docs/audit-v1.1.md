> **Documento histórico da V1.1.** Preservado para referência; comandos, fluxos e evidências não homologam a versão de desenvolvimento atual. Consulte [os guias atuais](../README.md) e a [matriz de implementação](implementation-status.md) antes de operar.

# MARKET RADAR V1.1 — auditoria pré-alteração

Data: 11/09/2026 UTC (sessão iniciada em 10/09 no Brasil). Auditoria somente de leitura da base existente antes das alterações V1.1. Referências/linhas abaixo correspondem à versão pré-alteração. Nenhuma chamada externa autenticada ou paga executada por esta auditoria. Nenhuma alteração no checkout feita pelo auditor.

## Escopo inspecionado

`providers/{contract,brightdata,mock}.ts`, `core/{types,normalize,freshness,pricing,opportunity,scheduler}.ts`, `server/{store,ingestion,worker,service,validation,api,seed,notifications}.ts`, `db/schema.ts`, migration `0000_certain_zarda.sql`, fixture SQLite, testes de motores/provider/pipeline, frontend Radar/painéis, `.env.example`, scripts worker/migration/init, Docker, identidade do starter e documentação de arquitetura/API/preços/score/freshness/providers/validação/roadmap/README/CHANGELOG.

## Bloqueios concretos de dados reais

1. **Todos os resultados Bright Data são `unknown`, e o motor bloqueia todos.** `providers/brightdata.ts:91` define `availability: "unknown"`; `core/opportunity.ts:112` bloqueia `availability !== "active"`, repetido para price drop na linha 181. Não impede persistência nem score, mas torna qualquer alerta real impossível. A aba inicial do Radar é `opportunities` (`radar-app.tsx:228`) e exige `a.eligible` (`:366`), escondendo esses registros na primeira vista. Corrigir gate apenas para sold/removed/unavailable, manter unknown explícito com penalidade moderada e texto nos alertas. Oferecer vista de validação com todos os reais/baseline, independente da decisão comercial.

2. **Preço string ou ausente descarta completamente um listing.** Schema em `brightdata.ts:16` exige `final_price` number; mapeamento retorna null se falha. Os testes atuais exigem esse descarte. `RawListing.price` e as colunas listings/snapshots (`db/schema.ts:42,65`) também são não nulas. Necessária migration aditiva para nullable nas duas tabelas e atualização de tipos/UI/motor. Parser BRL deve distinguir `R$ 2.500`/`2.500,00` de decimal; sem preço vira null, não zero. `materialize` compara preços diretamente (`ingestion.ts:25`): com nullable, null deve jamais gerar queda de preço nem lucro, compra manual ou comparável.

3. **Pesquisa somente keyword, sem contrato abstrato discriminado.** `contract.ts` recebe `query: string`. `brightdata.ts:248,256` usa `discover_by=keyword` e body `{keyword}`. Método URL deve preservar URL, sem passar pela canonicalização de anúncios (que apaga query). `matchesMonitor` atualmente tenta achar `m.query` no título/descrição: não colocar URL nesse campo como se fosse palavra-chave. Acrescentar tipo/método e campo URL com validação específica.

4. **Localização pode impedir alertas válidos silenciosamente.** Keyword provider informa locationFilter=false e sempre latitude/longitude nulos. `matchesMonitor` rejeita qualquer monitor com coordenadas quando anúncio não as possui (`opportunity.ts:41–47`). Cidade é igualdade exata após normalização, default Curitiba (`validation.ts:12`); location é truncada antes da primeira vírgula/separador. Mostrar dados retornados/ausência e limitação keyword. Search URL deve usar seus filtros intactos e não prometer verificação local do raio quando o retorno não tem coordenadas.

## Recência, proveniência e diagnóstico

5. **Datas futuras/inválidas são apagadas sem evidência.** `brightdata.ts:54–59` transforma ausência, formato não zonado, formato inválido e futuro no mesmo null. `freshness.ts:7–14` também classifica tudo como unknown; thresholds 15 minutos/24 horas espalhados. Adicionar estado/qualidade da publicação e centralizar thresholds. Conservar ausência diferente de futuro/inválido, sem criar delay negativo.

6. **Primeiro visto é capturado antes da resposta atual.** `worker.ts` cria `now` ao reclamar job e entrega esse mesmo timestamp ao `ingest` após chamadas assíncronas. Um listing publicado durante os segundos dessa resposta pode ter publicação posterior a firstSeenAt, embora mapFacebook aceite a publicação em seu relógio posterior. Capturar observação/ingestão após recebimento e medir latência desde o disparo original até resultados separadamente.

7. **Métricas são globais e limitadas aos 1000 últimos listings.** `service.ts` chama `discoveryDelays(pool.filter(!demo))`; `freshness.ts:19` calcula apenas amostra/mediana/P90/P95 excluindo baseline. Não existem método, run, snapshot ou primeira observação por provider/método; não permite comparação keyword vs URL nem retenção de qualidade antiga fora do pool. Persistir runs e observações deduplicadas por escopo apropriado; registrar baseline, publicação/qualidade, discovery delay, provider/método, monitor, snapshot. Não contar um ID repetido em todos os polls como nova amostra de descoberta.

8. **Publicação preservada pode ganhar confiança de outra data.** `materialize` mantém timestamp anterior se novo é mais recente, mas usa `raw.publicationConfidence`/source quando raw tem data (`ingestion.ts:60`). Selecionar timestamp+source+confidence+status como um conjunto, para não afirmar confiança emprestada.

9. **URL original é perdida.** Provider e materialize usam canonicalUrl (`brightdata.ts:65`, `ingestion.ts:35`), que reconstrói www.facebook.com/item/ID. Guardar originalUrl validada separada, usar canonical apenas para identidade. ID externo e provider já persistem; snapshot só está no payload do job, não na proveniência do listing.

10. **Diagnóstico atualmente insuficiente.** Provider health persiste apenas sucesso/falha, latência de um tick, volume normalizado, mensagem e checked_at. Sem count recebido/rejeitado/duplicado, início/fim do run, método, requested, snapshot ou mudanças de preço. Warnings do resultado não persistem. `providers/check` não grava resultado e exceções retornam erro genérico 500; jobs exibem erro, mas não classificação segura por fase. Criar eventos de execução e erros estruturados sem payload sensível/API key. Distinguir contrato validado de coleta real comprovada.

11. **UI parcial para validação.** Filtro origem já existe com all/demo/real (`radar-app.tsx:737`), mas abas elegíveis podem ocultar todos os reais; provenance explícita no detalhe só marca DEMO. Linhas não mostram availability/confidence/firstSeen/delay nem link original direto. Detalhe mostra publicado/firstSeen/lastSeen e disponibilidade, mas não delay. Imagem com onError apenas display:none (`radar-panels.tsx:358`), deixa área vazia em vez de fallback. O painel providers mostra count de health incluindo erros como “respostas reais”, o que não comprova listing real.

## Jobs, baseline, custos e segurança

12. **Base de jobs útil e preservável.** Enqueue evita pending/running do mesmo escopo; claim UPDATE RETURNING atômico, lease de120s, snapshot fica no payload e polls não re-POSTam. Trigger ambíguo torna job dead; preflight retry limpa triggerStarted. Baseline só conclui após busca completa; failure não conclui. Idempotência de alerta é protegida por unique event key; alerta/outbox usam batch transacional. Não reescrever arquitetura.

13. **Budget conta mais que disparos.** `worker.ts:130–138` incrementa count antes de guard/health, e incrementa inclusive quando orçamento já foi excedido. Preflight retry consome novamente sem POST pago. Orçamento bloqueado vira dead com nova tentativa por scheduler, e force scan pode gerar outro dead antes da janela seguinte. Reservar capacidade atomicamente sem ultrapassar máximo, diferenciar tentativa/HTTP/trigger, não cobrar health no contador de trigger, status budget_blocked e próximo horário após reset. Não reenfileirar automaticamente um bloqueio consciente várias vezes.

14. **Limites 50/dia e25 resultados fixos, sem piloto.** `runOne(...50)` e `limit:25` (`worker.ts:154`), API clamp1–100 com fallback50, `.env.example`50. Introduzir opções centralizadas PILOT_MODE defaulttrue, maxdaily5, records10, teste manual default5 com clamp. `scan` enfileira todos os monitores ativos e processa só um; teste limitado deve ter job identificável e não criar scheduler permanente. Cursor deve continuar pertencendo ao mesmo job, mesmo queryType/URL e requested limit.

15. **Queries antigas podem continuar sendo selecionadas após editar monitor.** search_queries usa user/monitor/query sem provider/revisão; worker insere termos atuais, depois seleciona de todas as linhas antigas (`worker.ts:116–127`). Filtrar seleção aos termos ativos ou persistir escopo/método/revisão. URL não deve ser expandida como aliases. Também usar escopo para distinguir primeira query real após troca de método.

16. **Baseline de exibição não acompanha baseline por monitor.** Ingestão consulta monitor_sightings e aplica baseline por provider/revisão corretamente (`ingestion.ts:95,183`). `state()` recalcula analyze a partir de `listing.baseline` global e ignora sightings (`service.ts:64–96`), podendo mostrar elegível um listing já conhecido globalmente que é baseline em novo monitor. Ao atualizar, manter consistência entre decisão de alerta, badge e diagnóstico; preço drop pode legitimamente superar baseline quando observado depois.

17. **Telegram falta opt-in piloto e dados de confiança.** Canal nunca envia demo e outbox tem unique id; ambiguidade vira uncertain sem retry cego. Atualmente chave+chat+workerUser bastam para enviar; adotar enabled explícito defaultfalse no piloto. Payload Alert não contém availability/confidence e mensagem só recomenda verificar; adicionar os valores observados sem afirmar confirmação.

18. **Identidade depende do gateway de implantação, conforme documentado.** API aceita header oai-authenticated-user-id como identidade; seguro somente quando dispatcher confiável remove/injeta header. Não expor Worker independente diretamente nem transformar header arbitrário em auth. Token worker tem32+ e só endpoint tick; tenant queries/POST origin/Zod/payload limits existentes são preserváveis. UI de provider test deve ser autorizada da mesma maneira. Não imprimir `ProviderError` arbitrário do transport/rawJSON; mensagens controladas e referências de erro são preferíveis.

## Preço/risco já corretos que devem permanecer

- Demo e real são separados em comparableSimilarity e na seleção/calibração da API; não existe fallback silencioso para preços demo.
- Variantes exatas, condição, mesmo vendedor, fingerprint, outliers MAD/IQR e preços parciais protegidos. Sem cinco comparáveis não há quickSale/market/ROI fictício.
- Unknown pode compor preços pedidos com limite7dias e confiança reduzida; sold/removed/unavailable não entra. Não confundir preço pedido com venda realizada.
- Primeiro/último visto são independentes da publicação; repetidos não viram novo ID; ausência de busca não vira sold.
- Compras/vendas e calibração persistidas, liquidez permanece null em vez de promessa inventada.

## Migration, testes e docs

Migration0000 contém dados existentes e NÃO deve ser alterada. Schema aditivo precisa migrar nulabilidade listings.price e listing_snapshots.price preservando IDs, índices, relacionamentos e os demais15tables. Rodar SQLite com dados anteriores antes+depois, foreign_key_check/integrity_check e inserts de null. Fixture atual aplica somente caminho fixo0000 (`tests/fixtures.ts:51`); atualizar para todas as migrations ordenadas, mantendo teste específico de upgrade. Script migrate local guarda hashes das aplicadas e bloqueia alteração; preservar.

42 testes existentes incluem comportamentos que V1.1 muda intencionalmente: unknown bloqueia alerta, string price rejeitada e futuro vira unknown. Atualizar expectativas e acrescentar regressões, sem apagar cobertura de baseline/preflight/dedup/tenant. Não considerar README evidência de live; docs honestamente dizem sem credenciais/sem live/sem Docker/sem QA visual. Atualizar antigos trechos docs/roadmap,architecture,pricing-engine,opportunity-score e freshness que ainda exigem disponibilidade active. `docs/providers.md` mistura proposta histórica/nomes env diferentes dos reais; reescrever contrato implementado atual, mantendo pesquisa histórica claramente separada.

## Testes V1.1 prioritários

1. Transport keyword e URL: metadata correta/incorreta; body/discriminator; URL preservada; limit; POST único; pending/ready/download; HTTP401/403/429/500; timeout POST ambíguo; snapshot failed e JSON/schema inválido; empty válido; recusa cursor/URLs arbitrários.
2. URL SSRF: http/file/ftp, localhost/IPs, credentials, subdomínio evil, portas não padrão, endpoint de redirect, caminho não marketplace; aceitar somente superfície oficial necessária sem reconstruir parâmetros internos.
3. Preço numérico2500, R$2.500,2.500,00,2500.00 conforme moeda; null/string sem preço; zero/negativo/NaN; parcelas/acessório. Null persiste e mostra indisponível, lucros null, não alerta nem gera false price drop.
4. Unknown recente forte com comparáveis reais é visível e alerta1; unknown risco+6 justificável; três estados inativos0alertas; repetido0alertas; firstSeen preservado e lastSeen atualiza; alerta contém availability e confidence.
   5.20reais baseline0alertas, depois20+1 novo=1descoberta; price3000→2200=drop não novo; nullprice não drop; escopo novo existente só baseline; erro+pending não concluem bootstrap.
5. Publicação2min/2h/20dias/ausente/futura/inválida/sem timezone; firstSeen distinto; sem negativos; UTC normalizado e UI local; dado antigo descoberto agora não “novo anúncio”.
6. Budget compartilhado entre usuários/monitores por credencial; quota máxima não ultrapassada sob claims concorrentes; health não dispara coleta paga; preflight não consome trigger; blocked não gera retries; pilotoptin Telegram; teste manual não altera scheduler.
7. Durable runs/observations sobrevivem reload, métodos separados, duplicados não inflam distribuição, counts recebidos aceitos rejeitados novos mudanças coerentes, latência total diferente de discoverydelay. Mensagens seguras nunca contêm key/token/rawproviderbody.
8. Build com secret sentinela conhecido apenas no backend/env; varrer somente dist/client para chave literal; evitar expor credenciais na saída do teste.

## Dependência externa real

Uma validação real ainda requer BRIGHTDATA_API_KEY, dataset/permissões que revelem contrato Marketplace, confirmação de direitos configurada pelo operador e uma URL real de pesquisa do Facebook/keyword escolhido. Não é necessário pedir senha Facebook, cookies de sessão, CAPTCHA ou conta falsa. User pode configurar segredo local/secret manager; testes de desenvolvimento devem permanecer mockados até execução paga limitada conscientemente acionada. A publicação do dashboard privado por si só não executa worker24/7; não reescrever deploy nesta V1.1 antes da prova da fonte.

## Resolução na V1.1

Os achados de disponibilidade, preço anulável, metadados de publicação, primeiro visto após download, baseline na leitura, budget, aliases obsoletos, proveniência e diagnóstico foram tratados. A migração nova foi aplicada em D1 local e testada sobre dados V1 com FKs ligadas. O pipeline de transporte fake é teste de contrato; não constitui coleta real.
