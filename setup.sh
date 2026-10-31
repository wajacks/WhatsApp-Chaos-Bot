#!/usr/bin/env bash
set -Eeuo pipefail

RED=$'\033[0;31m'
GREEN=$'\033[0;32m'
YELLOW=$'\033[1;33m'
RESET=$'\033[0m'

info() { printf '%b[INFO]%b %s\n' "$GREEN" "$RESET" "$1"; }
warn() { printf '%b[WARN]%b %s\n' "$YELLOW" "$RESET" "$1"; }
fail() { printf '%b[ERROR]%b %s\n' "$RED" "$RESET" "$1" >&2; exit 1; }

SCRIPT_DIR="$(cd -- "$(dirname -- "$0")" && pwd)"
cd "$SCRIPT_DIR"

info "Preparing WhatsApp Chaos Bot..."

if (( EUID == 0 )); then
    fail "Run setup as the regular bot account, not root. Use sudo only for the operating-system commands in README.md."
fi

if [[ "$(uname -s)" != "Linux" ]]; then
    fail "This setup script supports Linux. See README.md for the supported deployment path."
fi

if [[ ! -r /etc/os-release ]]; then
    fail "Cannot identify this Linux distribution. See README.md for supported systems."
fi

. /etc/os-release
if [[ "$ID" != "ubuntu" && "$ID" != "debian" ]]; then
    fail "This setup script supports Ubuntu and Debian. Your system is: $PRETTY_NAME"
fi

if [[ ! -f package.json || ! -f package-lock.json || ! -f index.js ]]; then
    fail "Run setup.sh from a WhatsApp Chaos Bot checkout containing package.json, package-lock.json, and index.js."
fi

for command_name in node npm git; do
    if ! command -v "$command_name" >/dev/null 2>&1; then
        fail "$command_name is required but was not found in PATH. Install the prerequisites listed in README.md and run setup again."
    fi
done

node_major="$(node -p 'Number(process.versions.node.split(".")[0])')"
node_minor="$(node -p 'Number(process.versions.node.split(".")[1])')"
if (( node_major < 22 || (node_major == 22 && node_minor < 12) )); then
    fail "Node.js 22.12 or newer is required. Detected $(node --version). Upgrade Node.js, then run setup again."
fi

info "Node.js $(node --version); npm $(npm --version)"
info "Creating the bot's runtime folders..."
mkdir -p data/session downloads
chmod 700 data data/session downloads

if [[ ! -f .env ]]; then
    if [[ ! -f .env.example ]]; then
        fail ".env.example is missing. Restore it from the repository before running setup."
    fi
    cp .env.example .env
    chmod 600 .env
    info "Created .env from .env.example."
else
    chmod 600 .env
    info "Kept your existing .env and restricted its permissions."
fi

info "Installing the locked Node.js dependencies with npm ci..."
npm ci

if ! grep -Eq '^AZURE_OPENAI_KEY=.+$' .env || ! grep -Eq '^AZURE_OPENAI_ENDPOINT=https?://.+' .env; then
    warn "Add AZURE_OPENAI_KEY and AZURE_OPENAI_ENDPOINT to .env before starting the bot; the current app initializes Azure OpenAI during startup."
fi

if ! grep -Eq '^OWNER_NUMBER=.+$' .env; then
    warn "Set OWNER_NUMBER in .env to enable owner-only controls."
fi

if grep -Eiq '^AI_VOICE_NOTES_ENABLED=true' .env && ! grep -Eq '^AZURE_SPEECH_KEY=.+$' .env; then
    warn "AI voice notes are enabled but AZURE_SPEECH_KEY is missing. Configure the Speech credentials or set AI_VOICE_NOTES_ENABLED=false."
fi

printf '\n'
info "Core setup is complete."
printf '%s\n' "Next:"
printf '%s\n' "  1. Review .env and configure the required Azure OpenAI credentials."
printf '%s\n' "  2. Install the Chromium system libraries listed in README.md."
printf '%s\n' "  3. Start the bot with: node index.js"
printf '%s\n' "Optional media tools and PM2 setup are documented in README.md."
