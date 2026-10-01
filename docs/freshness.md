> **Documento histórico da V1.1.** Preservado para referência; comandos, fluxos e evidências não homologam a versão de desenvolvimento atual. Consulte [os guias atuais](../README.md) e a [matriz de implementação](implementation-status.md) antes de operar.

# Publicação, descoberta e delay

publishedAt vem exclusivamente de listing_date com timezone; firstSeenAt é capturado depois de receber os dados, lastSeenAt se atualiza mesmo em duplicado. Dados são armazenados em UTC e exibidos no timezone local do navegador.

FRESHNESS_CONFIG centraliza confiança mínima 70, recém-publicado até 15min, recente até 24h e antigo acima disso. Limiar V1 preservado para comparação entre versões. Datas ausentes/sem timezone são desconhecidas; calendário impossível ou futuro são inválidos. Publicação válida já capturada não é substituída por observação mais nova/ausente.

Discovery delay = firstSeenAt − publishedAt em segundos, somente com publicação válida, confiança suficiente, datas finitas e ordem temporal coerente. Ausência não é zero. Scrape time e latência do fornecedor não substituem publicação. Latência da execução inclui preflight, resposta e espera de snapshot; representa tempo operacional do ciclo, não atraso desde publicação.

O detalhe mostra delay global do anúncio. discovery_observations guarda primeira observação por usuário/provider/método/listing; seus percentis comparam keyword e search_url, excluindo baseline. A publicação conhecida/ausente é contabilizada também para baseline, explicitamente. Observações são amostras do fornecedor, sem ground truth de cobertura.

Novo monitor/provider/revisão e primeira busca de alias recebem baseline, sem alertar estoque histórico. O Radar mostra baseline normalmente. ID conhecido não vira novo; queda de preço é outro evento. Antigo descoberto agora continua antigo. Publicação desconhecida não ganha recência máxima. Desaparecimento não significa vendido.
