# WhatsApp Chaos Bot

A WhatsApp group entertainment bot built with Node.js and `whatsapp-web.js`.

The bot includes games, economy features, AI, music playback, weather information, and other group features.

## Features

* 🎮 Group games
* 💰 Economy system
* 🤖 AI assistant
* 🎵 YouTube music playback
* 🌦️ Weather information
* 🏆 XP and rewards
* 👥 WhatsApp group interaction
* 🔐 WhatsApp session persistence
* ⚡ PM2 always-online deployment

## Requirements

The recommended deployment environment is:

* Ubuntu 22.04 or newer
* Node.js 22+
* npm
* Python 3
* FFmpeg
* Git
* Internet connection
* WhatsApp account

The setup script automatically installs/checks most of these requirements.

---

# Installation

## 1. Clone the repository

```bash
git clone YOUR_REPOSITORY_URL
```

Enter the project:

```bash
cd WhatsApp-Chaos-Bot
```

## 2. Run the setup script

```bash
chmod +x setup.sh
./setup.sh
```

The setup script installs and configures:

* Node.js dependencies
* FFmpeg
* yt-dlp
* Python dependencies
* bgutil PO-token provider
* PM2
* required bot directories
* the bot process
* the bgutil PO-token process

---

# Environment Variables

Create your `.env` file:

```bash
nano .env
```

Add the API keys required by your installation.

Never commit `.env` to GitHub.

A recommended approach is to provide a `.env.example` file containing variable names but no real secrets.

Example:

```env
GEMINI_API_KEY=
OPENWEATHERMAP_API_KEY=
```

Fill in the actual values on the server.

---

# YouTube / Music Setup

The bot uses `yt-dlp` for YouTube media.

The setup script installs the bgutil PO-token provider because YouTube may require proof-of-origin tokens for media extraction.

The provider is installed separately from the bot:

```text
~/bgutil-ytdlp-pot-provider
```

It runs as a PM2 process:

```text
bgutil-pot
```

The WhatsApp bot runs as:

```text
chaos-bot
```

YouTube cookies are intentionally **not included in the repository**.

If cookies are required by the current YouTube extraction environment, create:

```text
cookies.txt
```

in the project directory.

Never upload this file to GitHub.

---

# Starting the Bot

After setup:

```bash
pm2 status
```

You should see:

```text
bgutil-pot
chaos-bot
```

Both should show:

```text
online
```

---

# PM2 Commands

View bot logs:

```bash
pm2 logs chaos-bot
```

View bgutil logs:

```bash
pm2 logs bgutil-pot
```

Restart the bot:

```bash
pm2 restart chaos-bot
```

Restart bgutil:

```bash
pm2 restart bgutil-pot
```

Restart both:

```bash
pm2 restart all
```

View processes:

```bash
pm2 status
```

---

# Checking bgutil

The bgutil PO-token server runs locally on port `4416`.

Test it with:

```bash
curl http://127.0.0.1:4416/ping
```

A successful response looks similar to:

```json
{
  "server_uptime": 123,
  "version": "2.0.0"
}
```

---

# WhatsApp Authentication

When the bot starts for the first time, `whatsapp-web.js` will generate a QR code.

Scan the QR code using WhatsApp.

The authenticated session is stored locally and is ignored by Git.

Do not commit the session directory to GitHub.

---

# Updating the Bot

Pull the latest code:

```bash
git pull
```

Install any new dependencies:

```bash
npm install
```

Restart the bot:

```bash
pm2 restart chaos-bot
```

---

# Troubleshooting

## Bot is offline

Check:

```bash
pm2 status
```

Then:

```bash
pm2 logs chaos-bot
```

## YouTube playback fails

Check bgutil:

```bash
pm2 status
```

Then:

```bash
pm2 logs bgutil-pot
```

Test the server:

```bash
curl http://127.0.0.1:4416/ping
```

Check yt-dlp:

```bash
yt-dlp --version
```

## Check the PO-token provider

Run:

```bash
yt-dlp -v "https://www.youtube.com/watch?v=VIDEO_ID" 2>&1 | grep -E "PO Token Providers|bgutil|LOGIN_REQUIRED|Sign in"
```

You should see:

```text
bgutil:http-2.0.0
```

---

# Security

Never commit:

```text
.env
cookies.txt
data/
node_modules/
downloads/
```

These may contain credentials, authentication sessions, private data, or generated media.

---

# Project Structure

```text
WhatsApp-Chaos-Bot/
│
├── index.js
├── setup.sh
├── .gitignore
├── README.md
├── package.json
├── package-lock.json
│
├── src/
│   ├── commands/
│   ├── games/
│   └── assets/
│
├── downloads/
└── data/
```

The bgutil provider is intentionally kept outside the bot repository:

```text
~/bgutil-ytdlp-pot-provider/
```

This keeps the bot repository focused on the WhatsApp bot itself.

---

# Running on a VPS

For a production VPS deployment, PM2 is recommended.

The setup script automatically creates:

```text
bgutil-pot
chaos-bot
```

and saves the PM2 process list.

This allows the services to be restored after a server reboot.

## License

Add your project's license information here.

```
```
