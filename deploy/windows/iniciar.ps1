# Inicia o Market Radar (PowerShell como Administrador).
. "$PSScriptRoot\_comum.ps1"
Exigir-Administrador
if (-not (Iniciar-App)) { exit 1 }
