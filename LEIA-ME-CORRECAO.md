# Market Radar: correção da busca manual

**Pacote de atualização para a source `market-radar-saas-dev.zip`, versão 2.0.0-dev.1, entregue nesta conversa.**
Este ZIP contém apenas arquivos modificados e novos. Não é a source completa nem deve ser aplicado sobre a V1.1 antiga do GitHub.

## Aplicar e testar no Windows

1. Pare os dois terminais antigos (`npm run dev` e `npm run worker`) com **Ctrl+C**. Faça uma cópia de segurança dos arquivos que vai substituir.
2. Extraia este ZIP. Copie **todo o seu conteúdo**, incluindo `package.json` e as pastas `components`, `core`, `providers`, `scripts`, `server`, `tests` e `docs`, para a pasta da sua source, onde já existe o `package.json`. Aceite substituir os arquivos de mesmo nome. Não coloque a pasta da correção dentro da source: mescle o conteúdo na raiz.
3. Na mesma pasta, execute:

```bat
npm run dev
```

4. Mantenha essa janela aberta. O comando agora inicia o servidor e, depois de a API ficar pronta, inicia o worker na mesma janela. Abra o endereço exibido, normalmente:

```text
http://127.0.0.1:5173
```

5. Entre em **Minhas buscas → Buscar agora → Confirmar solicitação** uma única vez. Uma busca real pode consumir créditos da Bright Data. Mantenha `PILOT_MODE=true` para o teste manual e não aumente os limites de custo para corrigir um erro.

**Não precisa executar `npm install`, reinstalar dependências ou executar migrations para aplicar esta correção em sua instalação já funcionando da versão 2.0.0-dev.1.** Não foram adicionadas dependências nem migrations.

## O que deve acontecer

No terminal, `worker_started` confirma que o worker iniciou. Depois da solicitação, os eventos `worker_job` mostram o identificador da execução e, quando recebido, o snapshot. Uma coleta assíncrona pode passar por `waiting` antes de `done`; aguarde a conclusão sem clicar várias vezes.

Na tela, o processamento mostra a próxima consulta do resultado mesmo com o piloto manual ativo. Os anúncios válidos da primeira execução aparecem em **Resultados → Busca inicial**, sem alertas falsos de novidade. O fornecedor pode retornar zero anúncios, dados rejeitados ou somente links sem detalhes; essas situações não são convertidas em produtos fictícios.

Falhas passam a mostrar orientação na própria busca. Para a conta administrativa, **Motivo técnico desta tentativa** mostra a mensagem sanitizada e a etapa. O terminal também registra `worker_job_error`, em vez de esconder o erro dentro de um HTTP 200.

## Dados e configuração preservados

- Este pacote NÃO contém `.dev.vars`, `.env`, chaves, banco, `node_modules`, caches ou builds.
- NÃO apague a pasta `.wrangler`, o banco ou seu `.dev.vars`.
- Nenhuma migration, limpeza, redefinição de orçamento ou ativação da fonte é feita ao iniciar.
- A busca já cadastrada não precisa ser apagada ou recriada por causa da falha de cidade corrigida.
- As tentativas antigas permanecem no histórico. A próxima tentativa manual gera seu próprio registro.
- Se houve disparo sem confirmação, o bloqueio contra consumo duplicado continua. Não contorne esse aviso.

Seu `WORKER_TOKEN` precisa continuar configurado como já estava no teste anterior. Se estiver ausente, o comando mostra a instrução para `npm run local:init` e reinício; não imprime o token. Fonte, autorização de uso, chave e contrato continuam sendo configurações administrativas, não ativadas por este pacote.

Se o contrato tiver expirado ou a fonte precisar de validação, use **Administração → Validar configuração, sem coleta** antes de solicitar a busca. Mudanças reais no contrato continuam exigindo revisão dos filtros; a correção não apaga filtros nem troca fingerprints silenciosamente.

## Dois terminais, quando necessário

O modo anterior continua disponível:

```bat
npm run dev:server
```

Em outro terminal na mesma pasta:

```bat
npm run worker
```

Também é possível usar `LOCAL_WORKER_AUTOSTART=false` na configuração local. Não execute o worker separado quando o início conjunto já estiver gerenciando um.

O início conjunto usa apenas loopback e a porta de `RADAR_API_URL`, sem modificar o arquivo. Ao configurar `localhost`, usa internamente `127.0.0.1` para evitar que servidor e worker resolvam famílias de IP diferentes. Uma porta ocupada é recusada, sem matar outro processo ou escolher outra porta silenciosamente.

## Validação e limites

Foram executados **158 testes: 158 passaram, zero falhas e zero ignorados**. TypeScript, ESLint e compilação do bundle de componentes passaram. A falha da cidade foi reproduzida antes da mudança e o mesmo fluxo passou depois, com banco isolado e transporte simulado.

O início conjunto foi exercitado com processos locais, um servidor HTTP de teste e o worker real. A API/motor também foram exercitados até a gravação e a leitura do anúncio pelo feed. Isso não equivale a coleta paga real nem a validação completa no seu Windows.

O build completo Vinext ficou bloqueado no ambiente Linux pela dependência nativa ausente `@rolldown/binding-linux-x64-gnu`; a consulta ao registro npm falhou por resolução de nome. A correção não remove o lockfile nem mexe nas dependências que já abriam o painel no seu Windows. Não foi declarada homologação de produção ou teste visual em navegador nesta entrega.

Detalhes: `docs/hotfix-manual-search.md`. Lista e hashes: `docs/hotfix-manual-search-manifest.json`.
