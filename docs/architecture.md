> **Documento histórico da V1.1.** Preservado para referência; comandos, fluxos e evidências não homologam a versão de desenvolvimento atual. Consulte [os guias atuais](../README.md) e a [matriz de implementação](implementation-status.md) antes de operar.

# Market Radar — decisão inicial · 10/09/2026

## Objetivo e escopo

Facebook Marketplace é a fonte principal, conforme orientação do usuário. A primeira versão executa monitor → coleta → deduplicação → recência → normalização → comparáveis → preço → score → radar → alerta. Mercado Livre e OLX permanecem no roadmap, sem simular integrações ativas.

## Arquitetura escolhida

Monólito modular TypeScript: React/Vinext para interface, rotas HTTP versionadas para API, funções puras em `core/`, providers em `providers/`, persistência D1/SQLite e fila durável em `server/`. Um processo separado (`scripts/worker.mjs`) aciona jobs por API autenticada, sem depender do navegador. SSE comunica alterações; o navegador não é o scheduler de produção.

A plataforma Sites fornece publicação privada, identidade e D1. Não introduzimos Redis/PostgreSQL antes de medir carga. D1 tem limite por banco e escrita serializada: para crescimento além de 10 GB, particionar por tenant/tempo ou migrar o repositório para PostgreSQL. Snapshots são criados apenas em alterações relevantes. Vinext é experimental; manter domínio independente facilita trocar a camada web por Next.js estável na implantação própria. Nenhuma credencial reside no cliente.

## Invariantes antes da implementação

1. `publishedAt`, `firstSeenAt` e `lastSeenAt` são distintos. Timestamp incerto/futuro nunca ganha urgência.
2. Primeira busca completa de cada monitor/provider/revisão constrói baseline e suprime alertas. Falha não conclui baseline.
3. ID estável/URL canônica deduplicam. Fingerprint sinaliza possível duplicação; não funde automaticamente produtos apenas por título/preço.
4. Preço de entrada, parcela ou peça bloqueia estimativa e alerta financeiro.
5. Comparáveis exigem modelo/variante/armazenamento e condição compatíveis. Preço anunciado não é venda confirmada.
6. Ausência em busca não prova venda. Estado só muda com observação explícita do provider.
7. Alertas são gravados com chave única por anúncio/evento. Baseline, data desconhecida e disponibilidade incerta não geram urgência.
8. Modo demo nunca consulta fornecedor pago ou envia mensagens externas.

## Limites desta entrega

Visão, embeddings, WhatsApp, e-mail e push móvel têm pontos de extensão; não se apresentam como recursos executados. Regras locais e extração textual são o tier inicial. A fonte real depende de credencial, acesso/contrato e validação empírica do fornecedor. SLO de minutos só poderá ser medido com coleta real.

Fontes técnicas: [D1 limits](https://developers.cloudflare.com/d1/platform/limits/), [Workers limits](https://developers.cloudflare.com/workers/platform/limits/), [Vinext](https://github.com/cloudflare/vinext), [anúncio e ressalvas do Vinext](https://blog.cloudflare.com/vinext/).

## V1.1 — evolução incremental

Core preservado; ProviderQuery adiciona keyword/search_url. Prices em listings/snapshots agora aceitam null. Novas tabelas provider_runs e discovery_observations e kind/data em provider_health. Migration 0000 intacta; 0001 copia/reconstrói pai+filho em ordem compatível com FKs ligadas. Configuração de piloto central em server/pilot.ts. Unknown availability passa a risco moderado e não blocker. Teste manual compartilha locks/budget/pipeline, sem criar monitor. Escopo de POST ambíguo bloqueia novo job até reconciliação operacional. Documentos de pesquisa V1 são histórico de decisões; os guias V1.1 descrevem o comportamento vigente.
