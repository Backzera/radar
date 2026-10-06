# Publica o Market Radar no IIS em https://<domínio do .env>/brique.
# O instalar.ps1 já roda este script; dá para rodar de novo sozinho, sem risco:
#   powershell -ExecutionPolicy Bypass -File C:\brique\configurar-iis.ps1
#
# - Instala o IIS, o URL Rewrite e o ARR se faltarem, e liga o proxy do IIS.
# - Se o domínio já é um site no IIS (outro sistema na raiz), só acrescenta a aplicação
#   /brique dentro dele, com regras próprias: o site e as regras dele não são alterados.
# - Se não é, cria o site "Market Radar" (portas 80 e 443, certificado próprio para o
#   modo "Full" da Cloudflare), com a raiz levando para /brique.
. "$PSScriptRoot\_comum.ps1"
Exigir-Administrador

$UrlRewrite = "https://download.microsoft.com/download/1/2/8/128E2E22-C1B9-44A4-BE2A-5859ED1D4592/rewrite_amd64_en-US.msi"
$UrlArr = "https://download.microsoft.com/download/E/9/8/E9849D6A-020E-47E4-9FD0-A023E99B54EB/requestRouter_amd64.msi"
$Origem = Ler-Env "APP_ORIGIN" "{{ORIGIN}}"
$Dominio = ([uri]$Origem).Host
$Aplicacao = $Base.TrimStart("/")
$Pool = "MarketRadar"
$NomeSite = "Market Radar"
$PastaIis = Join-Path $Raiz "iis"
$NomeCertificado = "Market Radar - Origem"

# Roda o appcmd do IIS e devolve o código e o texto da saída.
function AppCmd {
    $anterior = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    try { $saida = & (Join-Path $env:windir "System32\inetsrv\appcmd.exe") @args 2>&1 | Out-String }
    finally { $ErrorActionPreference = $anterior }
    [pscustomobject]@{ Codigo = $LASTEXITCODE; Texto = $saida.Trim() }
}

function Instalar-Msi([string]$Nome, [string]$Url) {
    $arquivo = Join-Path $env:TEMP ([IO.Path]::GetFileName($Url))
    Write-Host "Baixando e instalando: $Nome"
    Baixar $Url $arquivo
    $p = Start-Process msiexec.exe -ArgumentList "/i `"$arquivo`" /qn /norestart" -Wait -PassThru
    Remove-Item $arquivo -ErrorAction SilentlyContinue
    if ($p.ExitCode -notin 0, 3010) { throw "O instalador de '$Nome' falhou (código $($p.ExitCode))." }
}

Passo "IIS: recursos do Windows, URL Rewrite e ARR"
Import-Module ServerManager
$r = Install-WindowsFeature -Name Web-Server, Web-Http-Errors, Web-Http-Logging, Web-Filtering
if (-not $r.Success) { throw "Não foi possível instalar o IIS." }
Import-Module WebAdministration
$modulos = @(Get-WebGlobalModule | ForEach-Object { $_.Name })
if ($modulos -notcontains "RewriteModule") { Instalar-Msi "URL Rewrite" $UrlRewrite }
if ($modulos -notcontains "ApplicationRequestRouting") { Instalar-Msi "Application Request Routing" $UrlArr }

# Proxy ligado, mantendo o endereço original e sem segurar a resposta em buffer.
# São os mesmos valores que outros sistemas atrás do IIS costumam usar.
$r = AppCmd set config "-section:system.webServer/proxy" "/enabled:true" "/commit:apphost"
if ($r.Codigo -ne 0) { throw "Não consegui ligar o proxy do IIS: $($r.Texto)" }
foreach ($ajuste in "/preserveHostHeader:true", "/reverseRewriteHostInResponseHeaders:false", "/responseBufferLimit:0") {
    $r = AppCmd set config "-section:system.webServer/proxy" $ajuste "/commit:apphost"
    if ($r.Codigo -ne 0) { Write-Warning "Ajuste $ajuste do proxy não aplicado: $($r.Texto)" }
}

Ajustar-Porta-Iis
# O IIS (grupo IIS_IUSRS e IUSR) precisa ler os web.config.
Executar-Icacls $PastaIis /grant "*S-1-5-32-568:(OI)(CI)RX" "*S-1-5-17:(OI)(CI)RX" /T

if (-not (Test-Path "IIS:\AppPools\$Pool")) {
    New-WebAppPool -Name $Pool | Out-Null
    Set-ItemProperty "IIS:\AppPools\$Pool" -Name managedRuntimeVersion -Value ""
}

Passo "IIS: site de $Dominio"
$hostDe = { param($ligacao) ($ligacao.bindingInformation -split ":")[-1] }
$site = Get-Website | Where-Object {
    @($_.bindings.Collection | ForEach-Object { & $hostDe $_ }) -contains $Dominio
} | Select-Object -First 1

if ($site -and $site.name -ne $NomeSite) {
    Write-Host "O domínio já é o site '$($site.name)' no IIS: só a aplicação $Base será acrescentada nele."
} else {
    $nomes = @($Dominio, "www.$Dominio")
    # Certificado da conexão Cloudflare -> VPS (o modo "Full" da Cloudflare aceita certificado próprio).
    $cert = Get-ChildItem Cert:\LocalMachine\My |
        Where-Object { $_.FriendlyName -eq $NomeCertificado -and $_.NotAfter -gt (Get-Date).AddDays(30) -and ($_.DnsNameList.Unicode -contains $Dominio) } |
        Sort-Object NotAfter -Descending | Select-Object -First 1
    if (-not $cert) {
        try {
            $cert = New-SelfSignedCertificate -DnsName $nomes -CertStoreLocation "Cert:\LocalMachine\My" -FriendlyName $NomeCertificado -NotAfter (Get-Date).AddYears(10)
        } catch {
            $cert = New-SelfSignedCertificate -DnsName $nomes -CertStoreLocation "Cert:\LocalMachine\My"
            $cert.FriendlyName = $NomeCertificado
        }
    }
    if (-not $site) {
        $novoId = [int](Get-ChildItem IIS:\Sites | Measure-Object -Property Id -Maximum).Maximum + 1
        New-Website -Name $NomeSite -Id $novoId -PhysicalPath (Join-Path $PastaIis "raiz") -ApplicationPool $Pool `
            -Port 80 -HostHeader $Dominio | Out-Null
        Write-Host "Site '$NomeSite' criado."
    } else {
        Set-ItemProperty "IIS:\Sites\$NomeSite" -Name physicalPath -Value (Join-Path $PastaIis "raiz")
    }
    foreach ($nome in $nomes) {
        if (-not (Get-WebBinding -Name $NomeSite -Protocol http -Port 80 -HostHeader $nome)) {
            New-WebBinding -Name $NomeSite -Protocol http -Port 80 -HostHeader $nome
        }
        if (-not (Get-WebBinding -Name $NomeSite -Protocol https -Port 443 -HostHeader $nome)) {
            New-WebBinding -Name $NomeSite -Protocol https -Port 443 -HostHeader $nome -SslFlags 1
        }
        $ligacao = Get-WebBinding -Name $NomeSite -Protocol https -Port 443 -HostHeader $nome
        try { $ligacao.RemoveSslCertificate() } catch { }
        $ligacao.AddSslCertificate($cert.Thumbprint, "My")
    }
    $site = Get-Website -Name $NomeSite
}

New-WebApplication -Site $site.name -Name $Aplicacao -PhysicalPath (Join-Path $PastaIis "app") -ApplicationPool $Pool -Force | Out-Null
Start-WebAppPool -Name $Pool -ErrorAction SilentlyContinue
Start-Website -Name $site.name -ErrorAction SilentlyContinue
Write-Host "Aplicação $Base no site '$($site.name)' -> app em 127.0.0.1:$Porta"

# Aviso se nenhuma regra do firewall libera as portas 80/443 (a Cloudflare precisa chegar na VPS).
$liberadas = Get-NetFirewallPortFilter -Protocol TCP -ErrorAction SilentlyContinue |
    Where-Object { ($_.LocalPort -contains "443") -or ($_.LocalPort -contains "80") } |
    Get-NetFirewallRule -ErrorAction SilentlyContinue |
    Where-Object { $_.Enabled -eq "True" -and $_.Direction -eq "Inbound" -and $_.Action -eq "Allow" }
if (-not $liberadas) {
    Write-Warning "Nenhuma regra do firewall do Windows libera as portas 80/443. Veja 'Firewall' no LEIA-ME.md."
}

Passo "Teste pelo IIS"
$testes = @()
foreach ($porta in 443, 80) {
    $esquema = if ($porta -eq 443) { "https" } else { "http" }
    if (Get-WebBinding -Name $site.name -Port $porta -HostHeader $Dominio) {
        $codigo = & curl.exe -sk -o NUL -w "%{http_code}" --max-time 20 --resolve "$($Dominio):$($porta):127.0.0.1" "$($esquema)://$Dominio$Base/api/v1/health/ready"
        Write-Host "$($esquema)://$Dominio$Base pelo IIS: HTTP $codigo (esperado: 200)"
        $testes += "$codigo"
    }
}
if ($testes -contains "200") {
    Write-Host "IIS pronto." -ForegroundColor Green
    exit 0
}
Write-Warning "O IIS não respondeu como esperado. Copie as mensagens acima e me envie."
exit 1
