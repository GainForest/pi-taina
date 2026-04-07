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

# Check if we can actually read from /dev/tty (not just if the file exists)
HAS_TTY=false
if (exec < /dev/tty) 2>/dev/null; then
  HAS_TTY=true
fi

# --------------- 1b. Architecture check (Linux only) ---------------
if [ "$PLATFORM" = "Linux" ]; then
  if [ "$ARCH" != "aarch64" ] && [ "$ARCH" != "x86_64" ]; then
    err "❌ Unsupported architecture: $ARCH"
    err "   Pi-Tainá requires 64-bit Raspberry Pi OS (aarch64)."
    err "   32-bit (armv7l/armhf) is not supported."
    err "   Download 64-bit OS: https://www.raspberrypi.com/software/"
    exit 1
  fi
  if [ "$ARCH" = "aarch64" ]; then
    ok "✅ 64-bit ARM detected"
  fi
fi

# --------------- 1c. RAM/swap check (Linux only) ---------------
if [ "$PLATFORM" = "Linux" ]; then
  TOTAL_MEM_KB=$(grep MemTotal /proc/meminfo | awk '{print $2}')
  TOTAL_MEM_MB=$((TOTAL_MEM_KB / 1024))
  if [ "$TOTAL_MEM_MB" -lt 1500 ]; then
    SWAP_KB=$(grep SwapTotal /proc/meminfo | awk '{print $2}')
    SWAP_MB=$((SWAP_KB / 1024))
    if [ "$SWAP_MB" -lt 1024 ]; then
      warn "⚠️  Low RAM (${TOTAL_MEM_MB}MB) and swap (${SWAP_MB}MB) detected."
      warn "   npm install may fail. Consider adding swap:"
      info "     sudo dphys-swapfile swapoff"
      info "     sudo sed -i 's/CONF_SWAPSIZE=.*/CONF_SWAPSIZE=2048/' /etc/dphys-swapfile"
      info "     sudo dphys-swapfile setup && sudo dphys-swapfile swapon"
      echo ""
      warn "Continue anyway? [y/N]"
      if [ "$HAS_TTY" = true ]; then
        read -r SWAP_ANSWER < /dev/tty || SWAP_ANSWER="n"
      else
        SWAP_ANSWER="y"
      fi
      case "$SWAP_ANSWER" in
        [yY]|[yY][eE][sS]) info "Continuing..." ;;
        *) err "Setup aborted. Add swap and re-run."; exit 1 ;;
      esac
    else
      ok "✅ Sufficient swap (${SWAP_MB}MB)"
    fi
  fi
fi

# --------------- 1d. Check git ---------------
if ! command -v git &>/dev/null; then
  if [ "$PLATFORM" = "Linux" ]; then
    warn "⚠️  git not found — installing..."
    sudo apt-get update && sudo apt-get install -y git
  else
    err "❌ git is required. Install it and re-run."
    exit 1
  fi
fi

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
  info "📝 Let's configure your bot. You'll need 3 things:"
  echo ""
  info "  1. 🤖 Telegram Bot Token — message @BotFather on Telegram, send /newbot"
  info "  2. 🔑 Gemini API Key     — get from https://aistudio.google.com/apikey"
  info "  3. 👤 Your Telegram ID    — message @userinfobot on Telegram"
  echo ""
  info "  Press Enter to skip any value — you can always edit .env later."
  echo ""

  # Read from /dev/tty so it works even if script is piped
  prompt_var() {
    local var_name="$1"
    local prompt_text="$2"
    local value=""
    printf "%s" "$prompt_text"
    if [ "$HAS_TTY" = true ]; then
      read -r value < /dev/tty || value=""
    else
      value=""
    fi
    if [ -n "$value" ]; then
      # Use | as sed delimiter to avoid issues with / in tokens
      if [ "$PLATFORM" = "macOS" ]; then
        sed -i '' "s|^${var_name}=.*|${var_name}=${value}|" .env
      else
        sed -i "s|^${var_name}=.*|${var_name}=${value}|" .env
      fi
      ok "  ✅ ${var_name} set"
    else
      info "  ⏭️  Skipped ${var_name}"
    fi
  }

  prompt_var "TELEGRAM_BOT_TOKEN" "🤖 Telegram Bot Token: "
  prompt_var "GEMINI_API_KEY" "🔑 Gemini API Key: "
  prompt_var "ADMIN_USER_ID" "👤 Your Telegram User ID: "

  echo ""

  # Check if all 3 required vars are set
  MISSING=0
  grep -q "^TELEGRAM_BOT_TOKEN=$" .env && MISSING=$((MISSING + 1))
  grep -q "^GEMINI_API_KEY=$" .env && MISSING=$((MISSING + 1))
  grep -q "^ADMIN_USER_ID=$" .env && MISSING=$((MISSING + 1))

  if [ "$MISSING" -eq 0 ]; then
    ok "✅ All required variables configured!"
  else
    warn "⚠️  ${MISSING} required variable(s) still empty. Edit .env before starting:"
    info "    nano .env"
  fi
fi

# --------------- 6. Optional: install pm2 ---------------
echo ""
warn "Install pm2 for always-on service mode? (recommended for Mac Mini / RPi) [y/N]"
if [ "$HAS_TTY" = true ]; then
  read -r PM2_ANSWER < /dev/tty || PM2_ANSWER="n"
else
  PM2_ANSWER="n"
fi

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
