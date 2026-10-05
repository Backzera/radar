# Market Radar

SaaS de controle de estoque e lucro para quem faz brick (compra e revenda de usados). O radar de oportunidades do Marketplace aparece como "Em breve": o código de coleta continua no projeto para uma próxima versão.

## O que o app faz

- **Contas próprias**: cadastro e login por e-mail e senha (`AUTH_MODE=password`), sessão em cookie `HttpOnly`.
- **Estoque**: produto com fotos, categoria, estado, IMEI/série, onde e de quem comprou, preço pedido e etapa (em estoque, em preparação, anunciado, reservado, vendido).
- **Custos extras** por produto (conserto, peças, frete, limpeza, taxas) e **venda** com taxas, canal e comprador; dá para desfazer a venda.
- **Contas automáticas**: total investido, lucro líquido, margem, ROI, dias em estoque e lucro esperado de quem ainda não vendeu.
- **Painel**: lucro e faturamento do período com comparação, meta mensal, lucro por mês (12 meses), lucro por categoria, produtos parados e últimas vendas.
- **Vendas** por período e **exportação** para planilha (CSV para Excel, separado por `;`).
- **Landing** pública com planos (`components/brick/brand.ts` concentra nome, preços e textos dos planos).
- **Usuários** (só administradores): cadastrar com senha gerada, bloquear e liberar, redefinir senha, trocar plano, excluir com tudo que a pessoa cadastrou e abrir ou fechar o cadastro pelo site. Cada ação fica no log `audit_events`, só com ids. Quem é administrador vem de `RADAR_ADMIN_EMAILS` (e-mails separados por vírgula) no `.dev.vars` ou nas variáveis de produção.
- **Conta**: cada pessoa troca a própria senha; os outros aparelhos conectados saem.

## Rotas

| Rota | Conteúdo |
|---|---|
| `/` | Landing com recursos, planos e perguntas |
| `/cadastro`, `/entrar` | Criar conta e entrar |
| `/app` | Aplicativo (painel, estoque, vendas, radar em breve, conta) |
| `/api/v1/...` | API: `auth/*`, `inventory/*`, `media/:id`, `brick/preferences` |

## Rodar no seu computador

Node.js >= 22.16. No `.dev.vars`, use `AUTH_MODE=password`.

```sh
npm run dev
```

O início local faz backup e aplica as migrations pendentes antes de subir o site e o worker. Em instalação nova: `npm ci`, `npm run local:init`, `npm run build`, `npm run db:migrate` e depois `npm run dev`.

As fotos ficam num bucket R2 com o binding `MEDIA` (no desenvolvimento, o Wrangler simula o bucket em `.wrangler/state`). Para produção, crie o bucket e preencha `wrangler.production.example.json`. A cobrança online ainda não foi integrada: os planos aparecem na landing e o plano escolhido fica salvo na conta.

## Estrutura

- `components/brick/`: interface do SaaS (landing, login, shell, painel, estoque, vendas, conta, gráficos).
- `core/brick.ts`: regras e contas do brick, usadas pelo servidor e pela interface.
- `server/auth.ts`, `server/inventory.ts`, `server/inventory-routes.ts`: login, estoque e fotos.
- Radar (desligado na interface por `FEATURES.radar` em `components/brick/brand.ts`): `providers/`, `server/worker.ts`, `server/supervisor.ts`, `components/saas/`.

## Verificação

```sh
npm test
npm run typecheck
npm run lint
npm run check:source-secrets
npm run build
```

## Documentação

Os documentos em `docs/` descrevem o radar (versões 1.1 a 2.0) e continuam valendo para quando ele for religado: [guia de desenvolvimento](docs/developer-guide.md), [API do radar](docs/api.md), [produção](docs/production.md), [status do radar](docs/implementation-status.md).
