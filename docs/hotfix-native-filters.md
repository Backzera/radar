# Market Radar 2.0 RC1: correção de período e raio

Pacote incremental para a source **2.0.0-rc.1** entregue nesta conversa. Não aplicar sobre a V1.1 antiga ou sobre uma versão personalizada sem comparar as alterações.

## O que mudou

A escolha atual do radar passa a prevalecer sobre filtros nativos antigos: sete dias não são mais substituídos silenciosamente por 24 horas; o raio não é mais omitido ou reaproveitado de uma configuração antiga. A alteração funciona para radares existentes e para novos radares.

Quando a metadata autenticada não informa a lista de períodos ou a unidade do raio, a administração pode completar essas informações uma vez, copiando os valores da própria conta Bright Data. A confirmação fica associada ao dataset e à versão do contrato. Não substitui um enum ou uma unidade explicitamente publicados pela fonte. Mudança no contrato invalida a confirmação anterior.

**Não é uma promessa de envio correto sem conhecer a unidade e os valores aceitos.** Enquanto faltarem informações, a tentativa é bloqueada antes da reserva de cota e do disparo pago. Ela não troca o período nem ignora o raio para conseguir executar.

## 1. Instalar na pasta existente

1. Pare o `npm run dev` e qualquer worker separado com **Ctrl+C**. Faça uma cópia da pasta atual antes de substituir código.
2. Extraia `market-radar-correcao-periodo-raio.zip`. Copie as pastas de dentro dele para a pasta onde está o seu `package.json`, mesclando e substituindo os arquivos de mesmo nome. Não crie uma pasta extra intermediária.
3. Preserve integralmente `.dev.vars`, `.wrangler`, bancos e backups. Não copie credenciais para o pacote nem para o chat.
4. Na pasta do projeto, execute:

```bat
npm run dev
```

O início conjunto de servidor e worker da RC1 é preservado. Não inicie um segundo worker separado quando o primeiro já estiver sendo gerenciado. Acesse o endereço informado no terminal.

**Esta correção não acrescenta dependências nem migrations.** Na instalação RC1 já funcionando, não é necessário executar `npm install` ou `npm run db:migrate` para este hotfix. Os scripts existentes de inicialização/upgrade, o lockfile e o `package.json` não foram alterados.

## 2. Confirmar os filtros uma vez, quando a fonte não os publica

1. Entre em **Administração** e clique em **Validar configuração, sem coleta**.
2. Abra a nova seção **Filtros da busca**, logo abaixo desse botão.
3. Na Bright Data, abra a aba **Configuração** do método **Discover by keyword** e confira o exemplo de entrada da API. Não execute uma coleta só para consultar essa configuração.
4. No Radar, informe o valor exato correspondente a **24 horas** e a **7 dias**. Se o contrato publicar um enum, os valores disponíveis aparecerão na lista. Se não publicar, copie o texto/valor do exemplo de entrada da sua conta, não uma tradução do navegador.
5. Confirme a unidade do campo `radius` que a Bright Data recebe: quilômetros, milhas ou metros. O formulário do Radar continua recebendo quilômetros. Não selecione quilômetros por suposição.
6. Marque **Conferi os valores e a unidade na configuração da minha conta Bright Data** e clique em **Salvar confirmação, sem coleta**.
7. Confira a **Prévia de verificação: 7 dias e 30 km**. É um exemplo local calculado com o mesmo preparador do envio, não uma coleta nem a leitura de um snapshot real.

Se o seu painel efetivamente apresentar `Last 7 days` e confirmar `radius` em quilômetros, a prévia desse exemplo será:

```json
{
  "keyword": "iphone 13",
  "city": "Curitiba",
  "radius": 30,
  "date_listed": "Last 7 days"
}
```

**Os textos `Last 24 hours` e `Last 7 days` mostrados como exemplos não são prova do contrato atual da sua conta.** Use-os somente quando corresponderem aos valores realmente aceitos/exibidos na fonte. Se a fonte não oferecer sete dias, não confirme artificialmente essa opção: o sistema recusará a execução com outro período.

Quando a fonte exigir milhas, 30 km são convertidos em aproximadamente 18,64113576712 milhas; quando exigir metros, em 30000 metros. Assim, ver um número diferente de 30 no CSV pode ser correto se houver conversão confirmada. Se a fonte exigir números inteiros, faixas ou valores discretos que não representem o raio escolhido, a busca é bloqueada com explicação, sem arredondamento silencioso.

Esta confirmação é administrativa e fica persistida no banco existente. Não é necessária para cada cliente ou radar. Não é preciso alterar `.dev.vars` nem informar uma API key nesta seção. O endpoint somente complementa o contrato, não modifica chaves, habilitação, piloto ou cotas.

Consultar e salvar a confirmação não cria jobs nem dispara uma coleta por esses endpoints. **Radares/tarefas já autorizados podem continuar sendo processados pelo worker conforme a configuração existente.** Mantenha o modo piloto durante o teste e não aumente limites para compensar um erro de configuração.

## 3. Testar o radar já cadastrado

Confira em **Minhas buscas → Revisar critérios** que o radar desejado está salvo com sete dias e 30 km. Não apague nem recrie o radar apenas por causa desta correção.

Se já houver um snapshot `Running`, aguarde a conclusão dele antes de pedir outro. Um snapshot já enviado não pode ter seus filtros alterados retroativamente por este pacote. O worker continua consultando o mesmo snapshot, sem disparar novamente para tentar corrigir o passado.

Depois da confirmação, solicite **Buscar agora → Confirmar solicitação** uma única vez. Esta ação é uma coleta real e pode consumir créditos. Confira a entrada do **novo snapshot**; os CSVs antigos continuarão mostrando os critérios antigos.

A palavra-chave do exemplo da prévia não substitui o produto cadastrado: cada execução usa o radar correspondente e a estratégia de aliases existente. O patch altera apenas a prioridade do período/raio e sua validação.

Se faltar confirmação, o painel e o motivo técnico exibem a orientação de configuração, com código `native_filters_unconfirmed`. A tentativa pode ficar registrada como falha de pré-validação, mas não é convertida numa chamada paga sem os filtros pedidos.

## Escopo e limites

- O hotfix cobre radares de descoberta por palavra-chave. Pesquisas avançadas por URL continuam usando o contrato/filtros próprios da URL; não são convertidas silenciosamente em pesquisa por palavra-chave.
- Corrigir a solicitação não garante que a origem sempre respeite todos os filtros. A conferência local de publicação permanece ativa. Dados já cobrados não são reembolsados por uma filtragem posterior.
- Não foram acrescentadas geocodificação ou novas garantias de distância real dos anúncios. O raio enviado e a distância comprovável no retorno são conceitos diferentes.
- A metadata histórica incompleta do projeto foi preservada como fixture; os testes não a transformam em prova de sete dias ou de quilômetros no fornecedor real.
- Nenhuma coleta Bright Data, mensagem Telegram, alteração em GitHub ou operação no banco do usuário foi executada nesta entrega.
- O contrato atual da sua conta, Windows e navegação por cliques não foram validados ao vivo.

## Testes executados

Ambiente local Linux, Node.js 22.16.0, usando dependências disponíveis na cópia isolada, sem carregar credenciais ou banco do usuário.

| Verificação | Resultado |
|---|---|
| Suíte da RC1 original | 183 testes passaram |
| Suíte após a correção | 199 testes passaram; 0 falhas; 0 ignorados |
| Novos testes específicos | 16 |
| TypeScript | Passou |
| ESLint | Passou |
| Compilação do conjunto de componentes para teste | Passou; não equivale a teste visual |
| Build completo Vinext | Bloqueado: falta `@rolldown/binding-linux-x64-gnu` neste ambiente Linux |
| Coleta real na conta Bright Data | Não executada |

Os testes verificam o JSON realmente passado ao transporte simulado da Bright Data, inclusive com radar existente que guardava 24h/10 no filtro legado e passou a pedir 7 dias/30. Também verificam edição parcial, inversão para 24h, conversão de unidades, validação de enum, concorrência da confirmação, isolamento administrativo, ausência de consumo antes da confirmação e retomada de snapshot pago sem novo disparo.

Os mocks de integração que representavam apenas execuções bem-sucedidas receberam contratos completos explicitamente sintéticos. Os testes que aceitavam o fallback antigo agora exigem bloqueio. Não foram desabilitadas as verificações contra repetição paga, isolamento ou incerteza de entrega.

## Voltar à versão anterior

Pare o servidor/worker e restaure a cópia dos arquivos de código feita antes da atualização. Não apague o banco nem restaure um backup antigo sobre operações novas sem avaliar os dados. Não há migration nova a desfazer. A confirmação salva na tabela existente possui tipo próprio e não altera os monitores nem os snapshots passados.

## Referências de integração

Documentação oficial consultada para contextualização, sem usar credenciais:
- https://docs.brightdata.com/api-reference/scrapers/social-media-apis/facebook-marketplace-discover-by-keyword
- https://docs.brightdata.com/api-reference/scrapers/management-apis/get-scrapers

Essas páginas públicas não foram tratadas como confirmação dos valores ou da unidade específicos da conta. A prioridade é metadata explícita; a complementação exige confirmação administrativa quando faltar informação.
