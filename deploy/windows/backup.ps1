# Cópia do banco e das fotos em data\backups. Guarda 14 dias.
# Uso (PowerShell como Administrador):
#   .\backup.ps1            faz um backup agora
#   .\backup.ps1 -Agendar   passa a fazer todo dia às 3h
param([switch]$Agendar)
. "$PSScriptRoot\_comum.ps1"
Exigir-Administrador

if ($Agendar) {
    $acao = New-ScheduledTaskAction -Execute "powershell.exe" `
        -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$Raiz\backup.ps1`"" -WorkingDirectory $Raiz
    $gatilho = New-ScheduledTaskTrigger -Daily -At "03:00"
    $conta = New-ScheduledTaskPrincipal -UserId (Nome-Conta "S-1-5-18") -LogonType ServiceAccount -RunLevel Highest
    Register-ScheduledTask -TaskName "$NomeTarefa - backup" -Action $acao -Trigger $gatilho -Principal $conta -Force | Out-Null
    Write-Host "Backup diário agendado para 3h (tarefa '$NomeTarefa - backup')." -ForegroundColor Green
    exit 0
}

$node = Caminho-Node
& $node (Join-Path $Raiz "backup-banco.mjs")
if ($LASTEXITCODE -ne 0) { throw "Falha ao copiar o banco." }

$backups = Join-Path $Dados "backups"
$fotos = Join-Path $Dados "media"
if (Get-ChildItem $fotos -Recurse -File -ErrorAction SilentlyContinue | Select-Object -First 1) {
    $destino = Join-Path $backups ("fotos-" + (Get-Date -Format "yyyy-MM-dd_HHmm") + ".zip")
    Compress-Archive -Path (Join-Path $fotos "*") -DestinationPath $destino -Force
    Write-Host "Fotos copiadas para $destino"
}

Get-ChildItem $backups -File | Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-14) } | Remove-Item -Force
Write-Host "Backup concluído em $backups" -ForegroundColor Green
