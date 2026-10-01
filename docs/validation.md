> **Documento histórico da V1.1.** Preservado para referência; comandos, fluxos e evidências não homologam a versão de desenvolvimento atual. Consulte [os guias atuais](../README.md) e a [matriz de implementação](implementation-status.md) antes de operar.

# Validação atual — operação real

12/09/2026: 109 testes aprovados; typecheck, lint, build, doctor e check-secrets executados. Migration 0004 aplicada apenas localmente. Cinco anúncios reais preservados; 652 anúncios e 12 monitores demo removidos com backup. Orçamento real permaneceu 2/5 durante toda a implementação. Worker local responde idle sem 401/403.

QA desktop 1440px e mobile 390px: formulário de monitor preenchido com iPhone 15/Curitiba/40/Last 24 hours/25 e regras financeiras. Salvamento de QA interceptado no navegador; nenhum monitor fictício persistido. Metadata consultada via GET autenticado, nenhuma consulta de anúncios. Build conserva warnings conhecidos de chunks >500kB e classificação parcial Vinext.

Ver [operação real](real-operation.md).

---

## Registros históricos de validação anteriores

# Validação V1.1

94 testes aprovados com Node/SQLite real em memória e transporte falso; verificação de tipos e lint sem erros. Incluem contratos keyword/URL/collect, filtros city/radius/date_listed/country, campos obrigatórios, valores inválidos, metadata incompleta/contraditória, mudança de contrato, fingerprint estável, snapshot/poll/download, SSRF, 429/500/timeout, BRL, datas/timezone, availability unknown (Radar+alerta+render do componente real), baseline 20+1, price drop, budget concorrente, POST ambíguo entre cliques, rejeição explícita recuperável, resposta vazia, isolamento e upgrade V1 com FKs ligadas. Também cobrem inicializador, configuração sem secrets, doctor somente leitura e erros seguros do worker.

Migration0001 aplicada com sucesso no D1 local existente (20 comandos); migration0000 não alterada. Build concluído. Script check:secrets verificou os valores configurados sem imprimir segredos. API local: página200, state200 (91 anúncios históricos locais), URL arbitrária422, validação sem credencial retorna ok=false com mensagem útil, SSE inclui metadados do alerta.

Na preparação local, Node 24.21.0/npm 11.19.0; npm ci, local:init, migrations, testes, typecheck, lint, build, check:secrets e doctor concluíram com código 0. Worker executou ticks autenticados, processando demo e mantendo zero disparos reais. API e SSE responderam 200; URLs de item/arbitrárias e keyword vazia retornaram 422. Testes negativos de autenticação rejeitaram token incorreto com 401 e uso do token do worker fora do seu endpoint com 403.

QA em Edge headless isolado: Fonte de dados, guia/checklist, defaults iPhone 15/limite 5, coleta desabilitada sem chave/direitos, validação sem coleta, formulário Search URL e filtro real. Desktop 1440px e mobile 390px, sem erro JavaScript ou overflow da página. Tráfego externo do navegador de teste foi bloqueado. Nenhuma fixture real simulada foi inserida no banco local para essa inspeção.

Não realizados: coleta autenticada/paga, confirmação manual dos anúncios no Facebook, medidas reais de delay/cobertura, envio Telegram, Docker ou teste de carga. A verificação visual foi limitada aos fluxos de configuração e filtragem, não a todo o produto.

Revisão de filtros nativos em 12/09/2026: GET oficial de metadata sem chave retornou 401; nomes adicionais relatados pelo operador não foram apresentados como confirmação autenticada. Migration 0002 aplicada localmente (uma coluna JSON em provider_runs), preservando hashes das migrations 0000/0001 e o histórico. Doctor confirmou 3/3 migrations, integridade do banco, API 200 e piloto 5×10. Worker retestado com ticks autenticados de demo, sem 401/403 ou disparos Bright Data, e encerrado após a verificação.

QA adicional em Edge com respostas de API interceptadas e contrato **sintético**, sem gravar fixtures no banco: validação libera os campos, cidade obrigatória, limite de raio, recência em inglês no JSON, country na busca por URL, rejeição de listing URL, criação de monitor com filtros separados da cidade local, enum ausente desabilitado, desktop/mobile sem overflow ou erros JavaScript. Unidades, limites e enum dessa fixture são dados de teste, nunca defaults ou evidência do contrato da conta. APIs externas foram bloqueadas no navegador de teste.

Warnings preservados: chunks client maiores que 500 kB e classificação estática parcial de rotas no Vinext beta. npm 11 também informou pacotes transitivos obsoletos e scripts de instalação sem aprovação registrada; os binários necessários funcionaram e não houve troca arbitrária de versões. Consulte [estado local](local-readiness.md).

O Site/demonstração não comprova fonte real ou monitoramento24/7. API key e metadata autenticada agora estão validadas; coleta manual e resultados reais continuam pendentes.

Revisão autenticada: metadata HTTP200, keyword/URL/Collect confirmados, recência suportada sem enum e desativada. Migration0003 aplicada sem alterar anteriores; candidatos URL-only preservam primeiro visto e baseline sem gerar alertas fictícios. QA com backend real validou configuração e botão habilitado em desktop/mobile, sem clicar no teste pago. Counter0/5 e zero provider_runs reais antes/depois. [Evidência detalhada](brightdata-authenticated-contract.md).
