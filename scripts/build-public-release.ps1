[CmdletBinding()]
param(
  [string]$Version,
  [string]$Tag,
  [string]$OutputRoot,
  [string]$SigningKeyPath,
  [string]$ReleaseNotes = "PRISM Worldgen Lab public release.",
  [switch]$SkipBuild,
  [switch]$OpenFolder
)

$ErrorActionPreference = "Stop"

function Resolve-RepoPath([string]$relativePath) {
  return [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot "..\$relativePath"))
}

function Require-Command([string]$name, [string]$installUrl) {
  $cmd = Get-Command $name -ErrorAction SilentlyContinue
  if (-not $cmd) {
    throw "Missing required command '$name'. Install it from: $installUrl"
  }
  return $cmd.Source
}

function Read-JsonFile([string]$path) {
  return Get-Content -LiteralPath $path -Raw | ConvertFrom-Json
}

function Test-WebView2Runtime {
  $registryPaths = @(
    "HKLM:\SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}",
    "HKLM:\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}",
    "HKCU:\SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}"
  )

  foreach ($path in $registryPaths) {
    if (Test-Path -LiteralPath $path) {
      return $true
    }
  }

  return $false
}

function Copy-RequiredFile([string]$source, [string]$destination) {
  if (-not (Test-Path -LiteralPath $source)) {
    throw "Expected release artifact not found: $source"
  }
  Copy-Item -LiteralPath $source -Destination $destination -Force
}

$toolRoot = Resolve-RepoPath "."
$tauriRoot = Join-Path $toolRoot "src-tauri"
$tauriConfigPath = Join-Path $tauriRoot "tauri.conf.json"
$tauriConfig = Read-JsonFile $tauriConfigPath

if (-not $Version) {
  $Version = [string]$tauriConfig.version
}
if (-not $Tag) {
  $Tag = "v$Version"
}
if (-not $OutputRoot) {
  $OutputRoot = Join-Path $toolRoot "release"
}
if (-not $SigningKeyPath) {
  $SigningKeyPath = Join-Path ([Environment]::GetFolderPath("MyDocuments")) "PRISM Worldgen Lab\Signing\worldgen-lab.key"
}

$nodePath = Require-Command "node" "https://nodejs.org/en/download"
$npmPath = Require-Command "npm.cmd" "https://nodejs.org/en/download"
$cargoPath = Require-Command "cargo" "https://www.rust-lang.org/tools/install"
$rustcPath = Require-Command "rustc" "https://www.rust-lang.org/tools/install"
$npxPath = Require-Command "npx.cmd" "https://nodejs.org/en/download"

if (-not (Test-Path -LiteralPath $SigningKeyPath)) {
  throw @"
Missing updater signing key:
$SigningKeyPath

Create one with:
npx tauri signer generate -w "$SigningKeyPath" --ci

Keep the private key secret. The matching public key is committed in src-tauri/tauri.conf.json.
"@
}

if (-not (Test-WebView2Runtime)) {
  Write-Warning "Microsoft Edge WebView2 Runtime was not detected locally. The generated Windows installer is configured to download the official Microsoft bootstrapper if WebView2 is missing. Official download: https://developer.microsoft.com/en-us/microsoft-edge/webview2/"
}

Write-Host "PRISM Worldgen Lab release build"
Write-Host "Version: $Version"
Write-Host "Tag: $Tag"
Write-Host "Node: $nodePath"
Write-Host "npm: $npmPath"
Write-Host "cargo: $cargoPath"
Write-Host "rustc: $rustcPath"
Write-Host "Signing key: $SigningKeyPath"

$env:TAURI_SIGNING_PRIVATE_KEY_PATH = $SigningKeyPath
$env:TAURI_SIGNING_PRIVATE_KEY = (Get-Content -LiteralPath $SigningKeyPath -Raw).Trim()

if (-not $SkipBuild) {
  Push-Location $toolRoot
  try {
    & npx.cmd tauri build --ci
    if ($LASTEXITCODE -ne 0) {
      throw "Tauri desktop build failed with exit code $LASTEXITCODE"
    }
  } finally {
    Pop-Location
  }
}

$releaseRoot = [System.IO.Path]::GetFullPath((Join-Path $OutputRoot $Tag))
$portableDir = Join-Path $releaseRoot "portable"
$installerDir = Join-Path $releaseRoot "installer"
$updaterDir = Join-Path $releaseRoot "updater"
New-Item -ItemType Directory -Force -Path $portableDir, $installerDir, $updaterDir | Out-Null

$releaseExe = Join-Path $tauriRoot "target\release\prism_worldgen_lab.exe"
$portableExe = Join-Path $portableDir "PRISM Worldgen Lab Portable.exe"
Copy-RequiredFile $releaseExe $portableExe

$portableZip = Join-Path $releaseRoot "PRISM-Worldgen-Lab-$Version-portable-windows-x64.zip"
if (Test-Path -LiteralPath $portableZip) {
  Remove-Item -LiteralPath $portableZip -Force
}
Compress-Archive -Path (Join-Path $portableDir "*") -DestinationPath $portableZip -Force

$nsisInstaller = Get-ChildItem -LiteralPath (Join-Path $tauriRoot "target\release\bundle\nsis") -Filter "*.exe" -ErrorAction Stop | Sort-Object LastWriteTime -Descending | Select-Object -First 1
$msiInstaller = Get-ChildItem -LiteralPath (Join-Path $tauriRoot "target\release\bundle\msi") -Filter "*.msi" -ErrorAction Stop | Sort-Object LastWriteTime -Descending | Select-Object -First 1
Copy-RequiredFile $nsisInstaller.FullName (Join-Path $installerDir $nsisInstaller.Name)
Copy-RequiredFile $msiInstaller.FullName (Join-Path $installerDir $msiInstaller.Name)

$updateAsset = $nsisInstaller
$signaturePath = "$($updateAsset.FullName).sig"
if (-not (Test-Path -LiteralPath $signaturePath)) {
  $updateAsset = $msiInstaller
  $signaturePath = "$($updateAsset.FullName).sig"
}
if (-not (Test-Path -LiteralPath $signaturePath)) {
  throw "No signed Tauri updater artifact was produced. Check bundle.createUpdaterArtifacts and signing configuration."
}

Copy-RequiredFile $updateAsset.FullName (Join-Path $updaterDir $updateAsset.Name)
Copy-RequiredFile $signaturePath (Join-Path $updaterDir ([System.IO.Path]::GetFileName($signaturePath)))

$signature = (Get-Content -LiteralPath $signaturePath -Raw).Trim()
$releaseAssetUrl = "https://github.com/F-B-Z/PRISM-Minecraft-WorldGen-Lab/releases/download/$Tag/$($updateAsset.Name)"
$latestJson = [ordered]@{
  version = $Version
  notes = $ReleaseNotes
  pub_date = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
  platforms = [ordered]@{
    "windows-x86_64" = [ordered]@{
      signature = $signature
      url = $releaseAssetUrl
    }
  }
} | ConvertTo-Json -Depth 8

$latestJsonPath = Join-Path $releaseRoot "latest.json"
[System.IO.File]::WriteAllText($latestJsonPath, $latestJson, [System.Text.UTF8Encoding]::new($false))

$manifest = [ordered]@{
  version = $Version
  tag = $Tag
  generated_at = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
  portable_zip = [System.IO.Path]::GetFileName($portableZip)
  installer = $nsisInstaller.Name
  msi = $msiInstaller.Name
  updater_asset = $updateAsset.Name
  updater_signature = [System.IO.Path]::GetFileName($signaturePath)
  latest_json = "latest.json"
  updater_uploads = @($updateAsset.Name, [System.IO.Path]::GetFileName($signaturePath), "latest.json")
  installer_runtime_note = "Windows installer uses the official Microsoft Edge WebView2 download bootstrapper when WebView2 is missing."
} | ConvertTo-Json -Depth 5

[System.IO.File]::WriteAllText((Join-Path $releaseRoot "release-manifest.json"), $manifest, [System.Text.UTF8Encoding]::new($false))

Write-Host ""
Write-Host "Release artifacts written to:"
Write-Host $releaseRoot
Write-Host ""
Write-Host "Upload these to GitHub release $Tag for auto-update support:"
Write-Host " - $($updateAsset.Name)"
Write-Host " - $([System.IO.Path]::GetFileName($signaturePath))"
Write-Host " - latest.json"

if ($OpenFolder) {
  Invoke-Item $releaseRoot
}
