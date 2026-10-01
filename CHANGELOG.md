# 2.0.0-rc.1 · seleção e experiência de compra

Filtro temporal de até sete dias, identidade exata, aliases automáticos, ativação inicial idempotente, feed de oportunidades separado do histórico, detalhes comerciais, negociação, quadro de negócios, disponibilidade opcional, cadência compatível com cotas e diagnóstico de aproveitamento. Atualização local aditiva com backup. Ver docs/release-2.0.md para evidências e restrições.

# 2.0.0-dev.1 — desenvolvimento local, 16/09/2026

- Correções contextuais de identificação, exclusão, troca, preço parcial e pesquisa; edição com preservação de campos/versão.
- Feed paginado/materializado por conta, agrupamento seguro de referências e detalhes sob demanda.
- Assistente e interface modular conectados a buscas, rascunhos, salvos, avisos, conta, compras e administração.
- Contas/planos/cotas, scheduler independente da UI, identidade verificada e outbox com lease/entrega incerta.
- Migration 0005 aditiva; corpus/regressões, backup/restauração SQLite, perfil de build e CI preparados.
- Verificação local: 143 testes, tipos e lint passaram. Build Vinext bloqueado por binding Linux; navegador bloqueado por política. Integrações e produção não homologadas.
- Sem push, deploy, chamadas pagas ou alteração de dados reais. Veja `docs/implementation-status.md` para pendências funcionais e de validação.

## Histórico preservado

# Changelog

## 1.1 — operação real (12/09/2026)

- Removido seed automático e fonte demo; mocks transferidos para tests.
- Purge com backup SQLite consistente, proveniência concordante e hash dos sobreviventes; 5 anúncios reais preservados.
- Monitor com venda manual/híbrida, teto/forte/Ultra, lucro/ROI/custos, publicação máxima, quantidade e controle de execução. Dinheiro do monitor em centavos (migration 0004).
- date_listed Last 24 hours habilitado por confirmação explícita do painel da conta, sem fingir enum da metadata.
- Baseline, dedup, orçamento e dreno de snapshot após pausa preservados; nenhuma coleta nova nesta etapa.
- 109 testes, typecheck, lint, build, doctor e secret check; QA desktop/mobile sem chamada paga.

## V1.1 — contrato autenticado Bright Data corrigido

- Metadata real HTTP200 confirmou discovery URL-only na fase de descoberta e schema rico no Collect; removida exigência indevida de preço/título para reconhecer discovery.
- Matching por método anunciado, assinatura e link do dataset, com IDs opacos corroborados e ambiguidade bloqueada.
- date_listed suportado sem enum permanece desativado; is_sold=true mapeado para vendido, false não prova ativo.
- Migration0003 armazena URLs pendentes sem inventar anúncios, preservando baseline/primeiro visto na promoção. Nenhum Collect automático.
- 94 testes, fixture baseada na metadata real, validação local e UI autenticadas sem coleta. Botão de teste habilitado e não clicado.

## V1.1 — filtros nativos Bright Data

- Formulários de monitor/teste usam city, radius, date_listed e country conforme metadata autenticada, preservando tipos e valores de enum.
- Validação completa antes do budget; fingerprint detecta mudança de contrato sem reagir a reordenação ou descrições. Metadata incompleta não gera opções presumidas.
- Migration 0002 acrescenta parâmetros efetivos por execução; localização integral retornada fica separada dos filtros solicitados. Freshness e baseline preservados.
- Collect by URL exige contrato e reserva adicional explícita; enriquecimento automático permanece desligado.
- 86 testes e QA desktop/mobile com contrato sintético. API de metadata sem credencial respondeu 401; nenhuma coleta real executada.

## V1.1 — preparação local para credencial

- Doctor confere ambiente, banco, migrations, API e configuração sem coleta ou exibição de secrets.
- Inicializador gera token ausente/vazio preservando valores; worker usa configuração consistente e logs seguros de início/tick.
- Fonte de dados separa chave, dataset e direitos, com checklist, guia e defaults iPhone 15/limite 5.
- URL de anúncio recebe 422 orientando a copiar a pesquisa; fila tem estados traduzidos e link original ausente fica desabilitado.
- POST rejeitado permite nova ação manual após correção; resultado incerto continua protegido contra repetição.
- Secret check inspeciona build, arquivos rastreados e índice Git; guias de cinco passos e operação 24/7 revisados.

## 1.1.0 — Live Facebook Marketplace Validation

- Auditoria da V1 e nova pesquisa oficial Bright Data.
- Keyword preservado; search URL validado e contrato async resolvido via metadata.
- Disponibilidade unknown visível e elegível com risco moderado; confiança independente.
- Preço anulável/BRL robusto, publicação inválida/futura sinalizada, URL original e snapshot preservados.
- Piloto manual5×10, limite atômico compartilhado, GET/preflight sem reserva e POST ambíguo bloqueado por escopo.
- Teste limitado sem monitor, painel de saúde/erros/execuções e estatísticas de delay por método.
- Baseline por monitor na leitura, aliases obsoletos removidos da seleção, primeiro visto após download.
- Migration0001 preservando histórico; 60 testes incluindo componente real renderizado e upgrade.
- Guias de teste real/produção e inspeção automática de segredos no build.

## 0.1.0 — 2026-09-10

- Primeira entrega orientada ao Facebook Marketplace após pesquisa técnica atualizada.
- Radar responsivo com 70 anúncios de demonstração, monitores, filtros e detalhe explicável.
- Banco relacional persistente com 15 tabelas, migrations e índices de consulta/deduplicação.
- Bootstrap, recência, snapshots, comparáveis robustos, custos/ROI, risco e score.
- Filas duráveis com lease, backoff, jitter, DLQ e limite de custo por provider.
- Busca adaptativa limitada; novo alias/revisão recebe baseline.
- Adapter Bright Data com introspecção e coleta assíncrona; sem chamada real/credencial na entrega.
- Alertas internos/SSE/navegador e outbox Telegram; dados demo nunca enviados externamente.
- Feedback, compra/venda e calibração estatística após cinco vendas compatíveis.
- Testes automatizados e smoke de API local; documentação e Docker de desenvolvimento.
- Corrigidos: parcela sem símbolo monetário; acessórios confundidos com consoles; alta após queda; baseline cruzado entre monitores; deduplicação além de 1.000 registros; atomicidade alerta/outbox; retry de preflight e comparáveis com disponibilidade desconhecida.

Limitações e trabalhos futuros explicitamente registrados em `docs/roadmap.md`.
