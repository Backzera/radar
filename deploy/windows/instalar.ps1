# Market Radar (brique): instala ou reinstala tudo na VPS Windows.
#
# Uso (PowerShell como Administrador), com o pacote extraído em C:\brique:
#   powershell -ExecutionPolicy Bypass -File C:\brique\instalar.ps1 -Email voce@email.com
#
# Faz sozinho: baixa o Node.js 24 (portátil, em C:\brique\node), cria o .env, registra o app
# para ligar junto com o Windows e configura o IIS (configurar-iis.ps1). Pode rodar de novo.
#
# Opções:
#   -Email voce@email.com   quem vira administrador ao criar a conta no site
#   -SemIis                 não mexe no IIS (para publicar pelo Caddy, veja o LEIA-ME.md)
param(
    [string]$Email,
    [switch]$SemIis
)
. "$PSScriptRoot\_comum.ps1"
Exigir-Administrador

Passo "1/5 Conferindo a VPS"
if ($Raiz -like "$env:SystemDrive\Users\*") {
    throw "Extraia o pacote fora da pasta de usuário (ex.: C:\brique) e rode de novo."
}
if (-not (Test-Path (Join-Path $Raiz "app\server.js"))) { throw "Está faltando a pasta app em $Raiz. Extraia o pacote inteiro." }
$os = Get-CimInstance Win32_OperatingSystem
$livreGB = [math]::Round((Get-PSDrive ($Raiz.Substring(0, 1))).Free / 1GB)
Write-Host "$($os.Caption) | memória: $([math]::Round($os.TotalVisibleMemorySize / 1MB, 1)) GB | disco livre: $livreGB GB"
if ($livreGB -lt 2) { throw "Pouco espaço em disco ($livreGB GB livres). Libere pelo menos 2 GB." }

Passo "2/5 Node.js"
if (-not (Test-Path $NodePortatil)) {
    $versao = (Invoke-RestMethod "https://nodejs.org/dist/index.json" -TimeoutSec 60) |
        Where-Object { $_.lts -and $_.version -like "v24.*" } | Select-Object -First 1
    if (-not $versao) { throw "Não encontrei o Node.js 24 LTS no site oficial." }
    $nome = "node-$($versao.version)-win-x64"
    $zip = Join-Path $env:TEMP "$nome.zip"
    Write-Host "Baixando Node.js $($versao.version)"
    Baixar "https://nodejs.org/dist/$($versao.version)/$nome.zip" $zip
    # Extrai dentro de C:\brique para herdar as permissões dela. Uma pasta movida de outro
    # lugar (como a pasta temporária do Administrador) leva as permissões antigas junto, e
    # o app, como SERVIÇO LOCAL, não consegue abrir o node.exe.
    $extraindo = Join-Path $Raiz "node-baixando"
    if (Test-Path $extraindo) { Remove-Item $extraindo -Recurse -Force }
    Expand-Archive $zip -DestinationPath $extraindo -Force
    $pastaNode = Join-Path $Raiz "node"
    if (Test-Path $pastaNode) { Remove-Item $pastaNode -Recurse -Force }
    Move-Item (Join-Path $extraindo $nome) $pastaNode
    Remove-Item $extraindo, $zip -Recurse -Force -ErrorAction SilentlyContinue
}
$node = Caminho-Node
Write-Host "Node.js $(& $node -v) em $node"

Passo "3/5 Configuração (.env)"
$envArquivo = Join-Path $Raiz ".env"
if (-not (Test-Path $envArquivo)) {
    Copy-Item (Join-Path $Raiz ".env.example") $envArquivo
    Write-Host "Criei o $envArquivo"
}
if ($Email) { Gravar-Env "RADAR_ADMIN_EMAILS" $Email.Trim().ToLower() }
while (-not (Ler-Env "RADAR_ADMIN_EMAILS" "")) {
    $digitado = (Read-Host "Seu e-mail (vira administrador ao criar a conta no site)").Trim().ToLower()
    if ($digitado -match "^[^@\s]+@[^@\s]+\.[^@\s]+$") { Gravar-Env "RADAR_ADMIN_EMAILS" $digitado }
    else { Write-Host "E-mail inválido." -ForegroundColor Yellow }
}
Write-Host "Endereço: $(Ler-Env 'APP_ORIGIN' '')$Base | administrador: $(Ler-Env 'RADAR_ADMIN_EMAILS' '')"

Passo "4/5 App (tarefa '$NomeTarefa', liga junto com o Windows)"
Parar-App
Aplicar-Permissoes
# Roda como SERVIÇO LOCAL, uma conta sem poderes de administrador; sem limite de tempo.
$acao = New-ScheduledTaskAction -Execute $node -Argument "`"$Raiz\iniciar-app.mjs`"" -WorkingDirectory $Raiz
$gatilho = New-ScheduledTaskTrigger -AtStartup
$conta = New-ScheduledTaskPrincipal -UserId (Nome-Conta "S-1-5-19") -LogonType ServiceAccount -RunLevel Limited
$opcoes = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable `
    -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -MultipleInstances IgnoreNew
Register-ScheduledTask -TaskName $NomeTarefa -Action $acao -Trigger $gatilho -Principal $conta -Settings $opcoes -Force | Out-Null
if (-not (Iniciar-App)) { throw "O app não subiu (log acima). Copie as mensagens e me envie." }

if ($SemIis) {
    Passo "5/5 IIS: pulado (-SemIis). Publique pelo Caddy, como no LEIA-ME.md."
} else {
    Passo "5/5 IIS"
    & (Join-Path $Raiz "configurar-iis.ps1")
    if ($LASTEXITCODE -ne 0) { exit 1 }
}

$dominio = ([uri](Ler-Env "APP_ORIGIN" "{{ORIGIN}}")).Host
Write-Host ""
Write-Host "Tudo certo na VPS!" -ForegroundColor Green
Write-Host "  1. Na Cloudflare, aponte o DNS de $dominio para esta VPS (nuvem laranja) e use o SSL no modo Full."
Write-Host "  2. Abra $(Ler-Env 'APP_ORIGIN' '')$Base/cadastro e crie sua conta com o e-mail $(Ler-Env 'RADAR_ADMIN_EMAILS' '')."
Write-Host "  3. Reinicie a VPS uma vez e confira se o site volta sozinho."
