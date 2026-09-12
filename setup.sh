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

# 1. Create required directories
info "Creating required project directories..."
mkdir -p logs data downloads temp

# 2. Environment Configuration (.env) Setup
info "Checking environment variables..."

if [ ! -f .env ]; then
    warn ".env file not found. Creating from template..."
    
    # Prompt user for required API keys
    read -p "Enter your Google Gemini API Key (GEMINI_API_KEY): " user_gemini_key
    read -p "Enter your OpenWeatherMap API Key (OPENWEATHERMAP_API_KEY): " user_weather_key
    read -p "Enter your Azure OpenAI Key (AZURE_OPENAI_KEY): " user_azure_key
    read -p "Enter your Azure OpenAI Endpoint (AZURE_OPENAI_ENDPOINT): " user_azure_endpoint
    
    cat <<EOF > .env
# WhatsApp Chaos Bot Configuration
GEMINI_API_KEY=${user_gemini_key}
OPENWEATHERMAP_API_KEY=${user_weather_key}

# Azure OpenAI (Handles !analyze Vision and !ai Chat Fallback)
AZURE_OPENAI_KEY=${user_azure_key}
AZURE_OPENAI_ENDPOINT=${user_azure_endpoint}

# Model Deployments
AZURE_OPENAI_CHAT_DEPLOYMENT=gpt-4o-mini

# Media Routing Note:
# !draw  -> Pollinations.ai (Keyless)
# !speak -> google-tts-api (Keyless)

PORT=4416
EOF
    info ".env file created successfully."
else
    info ".env file exists."
fi

# Validate key existence in .env
if ! grep -q "GEMINI_API_KEY=." .env; then
    warn "GEMINI_API_KEY appears to be empty in .env. Remember to update it before running."
fi

if ! grep -q "OPENWEATHERMAP_API_KEY=." .env; then
    warn "OPENWEATHERMAP_API_KEY appears to be empty in .env. Weather features may fail."
fi

if ! grep -q "AZURE_OPENAI_KEY=." .env; then
    warn "AZURE_OPENAI_KEY appears to be empty in .env. Vision analysis (!analyze) and chat fallback will fail."
fi

if ! grep -q "AZURE_OPENAI_ENDPOINT=." .env; then
    warn "AZURE_OPENAI_ENDPOINT appears to be empty in .env. Vision analysis (!analyze) and chat fallback will fail."
fi

# 3. Check Node.js & npm
info "Checking Node.js..."
if ! command -v node &> /dev/null; then
    err "Node.js is not installed. Please install Node.js (v18+ recommended) and re-run."
    exit 1
fi
info "Node.js version: $(node -v)"

if ! command -v npm &> /dev/null; then
    err "npm is not installed. Please install npm and re-run."
    exit 1
fi

# 4. Check & Install PM2 globally
if ! command -v pm2 &> /dev/null; then
    info "Installing PM2 globally..."
    npm install -g pm2
else
    info "PM2 is already installed."
fi

# 5. Check/Install System Dependencies (FFmpeg, Python3, pip)
info "Checking system dependencies..."

if ! command -v ffmpeg &> /dev/null; then
    warn "FFmpeg not found. Attempting to install via package manager..."
    if command -v apt-get &> /dev/null; then
        sudo apt-get update && sudo apt-get install -y ffmpeg
    elif command -v brew &> /dev/null; then
        brew install ffmpeg
    else
        err "Failed to install FFmpeg automatically. Please install FFmpeg manually."
        exit 1
    fi
else
    info "FFmpeg is installed."
fi

if ! command -v python3 &> /dev/null; then
    err "Python3 is not installed. Please install Python3 and re-run."
    exit 1
fi

PIP_CMD=""
if command -v pip3 &> /dev/null; then
    PIP_CMD="pip3"
elif command -v pip &> /dev/null; then
    PIP_CMD="pip"
else
    err "pip is not installed. Please install python3-pip."
    exit 1
fi

# 6. Install/Update yt-dlp & bgutil-ytdlp-pot-provider
info "Installing/Updating yt-dlp..."
$PIP_CMD install --upgrade yt-dlp

info "Installing bgutil-ytdlp-pot-provider..."
$PIP_CMD install --upgrade bgutil-ytdlp-pot-provider

# 7. Install Node.js npm dependencies
info "Installing Node.js dependencies..."
npm install

# 8. Start/Restart services via PM2
info "Configuring PM2 services..."

# bgutil PO Token Provider service
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

# 9. Save PM2 state for system reboots
info "Saving PM2 process configuration..."
pm2 save

# 10. Verify bgutil server health
info "Verifying bgutil PO Token server status..."
sleep 3

HEALTH_URL="http://127.0.0.1:4416/ping"
if command -v curl &> /dev/null; then
    if curl -s --head --request GET "$HEALTH_URL" | grep -E "200|404|302" > /dev/null; then
        info "bgutil server is up and listening on port 4416!"
    else
        warn "bgutil server started but did not respond on $HEALTH_URL. Check logs: 'pm2 logs bgutil-pot'"
    fi
else
    info "curl not found, skipping HTTP health test."
fi

info "Setup completed successfully! Use 'pm2 logs' to monitor bot output and scan the WhatsApp QR code."