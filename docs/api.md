> **Documento histórico da V1.1.** Preservado para referência; comandos, fluxos e evidências não homologam a versão de desenvolvimento atual. Consulte [os guias atuais](../README.md) e a [matriz de implementação](implementation-status.md) antes de operar.

# API interna v1

Base: `/api/v1`. JSON, respostas sem cache, validação Zod, autorização por usuário em cada consulta. POST do navegador exige origem igual e `Content-Type: application/json`, corpo até 32 KB. 120 leituras/minuto e 30 escritas/minuto por usuário; worker limitado a 30 ticks/minuto. IDs enviados não concedem acesso a registros de outro usuário.

| Método | Rota                    | Uso                                                                                         |
| ------ | ----------------------- | ------------------------------------------------------------------------------------------- |
| GET    | `/state`                | Monitores, radar, settings, compras, alertas e métricas; até 10.000 anúncios reais recentes |
| GET    | `/state?q=texto`        | Busca textual em todo o histórico; até 200 registros                                        |
| GET    | `/listings/{id}`        | Anúncio e até 100 snapshots                                                                 |
| GET    | `/events`               | SSE; evento `radar`; reconexão automática após conexão de aproximadamente 20s               |
| GET    | `/health`               | Estado mínimo do banco/configuração                                                         |
| POST   | `/monitors`             | Criar; schema completo em `server/validation.ts`                                            |
| POST   | `/monitors/{id}`        | Atualizar; nova revisão só quando muda a consulta                                           |
| POST   | `/monitors/{id}/toggle` | Ativar/pausar                                                                               |
| POST   | `/settings`             | Custos e padrões de novos monitores                                                         |
| POST   | `/scan`                 | Enfileirar monitores e executar um job                                                      |
| POST   | `/worker/tick`          | Tick independente; Bearer WORKER_TOKEN e usuário fixo                                       |
| POST   | `/providers/check`      | Validar contrato Bright Data; exige configuração                                            |
| POST   | `/alerts/read`          | Marcar alertas do usuário como lidos                                                        |
| POST   | `/feedback`             | Feedback/compra/venda; tipos no schema                                                      |

Exemplo de monitor mínimo:

```json
{
  "name": "iPhone 15 128 GB",
  "query": "iPhone 15",
  "maxPrice": 2500,
  "city": "",
  "provider": "brightdata",
  "providerFilters": { "city": "Curitiba", "date_listed": "Last 24 hours" },
  "mode": "combined",
  "expectedQuickSalePrice": 3000,
  "minProfit": 400,
  "minRoi": 15,
  "maxListingAgeMinutes": 1440,
  "resultsPerSearch": 25
}
```

Exemplo de compra:

```json
{ "listingId": "ID_INTERNO", "type": "bought", "paid": 2100, "costs": 120 }
```

## Identidade e execução

No Sites privado, a identidade é fornecida pelo dispatcher autenticado. A API confia nesses headers somente no ambiente de implantação protegido. Não expor o Worker diretamente com headers injetáveis; para implantação própria, adicionar gateway autenticado que remova os headers de entrada e injete identidade validada.

Em desenvolvimento, apenas host loopback aceita a identidade local `local-radar`, sem criar dados fictícios; o starter remove headers de identidade recebidos e pode simular sign-in local. Produção não tem esse fallback. `WORKER_TOKEN` é segredo com 32+ caracteres, limitado a `/worker/tick`, e usa `WORKER_USER_ID` fixo. O token de aplicação não contorna o gateway de autenticação do Sites: chamadas externas ao Site privado podem exigir ingresso de serviço suportado pela plataforma. Worker local/container funciona sem depender do navegador; não declarar monitoramento hospedado 24/7 antes de validar esse ingresso.

## V1.1

- GET /api/v1/state inclui diagnostics, métodos, budget, execuções e observações.
- POST /api/v1/providers/check valida metadata sem coleta e persiste mensagem segura.
- POST /api/v1/providers/test: {queryType: keyword|search_url, query, searchUrl, providerFilters, providerContractFingerprint?, limit}; cria um job manual, sem monitor recorrente ou alertas.
- POST /api/v1/scan: {monitorId}; solicita um monitor (na ausência usa primeiro ativo).
- POST /api/v1/jobs/continue: {} apenas processa fila existente.
- POST /api/v1/worker/tick: Bearer WORKER_TOKEN; único endpoint desse token.
- Monitores adicionam queryType, searchUrl, providerFilters e providerContractFingerprint; registros V1 assumem keyword.
- Provider_runs.request_snapshot registra input efetivamente enviado, dataset, contrato, fingerprint e limite. Provider_runs registra estados, orçamento solicitado, registros recebidos/aceitos/rejeitados/duplicados, datas e snapshot. Erros ProviderError são retornados sem payload externo sensível.

`providerFilters` contém somente escalares declarados pelo adapter no schema autenticado (keyword: city/radius/date_listed; search_url: country). Monitores Bright Data são validados contra metadata antes de salvar. O core trata esse objeto como configuração do provider. Não envie campos privilegiados, chaves ou tokens nele. Os formulários usam `diagnostics.validation.schemas` após `/providers/check`.

A metadata autenticada diferencia `outputKind=url_candidates` de `listing`. Diagnostics expõe `discoveryVerified`, `collectionVerified` e URLs `candidates` pendentes separadamente. Campos de entrada expõem `supported`, `inputEnabled` e `enumPublished`: date_listed pode ser suportado sem estar habilitado. Provider_runs.candidates_found conta URLs sem detalhes na resposta; migration0003 preserva a identidade/escopo e primeiro visto até chegar um anúncio com título.


## 2.0 RC1: adições

POST searches aceita activate=true na criação, junto do requestKey e config. A intenção inicial é persistida na mesma transação, idempotente por conta/requisição; nunca elimina o controle de cota. Edição mantém expectedVersion.

GET results: all/budget/qualified/new/price_drop/baseline respeitam seleção recente e orçamento; history e review são explícitos. GET deals?page=1&limit=25&stage=negotiating retorna estágios paginados. POST deals/:listingId aceita interessado/negociação/à venda/descartado pelas chaves do contrato (interested, negotiating, for_sale, passed), nota e expectedVersion. Compra/venda exigem as operações financeiras existentes.

POST availability/:listingId exige confirmConsumption=true e habilitação administrativa; GET listings/:id inclui deal e availabilityCheck. GET admin/status acrescenta quality. Todas as rotas de dados respeitam conta autenticada; administração exige permissão real.
