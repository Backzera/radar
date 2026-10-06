# Para o Market Radar (PowerShell como Administrador). Ele volta sozinho no próximo
# reinício do Windows; para subir antes, use .\iniciar.ps1.
. "$PSScriptRoot\_comum.ps1"
Exigir-Administrador
Parar-App
Write-Host "Market Radar parado." -ForegroundColor Green
