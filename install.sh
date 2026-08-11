#!/usr/bin/env bash
# pdf-tool — instalador amigable (una línea, estilo OpenClaw).
#
#   curl -fsSL https://raw.githubusercontent.com/dumbocan/pdf-tool/main/install.sh | bash
#
# Instala:
#   1. Node.js (si no está)
#   2. tesseract + OCR español (para facturas escaneadas; pide sudo)
#   3. pnpm (gestor de dependencias seguro, vía corepack)
#   4. el comando `pdf-tool` (clona el proyecto y lo enlaza)
#
# Después de instalar, probá:  pdf-tool ayuda

set -euo pipefail

REPO="https://github.com/dumbocan/pdf-tool.git"
INSTALL_DIR="${PDF_TOOL_DIR:-$HOME/.pdf-tool}"
BIN_DIR="$HOME/.local/bin"

echo "=============================================="
echo "  pdf-tool — instalador"
echo "=============================================="

# 1. Node.js
if ! command -v node >/dev/null 2>&1; then
  echo ""
  echo "➜ No encontré Node.js. Instalándolo..."
  if command -v nvm >/dev/null 2>&1 || [ -s "$HOME/.nvm/nvm.sh" ]; then
    # shellcheck disable=SC1091
    [ -s "$HOME/.nvm/nvm.sh" ] && . "$HOME/.nvm/nvm.sh"
    nvm install --lts >/dev/null
  elif command -v brew >/dev/null 2>&1; then
    echo "   (macOS) Instalando Node.js con Homebrew..."
    brew install node >/dev/null
  elif command -v apt-get >/dev/null 2>&1; then
    echo "   (se pedirá tu contraseña para instalar Node.js)"
    sudo apt-get update -qq
    sudo apt-get install -y -qq nodejs npm
  else
    echo "✗ No pude instalar Node.js automáticamente."
    echo "  Instalalo desde https://nodejs.org y volvé a correr este instalador."
    exit 1
  fi
fi
NODE_VERSION=$(node --version 2>/dev/null || echo "desconocida")
echo "➜ Node.js: $NODE_VERSION"

# 1b. pnpm (gestor de dependencias — corepack viene con Node)
if ! command -v pnpm >/dev/null 2>&1; then
  echo ""
  echo "➜ Activando pnpm (viene con Node, vía corepack)..."
  corepack enable 2>/dev/null || true
  corepack prepare pnpm@latest --activate 2>/dev/null || true
fi
echo "➜ pnpm: $(pnpm --version 2>/dev/null || echo 'no disponible')"

# 2. tesseract (OCR para facturas escaneadas)
if ! command -v tesseract >/dev/null 2>&1; then
  echo ""
  echo "➜ No encontré tesseract (para leer facturas escaneadas). Instalándolo..."
  if command -v apt-get >/dev/null 2>&1; then
    echo "   (se pedirá tu contraseña)"
    sudo apt-get update -qq
    sudo apt-get install -y -qq tesseract-ocr tesseract-ocr-spa poppler-utils
  elif command -v brew >/dev/null 2>&1; then
    brew install tesseract tesseract-lang poppler >/dev/null
  else
    echo "⚠ No pude instalar tesseract automáticamente."
    echo "  Las facturas escaneadas no se leerán, pero las digitales sí."
  fi
else
  echo "➜ tesseract: ya instalado"
fi

# 2b. git (necesario para descargar pdf-tool)
if ! command -v git >/dev/null 2>&1; then
  echo ""
  echo "➜ No encontré git. Instalándolo..."
  if command -v apt-get >/dev/null 2>&1; then
    sudo apt-get update -qq
    sudo apt-get install -y -qq git
  elif command -v brew >/dev/null 2>&1; then
    brew install git >/dev/null
  else
    echo "✗ No pude instalar git automáticamente."
    echo "  Instalalo (https://git-scm.com) y volvé a correr este instalador."
    exit 1
  fi
fi

# 3. pdf-tool
echo ""
echo "➜ Instalando pdf-tool en $INSTALL_DIR ..."
if [ -d "$INSTALL_DIR/.git" ]; then
  git -C "$INSTALL_DIR" pull --ff-only >/dev/null 2>&1 || true
else
  git clone --depth 1 "$REPO" "$INSTALL_DIR"
fi
cd "$INSTALL_DIR"
if [ ! -d node_modules ]; then
  pnpm install --prod --ignore-scripts >/dev/null 2>&1
fi

mkdir -p "$BIN_DIR"
ln -sf "$INSTALL_DIR/bin/pdf-tool.mjs" "$BIN_DIR/pdf-tool"

# PATH
case ":$PATH:" in
  *":$BIN_DIR:"*) ;;
  *) echo "➜ Agregando $BIN_DIR a tu PATH..."
     SHELL_PROFILE=""
     if [ -f "$HOME/.bashrc" ]; then SHELL_PROFILE="$HOME/.bashrc"; fi
     if [ -f "$HOME/.zshrc" ]; then SHELL_PROFILE="$HOME/.zshrc"; fi
     if [ -n "$SHELL_PROFILE" ]; then
       echo "" >> "$SHELL_PROFILE"
       echo "export PATH=\"$BIN_DIR:\$PATH\"" >> "$SHELL_PROFILE"
     fi
     echo "   Reiniciá tu terminal o ejecutá:  export PATH=\"$BIN_DIR:\$PATH\""
     ;;
esac

echo ""
echo "=============================================="
echo "✅ ¡Listo! pdf-tool quedó instalado."
echo ""
echo "Probá con:"
echo "    pdf-tool ayuda"
echo "    pdf-tool facturas /ruta/a/tus/facturas"
echo "    pdf-tool facturas /ruta/a/tus/facturas --ocr   (para escaneadas)"
echo ""
echo "¿Facturas de proveedores desconocidos? Configurá tu clave de IA:"
echo "    pdf-tool config"
echo ""
echo "Si el comando no aparece, abrí una terminal nueva."
echo "=============================================="
