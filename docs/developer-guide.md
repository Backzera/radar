# Guia de desenvolvimento

## Versão e base

Base remota conferida: `glayvisondouglas97-code/btmob`, commit `e2d456bb38093e148bbb1ccfad955534484899c2`, árvore `51898a2361f1bf1c0a2d51b96a0443d98e6d9533`. A cópia local veio do ZIP limpo e foi comparada pela árvore Git, incluindo normalização do arquivo de hosting para os bytes da origem.

O histórico local de trabalho foi inicializado sobre essa árvore e não é um clone do histórico remoto. Não faça force-push desse histórico. O patch entregue se aplica à árvore-base; revise `git apply --check` em uma branch nova de um clone atualizado. Se a base mudou, resolva os conflitos em vez de sobrescrever.

## Dependências e validação

Node mínimo 22.16.0, lockfile mantido. Nenhuma atualização indiscriminada de dependências.

```sh
npm ci --include=dev --include=optional --no-audit --no-fund
npm test
npm run typecheck
npm run lint
npm run check:source-secrets
npm run build
npm run check-secrets
```

**Resultado neste ambiente:** a tentativa de instalação limpa falhou por resolução/acesso ao registro npm; o build falhou pela ausência de `@rolldown/binding-linux-x64-gnu`. Os testes de JavaScript/TypeScript usaram as dependências existentes do ZIP original, extraídas isoladamente sem seus bancos ou `.dev.vars`. Isso não valida instalação limpa, produção nem dependências nativas de Linux.

Depois de um build válido, `npm run local:init` prepara a configuração local e `npm run db:migrate` aplica migrations locais. Inspecione os scripts antes de executar. Para desenvolvimento local, configure explicitamente `AUTH_MODE=local-development` e `ALLOW_LOCAL_DEV_AUTH=true`, mantenha coleta/alertas externos desligados e use loopback. Esse modo só é aceito quando o runtime está em desenvolvimento.

Não execute `npm run demo:purge -- --apply` como parte do onboarding. O comando de limpeza legado é manutenção separada.

## Arquitetura nova

- `core/catalog.ts` e `core/text.ts`: identificação e interpretação contextual, sem API de IA paga.
- `core/pricing-context.ts`: contexto de preço por grupo e requisição; duplicações seguem algoritmo exato.
- `server/feed.ts` e `server/evaluation.ts`: normalização atual em memória, resumos materializados, filtros/ordenação antes de paginação e detalhes separados.
- `server/http.ts` / `server/api.ts`: contrato HTTP testável separado dos bindings Cloudflare.
- `server/searches.ts`: criação idempotente, edição com versão e rascunhos persistidos.
- `server/accounts.ts`, `security.ts`, `channels.ts`, `supervisor.ts`: conta, cotas, identidade, vínculo de canal e agendamento.
- `components/saas/`: shell, assistente, lista de buscas, feed/detalhes e conta/administração.

A tela antiga monolítica foi substituída por módulos conectados. Componentes legados reutilizáveis e licenças permanecem. O módulo HTTP central ainda concentra rotas e poderá ser dividido por domínio após estabilização, sem mudar contratos por estética.

## API resumida

`GET bootstrap`, `GET results?q=&filter=&sort=&page=&limit=&monitorId=`, `GET listings/:id?page=&limit=`, `GET events`, `GET alerts`, `GET purchases`, `GET account`, `GET account/export`, `GET account/metrics`, `GET draft`.

`POST searches` recebe `{requestKey,config}`; `POST searches/:id` recebe `{expectedVersion,config}`. Idempotência de criação fica persistida; o rascunho mantém o identificador para retomada. Edição conserva campos omitidos, e `null` só limpa campos que admitem isso.

`POST scan` recebe `{monitorId,confirmConsumption:true}` e enfileira, sem realizar o disparo no navegador. `POST listing-preferences/:id`, `feedback`, `alerts/read`, `preferences`, `draft`, `draft/delete`, `channels/telegram/link`, `channels/telegram/disconnect`, `account/cancel` persistem ações reais.

As rotas começam com `/api/v1/`. Writes de navegador exigem mesma origem e JSON limitado a 32 KB reais. O endpoint worker usa credencial de serviço. Webhook Telegram usa seu próprio segredo. IDs e consultas são sempre escopados pela identidade verificada, não por `userId` fornecido pelo cliente.

## Migration 0005

É aditiva: 14 tabelas novas, colunas de lease da outbox, resumo de execuções, índices e triggers. As 18 tabelas anteriores passam a compor 32 tabelas. Os dados originais e seus IDs não são reescritos. Snapshot e journal Drizzle foram atualizados; teste compara tabelas e colunas com o SQL.

Triggers de reserva/reembolso, limites e invalidação de feed foram escritos explicitamente e não são inferidos automaticamente pelo Drizzle. Revise qualquer migration futura para não removê-los. Nenhuma migration 0000–0004 foi modificada. O teste de migração usa banco sintético anterior e confere preservação e foreign keys; isso não é homologação com dados de produção.

## Harness de integração de interface

```sh
npm run test:browser:prepare
npm run test:browser:serve
```

Esse harness usa os componentes reais e o handler real em banco **somente em memória**, com transporte externo proibido. As fixtures são exclusivamente de teste e identificadas. O bundle é montado com Webpack já presente em Next, apenas para testar integração de componentes; não muda o framework da aplicação nem substitui o build Vinext.

Neste ambiente a compilação desse bundle funcionou, mas a navegação pelo Chromium foi bloqueada com `net::ERR_BLOCKED_BY_ADMINISTRATOR`. Nenhuma política foi contornada. Não há capturas de tela ou validação de cliques/teclado conclusiva nesta entrega. `tests/wizard-contract.test.ts` faz renderização estática e verificação de contrato, não teste visual.

## Desempenho e limitações

Depois de `npm test`, `npm run benchmark -- 500 same` mede feed novo com fixtures. Alternativas: `50`, `5000`, `mixed`, `unique`. `before` só deve ser executado em uma cópia da base antiga com testes compilados.

Cache de feed é por conta, revisão dos dados e versão das regras, com TTL de um minuto. O primeiro rebuild ainda lê candidatos da conta e materializa resumos; valores únicos/duplicações podem exigir mais CPU que o cenário com preços repetidos. O payload não carrega todos os comparáveis, mas isso não prova escala ilimitada do algoritmo. D1 remoto, limites de plataforma e alta concorrência não foram medidos.

Exportação é paginada e sequencial, não snapshot transacional. Compras legadas são paginadas na resposta após consulta do conjunto de compras; grandes volumes nesse módulo ainda exigem paginação SQL. Mudar de banco não é parte desta entrega.
