#!/usr/bin/env bash

set -e

# Color definitions for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

info() { echo -e "${GREEN}[INFO]${NC} $1"; }
warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
err()  { echo -e "${RED}[ERROR]${NC} $1"; }

info "Starting environment setup for WhatsApp-Chaos-Bot..."

# 0. Check Git status for potential drift
if [ -d .git ]; then
    info "Checking Git repository status..."
    if [[ -n $(git status -s) ]]; then
        warn "You have uncommitted changes or untracked files on this VPS!"
        warn "Consider committing or stashing them before deployment to prevent drift."
    else
        info "Git working tree is clean."
    fi
fi

# 1. Create required directories
info "Creating required project directories..."
mkdir -p logs data downloads temp

# 2. Environment Configuration (.env) Setup
info "Checking environment variables..."

if [ ! -f .env ]; then
    warn ".env file not found. Creating from template..."
    
    read -p "Enter your Google Gemini API Key (GEMINI_API_KEY): " user_gemini_key
    read -p "Enter your OpenWeatherMap API Key (OPENWEATHERMAP_API_KEY): " user_weather_key
    read -p "Enter your Azure OpenAI Key (AZURE_OPENAI_KEY): " user_azure_key
    read -p "Enter your Azure OpenAI Endpoint (AZURE_OPENAI_ENDPOINT): " user_azure_endpoint
    read -p "Enter Bot Phone Number for Pairing (or press Enter to use QR Code): " user_pairing_number
    
    cat <<EOF > .env
# WhatsApp Chaos Bot Configuration
GEMINI_API_KEY=${user_gemini_key}
OPENWEATHERMAP_API_KEY=${user_weather_key}

# Azure OpenAI (Handles !analyze Vision and !ai Chat Fallback)
AZURE_OPENAI_KEY=${user_azure_key}
AZURE_OPENAI_ENDPOINT=${user_azure_endpoint}

# WhatsApp Authentication (Leave blank to default to QR Code)
PAIRING_NUMBER=${user_pairing_number}

# Model Deployments
AZURE_OPENAI_CHAT_DEPLOYMENT=gpt-4o-mini

# Server Port (Changed from 4416 to avoid collision with bgutil-pot on 4416)
PORT=3000
EOF
    info ".env file created successfully."
else
    info ".env file exists."
fi

# Validate key existence in .env
if ! grep -q "GEMINI_API_KEY=." .env; then
    warn "GEMINI_API_KEY appears to be empty in .env."
fi

if ! grep -q "OPENWEATHERMAP_API_KEY=." .env; then
    warn "OPENWEATHERMAP_API_KEY appears to be empty in .env. Weather features may fail."
fi

# 3. Check optional runtime assets
info "Verifying optional game/audio assets..."
[ -f cookies.txt ] && info "Found cookies.txt for YouTube downloads." || warn "cookies.txt missing. YouTube audio streaming may hit rate-limits."
[ -f rules.pdf ] && info "Found rules.pdf for Mafia." || warn "rules.pdf missing. Mafia case file will skip sending the document."
[ -f briefing.mp3 ] || [ -f briefing.ogg ] && info "Found Mafia briefing audio." || warn "briefing audio missing. Mafia dispatch audio will be skipped."

# 4. Check Node.js & npm
info "Checking Node.js..."
if ! command -v node &> /dev/null; then
    err "Node.js is not installed. Please install Node.js (v18+ recommended)."
    exit 1
fi
info "Node.js version: $(node -v)"

if ! command -v npm &> /dev/null; then
    err "npm is not installed."
    exit 1
fi

# 5. Check & Install PM2 globally
if ! command -v pm2 &> /dev/null; then
    info "Installing PM2 globally..."
    npm install -g pm2
else
    info "PM2 is already installed."
fi

# 6. Check/Install System Dependencies (FFmpeg, Python3, pip)
info "Checking system dependencies..."

if ! command -v ffmpeg &> /dev/null; then
    warn "FFmpeg not found. Attempting install..."
    if command -v apt-get &> /dev/null; then
        sudo apt-get update && sudo apt-get install -y ffmpeg python3 python3-pip curl
    else
        err "Please install FFmpeg and Python3 manually."
        exit 1
    fi
else
    info "FFmpeg is installed."
fi

PIP_CMD="pip3"
if ! command -v pip3 &> /dev/null; then
    PIP_CMD="pip"
fi

# 7. Install/Update yt-dlp & bgutil-ytdlp-pot-provider
info "Installing/Updating yt-dlp and bgutil provider..."
$PIP_CMD install --upgrade yt-dlp bgutil-ytdlp-pot-provider

# 8. Install Node.js npm dependencies
info "Installing Node.js dependencies..."
npm install

# 9. Start/Restart services via PM2
info "Configuring PM2 services..."

# bgutil PO Token Provider service (Runs strictly on port 4416)
if pm2 list | grep -q "bgutil-pot"; then
    info "Restarting bgutil-pot service..."
    pm2 restart bgutil-pot
else
    info "Starting bgutil-pot service..."
    pm2 start bgutil-ytdlp-pot-provider --name "bgutil-pot" -- run
fi

# WhatsApp Chaos Bot service
if pm2 list | grep -q "chaos-bot"; then
    info "Restarting chaos-bot service..."
    pm2 restart chaos-bot
else
    info "Starting chaos-bot service..."
    pm2 start index.js --name "chaos-bot"
fi

# 10. Save PM2 state
info "Saving PM2 process configuration..."
pm2 save

# 11. Verify bgutil server health
info "Verifying bgutil PO Token server status..."
sleep 3

HEALTH_URL="http://127.0.0.1:4416/ping"
if command -v curl &> /dev/null; then
    if curl -s --head --request GET "$HEALTH_URL" | grep -E "200|404|302" > /dev/null; then
        info "bgutil server is up and listening on port 4416!"
    else
        warn "bgutil server did not respond on $HEALTH_URL. Check logs: 'pm2 logs bgutil-pot'"
    fi
fi

info "Setup completed successfully! Use 'pm2 logs chaos-bot' to monitor output and scan the QR code."