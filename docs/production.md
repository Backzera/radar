# Produção: alvo, travas e pendências

**Estado: não homologado para publicação.** Nenhum deploy ou recurso externo foi criado. O alvo preserva Vinext/React e Cloudflare Workers/D1. O Dockerfile é explicitamente um preview local de artefatos compilados, não um servidor Node de produção substituto para Workers. Não usa mais `npm run dev` como comando da aplicação; ainda usa o emulador local de Workers.

## Preparação sem deploy

1. Validar instalação limpa Linux, testes, tipos, lint, build e verificação de segredos.
2. Revisar recursos Cloudflare **existentes e autorizados**. Copiar `wrangler.production.example.json` para `wrangler.production.json` e substituir D1 ID, nome, issuer e audience. O arquivo efetivo fica ignorado pelo Git. Não armazenar secrets em `vars`.
3. Executar `npm run build:production`. O script recusa placeholder de DB, configuração de identidade incompleta, acesso local habilitado e segredos em `vars`. Ele só compila, não publica. O plugin de mock da plataforma é excluído do perfil de produção.
4. Conferir o artefato `dist/server/wrangler.json`, bindings, rotas e isolamento. Uma compilação sem erros não equivale a validação de ambiente remoto.
5. Fazer backup D1 e teste de restauração conforme a plataforma e aplicar migrations em staging de forma autorizada. O runner `db:migrate` fornecido continua **local**; ele não deve ser reaproveitado como migrador remoto sem revisão do journal.
6. Configurar identidade administrada, origem protegida, secrets, worker supervisionado e borda do webhook. Homologar duas contas, expiração/logout, falhas e reinício com fixtures/staging antes de habilitar consumo pago.

## Monitoramento disponível

`GET /api/v1/health/live` retorna estado mínimo. `health/ready` verifica que a base SaaS foi migrada, sem revelar credenciais. Readiness não comprova contrato Bright Data nem disponibilidade de Telegram. O bootstrap separa estado da coleta, heartbeat do worker e conexão do painel.

O processo `scripts/worker.mjs` propaga encerramento por SIGTERM/SIGINT, aborta transporte pendente e emite eventos sanitizados. Autorização de coleta é separada de capacidade de finalizar snapshots já pagos. Não há transporte real testado nesta entrega.

## CI

`.github/workflows/ci.yml` foi criado apenas na source local. Ele instala dependências, roda testes/tipos/lint/build e inspeção de segredos, com coleta/avisos externos desligados e sem credenciais. Não contém deploy. **Não houve execução desse workflow no GitHub**, pois não houve push.

## Bloqueios observados

- Registro npm indisponível na instalação limpa: `EAI_AGAIN`.
- Binding nativo `@rolldown/binding-linux-x64-gnu` ausente nas dependências recebidas: build não aprovado.
- Chromium bloqueou a URL local com `ERR_BLOCKED_BY_ADMINISTRATOR`: inspeção visual não realizada.
- Access, Telegram, Bright Data e recursos D1 de produção não configurados/validados nesta tarefa.
- Sem gateway escolhido: pagamento, portal de assinatura e cancelamento de cobrança externa não implementados.

Resolver esses bloqueios não autoriza uma publicação automaticamente. Revise o relatório de implementação, a matriz de cobertura e os testes pendentes antes de liberar o serviço.

## Referências oficiais de integração

- Cloudflare Access: validação de JWT de aplicação, https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/
- Cloudflare Vite: configuração de runtime e artefatos, https://developers.cloudflare.com/workers/vite-plugin/reference/config/
- Node.js SQLite: API de backup, https://nodejs.org/api/sqlite.html#sqlitebackupsource-db-path-options

Essas referências orientam integração e não certificam este aplicativo. O perfil concreto precisa ser validado no runtime e versões travadas do projeto.
