# Hotfix: busca manual, diagnóstico e início local

Data: 16/09/2026.
Base: `market-radar-saas-dev.zip`, 2.0.0-dev.1. As capturas mostraram worker com HTTP 200, `queued: 0`, cota zero e tentativa falha. O banco e o erro detalhado da instalação do usuário não foram acessados.

## Causa reproduzida

1. A busca é criada com cidade `Curitiba` antes de validar o contrato compartilhado do fornecedor.
2. `server/http.ts` só preenchia o filtro nativo `providerFilters.city` ao salvar enquanto havia um contrato disponível.
3. Validar o fornecedor depois não atualizava automaticamente a busca existente.
4. O worker enviava a consulta sem o filtro nativo de cidade a `prepareQuery`. A metadata observada exige `city`.
5. O preflight retornava `Informe city: obrigatório no contrato da Bright Data.` antes da reserva de cota e antes do POST pago.
6. O supervisor descartava os resultados individuais de `runOne`. O terminal registrava apenas o agregado `processed` com IDs nulos; o bootstrap também ocultava o motivo.

A sondagem anterior à correção falhou exatamente nesse fluxo. O teste corrigido recebeu um anúncio sintético no feed, completou baseline e não gerou alerta de novidade.

É uma falha confirmada no código e compatível com a sequência apresentada. Não há confirmação independente de que era o único erro presente na conta do usuário.

## Alterações

- `withKeywordCity` preenche somente a cidade ausente a partir do monitor e apenas se o schema autenticado atual aceita esse campo. É usado no preflight do worker, antes do orçamento e do trigger.
- Filtros nativos explícitos, fingerprint fixado, limites e filtros de URL são preservados. O adaptador de baixo nível continua estrito; não passa a aceitar consultas incompletas arbitrariamente.
- Snapshots pagos em polling mantêm sua consulta original; não há novo disparo para “corrigir” um snapshot.
- Download de snapshot que ainda retorna um envelope HTTP 200 `building`/`starting`/`running` continua consultando o mesmo snapshot. Não vira sucesso vazio nem nova cobrança.
- O supervisor retorna resultados individuais com campos selecionados. O worker imprime `worker_job` / `worker_job_error` com etapa, ID, snapshot, erro sanitizado e prazo quando disponível.
- Bootstrap e Minhas buscas mostram mensagem acionável. Texto técnico é limitado à conta administrativa e sanitizado; nenhuma resposta contém o payload completo da fonte.
- Jobs pendentes mostram estado e próxima consulta mesmo em piloto. Uma solicitação duplicada informa que não foi criada outra tarefa, em vez de confirmar um novo agendamento inexistente.
- `npm run dev` passa a supervisionar servidor e worker no perfil portátil local. Espera readiness, usa endereço de loopback exato, recusa porta ocupada e sinaliza somente os filhos que criou ao encerrar. `dev:server` preserva o início manual separado.
- Não foram adicionadas migrations/dependências nem modificados dados/configuração privada. Histórico e bloqueios contra disparos incertos são mantidos.

## Verificações realizadas

| Verificação | Resultado |
|---|---|
| Suíte base | 143/143 testes passaram |
| Regressão antes do hotfix | Falhou com cidade obrigatória ausente, nenhum trigger |
| Suíte final | 158/158 passaram, zero falhas/ignorados |
| TypeScript sem emissão/incremental | Passou |
| ESLint da source | Passou |
| Bundle de componentes reais no harness | Compilou |
| HTML do cartão de erro | Renderizado e verificado por teste |
| Início conjunto e encerramento de filhos | Testado em Linux com servidor HTTP isolado e script real do worker |
| Coleta externa / conta Bright Data / Windows real | Não executados |
| Build completo Vinext | Bloqueado por binding Linux ausente; registro npm indisponível por DNS |
| Inspeção visual em navegador / deploy | Não executados |

As 15 regressões novas incluem preservação de filtro/fingerprint, falta de cidade sem consumir cota, mensagens por conta, deduplicação de pedidos, polling no piloto com cota usada, download temporariamente pendente, bloqueio de disparo incerto, preservação do histórico antigo, nenhuma falsa conclusão de snapshot falho, renderização do diagnóstico e seis testes do início local/logs.

## Comandos de verificação

```text
node scripts/test.mjs
node node_modules/typescript/bin/tsc --noEmit --incremental false
node node_modules/eslint/bin/eslint.js . --ignore-pattern node_modules --ignore-pattern .test-build --ignore-pattern .browser-build --ignore-pattern dist --ignore-pattern .next
node tests/browser/build.mjs
node scripts/run-framework.mjs build
```

Não foram usados segredos do ZIP original. Dependências já presentes no anexo foram extraídas isoladamente para os testes, sem executar instalação de pacotes nem copiar estado local. Fixtures não são inseridas na aplicação durante uso normal.

## Referências do protocolo consultadas

Documentação primária da Bright Data, consultada em 16/09/2026:
- Monitor Progress: `https://docs.brightdata.com/api-reference/web-scraper-api/management-apis/monitor-progress`
- Download Snapshot: `https://docs.brightdata.com/api-reference/scrapers/delivery-apis/download-snapshot`
- Troubleshooting, envelopes temporários do snapshot: `https://docs.brightdata.com/cn/api-reference/marketplace-dataset-api/troubleshooting`

O requisito concreto de `city` foi reproduzido com a fixture de metadata autenticada de 12/09/2026 presente na source. Não foi tratado como consulta ao contrato atual da conta.

## Aplicação e reversão

Copie o conteúdo do pacote na raiz da instalação 2.0.0-dev.1, com os processos parados. Preserve `.dev.vars` e `.wrangler`. Não é necessário recriar o monitor para esta falha.

Para reverter, pare os processos e restaure os arquivos substituídos a partir da cópia anterior. Como não há migration, o banco não precisa ser retrocedido. Remover os arquivos novos sem restaurar também o `package.json` e seus importadores deixaria referências quebradas.
