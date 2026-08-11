# pdf-tool — instalador para Windows (PowerShell), una línea, sin Docker.
#
#   iex (Invoke-WebRequest https://raw.githubusercontent.com/dumbocan/pdf-tool/main/install.ps1).Content
#
# Instala:
#   1. Node.js (si no está) — vía winget
#   2. tesseract + OCR español + poppler (para facturas escaneadas) — vía winget
#   3. pnpm (corepack) y el comando `pdf-tool`
#
# Requiere PowerShell 5.1+ y winget (Windows 10/11 modernos).

$ErrorActionPreference = "Stop"

Write-Host "=============================================="
Write-Host "  pdf-tool — instalador para Windows"
Write-Host "=============================================="

# 1. Node.js (>= 22 — el CLI usa sintaxis moderna que Node viejo no entiende)
$nodeMajor = 0
if (Get-Command node -ErrorAction SilentlyContinue) {
    $nodeMajor = [int](((node --version 2>$null) -replace '[vV]', '') -split '\.')[0]
}
if (-not (Get-Command node -ErrorAction SilentlyContinue) -or $nodeMajor -lt 22) {
    Write-Host ""
    if (Get-Command node -ErrorAction SilentlyContinue) {
        Write-Host "➜ Node v$(node --version 2>$null) es viejo (pdf-tool necesita >=22). Actualizándolo con winget..."
    } else {
        Write-Host "➜ Node.js no está instalado. Instalando Node LTS (>=22) con winget..."
    }
    winget install -e --id OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements | Out-Null
    # refrescar PATH
    $env:Path = [System.Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path", "User")
}
# verificación post-instalación
$nodeMajor = 0
if (Get-Command node -ErrorAction SilentlyContinue) {
    $nodeMajor = [int](((node --version 2>$null) -replace '[vV]', '') -split '\.')[0]
}
if (-not (Get-Command node -ErrorAction SilentlyContinue) -or $nodeMajor -lt 22) {
    Write-Host "✗ Node sigue siendo viejo o ausente. Instalalo manualmente desde https://nodejs.org (LTS >=22) y volvé a correr este instalador."
    exit 1
}
Write-Host "➜ Node.js: $(node --version 2>$null)"

# 2. tesseract (OCR escaneados)
if (-not (Get-Command tesseract -ErrorAction SilentlyContinue)) {
    Write-Host ""
    Write-Host "➜ tesseract no está instalado. Instalándolo con winget..."
    winget install -e --id UB-Mannheim.TesseractOCR --accept-source-agreements --accept-package-agreements | Out-Null
    $env:Path = [System.Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path", "User")
}
if (-not (Get-Command pdftoppm -ErrorAction SilentlyContinue)) {
    Write-Host "➜ poppler (para leer páginas escaneadas) no está. Instalándolo..."
    winget install -e --id oschwartz10612.Poppler --accept-source-agreements --accept-package-agreements | Out-Null
    $env:Path = [System.Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path", "User")
}
Write-Host "➜ tesseract: $(tesseract --version 2>&1 | Select-Object -First 1)"

# 2b. git (necesario para descargar pdf-tool)
if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
    Write-Host ""
    Write-Host "➜ git no está instalado. Instalándolo con winget..."
    winget install -e --id Git.Git --accept-source-agreements --accept-package-agreements | Out-Null
    $env:Path = [System.Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path", "User")
}

# 3. pnpm + pdf-tool
Write-Host ""
$installDir = "$env:USERPROFILE\.pdf-tool"
Write-Host "➜ Instalando pdf-tool en $installDir ..."
if (Test-Path "$installDir\.git") {
    Push-Location $installDir
    git pull --ff-only 2>$null | Out-Null
    Pop-Location
} else {
    git clone --depth 1 https://github.com/dumbocan/pdf-tool.git $installDir
}
Push-Location $installDir
# pnpm (corepack viene con Node; si no, fallback a npm)
if (-not (Get-Command pnpm -ErrorAction SilentlyContinue)) {
    corepack enable 2>$null | Out-Null
    corepack prepare pnpm@latest --activate 2>$null | Out-Null
}
if (-not (Get-Command pnpm -ErrorAction SilentlyContinue)) {
    Write-Host "➜ corepack no disponible; instalando pnpm con npm..."
    npm install -g pnpm 2>$null | Out-Null
}
if (-not (Get-Command pnpm -ErrorAction SilentlyContinue)) {
    Write-Host "✗ No pude instalar pnpm. Corré manualmente:  npm install -g pnpm   y volvé a correr este instalador."
    exit 1
}
if (-not (Test-Path node_modules)) {
    pnpm install --prod --ignore-scripts
}
Pop-Location

# 4. wrapper pdf-tool.cmd en %LOCALAPPDATA%\pdf-tool-bin
$binDir = Join-Path $env:LOCALAPPDATA "pdf-tool-bin"
New-Item -ItemType Directory -Force -Path $binDir | Out-Null
$cmd = "@echo off`r`nnode `"$installDir\bin\pdf-tool.mjs`" %*`r`n"
Set-Content -Path (Join-Path $binDir "pdf-tool.cmd") -Value $cmd -Encoding ASCII

# agregar a PATH (usuario)
$userPath = [System.Environment]::GetEnvironmentVariable("Path", "User")
if ($userPath -notlike "*$binDir*") {
    [System.Environment]::SetEnvironmentVariable("Path", "$userPath;$binDir", "User")
    Write-Host "➜ Agregué $binDir a tu PATH. Abrí una terminal nueva."
}

Write-Host ""
Write-Host "=============================================="
Write-Host "✅ ¡Listo! pdf-tool quedó instalado en Windows."
Write-Host ""
Write-Host "Probá con:"
Write-Host "    pdf-tool ayuda"
Write-Host "    pdf-tool facturas  (y arrastrá tu carpeta)"
Write-Host "    pdf-tool facturas C:\ruta\facturas --ocr"
Write-Host "    pdf-tool config   (clave de IA + formato de nombres)"
Write-Host ""
Write-Host "Si el comando no aparece, abrí una terminal nueva."
Write-Host "=============================================="
