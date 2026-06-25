[CmdletBinding()]
param(
  [string]$Version,
  [string]$Tag,
  [string]$OutputRoot,
  [string]$SigningKeyPath,
  [string]$CodeSigningCertificatePath,
  [string]$CodeSigningCertificatePassword,
  [string]$CodeSigningCertificatePasswordEnvVar = "PRISM_CODESIGN_PFX_PASSWORD",
  [string]$CodeSigningTimestampUrl = "http://timestamp.digicert.com",
  [string]$SignToolPath,
  [string]$ReleaseNotes = "PRISM Worldgen Lab public release.",
  [switch]$RequireCodeSigning,
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

function Resolve-SignTool {
  if ($SignToolPath) {
    if (-not (Test-Path -LiteralPath $SignToolPath)) {
      throw "Configured signtool.exe was not found: $SignToolPath"
    }
    return $SignToolPath
  }

  $cmd = Get-Command "signtool.exe" -ErrorAction SilentlyContinue
  if ($cmd) {
    return $cmd.Source
  }

  $kitRoot = Join-Path ${env:ProgramFiles(x86)} "Windows Kits\10\bin"
  if (Test-Path -LiteralPath $kitRoot) {
    $candidate = Get-ChildItem -LiteralPath $kitRoot -Recurse -Filter "signtool.exe" -ErrorAction SilentlyContinue |
      Where-Object { $_.FullName -match "\\x64\\signtool\.exe$" } |
      Sort-Object FullName -Descending |
      Select-Object -First 1
    if ($candidate) {
      return $candidate.FullName
    }
  }

  throw "signtool.exe was not found. Install the Windows SDK from: https://developer.microsoft.com/en-us/windows/downloads/windows-sdk/"
}

function Invoke-CodeSignFile([string]$path) {
  if (-not $CodeSigningCertificatePath) {
    return $false
  }
  if (-not (Test-Path -LiteralPath $CodeSigningCertificatePath)) {
    throw "Code-signing certificate was not found: $CodeSigningCertificatePath"
  }

  $signtool = Resolve-SignTool
  $password = $CodeSigningCertificatePassword
  if (-not $password -and $CodeSigningCertificatePasswordEnvVar) {
    $password = [Environment]::GetEnvironmentVariable($CodeSigningCertificatePasswordEnvVar)
  }

  $signArgs = @(
    "sign",
    "/fd", "SHA256",
    "/tr", $CodeSigningTimestampUrl,
    "/td", "SHA256",
    "/f", $CodeSigningCertificatePath
  )
  if ($password) {
    $signArgs += @("/p", $password)
  }
  $signArgs += $path

  Write-Host "Authenticode signing: $path"
  & $signtool @signArgs
  if ($LASTEXITCODE -ne 0) {
    throw "Authenticode signing failed for $path with exit code $LASTEXITCODE"
  }

  & $signtool verify /pa /v $path
  if ($LASTEXITCODE -ne 0) {
    throw "Authenticode signature verification failed for $path with exit code $LASTEXITCODE"
  }

  return $true
}

function New-Sha256Line([string]$root, [string]$path) {
  $hash = Get-FileHash -LiteralPath $path -Algorithm SHA256
  $rootPath = [System.IO.Path]::GetFullPath($root)
  if (-not $rootPath.EndsWith([System.IO.Path]::DirectorySeparatorChar)) {
    $rootPath = "$rootPath$([System.IO.Path]::DirectorySeparatorChar)"
  }
  $rootUri = [Uri]::new($rootPath)
  $pathUri = [Uri]::new([System.IO.Path]::GetFullPath($path))
  $relative = [Uri]::UnescapeDataString($rootUri.MakeRelativeUri($pathUri).ToString()).Replace("\", "/")
  return "$($hash.Hash.ToLowerInvariant())  $relative"
}

function Invoke-TauriSignerFile([string]$path, [int]$timeoutSeconds = 60) {
  $stdoutPath = Join-Path ([System.IO.Path]::GetTempPath()) "prism-tauri-sign-$([Guid]::NewGuid()).out"
  $stderrPath = Join-Path ([System.IO.Path]::GetTempPath()) "prism-tauri-sign-$([Guid]::NewGuid()).err"
  $oldSigningKeyPathEnv = $env:TAURI_SIGNING_PRIVATE_KEY_PATH
  try {
    $env:TAURI_SIGNING_PRIVATE_KEY_PATH = $null
    $process = Start-Process -FilePath "npx.cmd" `
      -ArgumentList @("tauri", "signer", "sign", $path) `
      -WorkingDirectory $toolRoot `
      -NoNewWindow `
      -PassThru `
      -RedirectStandardOutput $stdoutPath `
      -RedirectStandardError $stderrPath

    if (-not $process.WaitForExit($timeoutSeconds * 1000)) {
      Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
      throw "Tauri updater signing timed out after $timeoutSeconds seconds. Check TAURI_SIGNING_PRIVATE_KEY / TAURI_SIGNING_PRIVATE_KEY_PASSWORD."
    }

    $stdout = ""
    $stderr = ""
    if (Test-Path -LiteralPath $stdoutPath) {
      $stdout = (Get-Content -LiteralPath $stdoutPath -Raw).Trim()
    }
    if (Test-Path -LiteralPath $stderrPath) {
      $stderr = (Get-Content -LiteralPath $stderrPath -Raw).Trim()
    }
    if ($process.ExitCode -ne 0) {
      throw "Tauri updater signing failed with exit code $($process.ExitCode): $stderr"
    }
    if (-not $stdout) {
      throw "Tauri updater signing produced no signature output. stderr: $stderr"
    }
    return $stdout
  } finally {
    $env:TAURI_SIGNING_PRIVATE_KEY_PATH = $oldSigningKeyPathEnv
    Remove-Item -LiteralPath $stdoutPath, $stderrPath -Force -ErrorAction SilentlyContinue
  }
}

function Write-DefenderSubmissionReadme([string]$path, [string[]]$artifactNames) {
  $content = @"
# Microsoft Defender false-positive submission notes

Use this release packet when submitting the app to Microsoft Security Intelligence:

https://www.microsoft.com/en-us/wdsi/filesubmission

Recommended submission type:

- Submit as: Software developer
- Product: Microsoft Defender Antivirus / Microsoft Defender SmartScreen
- Classification: Incorrectly detected as malware/malicious

Product:

- Name: PRISM Worldgen Lab
- Publisher: FBZ / PRISM
- Repository: https://github.com/F-B-Z/PRISM-Minecraft-WorldGen-Lab
- Release: https://github.com/F-B-Z/PRISM-Minecraft-WorldGen-Lab/releases/tag/$Tag

Artifacts to submit if flagged:

$($artifactNames | ForEach-Object { "- $_" } | Out-String)

Notes:

This is a Tauri desktop application built from public source. It is unsigned
unless a Windows Authenticode certificate is passed to the release script. The
Tauri updater signature protects update integrity, but Windows Defender and
SmartScreen reputation still depend on Microsoft reputation and Authenticode
publisher trust.
"@

  [System.IO.File]::WriteAllText($path, $content, [System.Text.UTF8Encoding]::new($false))
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
if ($CodeSigningCertificatePath) {
  Write-Host "Authenticode certificate: $CodeSigningCertificatePath"
  Write-Host "Authenticode timestamp: $CodeSigningTimestampUrl"
} elseif ($RequireCodeSigning) {
  throw "Code signing is required, but -CodeSigningCertificatePath was not provided."
} else {
  Write-Warning "No Authenticode certificate was provided. Windows Defender/SmartScreen may warn on fresh unsigned builds. Pass -CodeSigningCertificatePath when a code-signing certificate is available."
}

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
if (Test-Path -LiteralPath $releaseRoot) {
  Remove-Item -LiteralPath $releaseRoot -Recurse -Force
}
New-Item -ItemType Directory -Force -Path $portableDir, $installerDir, $updaterDir | Out-Null

$releaseExe = Join-Path $tauriRoot "target\release\prism_worldgen_lab.exe"
$portableExe = Join-Path $portableDir "PRISM Worldgen Lab Portable.exe"
Copy-RequiredFile $releaseExe $portableExe
Invoke-CodeSignFile $portableExe | Out-Null

$portableZip = Join-Path $releaseRoot "PRISM-Worldgen-Lab-$Version-portable-windows-x64.zip"
if (Test-Path -LiteralPath $portableZip) {
  Remove-Item -LiteralPath $portableZip -Force
}
Compress-Archive -Path (Join-Path $portableDir "*") -DestinationPath $portableZip -Force

$nsisInstaller = Get-ChildItem -LiteralPath (Join-Path $tauriRoot "target\release\bundle\nsis") -Filter "*.exe" -ErrorAction Stop | Sort-Object LastWriteTime -Descending | Select-Object -First 1
$msiInstaller = Get-ChildItem -LiteralPath (Join-Path $tauriRoot "target\release\bundle\msi") -Filter "*.msi" -ErrorAction Stop | Sort-Object LastWriteTime -Descending | Select-Object -First 1
$nsisReleaseName = "PRISM-Worldgen-Lab-$Version-windows-x64-setup.exe"
$msiReleaseName = "PRISM-Worldgen-Lab-$Version-windows-x64.msi"
$nsisReleasePath = Join-Path $installerDir $nsisReleaseName
$msiReleasePath = Join-Path $installerDir $msiReleaseName
Copy-RequiredFile $nsisInstaller.FullName $nsisReleasePath
Copy-RequiredFile $msiInstaller.FullName $msiReleasePath
Invoke-CodeSignFile $nsisReleasePath | Out-Null
Invoke-CodeSignFile $msiReleasePath | Out-Null

$updateSource = Get-Item -LiteralPath $nsisReleasePath
$updateAssetName = $nsisReleaseName
$builtUpdaterSignaturePath = "$($nsisInstaller.FullName).sig"
if (-not (Test-Path -LiteralPath $builtUpdaterSignaturePath)) {
  throw "No signed Tauri updater artifact was produced. Check bundle.createUpdaterArtifacts and signing configuration."
}

$updateAssetPath = Join-Path $updaterDir $updateAssetName
$updateSignatureName = "$updateAssetName.sig"
Copy-RequiredFile $updateSource.FullName $updateAssetPath
$updateSignaturePath = Join-Path $updaterDir $updateSignatureName
if ($CodeSigningCertificatePath) {
  $signature = Invoke-TauriSignerFile $updateAssetPath
  [System.IO.File]::WriteAllText($updateSignaturePath, $signature, [System.Text.UTF8Encoding]::new($false))
} else {
  Copy-RequiredFile $builtUpdaterSignaturePath $updateSignaturePath
}

$signature = (Get-Content -LiteralPath $updateSignaturePath -Raw).Trim()
$releaseAssetUrl = "https://github.com/F-B-Z/PRISM-Minecraft-WorldGen-Lab/releases/download/$Tag/$updateAssetName"
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
  installer = $nsisReleaseName
  msi = $msiReleaseName
  updater_asset = $updateAssetName
  updater_signature = $updateSignatureName
  latest_json = "latest.json"
  updater_uploads = @($updateAssetName, $updateSignatureName, "latest.json")
  installer_runtime_note = "Windows installer uses the official Microsoft Edge WebView2 download bootstrapper when WebView2 is missing."
} | ConvertTo-Json -Depth 5

[System.IO.File]::WriteAllText((Join-Path $releaseRoot "release-manifest.json"), $manifest, [System.Text.UTF8Encoding]::new($false))

$checksumTargets = @(
  $portableZip,
  $nsisReleasePath,
  $msiReleasePath,
  $updateAssetPath,
  $updateSignaturePath,
  $latestJsonPath,
  (Join-Path $releaseRoot "release-manifest.json")
)
$checksumLines = $checksumTargets | ForEach-Object { New-Sha256Line $releaseRoot $_ }
[System.IO.File]::WriteAllLines((Join-Path $releaseRoot "SHA256SUMS.txt"), $checksumLines, [System.Text.UTF8Encoding]::new($false))

Write-DefenderSubmissionReadme `
  -path (Join-Path $releaseRoot "MICROSOFT_DEFENDER_SUBMISSION.md") `
  -artifactNames @(
    [System.IO.Path]::GetFileName($portableZip),
    "installer/$nsisReleaseName",
    "installer/$msiReleaseName"
  )

Write-Host ""
Write-Host "Release artifacts written to:"
Write-Host $releaseRoot
Write-Host ""
Write-Host "Upload these to GitHub release $Tag for auto-update support:"
Write-Host " - $updateAssetName"
Write-Host " - $updateSignatureName"
Write-Host " - latest.json"
Write-Host ""
Write-Host "Trust and verification files:"
Write-Host " - SHA256SUMS.txt"
Write-Host " - MICROSOFT_DEFENDER_SUBMISSION.md"

if ($OpenFolder) {
  Invoke-Item $releaseRoot
}
