> **Documento histórico da V1.1.** Preservado para referência; comandos, fluxos e evidências não homologam a versão de desenvolvimento atual. Consulte [os guias atuais](../README.md) e a [matriz de implementação](implementation-status.md) antes de operar.

# Motor de preços v0.1

O preço de revenda é uma estimativa de **preços pedidos**, não uma previsão treinada em vendas. Não há prazo garantido para “venda rápida”.

1. Exige chave de produto com modelo, armazenamento quando aplicável e edição de PS5. Não assume variante ausente. Usados e seminovos podem ser compatíveis com penalidade; novo e usado são separados.
2. Exclui o próprio anúncio, o mesmo vendedor, fingerprints repetidos, moeda diferente de BRL, preço parcial, condição desconhecida/danificada e ofertas explicitamente indisponíveis.
3. Disponibilidade `unknown` pode contribuir como **preço anunciado** observado em até 7 dias, com penalidade de similaridade e redução do teto de confiança (até 30 pontos conforme participação). Não confirma disponibilidade. Na V1.1, o anúncio pode alertar quando passar pelos critérios de oportunidade, risco e recência; desconhecimento sozinho não bloqueia.
4. Observações ativas de até 30 dias; similaridade mínima 80. Região e diferença entre usado/seminovo reduzem similaridade.
5. MAD modificado > 3,5 exclui preço extremo. Com MAD=0 usa IQR; sem dispersão usa faixa de 0,65–1,5 da mediana. Mantém trilha dos comparáveis excluídos.
6. Reporta média aritmética, mediana, P5, P25 e P75. Menos de 5 comparáveis não gera venda rápida/compra máxima.
7. Venda rápida = P25 × 0,97 × calibração. Esse desconto de 3% é **hipótese conservadora explícita**, não taxa aprendida. Calibração usa a mediana de preço vendido/estimado a partir de 5 vendas registradas da mesma variante e domínio demo/real; fator limitado a 0,8–1,05.
8. Compra máxima = (venda rápida × (1 − comissão) − custos fixos) / (1 + ROI mínimo). Compra excepcional aplica também limite abaixo de P5.

## Lucro

Lucro bruto = venda − compra. Custos = transporte + manutenção + limpeza + embalagem + outros + comissão sobre venda. Lucro líquido = lucro bruto − custos. Valores arredondados em centavos na fronteira financeira; a interface arredonda a reais e não promete precisão estatística.

ROI sobre compra = lucro líquido / compra. ROI sobre capital = lucro líquido / (compra + custos). A interface mostra os dois no detalhe; o monitor usa ROI sobre compra, conforme os exemplos do pedido.

## Limitações

O pool interativo usa até 1.000 observações recentes por usuário; a identidade/deduplicação consulta o banco independentemente desse teto. A busca textual alcança todo o histórico, com retorno limitado a 200. Antes de escalar, consultar e paginar comparáveis por produto, considerar região/tempo e custos específicos da plataforma de revenda. RAM, tamanhos e acessórios ainda não são atributos obrigatórios de todas as famílias; evitar operar essas variantes sem ampliar o normalizador.

Fundamentação: [NIST — MAD](https://www.itl.nist.gov/div898/software/dataplot/refman2/auxillar/mad.htm), [NIST — medidas de escala](https://www.itl.nist.gov/div898/handbook/eda/section3/eda356.htm).
