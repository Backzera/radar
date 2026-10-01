# Roteiro de validação visual e com iniciantes

**Não executado neste ambiente.** Chromium recusou a URL local com `net::ERR_BLOCKED_BY_ADMINISTRATOR`. Não há capturas aprovadas nem medição de uso com pessoas. A renderização estática e o bundle de integração são verificações diferentes.

## Preparação

Use instalação validada em ambiente autorizado. Para tarefas que não devem custar créditos, execute o harness `npm run test:browser:prepare` e `npm run test:browser:serve`, que usa somente banco em memória e bloqueia transportes externos. Os dados de teste são identificados e não entram na operação real.

Abra a versão desktop e largura de 360 px. Verifique zoom de 200%, teclado sem mouse, foco visível, leitura de rótulos/erros, retorno do foco ao fechar diálogo, contraste e movimento reduzido. Registre navegador, versão, viewport e limitações da ferramenta de acessibilidade utilizada.

## Fluxos funcionais de navegador

1. Entrar sem sessão: acesso negado ou encaminhamento ao provedor configurado, sem fallback de identidade em produção.
2. Criar busca pessoal por Fifine A8, região e orçamento; voltar etapas; recarregar e recuperar o rascunho; confirmar o resumo; clicar duas vezes sem criar duas buscas.
3. Configurar revenda com preço manual, custos e lucro. Conferir teto da prévia com resposta do servidor e indicação de estimativa informada pelo usuário.
4. Editar busca com coordenadas e limites legados; salvar sem mudanças; verificar que os campos não exibidos foram preservados. Abrir a mesma busca em duas abas e comprovar conflito de versão, sem sobrescrita.
5. Pesquisar histórico por termos com %, _, barra e acento; mudar ordenação/página; testar voltar/avançar e URL direta de anúncio.
6. Abrir detalhes e comparáveis por páginas. Salvar, descartar com motivo, reabrir, registrar compra e venda; verificar persistência após recarga.
7. Conferir estados de baseline, novidade, queda de preço, sem dados, cota esgotada e fonte indisponível. Nenhum número ou data deve ser inventado.
8. Simular entrega pendente, enviada, falha e incerta no harness. Conexão Telegram real permanece uma homologação externa separada, com autorização.
9. Testar duas contas com IDs diferentes e links diretos cruzados; confirmar que a UI não apresenta dados da outra nem administração. Cancelar acesso de uma conta sintética e observar pausa/avisos desabilitados, sem excluir a outra.
10. Inspecionar console e rede: nenhuma credencial, erro não tratado ou payload com todos os comparáveis na página inicial. Registrar capturas dos estados, não só do caminho feliz.

## Teste com cinco iniciantes

Recrute cinco participantes que não conheçam o projeto. Use roteiro neutro, sem ensinar os botões. Consentimento e gravação, quando usados, devem ser combinados diretamente com cada pessoa.

Tarefa A: “Você procura um microfone usado e sabe quanto aceita pagar. Configure uma busca para sua região e me diga quando receberia avisos.”

Tarefa B: “Você pretende comprar para revender. Ajuste os custos, interprete um resultado e explique a diferença entre preço anunciado, hipótese de revenda e lucro estimado.”

Tarefa C: “A busca não encontrou uma oportunidade aprovada. Descubra o motivo e mostre qual mudança faria, sem executá-la se envolver consumo.”

Registre tempo de configuração, necessidade de ajuda, erros, abandono, compreensão do teto e da incerteza, interpretação de estado vazio e localização dos controles de pausa. Não revele a resposta durante a tarefa.

Metas propostas, ainda não medidas: primeira busca em até três minutos e ao menos quatro de cinco participantes concluindo sem ajuda. A amostra serve para descoberta de problemas, não para estimar toda a população de clientes.

Após observar dificuldades, classifique os problemas, implemente correções e repita o roteiro. Não marque usabilidade como aprovada porque testes automatizados passaram.
