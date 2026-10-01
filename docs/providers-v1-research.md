> **Documento histórico da V1.1.** Preservado para referência; comandos, fluxos e evidências não homologam a versão de desenvolvimento atual. Consulte [os guias atuais](../README.md) e a [matriz de implementação](implementation-status.md) antes de operar.

# MARKET RADAR — pesquisa de fontes e contratos

Data da consulta: **10/09/2026**. Pesquisa documental; nenhuma credencial foi fornecida, nenhum serviço pago foi acionado e nenhum anúncio real foi coletado. "Documentado" não significa "testado com a conta de produção". Valores abaixo são USD, antes de impostos/câmbio, e precisam ser reconfirmados na contratação.

## Decisão recomendada — foco corrigido para Facebook Marketplace

1. Manter o núcleo independente: mock determinístico e importação de dados autorizados sempre funcionam.
2. Entregar adapter de dados do **Facebook via Bright Data**, desabilitado até configuração da chave e confirmação do operador sobre direitos/licença para o uso pretendido. Apify fica como alternativa. São APIs dos fornecedores, não APIs oficiais da Meta. Cobertura brasileira, precisão de publicação e atraso de descoberta dependem de piloto.
3. A pesquisa sobre Mercado Livre e OLX abaixo é material de **roadmap**, não compromisso de integração na primeira versão. Não desviar o produto para esses marketplaces.
4. Priorizar validação de recência, bootstrap e preço no Facebook. Fonte configurada e ainda não testada deve aparecer assim no produto, sem selo de conexão saudável fictício.

## Facebook / Meta

**Não localizei documentação pública oficial que ofereça um endpoint de descoberta comercial geral de anúncios C2C do Marketplace para compradores no Brasil.** Essa é uma conclusão limitada ao material verificado, não a alegação de que nenhuma API ou parceria exista.

O portal de Content Library e a página de Partner Program não puderam ser lidos nesta sessão (429/throttling/indisponibilidade de acesso). Não confirmar por isso requisitos, filtros, quotas ou endpoints desses programas. O anúncio oficial da Content Library descreve ferramentas destinadas a pesquisa; não fundamenta um produto comercial de revenda. [Meta: ferramentas para pesquisadores](https://about.fb.com/news/2023/06/how-ai-ranks-content-on-facebook-and-instagram/amp/).

A Meta anunciou busca do Marketplace no modo de compras da Meta AI em 2026. Isso é uma funcionalidade de produto, sem contrato público de API de descoberta apresentado nessa publicação; não transforma a capacidade da interface em API disponível ao MARKET RADAR. [Meta, atualização de maio de 2026](https://about.fb.com/news/2026/04/introducing-muse-spark-meta-superintelligence-labs/amp/).

A própria Meta distingue coleta automatizada autorizada de não autorizada e descreve bloqueios/rate limits para combatê-la. A publicidade de um anúncio e a disponibilidade de uma API de fornecedor não demonstram, por si, autorização da plataforma. [Meta: coleta de dados](https://www.facebook.com/help/463983701520800). Não implementar cookies de contas, endpoints GraphQL internos, resolução de CAPTCHA ou evasão de bloqueios.

## Mercado Livre — superfície oficial

### Mudanças recentes e busca

A página atualizada em **31/08/2026** determina migração de `/items?ids=` para `/items/bulk?ids=` e de `/users?ids=` para `/users/bulk?ids=` até **25/10/2026**. No retorno bulk, `code` vira `status_code`, existe `id` raiz e seleção usa `attributes=body.id,body.price`. Máximo documentado de multiget: 20 itens. Os exemplos antigos ainda aparecem na mesma página: novos adapters devem seguir o aviso de migração.

São descritos `/sites/{site}/search?seller_id=...` e `/users/{seller}/items/search`; o segundo é o substituto indicado para busca por vendedor. Os exemplos exigem `Authorization: Bearer`. `available_sorts`/`available_filters` devem orientar capacidades; a ordem padrão das listagens é relevância. Não extrapolar que `q` global, filtro por raio ou ordem cronológica funcionem hoje sem validação. Quantidade pública pode ser referencial, não estoque exato. [Busca de itens — versão atual](https://developers.mercadolivre.com.br/itens-e-buscas).

Para inventário autorizado, usar:

```http
GET https://api.mercadolibre.com/users/{SELLER_ID}/items/search?status=active&orders=start_time_desc&limit=50&offset=0
Authorization: Bearer ACCESS_TOKEN
```

`orders=start_time_desc` pertence à busca de itens do vendedor; `sort=date_desc` não deve ser copiado da API de pedidos. A busca por vendedor retorna IDs, `paging` e, quando solicitados, filtros. Para mais de 1.000 registros, a documentação descreve `search_type=scan`/`scroll_id`, válido por cinco minutos; página padrão 50, máximo 100. As notificações dos vendedores integrados são preferíveis ao polling exclusivo de seu inventário. [Busca por vendedor e paginação](https://developers.mercadolivre.com.br/pt_br/itens-e-buscas).

### Detalhes, fotos e datas

```http
GET https://api.mercadolibre.com/items/{ITEM_ID}
GET https://api.mercadolibre.com/items/{ITEM_ID}?include_attributes=all
GET https://api.mercadolibre.com/items/{ITEM_ID}/description
Authorization: Bearer ACCESS_TOKEN
```

O detalhe documenta preço, moeda, condição, atributos, imagens e campos de localização. Pode responder **206 Partial Content**, com `X-Content-Missing` indicando dados ausentes; isso deve reduzir a confiança, não derrubar o pipeline. Estoque/vendidos podem ter restrições por titular do token. [Publicar produtos / leitura de item](https://developers.mercadolivre.com.br/pt_br/autenticacao-e-autorizacao/publicacao-de-produtos).

Há `date_created` no detalhe do item. Preservar o campo de origem e validar sua semântica no piloto, distinguindo-o de `start_time`/reativação e `last_updated`. [Identificadores e detalhe completo](https://developers.mercadolivre.com.br/pt_br/gerenciamento-perguntas-respostas/identificadores-de-produtos). A descrição possui seu próprio `date_created`; **não usar a data da descrição como data de publicação**. [Descrição — atualizada em 13/03/2026](https://developers.mercadolivre.com.br/en_us/public-and-private-resources/item-description-2).

### OAuth, acesso e quotas

Autorização no Brasil: `https://auth.mercadolivre.com.br/authorization`, com `response_type=code`, `client_id`, `redirect_uri` exata e PKCE quando habilitado. Troca via `POST https://api.mercadolibre.com/oauth/token`, form URL encoded: `grant_type=authorization_code`, `client_id`, `client_secret`, `code`, `redirect_uri`, `code_verifier` quando aplicável. Renovação no mesmo endpoint com `grant_type=refresh_token`. Access token: seis horas; refresh é rotativo e de uso único. Atualizar credenciais atomicamente no servidor, com lock de renovação. [OAuth oficial](https://developers.mercadolivre.com.br/pt_br/convivencia-me1-me2/autenticacao-e-autorizacao).

401/403 não devem provocar tentativas de contorno. Permissões, titularidade, scopes, validação do usuário e IP autorizado são causas documentadas de 403. [Erros 403](https://developers.mercadolivre.com.br/pt_br/convivencia-me1-me2/erro-403). A gestão da aplicação expõe `max_requests_per_hour`; o valor 18.000 é exemplo documental, não quota universal. Desde 30/08/2026, aplicações Mercado Livre e Mercado Pago devem estar separadas. [Gestão de aplicações, 06/08/2026](https://developers.mercadolivre.com.br/pt_br/gerencie-seu-aplicativo). Não foi encontrada tabela universal de preço por chamada. Configurar budget de chamadas e respeitar 429. [Boas práticas](https://developers.mercadolivre.com.br/pt_br/identificadores-de-produtos/boas-praticas-para-usar-a-plataforma).

## OLX Brasil — não confundir integração do vendedor com busca pública

A documentação oficial oferece OAuth, importação/edição/exclusão do inventário, status, leads, chat e webhooks. A importação exige autorização do anunciante, escopo `autoupload` e plano empresarial adequado; usa `PUT https://apps.olx.com.br/autoupload/import`, JSON UTF-8 com limite de 1 MB. Não serve como descoberta de usados de terceiros. [OLX: superfície oficial](https://developers.olx.com.br/anuncio/api/home.html), [Importação e contratação](https://developers.olx.com.br/anuncio/api/import.html).

```http
GET https://apps.olx.com.br/autoupload/v1/published?ads_status=published&fetch_size=200
Authorization: Bearer ACCESS_TOKEN
```

Este endpoint lista os anúncios **do anunciante**; scopes `autoupload` ou `basic_user_info`. A página usa `page_token` e devolve `next_token`, nulo ao terminar. Máximo/padrão de 200 registros. Retorna `id`, `list_id` e `status` (`published`, `pending_review`, `deleted`, `refused`); esse contrato não fornece data de publicação, fotos ou preço para um radar aberto. [Listagem de publicação](https://developers.olx.com.br/anuncio/api/published_ads.html).

A FAQ publicada informa 5.000 requests/minuto por IP em `apps.olx.com.br`, com bloqueio por dez minutos e HTTP 429 quando excedido. Há aviso de evolução de políticas no portal; usar essa informação como limite documental sujeito a mudança, não alvo operacional. [Rate limit OLX](https://developers.olx.com.br/faq/rate_limit.html), [Portal](https://developers.olx.com.br/). Não implementar rotação de IP para ampliar quotas. Datas de bump/retorno ao topo não provam publicação nova. [Destaques](https://developers.olx.com.br/destaque/bumps_put.html).

## Bright Data — candidato de adapter externo

Contrato específico documentado:

```http
POST https://api.brightdata.com/datasets/v3/scrape?dataset_id=gd_lvt9iwuh6fbcwmx1a&include_errors=true&format=json
Authorization: Bearer BRIGHTDATA_API_KEY
Content-Type: application/json

{"input":[{"keyword":"iphone 15"}],"limit_per_input":25}
```

A página de descoberta aceita `keyword`. Outra aceita URL de busca/categoria. O contrato mostrado não expõe formalmente filtros Brasil/cidade/raio, ordenação por publicação nem cursor; não inventá-los. Confirmar uma URL real de busca e o contrato gerado no painel antes do piloto. [Descoberta por palavra](https://docs.brightdata.com/api-reference/scrapers/social-media-apis/facebook-marketplace-discover-by-keyword), [Descoberta por URL](https://docs.brightdata.com/api-reference/scrapers/social-media-apis/facebook-marketplace-discover-by-url).

Para item conhecido, o mesmo endpoint/dataset recebe `{"input":[{"url":"https://www.facebook.com/marketplace/item/ID"}]}`. Campos documentados: `product_id`, `url`, `title`, `initial_price`, `final_price`, `currency`, `condition`, `description`, `location`, `country_code`, `images`, `profile_id`, `listing_date`. Usar `listing_date` apenas se válida; guardar `publication_source=provider_reported` e payload de evidência. A amostra não garante preenchimento nem precisão em anúncios brasileiros. Não há SLA de atraso de descoberta nessa página. [Coleta por URL](https://docs.brightdata.com/api-reference/scrapers/social-media-apis/facebook-marketplace-collect-by-url).

O POST síncrono aceita array direto ou objeto `input`; `limit_per_input` deve ficar no corpo para limitar descoberta. Após um minuto pode retornar 202 + `snapshot_id` e `Retry-After`, em vez de registros. Tratar essa resposta no worker. [Contrato síncrono](https://docs.brightdata.com/api-reference/scrapers/synchronous-requests). Há `POST /datasets/v3/trigger`, com `type=discover_new` e `discover_by` dependente do coletor: validar os valores do coletor específico, sem copiar valores de Reddit/Amazon. [Contrato assíncrono](https://docs.brightdata.com/api-reference/rest-api/scraper/asynchronous-requests).

Acompanhar com `GET /datasets/v3/progress/{snapshot_id}` até `ready`. [Monitor progress](https://docs.brightdata.com/api-reference/web-scraper-api/management-apis/monitor-progress). A tabela de preço mostra free de 5.000 registros/mês, PAYG **US$1,50/1.000**, Scale US$499/mês com 384.000 registros e US$1,30/1.000 adicionais; headline “a partir de US$0,75” não representa PAYG. A oferta inclui técnicas de proxy/CAPTCHA do fornecedor; isso não comprova licença da Meta. Requer diligência contratual e não deve tornar essas técnicas dependência do nosso núcleo. [Preços Bright Data](https://brightdata.com/pricing/web-scraper).

## Apify — alternativa com contrato próprio e custo de detalhes

Escolher, para avaliação inicial, o Actor `apify/facebook-marketplace-scraper`, mantido pela Apify, em vez de um slug comunitário escolhido só por preço. Nenhum Actor deve ser tratado como autorizado pela Meta por estar na Store.

```http
POST https://api.apify.com/v2/acts/apify~facebook-marketplace-scraper/runs
Content-Type: application/json

{"startUrls":[{"url":"URL_DE_BUSCA_CONFIRMADA"}],"resultsLimit":25,"includeListingDetails":true}
```

O OpenAPI confirma também `/run-sync-get-dataset-items` e exige token. Preferir fluxo assíncrono do worker e credencial somente no servidor. [OpenAPI oficial do Actor](https://apify.com/apify/facebook-marketplace-scraper/api/openapi).

Inputs: `startUrls` obrigatório; `resultsLimit` inteiro mínimo 1; `includeListingDetails=false` por padrão. Descrição, coordenadas, timestamp e atributos são obtidos ao ativar detalhes. Sem limite explícito, o Actor tenta retornar o máximo possível; sempre enviar limite. A documentação não garante semântica/precisão do timestamp nem SLA de descoberta em minutos. [Input schema](https://apify.com/apify/facebook-marketplace-scraper/input-schema).

A aba de preços contradiz valores antigos no README: Free **US$6,20/1.000 listings + US$6,20/1.000 detalhes**; Starter US$5 + US$5; Scale US$3,80 + US$3,80; Business US$2,60 + US$2,60. “A partir de US$2,60” refere-se ao plano Business sem add-on. A assinatura do plano é separada. Orçar buscas repetidas por registros entregues, não apenas IDs inéditos. [Preço atual do Actor](https://apify.com/apify/facebook-marketplace-scraper/pricing).

## Regras de recência e avaliação proposta

Esta seção é recomendação de engenharia do MARKET RADAR, não garantia dos fornecedores.

- Preservar `published_at` anulável, `publication_source`, intervalo de incerteza e `publication_confidence`; `first_seen_at`, `provider_observed_at`, `ingested_at` e `last_verified_at` são campos distintos.
- `created_at` do dataset/run/snapshot jamais vira publicação. Datas futuras, inválidas e conflitantes são anomalias; ficam desconhecidas até revisão.
- O primeiro ciclo completo por monitor/fonte é baseline sem alerta. Falha parcial não conclui bootstrap. Um ID descoberto depois pode ser antigo; novidade interna e novidade de publicação são flags distintas.
- Recentes: exigir publicação confiável dentro do limiar. Idade relativa “há uma hora” gera intervalo temporal, não minuto fabricado. Promoção/bump, reativação e queda de preço têm eventos separados.
- Deduplicação primária por marketplace + ID canônico, secundária por URL canônica e fingerprint. Não fundir anúncios de vendedores diferentes só porque têm título/preço iguais. Comparar registros de múltiplos providers pelo mesmo ID da plataforma.
- `not_seen_in_search` não vira vendido/removido: ranking, paginação, indisponibilidade da fonte e geografia alteram resultados. Confirmar status em detalhe quando suportado; ausência repetida continua inferência, não venda confirmada.

Piloto proposto: mesmas cidades, monitores e orçamento; 7 dias com slots de polling equivalentes, jitter moderado e capacidade limitada. Registrar início/fim da consulta, versão de input/schema, custo, status, número de registros, IDs, publicação e primeira observação por provider. Reportar mediana/P90/P95 de `first_seen_at - published_at` só na amostra com publicação confiável, junto da fração sem data e tamanho da amostra. Medir separadamente latência HTTP/job e atraso de descoberta. Sem relógio confiável, medir lead/lag entre providers, não atraso absoluto.

Cobertura usa união observada dos providers como referência parcial; não alegar total do marketplace. Reportar freshness coverage, taxa de duplicatas, cobertura geográfica, taxa de detalhes válidos, 429/5xx, sucesso e custo por anúncio novo elegível. Budget rígido limita consultas e registros antes de emitir chamadas; testes de recência não devem faturar ilimitadamente.

Nenhum provider recebeu mediana de atraso, SLA ou quality score numérico nesta pesquisa: isso exige dados medidos. Estimativas de venda rápida com anúncios ativos devem ser identificadas como proxy de preço pedido, calibradas posteriormente por compras/vendas reais.

## Especificação de implementação — Facebook via Bright Data

Esta é a proposta de implementação para a primeira versão, atualizada após a correção de escopo para Facebook. Não envolve executar chamadas externas nesta pesquisa.

### Configuração e guard

```dotenv
MARKETPLACE_PROVIDER=mock
BRIGHTDATA_API_KEY=
BRIGHTDATA_FACEBOOK_DATASET_ID=gd_lvt9iwuh6fbcwmx1a
FACEBOOK_DATA_RIGHTS_CONFIRMED=false
BRIGHTDATA_MAX_RESULTS_PER_SEARCH=25
BRIGHTDATA_REQUEST_TIMEOUT_MS=70000
BRIGHTDATA_MAX_SNAPSHOT_AGE_SECONDS=900
BRIGHTDATA_MAX_POLL_ATTEMPTS=30
BRIGHTDATA_DAILY_RECORD_BUDGET=1000
```

Exigir `MARKETPLACE_PROVIDER=brightdata`, chave não vazia e `FACEBOOK_DATA_RIGHTS_CONFIRMED=true` antes de qualquer POST que consuma coleta. O guard registra uma declaração operacional do responsável; não concede autorização da Meta nem substitui direitos contratuais. Secrets nunca em VITE_/NEXT_PUBLIC_, respostas de API, logs ou exports. Uma configuração incompleta responde `configuration_required` sem rede e sem fallback silencioso para dados simulados.

### Search, detalhes e localidade

**Melhoria encontrada na etapa final: introspecção oficial antes da coleta.** A chamada abaixo retorna métodos, schemas de entrada e campos de saída do coletor disponível na conta:

```http
GET https://api.brightdata.com/datasets/v3/scrapers?dataset_id=gd_lvt9iwuh6fbcwmx1a
Authorization: Bearer BRIGHTDATA_API_KEY
```

Resposta: array com `id`, `domain`, `scraper_type` e objeto `scrapers`, que contém por método `input_schema`, `output_fields`, `sample_input` e `sample_output`. Cada método `discover_by_*` é acionado em `/datasets/v3/trigger` com `type=discover_new` e `discover_by` igual ao sufixo. Exemplo: `discover_by_keyword` → `keyword`. Usar essa metadata para `healthCheck` e validação de capabilities, com cache e hash de schema. Se o dataset/método ou campos obrigatórios não existirem, devolver `unsupported_capability` antes de gastar coleta. [Introspecção oficial](https://docs.brightdata.com/api-reference/scrapers/management-apis/get-scrapers).

Esse deve ser o **modo principal recomendado**, porque as páginas síncronas específicas omitem os discriminadores de descoberta presentes na documentação genérica. A introspecção resolve a escolha em tempo de configuração, sem adivinhar método de URL. Mantemos o caminho síncrono documentado como opção, inclusive sua recuperação de 202. Nenhum teste autenticado foi executado.

Após confirmar `discover_by_keyword` e seu input schema:

```http
POST https://api.brightdata.com/datasets/v3/trigger?dataset_id=gd_lvt9iwuh6fbcwmx1a&type=discover_new&discover_by=keyword&include_errors=true&limit_per_input=25
Authorization: Bearer BRIGHTDATA_API_KEY
Content-Type: application/json

[{"keyword":"iphone 15"}]
```

O modo async documenta `limit_per_input` como query parameter; no modo síncrono ele fica no corpo. A resposta async deve conter `snapshot_id` e segue a máquina de estados abaixo. Para URL, selecionar exclusivamente o método retornado pela metadata (ex.: se `discover_by_url` existir, sufixo `url`); falhar claramente se não houver. No método `collect_by_url`, omitir `type`/`discover_by` e enviar o schema de detalhe confirmado.

Para busca por URL, aceitar somente URL HTTPS com hostname exato `www.facebook.com` ou `facebook.com`, caminho `/marketplace/`, sem usuário/senha e sem destino arbitrário. A URL de busca deve ser fornecida/confirmada no painel do fornecedor; não adivinhar city slug nem parâmetros de recência. Para `getListing(id)`, validar ID decimal e construir `/marketplace/item/{id}`. Enviar `input:[{url}]` ao coletor de detalhes. Não incluir o corpo de pesquisa como instrução a modelo de IA.

O contrato keyword não contém latitude, raio, cidade ou país de entrada. Normalizar `country_code`/`location` de saída e excluir geografia incompatível quando verificável. Se coordenadas não existirem, a UI deve sinalizar **raio não verificado**; um texto de cidade não prova distância em quilômetros. As queries adaptativas e o preço continuam funcionando, mas a abrangência geográfica real precisa ser medida.

### Máquina de estados de coleta

1. HTTP 200: exigir array JSON e validar cada registro separadamente; o payload não pode ser interpretado como listagem se for `{error:...}`.
2. HTTP 202: exigir `snapshot_id`, persistir no job, respeitar `Retry-After`. Não executar novo POST ao receber 202.
3. `GET https://api.brightdata.com/datasets/v3/progress/{snapshot_id}` com Bearer. `starting`/`running` reagendam polling; `ready` segue para download; `failed` registra `error_message`; `canceled` termina cancelado. Estado desconhecido vira erro de contrato com prazo máximo, nunca sucesso. [Estados documentados](https://docs.brightdata.com/api-reference/scrapers/management-apis/monitor-progress).
4. `GET https://api.brightdata.com/datasets/v3/snapshot/{snapshot_id}?format=json` com Bearer. Retorna array de registros. Retenção publicada de 16 dias; 5 GB por request; o produto deve limitar bytes bem abaixo disso. 409 significa que o download ainda não está pronto/está em conflito: reagendar com limite. [Download snapshot](https://docs.brightdata.com/api-reference/scrapers/delivery-apis/download-snapshot).
5. Salvar resultado/página atomicamente; só concluir baseline quando toda a coleta pretendida terminar com sucesso. 401/403 bloqueiam provider até configuração; 429/5xx usam backoff/jitter e circuit breaker. Timeout de POST é estado ambíguo: retry cego pode duplicar job e cobrança. Sem `snapshot_id`, registrar incerteza e limitar retry; não prometer idempotência do fornecedor.

Polling proposto é de 10 segundos ou maior quando `Retry-After` exigir, sem manter uma conexão longa do frontend. Jobs aguardando fornecedor não bloqueiam fila de normalização/score. Interromper por prazo e tentativas máximas, preservando snapshot para inspeção. Não confundir timeout síncrono de um minuto com promessa de coleta em um minuto.

### Mapeamento verificável e confiança

| Campo recebido              | Campo normalizado / regra                                                                      |
| --------------------------- | ---------------------------------------------------------------------------------------------- |
| `product_id`                | `external_id`, string; chave composta com `facebook`                                           |
| `url`                       | URL canônica, validada contra ID/plataforma                                                    |
| `title`, `description`      | Texto não confiável; limites de tamanho; escape de HTML                                        |
| `final_price`               | Preço atual numérico, somente finito e não negativo                                            |
| `initial_price`             | Evidência do provider; não criar queda de preço sem observação anterior própria                |
| `currency`                  | Código explícito; somente BRL participa de estimativas BRL; nunca converter USD por inferência |
| `condition`                 | Enum normalizado; valores novos preservados como desconhecidos                                 |
| `location`, `country_code`  | Localização aproximada, com confiança separada                                                 |
| `images`                    | Lista de URLs HTTPS; não baixar automaticamente destinos arbitrários                           |
| `profile_id`                | Identificador pseudônimo opcional do vendedor; sem enriquecimento privado                      |
| `listing_date`              | ISO com timezone válido → `published_at`, source `provider_reported`                           |
| ausência de `listing_date`  | `published_at=null`, categoria DATA DESCONHECIDA                                               |
| ausência de disponibilidade | `status=unknown`, mesmo após HTTP 200                                                          |

Os campos são os do sample documentado nas páginas específicas já citadas. Não foi confirmado `creation_time` neste contrato; se aparecer, guardar bruto, sem usar para recência até validação da semântica. O estado `ready` é do **job**, não do anúncio. Mesmo detalhes retornados não confirmam venda/estoque disponível. Preço inicial do fornecedor também não substitui nosso histórico.

### Testes necessários antes de ligar a fonte real

- Transporte falso: 200 array; 202 → starting → running → ready → download; failed/canceled; 401; 429 com Retry-After; timeout; 409 de download; payload malformado; registros de erro misturados aos resultados.
- Guard sem chave ou sem confirmação faz zero chamadas; nenhuma credencial serializada para frontend.
- Datas ausentes/futuras/sem timezone, `creation_time` isolado e snapshot `created` não geram recém-publicado.
- Baseline parcial não emite alerta; status desconhecido não vira ativo/vendido; USD não entra em comparáveis BRL.
- Resposta enorme truncada/rejeitada, quantidade acima do limite rejeitada/sinalizada e budget contabilizado por registros entregues (inclusive repetidos).
- Dois providers entregando mesmo ID geram um anúncio, preservando ambas observações e divergências.
- Teste real opt-in somente com credencial/confirmacão e budget pequeno: keyword, URL de busca brasileira, URL de item conhecido; registrar resultado e campos realmente obtidos. Até então declarar **adapter implementado, integração autenticada pendente**.
