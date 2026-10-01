> **Documento histórico da V1.1.** Preservado para referência; comandos, fluxos e evidências não homologam a versão de desenvolvimento atual. Consulte [os guias atuais](../README.md) e a [matriz de implementação](implementation-status.md) antes de operar.

# Entrega MARKET RADAR V1.1

## Implementado

Base V1 preservada e auditada; dois modos de consulta Facebook, parser BRL/anúncios sem preço, disponibilidade unknown elegível com aviso e risco moderado, proveniência real/demo, filtro rápido de dados reais, publicação/primeiro visto/delay separados, datas inválidas/futuras, diagnóstico por execução e método, piloto manual com limites conservadores e teste avulso. Baseline, deduplicação, preço, risco, compras/vendas, SSE e alertas continuam funcionando. Corrigidos baseline na leitura, aliases obsoletos, instante de firstSeen e orçamento que crescia mesmo após o limite.

## Arquivos principais alterados

- providers/brightdata.ts e providers/contract.ts: contrato, introspecção, keyword/URL e snapshots.
- core/provider-query.ts, provider-values.ts, freshness.ts, opportunity.ts e types.ts: validação, mapeamento e análise.
- server/worker.ts, pilot.ts, diagnostics.ts, ingestion.ts, service.ts e api.ts: execução, limites, observabilidade e persistência.
- components/radar-app.tsx, radar-panels.tsx, provider-panel.tsx e listing-evidence.tsx: monitores, Radar, detalhes e diagnóstico.
- db/schema.ts e drizzle/0001_mature_madame_hydra.sql: preços anuláveis e novas tabelas, mantendo a migration 0000 intacta.
- tests/live-facebook.test.ts e testes existentes; scripts/check-secrets.mjs; .env.example; guias e README.

## Bright Data

Keyword envia texto. Search URL envia a pesquisa original validada, com seus filtros, sem reconstruir parâmetros Facebook. O discriminador de discovery URL é confirmado pela metadata da conta; contrato ausente ou ambíguo bloqueia a coleta. O adapter não faz login no Facebook nem pede cookies.

## Como testar Facebook real

1. Obter API key Bright Data com acesso ao scraper e conferir saldo/limite mensal.
2. Na pasta do projeto, executar npm ci e npm run local:init; inserir os dados em .dev.vars.
3. Executar npm run build, npm run db:migrate e npm run dev.
4. Em Fonte de dados, validar configuração sem coleta.
5. Testar keyword ou URL com limite5, conscientemente usando créditos.
6. Selecionar Somente anúncios reais no Radar; abrir os originais, conferir cidade e publicação.
7. Criar monitor; selecionar seu nome ao lado de Buscar agora. Em outro terminal, npm run worker acompanha jobs sem navegador.

O [guia completo](live-facebook-test.md) cobre criação de conta, erros, desligamento e execução recorrente posterior.

## Variáveis que precisam ser preenchidas/conferidas

BRIGHTDATA_API_KEY, BRIGHTDATA_DATASET_ID, FACEBOOK_DATA_RIGHTS_CONFIRMED. Para worker local: WORKER_TOKEN, WORKER_USER_ID e RADAR_API_URL. O inicializador já prepara o token em instalações novas. As opções PILOT_MODE, MAX_DAILY_PROVIDER_TRIGGERS, BRIGHTDATA_MAX_RECORDS_PER_TRIGGER e EXTERNAL_ALERTS_ENABLED têm defaults conservadores. Telegram é opcional e exige TELEGRAM_BOT_TOKEN e TELEGRAM_CHAT_ID, além de opt-in.

## Primeiro ciclo

Baseline persiste todos os resultados válidos para inspeção, mas não emite alertas urgentes. Novos IDs nas execuções seguintes são candidatos; IDs repetidos atualizam lastSeen, sem novo alerta. Queda de preço mantém evento próprio. Primeira consulta de alias/revisão também é baseline. Teste avulso nunca cria monitor recorrente.

## Como saber que funciona

Fonte de dados deve mostrar registros reais efetivamente recebidos, sem confundir health de metadata com coleta comprovada. Radar real exibe origem, publicação, firstSeen, delay e link original. Diagnóstico informa dados recebidos/aceitos/rejeitados/duplicados, snapshot, latência e erros. Os percentis são por método e excluem baseline; ausência de amostra aparece como indisponível.

## Custos

Piloto: até5 disparos/dia compartilhados pela credencial, até10 registros por disparo, coleta manual e Telegram desligado. O teste padrão solicita5. POST ambíguo não é refeito automaticamente; escopo exige reconciliação. Limites locais não garantem fatura. A [tabela oficial consultada](https://brightdata.com/pricing/web-scraper) informa PAYG US$1,50/1.000 registros; confirme plano e franquia na conta antes do piloto.

## Validação e limitações restantes

60 testes aprovados, tipos e lint limpos, build concluído, migration aplicada no D1 local preservando histórico e inspeção de secrets aprovada. API local respondeu200; URL arbitrária rejeitada422; SSE e diagnóstico sem credencial conferidos. Testes usaram transporte falso e SQLite real, incluindo render HTML do componente de evidência.

Ainda falta validação autenticada com API key e pesquisa real escolhida pelo usuário. Não há resultados reais, precisão geográfica, delay ou cobertura comprovados nesta entrega. Disponibilidade continua unknown quando o fornecedor não confirma. Visão computacional, liquidez calibrada, worker remoto24/7, Docker e QA visual em navegador não foram homologados.

## Próxima etapa recomendada

Inserir a chave no arquivo local ignorado pelo Git, informar a URL e autorizar duas consultas de até5 registros (keyword e URL). Depois de conferir registros reais, medir algumas execuções, validar localização/publicação e então escolher o ingresso autenticado e supervisão para [worker24/7](production-worker.md).
