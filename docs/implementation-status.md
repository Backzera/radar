# Checkpoint atual: Market Radar 2.0 RC1

Esta página substitui o status dev.1. Ver [release-2.0.md](release-2.0.md) para cobertura e limites.

## Concluído em desenvolvimento

Seleção com publicação confirmada em até sete dias; versões exatas; aliases automáticos; filtro temporal nativo quando confirmado; ativação persistida; nova home/assistente/detalhes; negociação e quadro de negócios; conferência opt-in de disponibilidade; validade de avisos pendentes; frequência compatível com capacidade; diagnóstico de aproveitamento; migration aditiva e atualização local com backup.

Suíte 183/183, TypeScript, lint e bundle de integração passaram. Nenhuma coleta paga, push, migração em dados do usuário ou implantação foi executada. O primeiro processamento de 5.000 preços distintos ainda é caro (aproximadamente 25,4 s local); otimizar sem alterar avaliação financeira antes de escala.

## Próximos passos exatos

1. Aplicar pacote incremental em cópia da source que já funciona no Windows; manter .dev.vars e .wrangler. Conferir backup e migração 0006 ao executar npm run dev.
2. Validar visualmente desktop/mobile/teclado e todos os passos do assistente. O navegador da execução de entrega bloqueou a página local; não há screenshots aprovados.
3. Em ambiente com dependência nativa apropriada, instalar pelo lockfile e executar build completo Vinext. Não apagar lockfile para esconder falha.
4. Fazer uma coleta real pequena autorizada: conferir payload date_listed/cidade/modelo, janela retornada, registros compatíveis e consumo. Nenhuma enumeração de sete dias deve ser presumida.
5. Validar disponibilidade e Telegram só após habilitação administrativa, com limite de consumo e recuperação de incerteza.
6. Em staging, homologar identidade externa, origem protegida, isolamento, backups remotos, concorrência e restart; depois teste com cinco iniciantes.
7. Integrar geocodificação municipal e terminar recursos comerciais (horários silenciosos, resumos, cobrança/cadastro público) mediante definição dos serviços e autorização.

Branch é local, não publique seu histórico com force-push. Pacotes e patch devem ser aplicados a uma base compatível e revisados antes de qualquer publicação.
