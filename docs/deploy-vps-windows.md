# Market Radar na VPS Windows — dz7.online/brique

Este pacote roda o app numa VPS Windows: um servidor Node.js com o banco num arquivo SQLite e as fotos numa pasta. O IIS recebe o acesso de fora e a Cloudflare fica na frente com o DNS e o https.

```
Visitante ──https──> Cloudflare ──> IIS (porta 443/80, aplicação /brique) ──> app (127.0.0.1:3010) ──> C:\brique\data
```

## Instalar (um comando)

1. Copie `brique-windows.zip` para a Área de Trabalho da VPS (na Área de Trabalho Remota, Ctrl+C no seu computador e Ctrl+V na VPS).
2. Abra o **PowerShell como Administrador** (menu Iniciar → PowerShell → botão direito → *Executar como administrador*) e rode, trocando o e-mail pelo seu:

   ```powershell
   Unblock-File "$env:USERPROFILE\Desktop\brique-windows.zip"
   Expand-Archive "$env:USERPROFILE\Desktop\brique-windows.zip" C:\
   Rename-Item C:\brique-windows C:\brique
   powershell -ExecutionPolicy Bypass -File C:\brique\instalar.ps1 -Email voce@email.com
   ```

O instalador faz tudo sozinho e mostra cada passo:

1. Confere a VPS.
2. Baixa o **Node.js 24** portátil para `C:\brique\node` (não mexe em outro Node que já exista na VPS).
3. Cria o `C:\brique\.env` com o seu e-mail como administrador.
4. Registra a tarefa **Market Radar (brique)**, que liga o app junto com o Windows como *SERVIÇO LOCAL* (uma conta sem poderes de administrador) e o religa se ele cair.
5. Configura o **IIS** (`configurar-iis.ps1`):
   - instala o IIS, o URL Rewrite e o ARR, se faltarem, e liga o proxy do IIS;
   - **se o dz7.online já é um site no IIS** (outro sistema na raiz do domínio), só acrescenta a aplicação `/brique` dentro dele, com regras próprias. O site e as regras dele continuam como estão, e reinstalar o outro sistema não apaga o `/brique`;
   - **se ainda não é**, cria o site *Market Radar* para `dz7.online` e `www.dz7.online` nas portas 80 e 443 (com certificado próprio, aceito pelo modo *Full* da Cloudflare), e a raiz do domínio leva para `/brique`;
   - testa o caminho completo pelo IIS e diz se deu certo.

Pode rodar o mesmo comando de novo a qualquer momento: ele não apaga dados nem duplica configurações.

## Cloudflare

1. **DNS**: registro `A` com nome `dz7.online` (ou `@`) apontando para o IP da VPS, com a **nuvem laranja (Proxied)** ligada. Para o `www`, um `CNAME` `www` → `dz7.online`, também com a nuvem laranja.
2. **SSL/TLS**: modo **Full**. Ele usa o certificado que o instalador criou na VPS. (*Flexible* também funciona, pela porta 80.) O modo vale para o domínio inteiro.
3. Em *SSL/TLS → Edge Certificates*, ligue **Always Use HTTPS**.

**Firewall**: a Cloudflare precisa chegar nas portas 80/443 da VPS. Se a VPS já tem outro site atrás da Cloudflare, isso já está feito. Senão, o instalador avisa; libere com:

```powershell
New-NetFirewallRule -DisplayName "Market Radar - HTTP/HTTPS" -Direction Inbound -Protocol TCP -LocalPort 80,443 -Action Allow
```

Se o provedor da VPS tiver firewall próprio no painel, libere as mesmas portas lá.

## Primeiro acesso

1. Abra `https://dz7.online/brique/cadastro` e crie sua conta **com o mesmo e-mail** usado no `-Email`.
2. Você entra como administrador: o menu mostra **Usuários**.
3. Se quiser que só você crie contas (vendendo o acesso por fora), em *Usuários* desligue **Cadastro pelo site**.
4. Reinicie a VPS uma vez e confira se o site volta sozinho.

## Atualizar para uma versão nova

No computador, gere o pacote novo (`npm run vps:build`) e copie o `brique-windows.zip` para a Área de Trabalho da VPS. Na VPS:

```powershell
Unblock-File "$env:USERPROFILE\Desktop\brique-windows.zip"
powershell -ExecutionPolicy Bypass -File C:\brique\atualizar.ps1 -Pacote "$env:USERPROFILE\Desktop\brique-windows.zip"
```

O script faz um backup do banco, para o app, troca `app\` e os scripts, e liga de novo. O `.env`, o Node e a pasta `data\` não são tocados. Se a versão nova tiver mudanças no banco, o app faz outra cópia em `data\backups\` antes de aplicá-las.

## Backup

```powershell
powershell -ExecutionPolicy Bypass -File C:\brique\backup.ps1            # agora
powershell -ExecutionPolicy Bypass -File C:\brique\backup.ps1 -Agendar   # todo dia às 3h
```

Os backups ficam em `C:\brique\data\backups` por 14 dias. Copie-os também para fora da VPS de vez em quando.

**Restaurar**: rode `parar.ps1`, apague `data\brique.sqlite-wal` e `data\brique.sqlite-shm` (se existirem), copie o backup escolhido por cima de `data\brique.sqlite` (e, se precisar das fotos, `Expand-Archive data\backups\fotos-<data>.zip data\media -Force`), depois `iniciar.ps1`.

## Comandos úteis

```powershell
powershell -ExecutionPolicy Bypass -File C:\brique\iniciar.ps1         # ligar
powershell -ExecutionPolicy Bypass -File C:\brique\parar.ps1           # desligar (volta no próximo reinício do Windows)
powershell -ExecutionPolicy Bypass -File C:\brique\configurar-iis.ps1  # refazer só a parte do IIS
Get-ScheduledTask "Market Radar (brique)" | Get-ScheduledTaskInfo                                                          # situação da tarefa
Get-ChildItem C:\brique\data\logs\*.log | Sort-Object LastWriteTime | Select-Object -Last 1 | Get-Content -Tail 50 -Wait   # log ao vivo
```

Para remover de vez: `parar.ps1`, depois `Unregister-ScheduledTask "Market Radar (brique)" -Confirm:$false` e, no Gerenciador do IIS, remova a aplicação `brique` (e o site *Market Radar*, se foi criado).

## O que tem no pacote

| Arquivo | Para que serve |
|---|---|
| `app\` | O app pronto (já compilado, com as dependências) |
| `instalar.ps1` | Instala ou reinstala tudo (Node, `.env`, tarefa do Windows e IIS) |
| `configurar-iis.ps1` | Só a parte do IIS (o instalador já roda) |
| `iniciar.ps1`, `parar.ps1` | Liga e desliga o app |
| `atualizar.ps1` | Troca para um pacote novo mantendo `.env` e `data\` |
| `backup.ps1` | Cópia do banco e das fotos (na hora ou todo dia às 3h) |
| `.env.example` | Modelo da configuração |
| `iis\app`, `iis\raiz` | `web.config` da aplicação `/brique` e da raiz do site (se o instalador criar o site) |
| `caddy\Caddyfile` | Alternativa ao IIS (veja abaixo) |
| `iniciar-app.mjs`, `backup-banco.mjs`, `_comum.ps1` | Usados pelos scripts acima |

Tudo que o app grava fica em `C:\brique\data`: `brique.sqlite` (banco), `media\` (fotos), `backups\` e `logs\`.

## Alternativa sem IIS: Caddy

Só para uma VPS sem IIS e com a porta 80 livre. Instale com `instalar.ps1 -Email voce@email.com -SemIis` e depois:

1. Baixe o Caddy para Windows (amd64) em caddyserver.com/download e salve o `caddy.exe` em `C:\caddy\`.
2. Configure e registre como serviço:

   ```powershell
   Copy-Item C:\brique\caddy\Caddyfile C:\caddy\Caddyfile
   C:\caddy\caddy.exe validate --config C:\caddy\Caddyfile
   sc.exe create caddy start= auto binPath= "C:\caddy\caddy.exe run --config C:\caddy\Caddyfile"
   sc.exe start caddy
   New-NetFirewallRule -DisplayName "Caddy (HTTP/HTTPS)" -Direction Inbound -Protocol TCP -LocalPort 80,443 -Action Allow
   ```

3. Na Cloudflare use o modo **Flexible** (o Caddyfile atende pela porta 80). Para *Full (strict)*, gere o Certificado de Origem em *SSL/TLS → Origin Server*, salve em `C:\caddy\certs\` e descomente o último bloco do Caddyfile.

## Problemas comuns

| Sintoma | Causa provável |
|---|---|
| "A execução de scripts foi desabilitada neste sistema" | Rode com `powershell -ExecutionPolicy Bypass -File ...`, como nos exemplos |
| O app não respondeu em 60 segundos | O instalador mostra o fim do log. Com `EADDRINUSE`, outro programa usa a porta 3010: coloque `PORT=3020` (por exemplo) no `.env` e rode o instalador de novo (ele ajusta o IIS) |
| Teste pelo IIS deu 502 | App parado: `iniciar.ps1` e veja o log em `data\logs` |
| Teste pelo IIS deu 500 | Falta o URL Rewrite ou o ARR: rode `configurar-iis.ps1` de novo e veja as mensagens |
| Teste pelo IIS deu 404 | Outro site do IIS atende o domínio por um curinga: confira as *Ligações* no Gerenciador do IIS |
| Erro 521 na Cloudflare | A Cloudflare não chega na VPS: porta 80/443 fechada no firewall do Windows ou do provedor |
| Erro 525/526 na Cloudflare | Modo **Full (strict)** com o certificado próprio do instalador. Use **Full** |
| "Origem da requisição inválida" ao entrar ou salvar | Abriu por um endereço diferente de `https://dz7.online` (ex.: pelo IP). Confira o `APP_ORIGIN` no `.env` e rode `iniciar.ps1` depois de mudar |
| Mudou o `BASE_PATH` e quebrou | O prefixo é definido no build: gere o pacote de novo com `npm run vps:build -- --base /novo` |

## Segurança

- O app só escuta em `127.0.0.1` e roda como *SERVIÇO LOCAL*: não tem poderes de administrador e só grava em `data\`.
- O `.env` e a pasta `data\` (banco e fotos) só podem ser lidos pelos administradores, pelo sistema e pelo próprio app.
- Deixe abertas para fora só as portas 80 e 443, além da Área de Trabalho Remota (3389). Se o painel do provedor permitir, libere a 3389 só para o seu IP.
- Opcional: aceitar nas portas 80/443 só os IPs da Cloudflare (lista em cloudflare.com/ips), para ninguém contornar o proxy.
- Mantenha o Windows Update ligado. O `.env` e a pasta `data\` ficam só na VPS: não os envie para repositórios.
