# Funções usadas pelos outros scripts. Não precisa rodar este arquivo.
$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"   # sem a barra de progresso os downloads ficam bem mais rápidos
try { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 } catch { }
$Raiz = $PSScriptRoot
$NomeTarefa = "Market Radar (brique)"
$NodePortatil = Join-Path $Raiz "node\node.exe"

function Passo([string]$Texto) { Write-Host ""; Write-Host "==> $Texto" -ForegroundColor Cyan }

function Baixar([string]$Url, [string]$Arquivo) {
    New-Item -ItemType Directory -Force (Split-Path $Arquivo) | Out-Null
    for ($tentativa = 1; $tentativa -le 3; $tentativa++) {
        try { Invoke-WebRequest $Url -OutFile $Arquivo -UseBasicParsing; return }
        catch {
            if ($tentativa -eq 3) { throw "Não consegui baixar $Url ($($_.Exception.Message))" }
            Start-Sleep -Seconds 5
        }
    }
}

function Ler-Env([string]$Chave, [string]$Padrao) {
    $arquivo = Join-Path $Raiz ".env"
    if (Test-Path $arquivo) {
        foreach ($linha in Get-Content $arquivo -Encoding UTF8) {
            if ($linha -match "^\s*$Chave\s*=\s*(.*)$") {
                $valor = $Matches[1].Trim().Trim('"').Trim("'")
                if ($valor) { return $valor }
            }
        }
    }
    return $Padrao
}

# Troca (ou acrescenta) uma linha CHAVE=valor no .env, sem mexer no resto.
function Gravar-Env([string]$Chave, [string]$Valor) {
    $arquivo = Join-Path $Raiz ".env"
    $linhas = [Collections.Generic.List[string]]@(Get-Content $arquivo -Encoding UTF8)
    $achou = $false
    for ($i = 0; $i -lt $linhas.Count; $i++) {
        if ($linhas[$i] -match "^\s*$Chave\s*=") { $linhas[$i] = "$Chave=$Valor"; $achou = $true }
    }
    if (-not $achou) { $linhas.Add("$Chave=$Valor") }
    [IO.File]::WriteAllLines($arquivo, $linhas, (New-Object Text.UTF8Encoding($false)))
}
$Porta = Ler-Env "PORT" "{{PORT}}"
$Base = Ler-Env "BASE_PATH" "{{BASE}}"
$Dados = Ler-Env "DATA_DIR" (Join-Path $Raiz "data")
$UrlSaude = "http://127.0.0.1:$Porta$Base/api/v1/health/ready"

function Exigir-Administrador {
    $identidade = [Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()
    if (-not $identidade.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
        Write-Host "Abra o PowerShell como Administrador (botão direito > Executar como administrador)." -ForegroundColor Yellow
        exit 1
    }
}

# Nome da conta no idioma do Windows ("SERVIÇO LOCAL", "LOCAL SERVICE"...), a partir do SID fixo.
function Nome-Conta([string]$Sid) {
    return ([Security.Principal.SecurityIdentifier]$Sid).Translate([Security.Principal.NTAccount]).Value
}

# O Node portátil que o instalar.ps1 baixa para node\ (ou, sem ele, o do sistema).
function Caminho-Node {
    if (Test-Path $NodePortatil) { return $NodePortatil }
    $node = Get-Command node -ErrorAction SilentlyContinue
    if (-not $node) { throw "Node.js não encontrado. Rode o instalar.ps1, que baixa o Node para $Raiz\node." }
    return $node.Source
}

function Executar-Icacls {
    & icacls @args /Q | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "icacls falhou: $args" }
}

# O app roda como SERVIÇO LOCAL (S-1-5-19): lê a pasta do pacote e só grava em data.
# Banco, fotos e .env ficam fechados para os outros usuários da máquina.
function Aplicar-Permissoes {
    New-Item -ItemType Directory -Force $Dados | Out-Null
    Executar-Icacls $Raiz /grant "*S-1-5-19:(OI)(CI)RX"
    Executar-Icacls $Dados /inheritance:r /grant:r "*S-1-5-32-544:(OI)(CI)F" "*S-1-5-18:(OI)(CI)F" "*S-1-5-19:(OI)(CI)M"
    $envArquivo = Join-Path $Raiz ".env"
    if (Test-Path $envArquivo) {
        Executar-Icacls $envArquivo /inheritance:r /grant:r "*S-1-5-32-544:F" "*S-1-5-18:F" "*S-1-5-19:R"
    }
}

# Leva a porta do .env (PORT) para o web.config da aplicação no IIS.
function Ajustar-Porta-Iis {
    $config = Join-Path $Raiz "iis\app\web.config"
    if (-not (Test-Path $config)) { return }
    $texto = [IO.File]::ReadAllText($config)
    $novo = $texto -replace "http://127\.0\.0\.1:\d+", "http://127.0.0.1:$Porta"
    if ($novo -ne $texto) { [IO.File]::WriteAllText($config, $novo, (New-Object Text.UTF8Encoding($false))) }
}

function Aguardar-App([int]$Segundos = 60) {
    for ($i = 0; $i -lt $Segundos; $i += 2) {
        try {
            $resposta = Invoke-WebRequest $UrlSaude -UseBasicParsing -TimeoutSec 3
            if ($resposta.StatusCode -eq 200) { return $true }
        } catch { }
        Start-Sleep -Seconds 2
    }
    return $false
}

function Mostrar-Log {
    $pasta = Join-Path $Dados "logs"
    $ultimo = Get-ChildItem $pasta -Filter "*.log" -ErrorAction SilentlyContinue | Sort-Object LastWriteTime | Select-Object -Last 1
    if ($ultimo) {
        Write-Host "--- últimas linhas de $($ultimo.FullName) ---"
        Get-Content $ultimo.FullName -Tail 30 -Encoding UTF8
    }
}

# Para a tarefa e os dois processos (supervisor e app). O Windows não encerra
# o processo filho junto, então os dois são encerrados pelo id gravado.
function Parar-App {
    if (Get-ScheduledTask -TaskName $NomeTarefa -ErrorAction SilentlyContinue) {
        Stop-ScheduledTask -TaskName $NomeTarefa -ErrorAction SilentlyContinue
    }
    $pid_arquivo = Join-Path $Dados "brique.pid"
    if (Test-Path $pid_arquivo) {
        foreach ($id in Get-Content $pid_arquivo) {
            if ($id -match "^\d+$") { Stop-Process -Id ([int]$id) -Force -ErrorAction SilentlyContinue }
        }
        Remove-Item $pid_arquivo -Force -ErrorAction SilentlyContinue
    }
    # Garantia: qualquer node.exe ainda escutando a porta do app.
    Get-NetTCPConnection -LocalPort $Porta -State Listen -ErrorAction SilentlyContinue | ForEach-Object {
        $processo = Get-Process -Id $_.OwningProcess -ErrorAction SilentlyContinue
        if ($processo -and $processo.ProcessName -eq "node") { Stop-Process -Id $processo.Id -Force }
    }
}

function Iniciar-App {
    Start-ScheduledTask -TaskName $NomeTarefa
    Write-Host "Aguardando o app responder..."
    if (Aguardar-App) {
        Write-Host "App no ar em http://127.0.0.1:$Porta$Base" -ForegroundColor Green
        return $true
    }
    Write-Host "O app não respondeu em 60 segundos." -ForegroundColor Red
    Mostrar-Log
    return $false
}
