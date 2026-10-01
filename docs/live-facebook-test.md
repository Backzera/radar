> **Documento histórico da V1.1.** Preservado para referência; comandos, fluxos e evidências não homologam a versão de desenvolvimento atual. Consulte [os guias atuais](../README.md) e a [matriz de implementação](implementation-status.md) antes de operar.

# Facebook real: do registro comprovado ao monitor

A primeira coleta autenticada já recebeu 5 anúncios reais neste ambiente. A etapa atual preservou esses dados e não fez nova coleta paga. Operação normal não contém demo.

1. Inicie npm run dev e, em outro terminal, npm run worker. Confirme npm run doctor.
2. Fonte de dados / Facebook Marketplace mostra chave, dataset, direitos, contrato, última coleta, orçamento e filas. Validar configuração consulta somente metadata.
3. Para teste avulso consciente: Palavra-chave, iPhone 15, cidade Curitiba, raio opcional, Last 24 hours e limite 5. Executar teste limitado cria uma única consulta e não cria monitor.
4. Radar → Todos / Histórico mostra os registros; clique em um anúncio para ver publicação, primeiro/último visto, delay, preço, riscos, origem e link original. Não há botão ativo quando URL está ausente.
5. Meus monitores → Novo monitor: configure máximos/margem/ROI, venda rápida esperada, custos e janela local 24h. Salve e execute Buscar agora: primeiro ciclo baseline sem alerta.

Last 24 hours é permitido por confirmação explícita do painel da conta do usuário; enum ausente da metadata permanece identificado como tal. Nenhum outro valor foi inventado. Raio mantém a unidade bruta do provider; metadata não publica unidade/limites, sem conversão automática. Cidade retornada não comprova precisão do raio.

PILOT_MODE=true mantém coleta real manual. Até alterar BRIGHTDATA_MAX_RECORDS_PER_TRIGGER, um monitor com 25 continua limitado ao teto atual 10. Secrets são exclusivamente do servidor. Reinicie API e worker depois de editar .dev.vars.

401: chave não aceita. 403: credencial sem acesso ao recurso. 429: limite do provider. Contrato alterado: valide novamente e revise o monitor antes de uma chamada paga. Não repita cegamente um disparo de resultado incerto; preserve/reconcilie seu snapshot.

Veja [operação real e backup](real-operation.md) e [worker 24/7](production-worker.md).
