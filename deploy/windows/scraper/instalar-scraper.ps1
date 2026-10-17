# Scraper do Market Radar (brique) na VPS Windows: instala Python portátil, as
# dependências, o navegador headless e sobe o serviço de scraping (porta 8000).
# Depois aponta o SCRAPER_URL do app para ele.
#
# Uso (PowerShell como Administrador), com esta pasta em C:\brique\scraper:
#   powershell -ExecutionPolicy Bypass -File C:\brique\scraper\instalar-scraper.ps1
#
# Opções:
#   -AppEnv  C:\brique\.env   caminho do .env do app (padrão: ..\.env)
#   -PythonVersao 3.12.7      versão do Python a baixar
param(
    [string]$AppEnv,
    [string]$PythonVersao = "3.12.7"
)
$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"
try { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 } catch { }

$Raiz = $PSScriptRoot
$NomeTarefa = "Market Radar Scraper (brique)"
$NomeTarefaApp = "Market Radar (brique)"
$Python = Join-Path $Raiz "python\python.exe"
$Navegadores = Join-Path $Raiz "browsers"
$Cookies = Join-Path $Raiz "fb_cookies.json"
if (-not $AppEnv) { $AppEnv = (Resolve-Path (Join-Path $Raiz "..\.env") -ErrorAction SilentlyContinue).Path }
if (-not $AppEnv) { $AppEnv = Join-Path (Split-Path $Raiz) ".env" }

function Passo([string]$t) { Write-Host ""; Write-Host "==> $t" -ForegroundColor Cyan }
function Baixar([string]$Url, [string]$Arquivo) {
    New-Item -ItemType Directory -Force (Split-Path $Arquivo) | Out-Null
    for ($i = 1; $i -le 3; $i++) {
        try { Invoke-WebRequest $Url -OutFile $Arquivo -UseBasicParsing; return }
        catch { if ($i -eq 3) { throw "Não consegui baixar $Url ($($_.Exception.Message))" }; Start-Sleep 5 }
    }
}
function Nome-Conta([string]$Sid) {
    return ([Security.Principal.SecurityIdentifier]$Sid).Translate([Security.Principal.NTAccount]).Value
}
# Troca (ou acrescenta) CHAVE=valor num .env, sem mexer no resto.
function Gravar-Env([string]$Arquivo, [string]$Chave, [string]$Valor) {
    if (-not (Test-Path $Arquivo)) { throw "Não achei o .env do app em $Arquivo. Passe o caminho com -AppEnv." }
    $linhas = [Collections.Generic.List[string]]@(Get-Content $Arquivo -Encoding UTF8)
    $achou = $false
    for ($i = 0; $i -lt $linhas.Count; $i++) {
        if ($linhas[$i] -match "^\s*$Chave\s*=") { $linhas[$i] = "$Chave=$Valor"; $achou = $true }
    }
    if (-not $achou) { $linhas.Add("$Chave=$Valor") }
    [IO.File]::WriteAllLines($Arquivo, $linhas, (New-Object Text.UTF8Encoding($false)))
}
function Saude([int]$Segundos = 90) {
    for ($i = 0; $i -lt $Segundos; $i += 3) {
        try { if ((Invoke-WebRequest "http://127.0.0.1:8000/health" -UseBasicParsing -TimeoutSec 3).StatusCode -eq 200) { return $true } } catch { }
        Start-Sleep 3
    }
    return $false
}

$identidade = [Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()
if (-not $identidade.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Write-Host "Abra o PowerShell como Administrador e rode de novo." -ForegroundColor Yellow; exit 1
}

Passo "1/6 Conferindo a pasta"
if ($Raiz -like "$env:SystemDrive\Users\*") { throw "Extraia esta pasta fora de Usuários (ex.: C:\brique\scraper) e rode de novo." }
if (-not (Test-Path (Join-Path $Raiz "app.py"))) { throw "Está faltando o app.py em $Raiz. Extraia o pacote inteiro." }
Write-Host ".env do app: $AppEnv"

Passo "2/6 Python portátil"
if (-not (Test-Path $Python)) {
    $exe = Join-Path $env:TEMP "python-$PythonVersao-amd64.exe"
    Write-Host "Baixando Python $PythonVersao"
    Baixar "https://www.python.org/ftp/python/$PythonVersao/python-$PythonVersao-amd64.exe" $exe
    $alvo = Join-Path $Raiz "python"
    Write-Host "Instalando em $alvo (não mexe em outro Python da VPS)"
    $p = Start-Process $exe -Wait -PassThru -ArgumentList @(
        "/quiet", "InstallAllUsers=0", "TargetDir=$alvo", "PrependPath=0",
        "Include_launcher=0", "Include_test=0", "Include_doc=0", "Include_tcltk=0",
        "Include_pip=1", "Shortcuts=0", "AssociateFiles=0"
    )
    if ($p.ExitCode -ne 0 -or -not (Test-Path $Python)) { throw "A instalação do Python falhou (código $($p.ExitCode))." }
    Remove-Item $exe -Force -ErrorAction SilentlyContinue
}
Write-Host "Python: $(& $Python --version)"

Passo "3/6 Dependências e navegador"
& $Python -m pip install --upgrade pip --quiet
if ($LASTEXITCODE -ne 0) { throw "Falha ao atualizar o pip." }
& $Python -m pip install -r (Join-Path $Raiz "requirements.txt") --quiet
if ($LASTEXITCODE -ne 0) { throw "Falha ao instalar as dependências (requirements.txt)." }
$env:PLAYWRIGHT_BROWSERS_PATH = $Navegadores
Write-Host "Baixando o navegador headless (pode demorar)..."
$navOk = $false
& $Python -m patchright install chromium 2>&1 | Write-Host
if ($LASTEXITCODE -eq 0) { $navOk = $true }
if (-not $navOk) {
    Write-Host "patchright falhou; tentando playwright..." -ForegroundColor Yellow
    & $Python -m playwright install chromium 2>&1 | Write-Host
    if ($LASTEXITCODE -eq 0) { $navOk = $true }
}
if (-not $navOk) { throw "Falha ao instalar o navegador (patchright/playwright install chromium)." }

Passo "4/6 Cookies do Facebook"
if (Test-Path $Cookies) {
    Write-Host "Encontrei o fb_cookies.json. (Troque-o quando a sessão expirar.)" -ForegroundColor Green
} else {
    Write-Host "AINDA SEM fb_cookies.json nesta pasta." -ForegroundColor Yellow
    Write-Host "  Opção A: copie o fb_cookies.json do seu computador para $Raiz"
    Write-Host "  Opção B: nesta VPS (com tela), rode:  `"$Python`" `"$Raiz\salvar_cookies.py`"  e faça login no Facebook."
    Write-Host "O serviço sobe mesmo assim, mas só coleta depois que o fb_cookies.json estiver aqui."
}

Passo "5/6 Serviço (tarefa '$NomeTarefa', liga junto com o Windows)"
if (Get-ScheduledTask -TaskName $NomeTarefa -ErrorAction SilentlyContinue) { Stop-ScheduledTask -TaskName $NomeTarefa -ErrorAction SilentlyContinue }
Get-NetTCPConnection -LocalPort 8000 -State Listen -ErrorAction SilentlyContinue | ForEach-Object {
    Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue
}
# Permite a conta SERVIÇO LOCAL ler/executar a pasta do scraper.
& icacls $Raiz /grant "*S-1-5-19:(OI)(CI)RX" /Q | Out-Null
$acao = New-ScheduledTaskAction -Execute (Join-Path $Raiz "iniciar-scraper.cmd") -WorkingDirectory $Raiz
$gatilho = New-ScheduledTaskTrigger -AtStartup
$conta = New-ScheduledTaskPrincipal -UserId (Nome-Conta "S-1-5-19") -LogonType ServiceAccount -RunLevel Limited
$opcoes = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable `
    -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -MultipleInstances IgnoreNew
Register-ScheduledTask -TaskName $NomeTarefa -Action $acao -Trigger $gatilho -Principal $conta -Settings $opcoes -Force | Out-Null
Start-ScheduledTask -TaskName $NomeTarefa
Write-Host "Aguardando o scraper responder (porta 8000)..."
if (-not (Saude)) {
    Write-Host "O scraper não respondeu. Veja o log:" -ForegroundColor Red
    $log = Join-Path $Raiz "logs\scraper.log"
    if (Test-Path $log) { Get-Content $log -Tail 30 -Encoding UTF8 }
    throw "O serviço de scraping não subiu. Copie o log acima e me envie."
}
Write-Host "Scraper no ar em http://127.0.0.1:8000" -ForegroundColor Green

Passo "6/6 Apontar o app para o scraper e LIGAR a coleta, depois religar o app"
Gravar-Env $AppEnv "SCRAPER_URL" "http://127.0.0.1:8000"
Gravar-Env $AppEnv "COLLECTION_ENABLED" "true"
Write-Host "SCRAPER_URL e COLLECTION_ENABLED=true gravados em $AppEnv"
if (Get-ScheduledTask -TaskName $NomeTarefaApp -ErrorAction SilentlyContinue) {
    Stop-ScheduledTask -TaskName $NomeTarefaApp -ErrorAction SilentlyContinue
    Start-Sleep 2
    Start-ScheduledTask -TaskName $NomeTarefaApp
    Write-Host "App religado para ler o SCRAPER_URL."
} else {
    Write-Host "Não achei a tarefa do app ('$NomeTarefaApp'). Reinicie o app manualmente (iniciar.ps1)." -ForegroundColor Yellow
}

Write-Host ""
Write-Host "Pronto!" -ForegroundColor Green
Write-Host "  1. Se ainda não colocou o fb_cookies.json nesta pasta, coloque e rode de novo (ou reinicie a tarefa '$NomeTarefa')."
Write-Host "  2. No site, entre como admin -> Radar -> Administração -> 'Validar configuração' para habilitar a fonte."
Write-Host "  3. Crie um radar e use 'Buscar agora'."
