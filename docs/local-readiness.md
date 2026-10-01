> **Documento histórico da V1.1.** Preservado para referência; comandos, fluxos e evidências não homologam a versão de desenvolvimento atual. Consulte [os guias atuais](../README.md) e a [matriz de implementação](implementation-status.md) antes de operar.

> Histórico da preparação anterior. Para o estado atual de operação real, veja [real-operation.md](real-operation.md) e [validation.md](validation.md). A primeira coleta real já foi concluída; demo foi removido da operação.

# Preparação local para o primeiro teste autenticado

Trabalho realizado na base existente V1.1, na pasta que contém `package.json`. Node 24.21.0 (mínimo 22.13.0), npm 11.19.0. As dependências foram reinstaladas com `npm ci`, sem alterar versões. O antigo wrapper local de npm foi retirado da pasta para usar o npm instalado no sistema.

| Verificação           | Resultado                                                                             |
| --------------------- | ------------------------------------------------------------------------------------- |
| local:init            | OK; token existente preservado, sem exibição                                          |
| Build                 | OK; warnings conhecidos descritos em validation.md                                    |
| Migrations            | 4/4 aplicadas; 0002 adiciona snapshot e 0003 candidatos URL-only; anteriores intactas |
| Banco                 | SQLite local íntegro; histórico preservado                                            |
| Testes / tipos / lint | 94 testes; todos aprovados                                                            |
| API / frontend / SSE  | HTTP 200 em http://localhost:5173                                                     |
| Worker                | Iniciou e executou ticks autenticados; sem loop de erro                               |
| Pilot Mode            | Ativo; até 5 disparos/dia e 10 resultados/disparo                                     |
| Alertas externos      | Desligados                                                                            |
| Secret check          | Build, arquivos rastreados e índice Git sem valores secretos configurados             |
| Doctor                | OK; API Key e direitos configurados; metadata autenticada HTTP200                     |
| Facebook real         | Aguardando primeira coleta manual; zero coletas pagas                                 |

Os testes locais usaram o banco existente e fixtures isoladas. A navegação em desktop/celular foi conferida com um navegador de teste; validação sem chave não fez coleta e o contador permaneceu em 0/5. O conjunto completo de evidências e limitações está em [validation.md](validation.md).

## Configuração para uma instalação nova

A credencial local e a metadata já foram validadas nesta máquina; os passos de conta/configuração abaixo são para novos ambientes. No estado atual, falta somente a coleta manual, sem date_listed por enquanto. Veja [contrato autenticado](brightdata-authenticated-contract.md).

1. Criar/entrar na conta Bright Data e obter a API key.
2. Inserir a chave diretamente em `.dev.vars`, em `BRIGHTDATA_API_KEY`.
3. Revisar termos/licenças e confirmar `FACEBOOK_DATA_RIGHTS_CONFIRMED=true` somente se aplicável.
4. Iniciar ou reiniciar servidor e worker com a configuração nova.
5. OPERAÇÃO → Facebook Marketplace → Validar configuração · sem coleta → Testar iPhone 15, Cidade Curitiba, Raio 40 e Recência Last 24 hours, com limite 5. Preencha conforme o contrato carregado. Se faltarem opções de recência, o select fica indisponível; confirme unidade do raio no painel quando não publicada pela metadata.
6. Para monitor por URL, copiar a página de resultados do Marketplace com produto, cidade, raio e ordenação desejados.

Servidor, em um terminal: `npm run dev`. Worker, em outro: `npm run worker`. Diagnóstico opcional: `npm run doctor`. Use a porta impressa pelo servidor; se mudar, atualize `RADAR_API_URL` e reinicie. Preparação e comandos completos: [guia de teste real](live-facebook-test.md).

Espera-se receber **até cinco anúncios válidos** em Radar → Somente anúncios reais, com origem, publicação, primeiro visto, delay quando confiável e link original. O resultado depende do fornecedor. A primeira consulta de monitor é baseline sem alerta urgente; as próximas podem identificar IDs novos. Não há confirmação de cobertura, localização precisa ou recência até conferir os resultados reais.

Esta preparação é local. Não foram configurados secrets hospedados, serviço 24/7 ou novas coletas no Site privado. A [próxima fase](production-worker.md) começa depois de comprovar a fonte com registros reais.
