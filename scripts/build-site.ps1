<#
.SYNOPSIS
  Builds the public website (site/) and packs site/dist into site-dist.zip.

.DESCRIPTION
  Installs the site's dependencies when missing (npm ci), runs `npm run build`
  in site/ and writes site-dist.zip at the repository root. The zip holds the
  CONTENTS of site/dist (index.html at its root, plus .htaccess and
  .well-known/), ready to extract into public_html/phpmyflow/ on Hostinger.
  It never contains a demo/ folder, so extracting it leaves /demo/ alone.
  Steps and checks: docs/site-deploy.md.

.PARAMETER Out
  Path of the zip. Default: <repo>/site-dist.zip.

.PARAMETER SkipInstall
  Don't run npm ci even if site/node_modules is missing.

.EXAMPLE
  .\scripts\build-site.ps1
#>
[CmdletBinding()]
param(
    [string]$Out,
    [switch]$SkipInstall
)

Set-StrictMode -Version 3
$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$site = Join-Path $root 'site'
$dist = Join-Path $site 'dist'
if (-not $Out) { $Out = Join-Path $root 'site-dist.zip' }

function Stop-WithError([string]$msg) {
    Write-Host ''
    Write-Host $msg -ForegroundColor Red
    exit 1
}

if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
    Stop-WithError "npm is not in the PATH. Install Node.js LTS (https://nodejs.org/ or: winget install OpenJS.NodeJS.LTS)."
}

Push-Location $site
try {
    if (-not $SkipInstall -and -not (Test-Path (Join-Path $site 'node_modules'))) {
        Write-Host '> npm ci (site/)' -ForegroundColor Cyan
        & npm ci
        if ($LASTEXITCODE -ne 0) { Stop-WithError 'npm ci failed (see above).' }
    }
    Write-Host '> npm run build (site/)' -ForegroundColor Cyan
    & npm run build
    if ($LASTEXITCODE -ne 0) { Stop-WithError 'The build failed (see above).' }
}
finally { Pop-Location }

foreach ($required in @('index.html', 'es\index.html', '404.html', '.htaccess', '.well-known\security.txt', 'sitemap.xml', 'robots.txt')) {
    if (-not (Test-Path (Join-Path $dist $required))) { Stop-WithError "site/dist/$($required -replace '\\', '/') is missing: the build is incomplete." }
}
if (Test-Path (Join-Path $dist 'demo')) { Stop-WithError 'site/dist/demo exists: the site must never ship a demo/ folder (it would overwrite the demo).' }

# Zip by hand: every file (dotfiles included) with "/" separators, which any
# unzip on Linux (Hostinger's File Manager) expects.
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
if (Test-Path $Out) { Remove-Item $Out -Force }
$zip = [System.IO.Compression.ZipFile]::Open($Out, [System.IO.Compression.ZipArchiveMode]::Create)
$count = 0
try {
    $base = (Resolve-Path $dist).Path.TrimEnd('\') + '\'
    foreach ($file in Get-ChildItem -Path $dist -Recurse -File -Force) {
        $entry = $file.FullName.Substring($base.Length) -replace '\\', '/'
        [void][System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $file.FullName, $entry, [System.IO.Compression.CompressionLevel]::Optimal)
        $count++
    }
}
finally { $zip.Dispose() }

$size = [math]::Round((Get-Item $Out).Length / 1MB, 2)
Write-Host ''
Write-Host "  ok  $Out ($count files, $size MB)" -ForegroundColor Green
Write-Host '  Upload it to public_html/phpmyflow/ and extract it there (docs/site-deploy.md). Do not delete /demo/.'
