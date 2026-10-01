# Market Radar 2.0 RC1: atualizar a instalação que já está funcionando

Esta atualização é para a source SaaS `2.0.0-dev.1` com a correção de busca que iniciou servidor e worker pelo mesmo `npm run dev`. Ela não é uma atualização direta da antiga V1.1 no GitHub.

## Instalação existente no Windows

1. Pare o `npm run dev` e qualquer `npm run worker` com Ctrl+C. Não mantenha duas instâncias abertas. Faça uma cópia de segurança da pasta atual antes de substituir arquivos.
2. Extraia `market-radar-2.0-atualizacao.zip`. Copie **o conteúdo interno** para a pasta onde está o `package.json` da sua source. Mescle as pastas e aceite substituir os arquivos. Não coloque uma nova subpasta entre os arquivos e o package.json existente.
3. Na mesma pasta, execute:

```bat
npm run dev
```

Não é necessário reinstalar dependências nesta atualização: a árvore de dependências não mudou. O requisito é Node.js 22.16 ou superior. O comando inicia o servidor e o worker juntos; mantenha a janela aberta. Use o endereço impresso no terminal, normalmente `http://127.0.0.1:5173`.

**Preserve `.dev.vars`, `.wrangler`, seus bancos, backups e credenciais.** O pacote não contém esses arquivos. Não execute reset, limpeza de demo nem apague seu banco para atualizar.

## Atualização do banco

Antes de iniciar o servidor, o comando identifica o banco local existente, confere os hashes de migrations anteriores e cria um backup SQLite consistente em `backups/radar-before-v2-....sqlite`, acompanhado do manifesto de integridade. Depois aplica somente a migration aditiva `0006_radar_experience.sql`, dentro de uma transação.

Se o SQL falhar, a transação é revertida. A cópia anterior continua disponível. Se houver dois bancos candidatos ou migrations históricas alteradas, o processo para sem escolher um banco arbitrariamente. Não ignore esse erro nem apague arquivos para forçar a atualização.

Também é possível executar só a atualização, com os servidores parados:

```bat
npm run local:upgrade
```

As migrations 0000 a 0005 não foram reescritas. Anúncios, compras, vendas e cotas existentes não são removidos. Os registros antigos e incompatíveis deixam de aparecer nas oportunidades, mas continuam acessíveis pelo histórico.

## Primeiro teste

Abra Oportunidades e clique em **Novo radar**. Informe produto, região, orçamento e preferências. Use **Ativar radar e buscar**. Esse clique salva e já coloca a primeira busca na fila, sem precisar ir a outra página e clicar em Buscar agora. Ela será executada se a fonte estiver validada, a coleta estiver habilitada e houver cota. A execução real pode consumir créditos da Bright Data.

Na fonte habilitada, a primeira execução funciona também com `PILOT_MODE=true`. Esse modo continua impedindo pesquisas periódicas automáticas posteriores. Para acompanhamento contínuo, o responsável deve habilitar `PILOT_MODE=false` conscientemente e revisar as cotas. Esta atualização não modifica esse arquivo por você. Com cinco buscas diárias, um único radar não tem cobertura a cada cinco minutos; a frequência exibida considera essa capacidade.

Radares que já existiam não são recriados nem recebem disparos pagos extras durante a instalação. Você pode continuar usando-os; o feed é reavaliado com as regras novas. Uma busca manual adicional no radar antigo mantém o botão de confirmação de consumo.

## Datas e produto

A seleção principal aceita publicações confirmadas de no máximo sete dias, ou 24 horas quando essa janela foi escolhida. Modelo, versão, condição, região verificável e orçamento também precisam corresponder. iPhone 14 não inclui automaticamente 13, 14 Plus, 14 Pro ou 14 Pro Max. Partes avulsas ficam fora da seleção de aparelhos completos.

Aliases são preparados pelo servidor. Você não precisa preencher uma lista de sinônimos. Não são disparadas todas as variações ao mesmo tempo.

O filtro nativo de data utiliza somente valores confirmados pelo contrato da fonte. Se sete dias não estiver entre as opções confirmadas e 24 horas estiver, o aplicativo usa 24 horas e avisa que a cobertura ficou mais curta. Se nenhum valor estiver confirmado, a verificação local continua, com aviso de que a fonte pode consumir registros antigos. Descartar após receber não desfaz uma cobrança da fonte.

Não há um geocodificador universal nesta entrega. O raio só é enviado quando o contrato confirma tipo e unidade compatíveis. Sem coordenadas confiáveis, a filtragem local é conservadora pela cidade, e não uma promessa de raio exato.

## Disponibilidade e custos extras

O botão **O anúncio não abre** retira o anúncio da sua seleção, sem afirmar que ele foi vendido. A conferência individual por URL tem fila, reaproveitamento de consultas recentes, limite próprio e a mesma proteção de orçamento geral. Ela permanece desativada por padrão para não aumentar seus gastos sem uma decisão administrativa.

Para uma futura validação consciente dessa funcionalidade, as opções administrativas são:

```env
AVAILABILITY_ENABLED=true
AUTO_VERIFY_OPPORTUNITIES=false
MAX_DAILY_AVAILABILITY_CHECKS=1
```

Não é necessário habilitar isso para usar o radar normal. Uma conferência não garante que o vendedor ainda tenha o produto quando você entrar em contato. Disponibilidade desconhecida permanece desconhecida.

## Segurança e homologação

O modo local de desenvolvimento não é um site público. Não exponha `npm run dev` à internet. A integração real com sua conta Bright Data, a autenticação pública, Telegram, D1 remoto e a interface no Windows ainda precisam ser conferidos no seu ambiente. Nenhuma credencial foi enviada ou usada nesta validação.

O build completo no ambiente de teste Linux não foi aprovado por falta do módulo nativo Rolldown para Linux. A compilação TypeScript e o bundle de teste dos componentes passaram, mas não substituem esse build. O navegador automatizado deste ambiente bloqueou a página local; não há alegação de validação visual concluída.

## Voltar à versão anterior

Pare os processos. Volte os arquivos da source a partir da cópia feita antes da atualização. Antes de restaurar dados, faça também uma cópia da situação atual: restaurar o backup anterior descarta alterações feitas depois dele.

A ferramenta de restauração exige um destino novo:

```bat
node scripts/backup.mjs restore "CAMINHO_DO_BACKUP.sqlite" "CAMINHO_DE_UMA_COPIA_NOVA.sqlite"
```

Ela verifica o manifesto e não sobrescreve banco existente. A troca do banco ativo deve ser feita com os processos parados e acompanhada do journal de migrations correspondente à versão restaurada. Não apague `.wrangler` inteira.
