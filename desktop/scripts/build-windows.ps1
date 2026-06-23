$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$Desktop = Resolve-Path (Join-Path $ScriptDir "..")
$Root = Resolve-Path (Join-Path $Desktop "..")
$Engine = Join-Path $Root "engine"
$BinDir = Join-Path $Desktop "src-tauri\bin"
$Spec = Join-Path $ScriptDir "blowmyjob-engine.spec"
$PublicAgentDir = Join-Path $Root "public\downloads\agent"
$ExpectedInstaller = Join-Path $PublicAgentDir "BLOW-MY-JOB-Agent_x64-setup.exe"

if ($env:OS -ne "Windows_NT") {
  throw "Ce script doit être lancé sur Windows."
}

if (!(Test-Path $Engine)) {
  throw "engine introuvable: $Engine"
}

$Python = Join-Path $Engine "venv\Scripts\python.exe"
if (!(Test-Path $Python)) {
  $Python = (Get-Command python -ErrorAction Stop).Source
}

Write-Host "==> Build sidecar Python Windows"
& $Python -m pip install --upgrade pip pyinstaller -q
& $Python -m pip install -r (Join-Path $Engine "requirements.txt") -q

New-Item -ItemType Directory -Force -Path $BinDir | Out-Null
Push-Location $ScriptDir
try {
  & $Python -m PyInstaller --noconfirm --clean $Spec
} finally {
  Pop-Location
}

$SidecarOut = Join-Path $ScriptDir "dist\blowmyjob-engine.exe"
$SidecarTarget = Join-Path $BinDir "blowmyjob-engine-x86_64-pc-windows-msvc.exe"
Copy-Item $SidecarOut $SidecarTarget -Force
Write-Host "==> Sidecar prêt: $SidecarTarget"

Write-Host "==> Install desktop deps"
Push-Location $Desktop
try {
  if (Test-Path "package-lock.json") {
    npm ci
  } else {
    npm install
  }

  Write-Host "==> Build Tauri Windows installer"
  $env:VITE_API_ORIGIN = if ($env:VITE_API_ORIGIN) { $env:VITE_API_ORIGIN } else { "https://blowmyjob.fr" }
  npm run tauri:build:windows
} finally {
  Pop-Location
}

$NsisDir = Join-Path $Desktop "src-tauri\target\x86_64-pc-windows-msvc\release\bundle\nsis"
$Installer = Get-ChildItem $NsisDir -Filter "*.exe" | Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (!$Installer) {
  throw "Installateur NSIS introuvable dans $NsisDir"
}

New-Item -ItemType Directory -Force -Path $PublicAgentDir | Out-Null
Copy-Item $Installer.FullName $ExpectedInstaller -Force

Write-Host "OK -> $ExpectedInstaller"
