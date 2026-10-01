# Benchmark local 2.0 RC1

| Cenário | Anúncios na base | Cards | JSON (bytes) | Primeira montagem (ms) | Cache (ms) |
|---|---:|---:|---:|---:|---:|
| mixed | 50 | 10 | 34007 | 24 | 1 |
| same | 50 | 50 | 170416 | 31 | 3 |
| unique | 50 | 50 | 171323 | 40 | 5 |
| mixed | 500 | 50 | 170177 | 157 | 4 |
| same | 500 | 50 | 171262 | 217 | 10 |
| unique | 500 | 50 | 172141 | 539 | 9 |
| mixed | 5000 | 50 | 170578 | 1335 | 24 |
| same | 5000 | 50 | 171618 | 2281 | 73 |
| unique | 5000 | 50 | 167172 | 25446 | 81 |

Dados sintéticos. Mesmo modelo, modelos mistos e preços únicos. Nenhum comparável completo no JSON do feed. Primeira reconstrução e cache medidos separadamente. 5.000 preços únicos ainda exigem cerca de 25,4 segundos na primeira montagem; não homologado para alto volume em produção.
