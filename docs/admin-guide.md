# Guia administrativo

## Não ativar coleta ou publicação automaticamente

Esta entrega não executou push, deploy, coleta paga, configuração de infraestrutura, envios Telegram nem cobrança. `COLLECTION_ENABLED=false`, `PILOT_MODE=true` e `EXTERNAL_ALERTS_ENABLED=false` são padrões conservadores. A trava adicional de coleta bloqueia novos disparos; snapshots já pagos podem ser concluídos.

Segredos identificados no ZIP original precisam ser rotacionados pelo titular. Nenhum segredo original foi usado nesta implementação, e não há comprovação de revogação. `.env.example` só contém nomes e valores não secretos.

## Identidade e administração

Para acesso independente foi preparado o perfil `AUTH_MODE=cloudflare-access`, com `ACCESS_ISSUER` e `ACCESS_AUDIENCE`. A aplicação verifica assinatura RS256 e claims no servidor, não apenas a existência do cabeçalho. `RADAR_ADMIN_IDS` é uma lista explícita de identidades autorizadas; o primeiro usuário não se torna administrador automaticamente.

Este verificador usa Web Crypto, tem testes com chaves efêmeras e não foi validado contra uma aplicação Access real nem submetido a revisão independente. A autenticação administrada não significa que fluxo público de cadastro, aprovação, recuperação e cobrança foi homologado. Rotação de chaves usa cache de cinco minutos; disponibilidade durante uma troca de `kid` exige homologação.

O perfil `platform` só aceita identidade quando `TRUST_PLATFORM_IDENTITY=true` e o proxy injeta `x-radar-origin-token` válido. A origem precisa estar protegida; o cliente não pode configurar esse cabeçalho. Não usar apenas `oai-authenticated-user-id` em um site aberto.

Acesso sem identidade externa exige simultaneamente execução de desenvolvimento, `ALLOW_LOCAL_DEV_AUTH=true` e origem loopback. Não é um modo de autenticação de produção.

IDs antigos são preservados. IDs `access:<issuer>:<sub>` não recebem dados de usuários antigos automaticamente. Uma migração de identidade precisa de mapeamento confiável e revisão separada. Não transfira todos os registros ao primeiro usuário.

## Planos, operação e falhas

A área administrativa permite revisar contrato e limites. Rotas administrativas também exigem autorização no servidor. O plano inicial é administrado, não comprado; não há checkout. API administrativa de associação de plano: `POST /api/v1/admin/accounts/plan` com `accountId` e `planId`. Alteração que violaria o limite de buscas ativas é recusada. Pause buscas ou revise o limite antes de reduzir o plano.

A migration preserva contas antigas com mais de cinco buscas ativas em um plano legado que exige revisão; não pausa nem apaga buscas silenciosamente. O teto global continua existindo.

O scheduler processa até duas contas elegíveis por tick, alternando por última execução. Use um processo Node supervisionado com `npm run worker`, ou um agendamento de servidor autorizado que faça a mesma chamada autenticada. A interface não é responsável por continuar tarefas. Atividade de painel por SSE não comprova saúde da coleta.

A credencial de worker só acessa `POST /api/v1/worker/tick`. Para HTTPS protegido por Access, as credenciais de serviço opcionais `CF_ACCESS_CLIENT_ID` e `CF_ACCESS_CLIENT_SECRET` são enviadas ao mesmo destino configurado, sem redirecionamento. Políticas de borda precisam permitir o serviço. HTTP remoto é recusado por padrão; a exceção de rede local existe somente para o Compose de desenvolvimento.

Cotas individuais e globais são reservadas na mesma operação e devolvidas apenas em falhas seguramente anteriores ao disparo. Um disparo pago incerto não é repetido automaticamente. Reinício real do supervisor, failover e custos do fornecedor ainda exigem validação de implantação.

## Telegram

Defina bot, nome do bot e segredo do webhook no servidor. Habilite o plano e alertas externos somente depois de autorização. O vínculo usa token temporário aleatório, armazenado como hash, com expiração e uso único. Só aceita chat privado cujo remetente corresponde ao chat. Um destino não é vinculado silenciosamente a outra conta.

Configure a borda para permitir o webhook exato e manter a validação do segredo no servidor; o bot não passa por um login interativo de Access. Não abra todo `/api/v1` para resolver isso.

O canal distingue confirmação de envio, recusa comprovada e entrega incerta. Recusa temporária comprovada tem no máximo três tentativas; falha ambígua não é reenviada cegamente. Itens `sending` com lease vencido passam a `uncertain`. Não há promessa de entrega exatamente uma vez. A interface mostra o estado de entrega dos avisos.

## Backup e retenção

Para SQLite local, `node scripts/backup.mjs create ORIGEM DESTINO_NOVO` cria snapshot consistente pela API SQLite, incluindo WAL confirmado, e grava manifesto SHA-256. `restore BACKUP NOVO_BANCO` verifica o manifesto e restaura sem sobrescrever destino existente. Ambos verificam integridade e foreign keys. Não execute contra arquivo escolhido por engano; os caminhos são responsabilidade do operador.

Teste o banco restaurado separado e só depois planeje troca de aplicação em janela autorizada. Não sobrescreva banco em uso. Backups D1 remoto usam mecanismo próprio da plataforma e permanecem não testados aqui.

`node scripts/retention-report.mjs BANCO 90` apenas conta candidatos antigos, sem remoção. Política automática destrutiva não está ativa. Exclusão permanente de conta e retenção com execução controlada ainda precisam de fluxo administrativo completo.


## Atualização 2.0 RC1

Consulte ATUALIZAR_MARKET_RADAR_2_0.md antes de atualizar o banco. A nova primeira busca é autorizada por Ativar radar e buscar inclusive no piloto, mas o scheduler periódico segue desligado no piloto. Não remova cotas. A cadência considera capacidade e radares ativos.

AVAILABILITY_ENABLED, AUTO_VERIFY_OPPORTUNITIES e MAX_DAILY_AVAILABILITY_CHECKS controlam a conferência opcional por URL; desativados por padrão. O limite adicional não substitui cota global/individual. Timeout depois de disparo sem cursor fica incerto; investigar antes de repetir. Valores de data/radius só são enviados quando confirmados pelo contrato.

Qualidade das buscas mostra observações por conta, não registros únicos nem preço faturado. Documentos anteriores não comprovam produção atual.
