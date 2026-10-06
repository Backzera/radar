# Atualiza para um pacote novo sem tocar no .env nem na pasta data.
# Uso (PowerShell como Administrador, na pasta já instalada):
#   powershell -ExecutionPolicy Bypass -File .\atualizar.ps1 -Pacote C:\brique-windows.zip
# -Pacote aceita o .zip ou a pasta já extraída.
param([Parameter(Mandatory = $true)][string]$Pacote)
. "$PSScriptRoot\_comum.ps1"
Exigir-Administrador

$Pacote = (Resolve-Path $Pacote).Path
$temporaria = $null
if ($Pacote -like "*.zip") {
    $temporaria = Join-Path $env:TEMP ("brique-" + [guid]::NewGuid().ToString("N"))
    Write-Host "Extraindo $Pacote..."
    Expand-Archive $Pacote $temporaria
    $Pacote = $temporaria
}
# O zip traz uma pasta brique-windows dentro.
if (-not (Test-Path (Join-Path $Pacote "app\server.js"))) {
    $interna = Get-ChildItem $Pacote -Directory | Where-Object { Test-Path (Join-Path $_.FullName "app\server.js") } | Select-Object -First 1
    if (-not $interna) { throw "Não achei app\server.js em $Pacote." }
    $Pacote = $interna.FullName
}
if ($Pacote -eq $Raiz) { throw "Indique o pacote novo, não a pasta instalada." }

# O prefixo (/brique) vem embutido no build: precisa ser o mesmo do .env.
$baseNova = (Get-Content (Join-Path $Pacote ".env.example") -Encoding UTF8 | Where-Object { $_ -match "^BASE_PATH=" }) -replace "^BASE_PATH=", ""
if ($baseNova -ne $Base) {
    throw "O pacote novo foi gerado para '$baseNova', mas o .env usa '$Base'. Gere o pacote com --base $Base."
}

Write-Host "Fazendo backup antes de atualizar..."
& (Caminho-Node) (Join-Path $Raiz "backup-banco.mjs")
if ($LASTEXITCODE -ne 0) { throw "O backup falhou; nada foi alterado." }

Parar-App
Start-Sleep -Seconds 1
Remove-Item (Join-Path $Raiz "app") -Recurse -Force
Copy-Item (Join-Path $Pacote "app") (Join-Path $Raiz "app") -Recurse
# Scripts, modelos e guia (o .env e a pasta data ficam como estão).
Get-ChildItem $Pacote -File | Where-Object { $_.Name -ne ".env" } | Copy-Item -Destination $Raiz -Force
foreach ($pasta in "caddy", "iis") {
    $origem = Join-Path $Pacote $pasta
    if (Test-Path $origem) { Copy-Item $origem $Raiz -Recurse -Force }
}
Ajustar-Porta-Iis
Aplicar-Permissoes
if ($temporaria) { Remove-Item $temporaria -Recurse -Force -ErrorAction SilentlyContinue }

Write-Host "Arquivos atualizados. Se a versão nova mudar o banco, o app aplica as mudanças ao iniciar."
if (-not (Iniciar-App)) { exit 1 }
