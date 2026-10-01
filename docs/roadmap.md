> **Documento histórico da V1.1.** Preservado para referência; comandos, fluxos e evidências não homologam a versão de desenvolvimento atual. Consulte [os guias atuais](../README.md) e a [matriz de implementação](implementation-status.md) antes de operar.

# Roadmap e limites honestos

## Entregue na v0.1

- Facebook como fonte principal; demo e adapter Bright Data isolados.
- Monitores persistentes, regras e custos; query expansion limitada; busca, histórico e comparáveis.
- Pipeline e fila durável com leases, backoff, DLQ e orçamento de chamadas; bootstrap seguro.
- Preço robusto e oportunidade explicável; risco separado; preço parcial e acessórios bloqueados.
- Dashboard responsivo, SSE, alertas internos/navegador, outbox e adapter Telegram.
- Registro de compras/vendas; calibração mediana quando houver 5 vendas da mesma variante.
- Migrations, testes unitários/integração com SQLite real, scripts de execução, Docker para desenvolvimento.

## Antes de operar com dados reais diariamente

1. Validar direitos de coleta e armazenamento e contrato do fornecedor; fornecer chave em secret manager. A flag de configuração não concede autorização da plataforma.
2. Executar piloto opt-in com poucos registros. Comparar schemas, país/cidade, preços e data diretamente com anúncios observados legitimamente. O adapter não foi testado com credenciais reais.
3. Escolher fonte/observação que confirme disponibilidade. A saída documentada Bright Data não confirma `active`; isso impede alertas urgentes nessa fonte enquanto faltar evidência.
4. Medir mediana/P90/P95 de descoberta por 7 dias com cobertura de timestamps. Não assumir SLA.
5. Hospedar o processo worker com supervisão (systemd, container ou scheduler equivalente). Publicar o dashboard sozinho NÃO habilita polling contínuo.
6. Configurar backups/exportação, retenção e exclusão de dados, alertas de erro/custo e teste de carga. D1 tem teto por banco; planejar migração para PostgreSQL/particionamento antes dele.
7. Fazer QA de navegador/mobile e revisão de segurança operacional. Vinext é beta; avaliar Next.js estável/OpenNext para operação independente.

## Incrementos após dados suficientes

Visão/embeddings com cache e orçamento; tamanho/RAM/GPU/acessórios como variantes estruturadas; confirmação e acompanhamento de disponibilidade; Kaplan–Meier com censura à direita para tempo até indisponibilidade; liquidez probabilística; Ultra estatístico condicionado à liquidez medida; gráfico histórico agregado; políticas de retenção; exportação e FTS; métricas por provider com amostra explícita; pool de comparáveis paginado por produto; workers/fila de análise separados para alto volume.

## Futuro comercial

Negociação assistida sem envio automático, mapa, arbitragem entre plataformas, descoberta automática de produtos. Mercado Livre e OLX só depois da validação do núcleo Facebook. WhatsApp oficial, e-mail e push móvel requerem conectores próprios. Não ativados nem apresentados como implementados.

## Delimitação da primeira versão

Não há visão computacional executada, previsão de venda treinada, vendas inferidas por desaparecimento, autenticação própria multi-organização, app nativo nem compra/contato automático com vendedores. O objetivo entregue é a base funcional verificável, não uma alegação de operação produtiva já homologada.

## Situação após V1.1

Busca por URL, piloto, diagnósticos por método e métricas de delay foram implementados. A próxima etapa é fornecer credencial e URL, comprovar entradas reais e medir qualidade. Só depois ativar worker remoto24/7, confirmação de disponibilidade e visão computacional. Nenhuma dessas capacidades futuras é necessária para mostrar um anúncio unknown.
