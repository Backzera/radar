# Market Radar na VPS Windows — dz7.online/brique

Este pacote roda o app numa VPS Windows: um servidor Node.js com o banco num arquivo SQLite e as fotos numa pasta. O IIS ou o Caddy recebem o acesso de fora, e a Cloudflare fica na frente só para DNS e certificado SSL.

```
Visitante ──https──> Cloudflare ──> IIS ou Caddy (porta 80/443) ──> app (127.0.0.1:3010) ──> C:\brique\data
```

## O que tem no pacote

| Arquivo | Para que serve |
|---|---|
| `app\` | O app pronto (já compilado, com as dependências) |
| `instalar.ps1` | Instala: confere o Node, cria o `.env`, ajusta permissões e registra o app para iniciar com o Windows |
| `iniciar.ps1`, `parar.ps1` | Liga e desliga o app |
| `atualizar.ps1` | Troca para um pacote novo mantendo `.env` e `data\` |
| `backup.ps1` | Cópia do banco e das fotos (na hora ou todo dia às 3h) |
| `.env.example` | Modelo da configuração |
| `iis\web.config` | Regras para o IIS (opção A) |
| `caddy\Caddyfile` | Configuração do Caddy (opção B) |
| `iniciar-app.mjs`, `backup-banco.mjs`, `_comum.ps1` | Usados pelos scripts acima |

Tudo que o app grava fica em `C:\brique\data`: `brique.sqlite` (banco), `media\` (fotos), `backups\` e `logs\`.

## Requisitos da VPS

- Windows Server 2016 ou mais novo (2019, 2022 e 2025 são os mais comuns), com 1 GB de RAM livre.
- **Node.js 24 LTS**: em nodejs.org, baixe o *Windows Installer (.msi)* de 64 bits e instale com as opções padrão.
- Acesso como Administrador pela Área de Trabalho Remota.
- Portas 80 e 443 liberadas também no painel do provedor da VPS, se ele tiver firewall próprio.

Todos os comandos abaixo são no **PowerShell como Administrador** (menu Iniciar → digite PowerShell → botão direito → *Executar como administrador*).

## 1. Copiar e instalar

1. Copie `brique-windows.zip` para a Área de Trabalho da VPS (na Área de Trabalho Remota, Ctrl+C no seu computador e Ctrl+V na VPS funciona).
2. Extraia em `C:\brique`:

   ```powershell
   Unblock-File "$env:USERPROFILE\Desktop\brique-windows.zip"
   Expand-Archive "$env:USERPROFILE\Desktop\brique-windows.zip" C:\
   Rename-Item C:\brique-windows C:\brique
   ```

3. Rode o instalador:

   ```powershell
   cd C:\brique
   powershell -ExecutionPolicy Bypass -File .\instalar.ps1
   ```

   Na primeira vez ele cria o `.env` e abre no Bloco de Notas. Coloque **o seu e-mail** em `RADAR_ADMIN_EMAILS`, salve e rode o mesmo comando de novo.

O instalador confere o Node.js, fecha as permissões das pastas, registra a tarefa **Market Radar (brique)** (sobe sozinha quando o Windows liga, como *SERVIÇO LOCAL*, uma conta sem poderes de administrador) e espera o app responder em `http://127.0.0.1:3010/brique`.

## 2. Publicar na porta 80: IIS ou Caddy

Veja quem já usa a porta 80:

```powershell
Get-NetTCPConnection -LocalPort 80 -State Listen -ErrorAction SilentlyContinue | ForEach-Object { (Get-Process -Id $_.OwningProcess).ProcessName }
```

- **Não apareceu nada**: a porta está livre. Use o **Caddy** (opção B), que é mais simples.
- **Apareceu `System`**: é o IIS. Use a **opção A**.
- **Apareceu outro programa**: outro servidor já atende o domínio; ele precisa repassar `/brique` para `http://127.0.0.1:3010`.

### Opção A: IIS

1. Instale os dois módulos da Microsoft (instaladores .msi, opções padrão):
   - **URL Rewrite 2.1**: iis.net/downloads/microsoft/url-rewrite
   - **Application Request Routing 3.0**: iis.net/downloads/microsoft/application-request-routing
2. Ligue o proxy do ARR (uma vez por servidor):

   ```powershell
   & "$env:windir\system32\inetsrv\appcmd.exe" set config -section:system.webServer/proxy /enabled:"True" /preserveHostHeader:"True" /commit:apphost
   ```

3. Aponte o site:
   - **O dz7.online ainda não existe no IIS**: crie o site usando a pasta `C:\brique\iis`, que só tem o `web.config` com as regras:

     ```powershell
     Import-Module WebAdministration
     New-Website -Name "dz7.online" -PhysicalPath C:\brique\iis -Port 80 -HostHeader "dz7.online"
     New-WebBinding -Name "dz7.online" -Port 80 -HostHeader "www.dz7.online"
     ```

   - **O dz7.online já é um site no IIS**: abra o `web.config` da pasta desse site e copie para ele as duas regras `<rule>` e o bloco `<location>` de `C:\brique\iis\web.config`. Se a raiz do domínio já mostra outro site, não copie a regra *Raiz para o Market Radar*.

4. Teste na própria VPS (deve responder `{"status":"ready"}`):

   ```powershell
   curl.exe -s -H "Host: dz7.online" http://127.0.0.1/brique/api/v1/health/ready
   ```

### Opção B: Caddy

1. Baixe o Caddy para Windows (amd64) em caddyserver.com/download e salve o `caddy.exe` em `C:\caddy\`.
2. Copie a configuração e confira:

   ```powershell
   Copy-Item C:\brique\caddy\Caddyfile C:\caddy\Caddyfile
   C:\caddy\caddy.exe validate --config C:\caddy\Caddyfile
   ```

3. Registre o Caddy como serviço do Windows e libere as portas no firewall:

   ```powershell
   sc.exe create caddy start= auto binPath= "C:\caddy\caddy.exe run --config C:\caddy\Caddyfile"
   sc.exe start caddy
   New-NetFirewallRule -DisplayName "Caddy (HTTP/HTTPS)" -Direction Inbound -Protocol TCP -LocalPort 80,443 -Action Allow
   ```

4. Teste na própria VPS:

   ```powershell
   curl.exe -s -H "Host: dz7.online" http://127.0.0.1/brique/api/v1/health/ready
   ```

Depois de mudar o `C:\caddy\Caddyfile`: `Restart-Service caddy`.

## 3. Cloudflare

1. **DNS**: registro `A` com nome `dz7.online` (ou `@`) apontando para o IP da VPS, com a **nuvem laranja (Proxied)** ligada. Para o `www`, um `CNAME` `www` → `dz7.online`, também com a nuvem laranja.
2. **SSL/TLS**, escolha um modo:
   - **Flexible**: funciona na hora com a configuração acima (porta 80). A Cloudflare faz o https com o visitante. O modo vale para o domínio inteiro: se outro site no dz7.online já usa *Full*, prefira o Full (strict) abaixo.
   - **Full (strict)**, recomendado: o caminho entre a Cloudflare e a VPS também fica criptografado.
     1. Em *SSL/TLS → Origin Server → Create Certificate*, gere o certificado (RSA, 15 anos) para `dz7.online` e `*.dz7.online`.
     2. No Bloco de Notas, salve o *Origin Certificate* como `dz7.online.pem` e a *Private Key* como `dz7.online.key` (em *Tipo*, escolha *Todos os arquivos*).
     3. **Caddy**: salve os dois em `C:\caddy\certs\`, descomente o último bloco do `C:\caddy\Caddyfile` e rode `Restart-Service caddy`.
     4. **IIS**: salve os dois em `C:\certs\`, junte num `.pfx` e importe (o `certutil` pede uma senha para o `.pfx`; o `Read-Host` pede a mesma):

        ```powershell
        cd C:\certs
        certutil -MergePFX dz7.online.pem dz7.online.pfx
        Import-PfxCertificate -FilePath C:\certs\dz7.online.pfx -CertStoreLocation Cert:\LocalMachine\My -Password (Read-Host -AsSecureString "Senha do PFX")
        ```

        No Gerenciador do IIS, no site **dz7.online** → *Ligações* → *Adicionar*: tipo `https`, porta 443, nome do host `dz7.online`, marque *Exigir SNI* e escolha o certificado da Cloudflare. Repita para `www.dz7.online`. Depois apague a pasta `C:\certs` (o certificado já está guardado no Windows).
     5. Só então mude o modo da Cloudflare para **Full (strict)**.
3. Em *SSL/TLS → Edge Certificates*, ligue **Always Use HTTPS**.

## 4. Primeiro acesso

1. Abra `https://dz7.online/brique/cadastro` e crie sua conta **com o mesmo e-mail** que está em `RADAR_ADMIN_EMAILS`.
2. Você entra como administrador: o menu mostra **Usuários**.
3. Se quiser que só você crie contas (vendendo o acesso por fora), em *Usuários* desligue **Cadastro pelo site**.

## Atualizar para uma versão nova

No computador, gere o pacote novo (`npm run vps:build`) e copie o `brique-windows.zip` para a Área de Trabalho da VPS. Na VPS:

```powershell
Unblock-File "$env:USERPROFILE\Desktop\brique-windows.zip"
cd C:\brique
powershell -ExecutionPolicy Bypass -File .\atualizar.ps1 -Pacote "$env:USERPROFILE\Desktop\brique-windows.zip"
```

O script faz um backup do banco, para o app, troca `app\` e os scripts, e liga de novo. O `.env` e a pasta `data\` não são tocados. Se a versão nova tiver mudanças no banco, o app faz outra cópia em `data\backups\` antes de aplicá-las.

## Backup

```powershell
cd C:\brique
powershell -ExecutionPolicy Bypass -File .\backup.ps1            # agora
powershell -ExecutionPolicy Bypass -File .\backup.ps1 -Agendar   # todo dia às 3h
```

Os backups ficam em `C:\brique\data\backups` por 14 dias. Copie-os também para fora da VPS de vez em quando.

**Restaurar**: rode `.\parar.ps1`, apague `data\brique.sqlite-wal` e `data\brique.sqlite-shm` (se existirem), copie o backup escolhido por cima de `data\brique.sqlite` (e, se precisar das fotos, `Expand-Archive data\backups\fotos-<data>.zip data\media -Force`), depois `.\iniciar.ps1`.

## Comandos úteis

```powershell
cd C:\brique
powershell -ExecutionPolicy Bypass -File .\iniciar.ps1     # ligar
powershell -ExecutionPolicy Bypass -File .\parar.ps1       # desligar (volta no próximo reinício do Windows)
Get-ScheduledTask "Market Radar (brique)" | Get-ScheduledTaskInfo                                       # situação da tarefa
Get-ChildItem C:\brique\data\logs\*.log | Sort-Object LastWriteTime | Select-Object -Last 1 | Get-Content -Tail 50 -Wait   # log ao vivo
```

Para remover de vez: `.\parar.ps1` e depois `Unregister-ScheduledTask "Market Radar (brique)" -Confirm:$false`.

## Problemas comuns

| Sintoma | Causa provável |
|---|---|
| `instalar.ps1` diz que o Node não foi encontrado logo depois de instalar | O PATH só atualiza em janelas novas: feche e abra o PowerShell |
| "A execução de scripts foi desabilitada neste sistema" | Rode com `powershell -ExecutionPolicy Bypass -File .\script.ps1`, como nos exemplos |
| O app não respondeu em 60 segundos | O instalador mostra o fim do log. Com `EADDRINUSE`, outro programa usa a porta 3010: mude `PORT` no `.env` e no `web.config`/`Caddyfile` |
| 502 Bad Gateway | App parado: `.\iniciar.ps1` e veja o log em `data\logs` |
| IIS mostra erro 500.19 | Falta o módulo URL Rewrite |
| IIS mostra 404 em `/brique` | Proxy do ARR desligado (passo 2 da opção A) ou regras no site errado |
| Erro 521 na Cloudflare | Nada respondendo na porta 80 da VPS: IIS/Caddy parado ou porta fechada no firewall do Windows ou do provedor |
| Erro 525/526 na Cloudflare | Modo **Full (strict)** sem o Certificado de Origem instalado. Volte para Flexible ou instale o certificado |
| "Origem da requisição inválida" ao entrar ou salvar | `APP_ORIGIN` no `.env` diferente do endereço usado no navegador (precisa ser `https://dz7.online`, sem barra no final). Depois de mudar o `.env`, rode `.\iniciar.ps1` |
| Mudou o `BASE_PATH` e quebrou | O prefixo é definido no build: gere o pacote de novo com `npm run vps:build -- --base /novo` |

## Segurança

- O app só escuta em `127.0.0.1` e roda como *SERVIÇO LOCAL*: não tem poderes de administrador e só grava em `data\`.
- O `.env` e a pasta `data\` (banco e fotos) só podem ser lidos pelos administradores, pelo sistema e pelo próprio app.
- Deixe abertas para fora só as portas 80 e 443, além da Área de Trabalho Remota (3389). Se o painel do provedor permitir, libere a 3389 só para o seu IP.
- Opcional: aceitar nas portas 80/443 só os IPs da Cloudflare (lista em cloudflare.com/ips), para ninguém contornar o proxy.
- Mantenha o Windows Update ligado. O `.env` e a pasta `data\` ficam só na VPS: não os envie para repositórios.
