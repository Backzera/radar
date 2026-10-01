> **Documento histórico da V1.1.** Preservado para referência; comandos, fluxos e evidências não homologam a versão de desenvolvimento atual. Consulte [os guias atuais](../README.md) e a [matriz de implementação](implementation-status.md) antes de operar.

# Worker 24/7 — arquitetura preservada

A coleta real V1.1 já foi comprovada e os dados demo foram removidos da operação. Nenhum processo remoto contínuo foi ativado e não foi migrada a infraestrutura.

## Processo e estado

scripts/worker.mjs envia POST /api/v1/worker/tick a cada 10s. O token da aplicação é server-only e vinculado a WORKER_USER_ID. Um tick agenda monitores vencidos permitidos pela política e processa no máximo um job. Piloto impede novos agendamentos reais; jobs manuais pendentes continuam. O endpoint /api/v1/jobs/continue apenas drena trabalhos já solicitados pelo usuário autenticado, sem criar agendamento.

Estado em D1: monitores/revisões, baseline, jobs, lease_token/lease_until, cursor/snapshot, orçamento por data UTC, execuções, observações e outbox. Claim é UPDATE atômico com lease de 120s; polls do fornecedor ficam disponíveis a cada 15s, até 30min. Falhas GET têm retry/jitter e limite; POST ambíguo exige reconciliação. Testes manuais usam escopo próprio, não viram monitores.

O processo worker não possui dados duráveis locais; pode reiniciar e retomar cursor salvo. API e banco precisam estar disponíveis. Supervisione o processo, registre falhas, monitore último tick/execução e faça backup do estado. Não execute múltiplos schedulers sem verificar leases, idempotência e budget sob carga. SSE não substitui agendamento nem push em segundo plano.

## Ambientes

| Ambiente                     | Identidade                                                                | Execução                                                       | Limitação                                                                                       |
| ---------------------------- | ------------------------------------------------------------------------- | -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Local de desenvolvimento     | bypass apenas em development/loopback; local-radar ou sign-in simulado    | dois terminais ou containers locais                            | computador precisa estar ligado; configuração não deve ser exposta à Internet                   |
| Sites privado                | gateway injeta identidade de usuário confiável                            | aplicação e D1 hospedados; página pode acompanhar jobs manuais | token WORKER_TOKEN sozinho não autentica no gateway; ingress de serviço autorizado é necessário |
| Produção independente futura | autenticação real de usuários + identidade de serviço + gateway confiável | API e worker supervisionados, banco persistente                | não confiar em headers oai-* fornecidos por clientes; remover bypass local                      |

Opção inicial adequada: validar a fonte localmente, depois escolher ambiente de serviço que permaneça ativo e permita HTTP autenticado para a API. É possível manter aplicação/D1 no Sites somente se o ingresso de serviço for oficialmente suportado e provisionado. Alternativamente, hospedar API e worker no mesmo ambiente controlado, adaptando os bindings de armazenamento/autenticação; não basta expor o servidor dev do Docker.

## Preparação posterior

**Recomendação para a primeira operação 24/7:** manter o processo Node existente em um único serviço permanente e supervisionado, executando `npm run worker`, com secrets no ambiente e API/banco hospedados. Node 22.13+ pode reiniciar o processo sem perder a fila persistida no D1. Nenhuma infraestrutura foi instalada ou contratada nesta preparação local.

Antes de escolher o host, valide o ingresso de serviço autenticado da API. No Sites privado, depende de suporte oficial da plataforma: um Bearer da aplicação sozinho não atravessa o gateway. Se esse ingresso não estiver disponível, planeje uma implantação controlada da API com autenticação real e seus bindings, preservando os motores. Hospedar somente o worker não mantém uma API local acessível com o PC desligado.

Uma alternativa posterior é um pequeno Worker com [Cloudflare Cron Triggers](https://developers.cloudflare.com/workers/configuration/cron-triggers/), invocando o tick autenticado. A grade em minutos deve ser confrontada com o delay medido e o polling atual de 15 segundos. Não foi ativada nem substitui o scheduler nesta etapa.

O worker local registra início, ticks e um heartbeat ocioso por minuto. Falha 401/403 encerra o processo; erros de conexão usam mensagens sem dados sensíveis. Reinicie API e worker após editar `.dev.vars`.

1. Medir o custo e o delay de monitores reais dentro do orçamento; validar cada método que será usado continuamente.
2. Configurar secrets do servidor, usuário de serviço e acesso ao gateway sem senha/cookie Facebook.
3. Desabilitar piloto conscientemente, manter teto diário e revisar intervalos.
4. Implementar reconciliação operacional de triggers ambíguos usando snapshot no fornecedor antes de liberar novo disparo.
5. Validar restart, leases expirados, uma única notificação por evento, backup/restore e isolamento por usuário.
6. Só então habilitar Telegram com EXTERNAL_ALERTS_ENABLED=true e credenciais do canal; coletar métricas reais por horas/dias.

Revisão não homologou disponibilidade 24/7, Docker, gateway de serviço, carga ou orçamento real. D1 atual usa camada de comandos SQLite; migration 0001 reconstrói pai/filho em ordem segura preservando FKs. As migrations aplicadas permanecem imutáveis.
