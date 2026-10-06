# Instala o Market Radar como tarefa que inicia junto com o Windows.
# Uso (PowerShell como Administrador, na pasta do pacote):
#   powershell -ExecutionPolicy Bypass -File .\instalar.ps1
. "$PSScriptRoot\_comum.ps1"
Exigir-Administrador

if ($Raiz -like "$env:SystemDrive\Users\*") {
    Write-Host "Extraia o pacote fora da pasta de usuário (ex.: C:\brique) e rode de novo." -ForegroundColor Yellow
    exit 1
}

# 1. Node.js
$node = Caminho-Node
$versao = [version](& $node -p "process.versions.node")
if ($versao -lt [version]"22.16.0") {
    Write-Host "Node.js $versao é antigo. Instale o Node.js 24 LTS." -ForegroundColor Yellow
    exit 1
}
Write-Host "Node.js $versao em $node"

# 2. Configuração
$envArquivo = Join-Path $Raiz ".env"
if (-not (Test-Path $envArquivo)) {
    Copy-Item (Join-Path $Raiz ".env.example") $envArquivo
    Write-Host "Criei o arquivo .env. Coloque seu e-mail em RADAR_ADMIN_EMAILS, salve e rode este script de novo." -ForegroundColor Yellow
    Start-Process notepad.exe $envArquivo
    exit 1
}
if (-not (Ler-Env "RADAR_ADMIN_EMAILS" "")) {
    Write-Host "Preencha RADAR_ADMIN_EMAILS no .env com o seu e-mail e rode de novo." -ForegroundColor Yellow
    Start-Process notepad.exe $envArquivo
    exit 1
}

# 3. Permissões
Parar-App
Aplicar-Permissoes

# 4. Tarefa agendada: sobe com o Windows, sem limite de tempo, como SERVIÇO LOCAL.
$acao = New-ScheduledTaskAction -Execute $node -Argument "`"$Raiz\iniciar-app.mjs`"" -WorkingDirectory $Raiz
$gatilho = New-ScheduledTaskTrigger -AtStartup
$conta = New-ScheduledTaskPrincipal -UserId (Nome-Conta "S-1-5-19") -LogonType ServiceAccount -RunLevel Limited
$opcoes = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable `
    -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -MultipleInstances IgnoreNew
Register-ScheduledTask -TaskName $NomeTarefa -Action $acao -Trigger $gatilho -Principal $conta -Settings $opcoes -Force | Out-Null
Write-Host "Tarefa '$NomeTarefa' registrada."

if (-not (Iniciar-App)) { exit 1 }
Write-Host ""
Write-Host "Próximo passo: publicar em $(Ler-Env 'APP_ORIGIN' '{{ORIGIN}}')$Base pelo IIS ou pelo Caddy (veja LEIA-ME.md)."
