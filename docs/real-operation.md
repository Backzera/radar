> **Documento histórico da V1.1.** Preservado para referência; comandos, fluxos e evidências não homologam a versão de desenvolvimento atual. Consulte [os guias atuais](../README.md) e a [matriz de implementação](implementation-status.md) antes de operar.

# Operação real — V1.1

## Dados e backup

A limpeza local de 12/09/2026 removeu 652 anúncios e 12 monitores de origem demo concordante. Os 5 anúncios reais, snapshots, execuções Bright Data, compras/histórico real, configurações e contador de budget permaneceram iguais nos hashes de preservação. API/worker foram interrompidos durante a limpeza; nenhuma chamada paga foi feita.

Backup anterior à limpeza e à migration 0004: `.wrangler/backups/before-demo-purge-2026-09-12T07-50-27-686Z/radar.sqlite`. O diretório também contém journal de migrations e report.json. .wrangler é ignorado pelo Git. SQLite backup API inclui WAL confirmado; cópia verificada por integrity_check e hash.

Purge exige listings.demo=1 **e** data.demo=true **e** data.provider=demo. Monitores têm provider demo explícito. Filhos são removidos por referência ao listing comprovado; vínculos reais/conflitantes impedem remover monitores. Budget, usuários e secrets não são apagados. Um hash de todos os registros fora do plano de remoção garante rollback se qualquer sobrevivente mudar. Rodar novamente é idempotente.

Rollback: pare API e worker, preserve também uma cópia do estado atual, localize o único SQLite MARKET RADAR em .wrangler/state/v3/d1 e restaure o backup para esse arquivo. Remova apenas seus arquivos auxiliares -wal/-shm com todos os processos parados, restaure o journal salvo e execute db:migrate para reaplicar migrations posteriores. Não restaure sobre um banco aberto nem descarte novas coletas feitas após o backup. Para recuperar só um registro antigo, prefira ler o backup separado a substituir todo o banco.

## Monitor e dinheiro

Nome, produto, keyword/URL, aliases, negativas, cidade/raio do provider, recência do provider, máximo, forte, Ultra, venda rápida, modo manual/automático/híbrido, lucro mínimo, ROI, custos globais ou por monitor, idade máxima, quantidade, intervalo, score/risco e ativo/pausado.

A migration 0004 adiciona monitors.financials. Novos valores monetários do monitor ficam em centavos inteiros nessa coluna; o JSON config legado permanece compatível, mas financials é a fonte financeira ao ler. Registros antigos são preservados e recebem defaults de leitura: janela 24h, 10 resultados, lucro mínimo 0, venda manual ausente. Nenhum preço de venda é inventado. Edições comerciais mantêm revision/baseline; alteração da consulta cria novo escopo.

Máximo é teto obrigatório. Forte/Ultra opcionais são derivados de 92%/80% do máximo, mantendo Ultra ≤ forte ≤ máximo. Classificação Ultra ainda exige margem, ROI ≥25%, confiança ≥60, risco ≤35 e publicação válida dentro da janela. Um valor abaixo do teto sozinho não é oportunidade.

Manual usa sua venda esperada. Automático usa pelo menos 5 comparáveis reais compatíveis e confiança suficiente. Híbrido usa o menor entre manual e automático; faltando amostra, usa manual. Venda manual não aumenta a contagem/confiança dos comparáveis. Calibração usa pelo menos 5 vendas registradas reais da mesma variante; engine de alertas e dashboard compartilham a regra/amostra.

Lucro líquido = venda − compra − combustível/transporte/manutenção/limpeza/embalagem/adicional − taxas/comissões sobre venda. Aritmética em centavos; comparação do ROI acontece antes do arredondamento. ROI mostrado é sobre preço de compra; o detalhe também mostra ROI sobre capital total. Preço ausente/parcial não recebe lucro estimado.

## Recência e pipeline

Last 24 hours foi confirmado no painel da conta pelo usuário, não no enum da metadata. Só é habilitado para o dataset conhecido quando o campo continua presente com tipo compatível; enum real tem precedência. Sem texto livre nem valores adicionais presumidos.

Filtro local usa a diferença exata entre agora e published_at: 15/30 minutos, 1/3/6/12/24h, 3/7 dias ou sem limite. Data desconhecida, inválida ou futura não gera urgência. First seen nunca substitui publicação. Mesmo uma queda de preço fica fora da fila urgente se a publicação ultrapassar a janela. Os dados continuam persistidos no histórico.

Publicações até 15 minutos recebem maior peso; a contribuição diminui ao longo da janela. Opportunity e Risk são separados. Availability unknown continua elegível, com risco/confiança ajustados moderadamente.

Primeiro ciclo por consulta cria baseline sem alertas. IDs repetidos atualizam last_seen_at; queda preserva evento próprio; alertas usam chave idempotente. Se pausar/editar após criação de snapshot, ele é concluído com o contrato salvo, sem novo disparo e sem alerta do monitor pausado/substituído.

## Histórico e negócio

Radar e métricas usam somente registros reais. A avaliação usa até 10.000 observações recentes reais; busca textual consulta o histórico e retorna até 200. Contagem observada vem do banco; métricas de oportunidades refletem a janela analisada. Detalhes preservam snapshots, publicação, primeiro/último visto, preço, localização e fonte.

Comprei salva preço anunciado, pago, data, custos, nota, venda prevista e lucro previsto para o valor pago. Vendido salva preço/data, taxas e custos adicionais. A tela compara lucro real/previsto, ROI e dias em estoque. Desaparecimento de anúncio não é venda comprovada.

## Segurança de operação

Piloto continua ativo; global atual permanece 5 disparos/dia e 10 registros/disparo. Escolher 25 no monitor não aumenta esse teto. Para permitir 25, altere BRIGHTDATA_MAX_RECORDS_PER_TRIGGER conscientemente e reinicie ambos os processos. Não alteramos a chave, direitos, budget ou flags de custo.

Intervalo mínimo 60s, com espaçamento adaptativo que nunca fica abaixo do intervalo configurado. O budget compartilhado é o bloqueio final; não existe garantia de operação contínua por 24h com orçamento insuficiente. Pausado não inicia coleta. Collect automático e notificações externas permanecem desligados.

Para operar com PC desligado, API/banco e worker precisam estar hospedados. A fase atual mantém execução local; veja production-worker.md.
