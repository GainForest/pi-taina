#!/usr/bin/env bash
set -euo pipefail

# ============================================================
# Pi-Tainá Setup Script
# Supports: macOS (Apple Silicon) and Raspberry Pi OS (ARM64)
# Idempotent — safe to run multiple times
# ============================================================

# --------------- Color helpers ---------------
if command -v tput &>/dev/null && tput colors &>/dev/null && [ "$(tput colors)" -ge 8 ]; then
  GREEN="$(tput setaf 2)"
  RED="$(tput setaf 1)"
  YELLOW="$(tput setaf 3)"
  RESET="$(tput sgr0)"
else
  GREEN=""
  RED=""
  YELLOW=""
  RESET=""
fi

ok()   { echo "${GREEN}${1}${RESET}"; }
err()  { echo "${RED}${1}${RESET}" >&2; }
warn() { echo "${YELLOW}${1}${RESET}"; }
info() { echo "${1}"; }

# --------------- Banner ---------------
echo ""
echo "🌿 Pi-Tainá Setup"
echo "=================================="

# --------------- 1. Platform detection ---------------
OS="$(uname -s)"   # Darwin or Linux
ARCH="$(uname -m)" # arm64 or aarch64 or x86_64

if [ "$OS" = "Darwin" ]; then
  PLATFORM="macOS"
elif [ "$OS" = "Linux" ]; then
  PLATFORM="Linux"
else
  err "❌ Unsupported OS: $OS"
  exit 1
fi

info "Platform: ${PLATFORM} (${ARCH})"
echo ""

# --------------- 2. Check/install Node.js 20+ ---------------
info "🔍 Checking Node.js..."

node_ok=false
if command -v node &>/dev/null; then
  NODE_VERSION="$(node --version)"          # e.g. v20.11.0
  NODE_MAJOR="${NODE_VERSION#v}"            # strip leading 'v'
  NODE_MAJOR="${NODE_MAJOR%%.*}"            # keep major only
  if [ "$NODE_MAJOR" -ge 20 ]; then
    ok "✅ Node.js ${NODE_VERSION}"
    node_ok=true
  else
    warn "⚠️  Node.js ${NODE_VERSION} found but version 20+ is required — upgrading..."
  fi
else
  warn "⚠️  Node.js not found — installing..."
fi

if [ "$node_ok" = false ]; then
  if [ "$PLATFORM" = "macOS" ]; then
    if command -v brew &>/dev/null; then
      info "📦 Installing Node.js 20 via Homebrew..."
      brew install node@20
      # Homebrew may not link node@20 automatically
      BREW_PREFIX="$(brew --prefix)"
      export PATH="${BREW_PREFIX}/opt/node@20/bin:${PATH}"
    else
      err "❌ Homebrew is not installed."
      err "   Install it first: https://brew.sh"
      err "   Then re-run this script."
      exit 1
    fi
  elif [ "$PLATFORM" = "Linux" ]; then
    info "📦 Installing Node.js 20 via NodeSource..."
    curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
    sudo apt-get install -y nodejs
  fi

  # Verify after install
  if ! command -v node &>/dev/null; then
    err "❌ Node.js installation failed — 'node' not found in PATH."
    exit 1
  fi
  NODE_VERSION="$(node --version)"
  NODE_MAJOR="${NODE_VERSION#v}"
  NODE_MAJOR="${NODE_MAJOR%%.*}"
  if [ "$NODE_MAJOR" -lt 20 ]; then
    err "❌ Node.js ${NODE_VERSION} installed but version 20+ is required."
    exit 1
  fi
  ok "✅ Node.js ${NODE_VERSION} installed"
fi

# --------------- 3. Check/install Python 3 ---------------
echo ""
info "🔍 Checking Python 3..."

if command -v python3 &>/dev/null; then
  PYTHON_VERSION="$(python3 --version 2>&1)"
  ok "✅ ${PYTHON_VERSION}"
else
  warn "⚠️  Python 3 not found — installing..."
  if [ "$PLATFORM" = "macOS" ]; then
    if command -v brew &>/dev/null; then
      info "📦 Installing Python 3 via Homebrew..."
      brew install python3
    else
      err "❌ Homebrew is not installed. Cannot install Python 3."
      err "   Install Homebrew first: https://brew.sh"
      exit 1
    fi
  elif [ "$PLATFORM" = "Linux" ]; then
    info "📦 Installing Python 3 via apt-get..."
    sudo apt-get install -y python3
  fi

  if command -v python3 &>/dev/null; then
    PYTHON_VERSION="$(python3 --version 2>&1)"
    ok "✅ ${PYTHON_VERSION} installed"
  else
    err "❌ Python 3 installation failed."
    exit 1
  fi
fi

# --------------- 4. Install npm dependencies ---------------
echo ""
info "📦 Installing dependencies..."

# Run npm install from the directory containing this script
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

npm install
ok "✅ Dependencies installed"

# --------------- 5. Setup .env file ---------------
echo ""
info "🔍 Checking .env configuration..."

if [ -f ".env" ]; then
  ok "✅ .env already exists — skipping"
else
  if [ ! -f ".env.example" ]; then
    err "❌ .env.example not found. Cannot create .env."
    exit 1
  fi
  cp .env.example .env
  echo ""
  info "📝 Created .env from template. You need to set these 3 values:"
  echo ""
  info "  1. TELEGRAM_BOT_TOKEN — get from @BotFather on Telegram"
  info "  2. GEMINI_API_KEY     — get from https://aistudio.google.com/apikey"
  info "  3. ADMIN_USER_ID      — get from @userinfobot on Telegram"
  echo ""
  info "  Edit .env with: nano .env"
fi

# --------------- 6. Optional: install pm2 ---------------
echo ""
warn "Install pm2 for always-on service mode? (recommended for Mac Mini / RPi) [y/N]"
read -r PM2_ANSWER </dev/tty || PM2_ANSWER="n"

case "$PM2_ANSWER" in
  [yY]|[yY][eE][sS])
    info "📦 Installing pm2 globally..."
    npm install -g pm2
    ok "✅ pm2 installed"
    ;;
  *)
    info "⏭️  Skipping pm2 installation"
    ;;
esac

# --------------- 7. Final instructions ---------------
echo ""
ok "🌿 Setup complete!"
echo ""
info "  Start the bot:     npm start"
info "  Development mode:  npm run dev"
info "  Run smoke test:    npm run test:smoke"
echo ""
info "  For always-on service:"
info "    pm2 start npm --name taina -- start"
info "    pm2 startup && pm2 save"
echo ""
