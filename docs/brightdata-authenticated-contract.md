> **Documento histórico da V1.1.** Preservado para referência; comandos, fluxos e evidências não homologam a versão de desenvolvimento atual. Consulte [os guias atuais](../README.md) e a [matriz de implementação](implementation-status.md) antes de operar.

> Atualização operacional: Last 24 hours agora é permitido por confirmação explícita do usuário no painel da conta, mantendo enumPublished=false/optionsSource=account_panel. A descrição abaixo registra a metadata observada antes dessa configuração. O filtro local de publicação permanece obrigatório conforme cada monitor. Ver [operação real](real-operation.md).

# Contrato autenticado Bright Data — 12/09/2026

GET `https://api.brightdata.com/datasets/v3/scrapers?dataset_id=gd_lvt9iwuh6fbcwmx1a` respondeu HTTP 200. A API key foi lida apenas no processo servidor, sem registro em logs, fixtures ou frontend. Nenhum trigger, scrape, snapshot ou outra coleta paga foi solicitado nesta revisão. Contador local: 0/5, zero execuções reais.

## Divergência corrigida

A metadata declara `output_fields: [{name: "url", type: "url"}]` para **ambos os métodos de descoberta**. O parser antigo exigia também `product_id`, `title`, `final_price` e `currency`, por isso recusava os métodos apesar de reconhecer city/radius. Collect era aceito porque declara o schema rico de detalhes.

As chaves reais continuam canônicas, sem alias ou ID alternativo nos objetos de método observados. `scraper_type` anuncia os mesmos três métodos. IDs `cs_...` em `use_cases.subsets_ids` são subconjuntos, não discriminadores de execução.

| Método/chave real     | Discriminator do trigger | Inputs observados                                                                                          | Saída declarada                                                                                  |
| --------------------- | ------------------------ | ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `discover_by_keyword` | `keyword`                | `keyword:text` obrigatório; `city:text` obrigatório; `radius:number` opcional; `date_listed:text` opcional | `url:url`                                                                                        |
| `discover_by_url`     | `url`                    | `url:url` obrigatório; `country:country` opcional                                                          | `url:url`                                                                                        |
| `collect_by_url`      | Não usa discovery        | `url:url` obrigatório                                                                                      | URL, título, product_id, final_price, currency, location, listing_date, images, is_sold e outros |

Os links de configuração terminam em `/keyword/configuration`, `/url/configuration` e `/pdp/configuration`, respectivamente, sob o mesmo dataset. O matching agora cruza tipo anunciado, assinatura de inputs e link verificado quando necessário. Chave opaca pode ser reconhecida somente com essas evidências concordantes. Não converte títulos livres em discriminator nem aceita candidatos ambíguos.

## Recência e raio

`date_listed`: **supported=true, enumPublished=false, inputEnabled=false**. Tipo `text` confirma representação textual, mas não prova ausência de restrições semânticas. Sem lista de valores ou outra comprovação, não enviamos `Last 24 hours` nem qualquer string presumida. A interface informa “Campo suportado, mas opções não publicadas pela metadata.”

`radius`: número opcional confirmado, sem unidade, mínimo ou máximo publicados. Nenhuma conversão para km/milhas é feita; confirme a unidade no painel antes de preencher. `city` é texto obrigatório, mas resolução geográfica e precisão não foram comprovadas por coleta.

## Saída e normalização

A documentação descreve discovery como fase de uma coleta; a saída resumida da metadata **não prova que o snapshot final terá apenas URLs**. Os testes cobrem tanto snapshot rico quanto URL-only. Somente o primeiro trigger manual comprovará o retorno final da conta. [Metadata oficial](https://docs.brightdata.com/api-reference/scrapers/management-apis/get-scrapers) · [requisição assíncrona](https://docs.brightdata.com/api-reference/rest-api/scraper/asynchronous-requests).

- Anúncio analisável: URL HTTPS legítima `/marketplace/item/ID` e título não vazio. ID pode vir da URL; `product_id`, quando presente, deve coincidir. Preço, moeda, localização, publicação e imagens podem estar ausentes sem gerar valores inventados.
- `final_price` é considerado em BRL somente com moeda explícita. Não usa `initial_price` como preço atual.
- `listing_date` permanece a única fonte de publicação. Primeiro/último visto e delay continuam separados.
- `is_sold=true` significa vendido; `false` ou ausente mantém disponibilidade não confirmada.
- Resposta contendo apenas URL legítima vira candidato separado. Não recebe título, score, preço ou alerta fictício. Erros do provider, IDs divergentes e país contraditório não entram por esse fallback.
- Migration 0003 preserva candidatos por usuário/provider/escopo/ID e primeiro/último visto. URLs baseline continuam baseline se detalhes chegarem depois; não geram falso alerta de anúncio novo. Detalhes já existentes não reabrem pendência.
- Nenhuma URL descoberta provoca um segundo Collect automaticamente. O suporte interno de detalhe continua exigindo reserva explícita adicional.

## Verificação

Fixture sanitizada em `tests/fixtures/brightdata-metadata-2026-09-12.json`, com schema e links reais, sem credencial nem samples de anúncios. Testes sintéticos anteriores continuam cobrindo variações de enum e contrato; não são apresentados como metadata real.

A validação pelo endpoint local e pelo botão do navegador retornou **keyword=true, search_url=true, collect_url=true**. O botão de teste ficou habilitado, mas não foi clicado. Desktop e mobile sem erro JavaScript/overflow; zero disparos e zero execuções reais após o QA.

O próximo passo permitido ao operador é uma consulta manual com keyword `iPhone 15`, city `Curitiba`, limite 5, **sem date_listed por enquanto**. Raio é opcional e sua unidade ainda precisa ser confirmada. O teste está preparado; recebimento de anúncios reais ainda não foi comprovado.
