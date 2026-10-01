> **Documento histórico da V1.1.** Preservado para referência; comandos, fluxos e evidências não homologam a versão de desenvolvimento atual. Consulte [os guias atuais](../README.md) e a [matriz de implementação](implementation-status.md) antes de operar.

# Opportunity, risco e confiança — V1.1

O score mantém contribuições explicáveis: desconto até30, ROI líquido até25, recência até15, confiança dos comparáveis até15, identificação até10, localização até5, menos30% do Risk Score. Valores são heurísticas de ranking, não probabilidade calibrada de lucro.

Availability unknown não bloqueia sozinho: acrescenta6 ao risco e reduz6 da confiança agregada. O aviso aparece em cards, detalhe, alertas e Telegram/navegador. Sold/removed/unavailable bloqueiam novo alerta de compra. Não houve confirmação desses estados por campo Bright Data atual.

Alertas continuam exigindo baseline concluído, publicação suficientemente recente (até24h) ou queda recente, preço integral confiável, risco permitido e critérios do monitor. Manual segue seus limites; automático exige score/ROI e confiança de preço≥60. Unknown pode alertar. Antigo/desconhecido sem queda fica visível e analisado, mas sem alerta urgente; não foi adicionado atalho por preço extraordinário que invente recência. Liquidez exigida continua bloqueando enquanto não houver amostra.

Preço null/entrada/acessório não gera lucro fictício. Domínios real/demo permanecem separados. Mínimo5 comparáveis reais compatíveis para estimar venda rápida. Baseline por monitor/revisão é respeitado na ingestão e ao recalcular o Radar. O alerta new e a queda têm chaves idempotentes e cooldown.
