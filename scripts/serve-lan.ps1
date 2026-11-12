<#
.SYNOPSIS
  Serve phpMyFlow on the local network with PHP's built-in server.

.DESCRIPTION
  Checks PHP (8.1+, pdo_mysql, openssl), builds the UI when server/index.html
  is missing, checks that the port is free and that the Windows firewall lets
  the LAN in, then serves server/ on the LAN address and on 127.0.0.1.

.PARAMETER Ip
  LAN IPv4 address to listen on. Default: the address of the interface that
  has an active default gateway (asks when there are several).

.PARAMETER Port
  TCP port. Default: 8090.

.PARAMETER Rebuild
  Build the UI even if server/index.html exists.

.PARAMETER OpenFirewall
  Create an inbound rule for the port, limited to the local subnet.
  Needs an elevated PowerShell (Run as administrator).

.PARAMETER DryRun
  Only print what would be done. -WhatIf does the same.

.EXAMPLE
  .\scripts\serve-lan.ps1
  .\scripts\serve-lan.ps1 -Ip 192.168.1.32 -Port 8090 -OpenFirewall
  .\scripts\serve-lan.ps1 -DryRun
#>
[CmdletBinding(SupportsShouldProcess = $true)]
param(
    [string]$Ip,
    [ValidateRange(1, 65535)][int]$Port = 8090,
    [switch]$Rebuild,
    [switch]$OpenFirewall,
    [switch]$DryRun
)

Set-StrictMode -Version 3
$ErrorActionPreference = 'Stop'

$dry = $DryRun -or $WhatIfPreference
# Our own dry-run handles -WhatIf; don't let it leak into module auto-loading.
$WhatIfPreference = $false
$root = Split-Path -Parent $PSScriptRoot
$serverDir = Join-Path $root 'server'
$webDir = Join-Path $root 'web'
$router = Join-Path $PSScriptRoot 'lan-router.php'

function Write-Step([string]$msg) { Write-Host "> $msg" -ForegroundColor Cyan }
function Write-Ok([string]$msg) { Write-Host "  ok  $msg" -ForegroundColor Green }
function Write-Dry([string]$msg) { Write-Host "  [dry-run] would $msg" -ForegroundColor DarkGray }
function Stop-WithError([string]$msg) {
    Write-Host ''
    Write-Host $msg -ForegroundColor Red
    exit 1
}

# ---------------------------------------------------------------- IP address

function ConvertTo-UInt32([string]$addr) {
    $b = ([System.Net.IPAddress]::Parse($addr)).GetAddressBytes()
    return ([uint32]$b[0] -shl 24) -bor ([uint32]$b[1] -shl 16) -bor ([uint32]$b[2] -shl 8) -bor [uint32]$b[3]
}

function Get-Subnet([string]$addr, [int]$prefix) {
    $all = [uint64]4294967295
    $mask = if ($prefix -eq 0) { [uint32]0 } else { [uint32](($all -shl (32 - $prefix)) -band $all) }
    $net = (ConvertTo-UInt32 $addr) -band $mask
    $bytes = @((($net -shr 24) -band 255), (($net -shr 16) -band 255), (($net -shr 8) -band 255), ($net -band 255))
    return ('{0}/{1}' -f ($bytes -join '.'), $prefix)
}

Write-Step 'Network address'
$candidates = @(Get-NetIPConfiguration -ErrorAction SilentlyContinue | Where-Object {
        $_.IPv4DefaultGateway -and $_.NetAdapter -and $_.NetAdapter.Status -eq 'Up' -and $_.IPv4Address
    } | ForEach-Object {
        foreach ($a in @($_.IPv4Address)) {
            [pscustomobject]@{
                Ip = $a.IPAddress; Prefix = [int]$a.PrefixLength
                Alias = $_.InterfaceAlias; Index = $_.InterfaceIndex
            }
        }
    })
# /31 and /32 addresses are point-to-point links (usually VPNs), not a LAN.
$lan = @($candidates | Where-Object { $_.Prefix -lt 31 })
if ($lan.Count -gt 0) { $candidates = $lan }

if ($Ip) {
    $parsed = $null
    if (-not [System.Net.IPAddress]::TryParse($Ip, [ref]$parsed) -or $parsed.AddressFamily -ne 'InterNetwork') {
        Stop-WithError "-Ip '$Ip' is not an IPv4 address."
    }
    $local = Get-NetIPAddress -AddressFamily IPv4 -IPAddress $Ip -ErrorAction SilentlyContinue | Select-Object -First 1
    if (-not $local) {
        Stop-WithError "$Ip is not an address of this computer. Addresses with a gateway: $((@($candidates | ForEach-Object Ip)) -join ', ')"
    }
    $selected = [pscustomobject]@{ Ip = $Ip; Prefix = [int]$local.PrefixLength; Alias = $local.InterfaceAlias; Index = $local.InterfaceIndex }
}
elseif ($candidates.Count -eq 0) {
    Stop-WithError 'No network interface with an active default gateway was found. Pass the address with -Ip.'
}
elseif ($candidates.Count -eq 1) {
    $selected = $candidates[0]
}
else {
    Write-Host '  Several interfaces have a default gateway:'
    for ($i = 0; $i -lt $candidates.Count; $i++) {
        Write-Host ('    [{0}] {1,-15} {2}' -f ($i + 1), $candidates[$i].Ip, $candidates[$i].Alias)
    }
    if ($dry) {
        $selected = $candidates[0]
        Write-Dry "ask which one to use (taking [1] for the dry run)"
    }
    else {
        do {
            $answer = Read-Host "  Which one? (1-$($candidates.Count))"
            $n = 0
        } until ([int]::TryParse($answer, [ref]$n) -and $n -ge 1 -and $n -le $candidates.Count)
        $selected = $candidates[$n - 1]
    }
}
$Ip = $selected.Ip
$subnet = Get-Subnet $Ip $selected.Prefix
Write-Ok "$Ip on '$($selected.Alias)' (subnet $subnet)"

# ---------------------------------------------------------------------- PHP

Write-Step 'PHP'
$phpCmd = Get-Command php -ErrorAction SilentlyContinue
if (-not $phpCmd) {
    Stop-WithError ("php is not in the PATH.`n" +
        "  Install PHP 8.1+ (https://windows.php.net/download/, 'VS16 x64 Non Thread Safe' zip),`n" +
        "  unzip it, e.g. to C:\php, and add that folder to the PATH (System > Environment variables).")
}
$php = $phpCmd.Source
$phpVersion = (& $php -r 'echo PHP_VERSION;' 2>$null)
if (-not $phpVersion -or [version]($phpVersion -replace '[^0-9.].*$', '') -lt [version]'8.1') {
    Stop-WithError "PHP $phpVersion found at $php; phpMyFlow needs 8.1 or newer."
}
$modules = @(& $php -m 2>$null | ForEach-Object { $_.Trim().ToLowerInvariant() })
$missing = @('pdo_mysql', 'openssl' | Where-Object { $modules -notcontains $_ })
if ($missing.Count -gt 0) {
    $ini = (& $php -r 'echo php_ini_loaded_file() ?: "";' 2>$null)
    $iniHint = if ($ini) { "Edit $ini" } else {
        "No php.ini is loaded: copy php.ini-production to php.ini in $(Split-Path -Parent $php)"
    }
    $lines = ($missing | ForEach-Object { "      extension=$_" }) -join "`n"
    Stop-WithError ("PHP $phpVersion is missing: $($missing -join ', ').`n" +
        "  $iniHint and remove the ';' in front of:`n$lines`n" +
        "  Also check that extension_dir points to the 'ext' folder, e.g. extension_dir = `"ext`".")
}
Write-Ok "PHP $phpVersion ($php) with pdo_mysql and openssl"
# 8.1 gets no security fixes since 2025-12-31 and 8.2 none after 2026-12-31: it still works, but say so.
if ([version]($phpVersion -replace '[^0-9.].*$', '') -lt [version]'8.3') {
    Write-Host "  PHP $phpVersion no longer gets (or will soon stop getting) security fixes. Use PHP 8.3 or newer when you can." -ForegroundColor Yellow
}

# ---------------------------------------------------------------------- UI

Write-Step 'User interface'
$indexHtml = Join-Path $serverDir 'index.html'
if ((Test-Path $indexHtml) -and -not $Rebuild) {
    Write-Ok 'server/index.html exists (use -Rebuild to build again)'
}
else {
    $reason = if ($Rebuild) { '-Rebuild was given' } else { 'server/index.html is missing' }
    Write-Host "  Building the UI: $reason."
    if (-not (Get-Command node -ErrorAction SilentlyContinue) -or -not (Get-Command npm -ErrorAction SilentlyContinue)) {
        Stop-WithError ("Node.js is needed to build the UI (only once; the server does not need it).`n" +
            "  Install the LTS version from https://nodejs.org/ or run: winget install OpenJS.NodeJS.LTS`n" +
            "  Then open a new terminal and run this script again.")
    }
    Write-Ok "node $(& node --version)"
    $needCi = -not (Test-Path (Join-Path $webDir 'node_modules'))
    if ($dry) {
        if ($needCi) { Write-Dry 'run: npm ci (in web/)' }
        Write-Dry 'run: npm run build (in web/)'
    }
    else {
        Push-Location $webDir
        try {
            if ($needCi) {
                & npm ci
                if ($LASTEXITCODE -ne 0) { Stop-WithError 'npm ci failed (see above).' }
            }
            & npm run build
            if ($LASTEXITCODE -ne 0) { Stop-WithError 'npm run build failed (see above).' }
        }
        finally { Pop-Location }
        Write-Ok 'UI built into server/'
    }
}

# ---------------------------------------------------------------------- port

Write-Step "Port $Port"
$busy = @(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)
if ($busy.Count -gt 0) {
    $owners = $busy | Select-Object -ExpandProperty OwningProcess -Unique | ForEach-Object {
        $p = Get-Process -Id $_ -ErrorAction SilentlyContinue
        if ($p) { "$($p.ProcessName) (PID $_)" } else { "PID $_" }
    }
    $msg = "Port $Port is already in use by: $($owners -join ', ')."
    if (-not $dry) { Stop-WithError "$msg`n  Stop it or choose another port with -Port." }
    Write-Host "  $msg A real run would stop here." -ForegroundColor Yellow
}
else { Write-Ok 'free' }

# ------------------------------------------------------------------ firewall

Write-Step 'Windows firewall'
$ruleName = "phpMyFlow LAN TCP $Port"
$hasRule = $false
$checked = $false
try {
    $filters = Get-NetFirewallPortFilter -Protocol TCP -ErrorAction Stop |
        Where-Object { @($_.LocalPort) -contains [string]$Port }
    foreach ($f in $filters) {
        $rule = $f | Get-NetFirewallRule -ErrorAction SilentlyContinue
        if ($rule -and $rule.Enabled -eq 'True' -and $rule.Direction -eq 'Inbound' -and $rule.Action -eq 'Allow') {
            $hasRule = $true
            Write-Ok "inbound rule found: '$($rule.DisplayName)'"
            break
        }
    }
    $checked = $true
}
catch {
    Write-Host "  Could not read the firewall rules ($($_.Exception.Message.Trim())); run as administrator to check them." -ForegroundColor Yellow
}

$profileName = $null
$netProfile = Get-NetConnectionProfile -InterfaceIndex $selected.Index -ErrorAction SilentlyContinue | Select-Object -First 1
if ($netProfile) { $profileName = [string]$netProfile.NetworkCategory }

$ruleCmd = "New-NetFirewallRule -DisplayName '$ruleName' -Direction Inbound -Protocol TCP -LocalPort $Port " +
    "-RemoteAddress $subnet -Action Allow -Profile Private,Domain"

if (-not $hasRule) {
    $isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(
        [Security.Principal.WindowsBuiltInRole]::Administrator)
    if ($OpenFirewall -and $isAdmin) {
        if ($dry) {
            Write-Dry "run: $ruleCmd"
        }
        else {
            New-NetFirewallRule -DisplayName $ruleName -Direction Inbound -Protocol TCP -LocalPort $Port `
                -RemoteAddress $subnet -Action Allow -Profile Private, Domain | Out-Null
            Write-Ok "rule '$ruleName' created: only $subnet can connect"
        }
    }
    else {
        $what = if ($checked) { "No inbound rule allows TCP ${Port}" } else { "If no inbound rule allows TCP ${Port}" }
        Write-Host "  ${what}: other computers may not reach this server." -ForegroundColor Yellow
        if ($OpenFirewall) {
            Write-Host '  -OpenFirewall needs an elevated PowerShell. Run this as administrator:' -ForegroundColor Yellow
        }
        else {
            Write-Host '  Run this script with -OpenFirewall as administrator, or run this yourself as administrator:' -ForegroundColor Yellow
        }
        Write-Host "    $ruleCmd"
    }
}
if ($profileName -eq 'Public') {
    Write-Host ("  Windows marks the network '$($selected.Alias)' as Public. The rule above only applies to Private/Domain`n" +
        "  networks: if this is your home or office network, set it to Private in Settings > Network & internet.") -ForegroundColor Yellow
}

# ------------------------------------------------------------------- start

$listen = @("${Ip}:$Port")
if ($Ip -ne '127.0.0.1') { $listen += "127.0.0.1:$Port" }

Write-Host ''
Write-Host 'phpMyFlow' -ForegroundColor White
Write-Host "  This computer:    http://127.0.0.1:$Port"
Write-Host "  Other computers:  http://${Ip}:$Port"
Write-Host ''
Write-Host 'Development server without HTTPS: passwords travel unencrypted over the network. Use it only on trusted networks.' -ForegroundColor Yellow
Write-Host ''

if ($dry) {
    foreach ($l in $listen) { Write-Dry "run: php -S $l -t server scripts/lan-router.php (in $root)" }
    Write-Host 'Dry run: nothing was started.'
    exit 0
}

Write-Host 'Press Ctrl+C to stop.' -ForegroundColor DarkGray
Write-Host ''

# One php -S per address (the LAN IP and loopback): binding 0.0.0.0 would also
# listen on every other interface (VPN, virtual switches...).
$procs = @()
try {
    foreach ($l in $listen) {
        $procs += Start-Process -FilePath $php -WorkingDirectory $root -NoNewWindow -PassThru `
            -ArgumentList @('-S', $l, '-t', "`"$serverDir`"", "`"$router`"")
    }
    while ($true) {
        $exited = @($procs | Where-Object { $_.HasExited })
        if ($exited.Count -gt 0) {
            Write-Host "php exited with code $($exited[0].ExitCode)." -ForegroundColor Red
            break
        }
        Start-Sleep -Milliseconds 300
    }
}
finally {
    foreach ($p in $procs) {
        if ($p -and -not $p.HasExited) { Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue }
    }
    Write-Host 'Stopped.'
}
