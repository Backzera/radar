# Market Radar 2.0 RC1

Radar de compra e revenda com seleção por produto, versão, publicação, região verificável e orçamento. Esta é uma versão de desenvolvimento para teste integrado, não uma homologação de produção.

## Atualizar a instalação atual

Use [ATUALIZAR_MARKET_RADAR_2_0.md](ATUALIZAR_MARKET_RADAR_2_0.md). Depois de parar os processos e copiar os arquivos por cima da source SaaS dev.1 com hotfix:

```sh
npm run dev
```

O início local cria backup e aplica somente a migration aditiva 0006 quando necessário, antes de iniciar servidor e worker. Não sobrescreve `.dev.vars` nem remove histórico. Não execute outro worker em paralelo. Node.js >=22.16.

## Instalação nova

A source completa não contém banco nem credenciais. Em ambiente com dependências apropriadas e build disponível:

```sh
npm ci
npm run local:init
npm run build
npm run db:migrate
npm run dev
```

Ajuste autenticação e configuração local diretamente no arquivo privado conforme o [guia administrativo](docs/admin-guide.md). Não exponha o servidor de desenvolvimento à internet. Nunca distribua `.dev.vars`, `.wrangler` ou segredos junto à source.

## O que mudou

- Oportunidades com modelo/versão corretos e publicação confirmada de até sete dias; histórico separado.
- Variações do nome preparadas automaticamente, sem lista de aliases no cadastro.
- Ativação salva intenção durável e inicia a primeira pesquisa, com idempotência e limites de consumo.
- Cards, detalhes e negociação em linguagem de compra e revenda, sem fórmulas internas na jornada básica.
- Quadro persistido de negócios e resultados de compras/vendas registradas.
- Conferência opcional de disponibilidade com reserva de orçamento e proteção para entregas incertas.
- Frequência efetiva calculada com a capacidade diária, não apenas com o intervalo digitado.
- Painel administrativo de aproveitamento de observações, erros e descartes.

A primeira busca é autorizada por Ativar radar e buscar. Com `PILOT_MODE=true`, as seguintes continuam manuais. Coleta desligada, fonte não configurada ou cota esgotada não viram resultados fictícios. Alterar para modo periódico é uma decisão administrativa de consumo.

## Verificação

```sh
npm test
npm run typecheck
npm run lint
npm run check:source-secrets
npm run build
```

Em 01/10/2026, no Windows com Node 24: 209 testes passando, TypeScript, lint e build completo passaram. A interface ativa fica em `components/saas`; os componentes da V1 e o kit de interface sem uso foram removidos. Ainda não houve validação de produção.

## Documentação

- [Guia do cliente](docs/user-guide.md)
- [Entrega, matriz e limites desta versão](docs/release-2.0.md)
- [Checkpoint e próximos passos](docs/implementation-status.md)
- [Guia do administrador](docs/admin-guide.md)
- [Guia de desenvolvimento](docs/developer-guide.md)
- [API](docs/api.md)
- [Procedimento de produção](docs/production.md)

Os documentos históricos V1.1/dev.1 descrevem suas respectivas revisões. O status atual está no relatório 2.0. Não confunda uma validação histórica com homologação da versão presente.
