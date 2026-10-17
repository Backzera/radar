# Scraper do Market Radar (brique) — VPS Windows

Este pacote instala o **scraper** (o "braço" que abre o Facebook e lê os anúncios)
na mesma VPS onde o app já roda. O app (parte Node) continua como está; aqui só
entra o serviço Python que ele chama pelo `SCRAPER_URL`.

```
app (C:\brique, Node, porta 3010) ──SCRAPER_URL──> scraper (C:\brique\scraper, Python, porta 8000) ──> Facebook
```

## Instalar (um comando)

1. Copie `brique-scraper-windows.zip` para a VPS e extraia em **`C:\brique\scraper`**
   (ao lado da pasta `C:\brique` do app). A pasta final deve ter o `app.py` e o
   `instalar-scraper.ps1` dentro.
2. Abra o **PowerShell como Administrador** e rode:

   ```powershell
   powershell -ExecutionPolicy Bypass -File C:\brique\scraper\instalar-scraper.ps1
   ```

O instalador, sozinho:
1. Baixa o **Python** portátil para `C:\brique\scraper\python` (não mexe em outro Python).
2. Instala as dependências e o **navegador headless**.
3. Registra a tarefa **Market Radar Scraper (brique)**, que sobe o scraper (porta 8000)
   junto com o Windows e o religa se cair.
4. Grava `SCRAPER_URL=http://127.0.0.1:8000` no `.env` do app e **religa o app**.

## Cookies do Facebook (a "comida" do scraper)

O scraper usa a sessão de uma conta do Facebook (a conta operadora). Coloque o
arquivo **`fb_cookies.json`** dentro de `C:\brique\scraper`. Duas formas:

- **Copiar do seu computador**: pegue o `fb_cookies.json` que já funciona na sua
  máquina (pasta `scraping-service`) e cole em `C:\brique\scraper`.
- **Gerar na VPS** (com tela, via Área de Trabalho Remota):

  ```powershell
  C:\brique\scraper\python\python.exe C:\brique\scraper\salvar_cookies.py
  ```

  Abre o navegador; faça login no Facebook e abra o Marketplace. Ele salva o
  `fb_cookies.json` sozinho.

Depois de colocar os cookies, reinicie a tarefa (parar e iniciar):

```powershell
Stop-ScheduledTask  -TaskName "Market Radar Scraper (brique)"
Start-ScheduledTask -TaskName "Market Radar Scraper (brique)"
```

## Habilitar a fonte no site

Com o scraper no ar e os cookies no lugar: entre no site como **administrador** →
**Radar → Administração → Validar configuração**. Depois crie um radar e use
**Buscar agora**.

## Comandos úteis

```powershell
# Estado e log do scraper
Get-ScheduledTask -TaskName "Market Radar Scraper (brique)"
Get-Content C:\brique\scraper\logs\scraper.log -Tail 40 -Wait

# Parar / iniciar
Stop-ScheduledTask  -TaskName "Market Radar Scraper (brique)"
Start-ScheduledTask -TaskName "Market Radar Scraper (brique)"

# Testar direto
Invoke-WebRequest http://127.0.0.1:8000/health
```

## Observações

- Os cookies expiram de tempos em tempos; quando o radar parar de coletar, gere/
  copie um `fb_cookies.json` novo e reinicie a tarefa.
- O scraper só precisa rodar na VPS; o usuário final **nunca** loga no Facebook.
- Se algo falhar na instalação, copie as mensagens do PowerShell e o fim do
  `logs\scraper.log` e me envie.
