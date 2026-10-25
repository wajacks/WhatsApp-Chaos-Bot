<div align="center">
<h1>⚡ WhatsApp Chaos Bot ⚡</h1>
<p><strong>Turn the group chat into a game lobby.</strong></p>
<p>Multiplayer games, friendly rivalries, rewards, AI tools, and plenty of chaos.</p>

<img alt="Node.js 22.12+" src="https://img.shields.io/badge/Node.js-22.12%2B-339933?logo=nodedotjs&logoColor=white">
<img alt="WhatsApp Web.js" src="https://img.shields.io/badge/WhatsApp-Web.js-25D366?logo=whatsapp&logoColor=white">
<img alt="MIT License" src="https://img.shields.io/badge/License-MIT-blue.svg">
</div>

---

## ✨ What’s inside

- **Game night:** Country Rebus, Wordle, Word Chain, Scrambled Word, Word Forge, and Mafia.
- **Progression:** profiles, levels, XP, dollar balances, daily rewards, and a shop.
- **AI and utilities:** AI chat, image generation, Bible verses, hymns, weather, and class tools.
- **Group and private play:** several games use group lobbies with private-message actions or clues.

Open `!menu` for the command center or `!games` for the current game list.

## 🎮 Game lineup

| Game | How to start |
|---|---|
| Country Rebus | `!rebus` → join with `!joinrebus`; host starts with `!startrebus` |
| Wordle | `!wordle` → join with `!join`; host starts with `!startwordle` |
| Word Chain | `!wordchain` → join with `!wjoin`, then the host uses `!startwordchain` |
| Scrambled Word | `!scramble` → join with `!joinscramble`; host starts with `!startscramble` |
| Word Forge | `!wordforge` → join with `!joinforge`, then the host uses `!startforge` |
| Mafia | `!mafia` → join with `!joinmafia`; host starts with `!startmafia` |

The lobby host must also join as a player. Only the host can start or stop a game, and a group can run one game at a time. Lobbies stay open until the host acts. Use `!games` for exact join/start/stop commands. Economy amounts are shown in dollars; existing saved balances keep their values.

## 🎨 Image Studio

Use one command: `!draw <prompt>`. The bot offers:

1. **GPT-image-2** — Azure image generation, costs $5,000 game dollars.
2. **Pollinations** — free.

Reply with `1` or `2` within 60 seconds to generate. Reply `cancel` to stop. Azure uses `AZURE_OPENAI_IMAGE_DEPLOYMENT` (defaults to `gpt-image-2`). Image requests wait up to five minutes by default; set `AZURE_OPENAI_IMAGE_TIMEOUT_MS` to change that limit.


## 🔍 Image Analysis

Attach a photo with a caption such as `!analyze What is happening here?`, or reply to a photo with `!analyze <question>`. The bot sends the image and question to the Azure vision-capable chat deployment and replies with a text analysis. Analysis costs $2,000 game dollars; the owner is exempt.

Supported formats are JPEG, PNG, WebP, and GIF. Images must be smaller than 10 MB. The command uses `AZURE_OPENAI_CHAT_DEPLOYMENT` and consumes Azure usage. If WhatsApp cannot download the image, resend it as a regular photo rather than a view-once image.

Azure image generation costs $5,000 game dollars; Pollinations is free. Image analysis costs $2,000 game dollars. The owner is exempt. To purchase game dollars, send M-Pesa to 0111659469, then submit `!buycoins <KSh amount> <M-Pesa transaction code>`. The owner verifies the payment before crediting the balance.

## 🚀 First-time setup

The included `setup.sh` is deliberately small. It checks the environment, creates the bot’s local runtime folders, creates a private `.env` from `.env.example` if needed, and installs the locked Node.js dependencies with `npm ci`.

It does **not** install system packages, change swap settings, install media download tools, install PM2, or start the bot. The steps below cover those choices.

### 1. Prepare the server

The documented server setup targets **Ubuntu 22.04+ or Debian 12+**, with a regular non-root account for running the bot.

Install:

- Node.js **22.12 or newer**, npm, and Git.
- Internet access to GitHub and the npm registry.
- The Chromium shared libraries listed in the next step.

Install Node.js from the [official Node.js downloads page](https://nodejs.org/en/download), then confirm:

```bash
node --version
npm --version
git --version
```

The bot’s WhatsApp Web client uses Puppeteer and Chrome. Puppeteer downloads its matching browser during dependency installation; Linux still needs the browser’s shared system libraries.

<details>
<summary><strong>Ubuntu / Debian: install Chrome system libraries</strong></summary>

Run this once on the server:

```bash
sudo apt-get update
sudo apt-get install -y \
  ca-certificates fonts-liberation libasound2 libatk-bridge2.0-0 \
  libatk1.0-0 libc6 libcairo2 libcups2 libdbus-1-3 libexpat1 \
  libfontconfig1 libgbm1 libgcc1 libglib2.0-0 libgtk-3-0 \
  libnspr4 libnss3 libpango-1.0-0 libpangocairo-1.0-0 \
  libstdc++6 libx11-6 libx11-xcb1 libxcb1 libxcomposite1 \
  libxcursor1 libxdamage1 libxext6 libxfixes3 libxi6 \
  libxrandr2 libxrender1 libxss1 libxtst6 lsb-release wget xdg-utils
```

Package names can vary by distribution release. See Puppeteer’s [Linux troubleshooting guide](https://pptr.dev/troubleshooting#chrome-doesnt-launch-on-linux) if apt reports a package as unavailable.

</details>

### 2. Get the bot and install its core dependencies

Clone the repository using the URL and authentication method available to you, then enter the project folder:

```bash
git clone https://github.com/wajacks/WhatsApp-Chaos-Bot.git
cd WhatsApp-Chaos-Bot
bash setup.sh
```

The setup script requires Node.js 22.12+, npm, and Git. It does not need root privileges. The lockfile fetches the public WhatsApp Web.js dependency over HTTPS.

### 3. Configure the bot

The first setup creates `.env` and restricts it to your account. Edit it before starting:

```bash
nano .env
```

| Variable | Required? | Purpose |
|---|---|---|
| `AZURE_OPENAI_KEY` | **Yes for startup** | Azure OpenAI credential; Azure is the primary provider for AI chat and Mafia narration. |
| `AZURE_OPENAI_ENDPOINT` | **Yes for startup** | Azure resource endpoint, for example `https://your-resource.openai.azure.com/`. |
| `AZURE_OPENAI_CHAT_DEPLOYMENT` | Recommended | Azure chat deployment for AI chat and Mafia narration; defaults to `gpt-4o-mini`. |
| `AZURE_OPENAI_IMAGE_DEPLOYMENT` | Optional | Azure deployment offered as choice 1 in `!draw`; defaults to `gpt-image-2`. |
| `AZURE_OPENAI_IMAGE_TIMEOUT_MS` | Optional | Azure image request timeout in milliseconds; defaults to 300000 (5 minutes). |
| `OWNER_NUMBER` | Recommended | Owner controls. Use the full international number with digits only, such as `254712345678`. |
| `GEMINI_API_KEY` | Optional | Enables Gemini fallback for AI chat and Mafia narration when Azure OpenAI is unavailable. |
| `OPENWEATHERMAP_API_KEY` | Optional | Enables live weather lookups. |
| `PAIRING_NUMBER` | Optional | Request a WhatsApp pairing code. Leave blank to use a QR code. |

The Azure key and endpoint are required at startup; Azure OpenAI handles AI chat and Mafia narration as the primary provider. Gemini is only used as a fallback when `GEMINI_API_KEY` is configured. Keep your real `.env` private; never commit it or paste its contents into an issue.

### 4. Link WhatsApp and start the bot

Start the bot in the foreground for the first login:

```bash
node index.js
```

A QR code appears in the terminal. On the WhatsApp account you want the bot to use, open **Linked devices → Link a device** and scan it. Keep the terminal running while you confirm that the bot connects.

If you set `PAIRING_NUMBER`, follow the pairing-code instructions printed by the bot instead. Use a dedicated WhatsApp account where possible.

## 🔁 Keep it online with PM2 (optional)

Run the bot as the same non-root account that owns the project and WhatsApp session:

```bash
npm install --global pm2
pm2 start index.js --name chaos-bot --cwd "$PWD"
pm2 logs chaos-bot
```

To restore the process after a server reboot, configure PM2’s startup service once:

```bash
pm2 startup
```

PM2 prints a system command. Run that command, then save the process list:

```bash
pm2 save
```

See the [PM2 startup guide](https://pm2.keymetrics.io/docs/usage/startup/) for details. The setup script intentionally leaves process-manager installation and boot configuration to you. The in-chat `!owner restart` and `!owner update` commands require the bot to run in PM2 under the name `chaos-bot`.

Useful commands:

```bash
pm2 status
pm2 logs chaos-bot
pm2 restart chaos-bot
pm2 stop chaos-bot
```

## 🎵 Optional media and assets

The bundled OGG tracks support `!song` without extra system tools. Install the optional packages below for voice generation, hymn audio, and YouTube downloads.

### Voice and audio conversion

Voice note generation and hymn piano audio use FFmpeg. Install it on Ubuntu/Debian:

```bash
sudo apt-get install -y ffmpeg
```

### YouTube downloads

`!video` is active. It offers 360p, 480p, and 720p video plus audio-only downloads. Downloads use Node.js as yt-dlp's JavaScript runtime and pass `cookies.txt` from the project root when present. The bot also accepts `YOUTUBE_COOKIES_PATH` in `.env` if you keep the file elsewhere. The cookie file is ignored by Git; transfer it to the server securely and run `chmod 600 cookies.txt`. Never commit or paste the cookie file. If no cookie file is present, yt-dlp attempts an unauthenticated download. Video over 50 MB is rejected to protect WhatsApp Web and the bot's memory. The bot uses the `$HOME/.venvs/chaos-media/bin/yt-dlp` executable when it exists, with `YT_DLP_PATH` available to override it.

Install yt-dlp in a Python virtual environment and FFmpeg for audio extraction:

```bash
sudo apt-get install -y ffmpeg python3-venv
python3 -m venv "$HOME/.venvs/chaos-media"
"$HOME/.venvs/chaos-media/bin/python" -m pip install --upgrade pip 'yt-dlp[default]'
"$HOME/.venvs/chaos-media/bin/yt-dlp" --version
node --version
```

The bot automatically uses this virtual environment's yt-dlp executable. Node.js must be available to the bot process for YouTube's JavaScript challenges. To enable cookie-backed downloads, securely copy your Netscape-format YouTube cookie export to `cookies.txt` in the project root, then run:

```bash
chmod 600 cookies.txt
```

Keep the cookie file out of Git and refresh it when YouTube expires it. You can set `YOUTUBE_COOKIES_PATH` in `.env` if the file is stored elsewhere.

### Optional game assets

- **Mafia:** `rules.pdf` and either `briefing.mp3` or `briefing.ogg` may be placed in the project root. Missing files are skipped by the game.
- **Random songs:** `!song` uses the OGG files bundled under `src/assets`.

### Memory and swap

The core setup does not change swap settings. Use your VPS provider’s guidance if the server needs additional swap; some containers and managed servers do not allow creating a swap file.

## 💾 Sessions, data, and moving servers

The WhatsApp login is saved under `data/session`. User economy data and game state are stored as local files under `data/`; they are not in Git.

- Keep the bot running as the same operating-system user so it can read its session and data.
- Back up `data/` securely before replacing a server or reinstalling.
- Stop the old instance before moving the WhatsApp session to another server. Do not run two bot instances with the same WhatsApp session at once.
- The setup script restricts `data/`, `data/session/`, and `downloads/` to the bot account. Treat backups of `data/` as private: they contain authentication state and player identifiers.
- The Class Portal also writes a scheduled backup to `data/classdb_backup.json`; continue backing up the full `data/` directory.

## 🧰 Troubleshooting

**The bot exits with an Azure credentials error**  
Set both `AZURE_OPENAI_KEY` and `AZURE_OPENAI_ENDPOINT` in `.env`, then start it again.

**Chrome fails to launch or reports a missing shared library**  
Install the Ubuntu/Debian libraries above. Puppeteer’s [troubleshooting guide](https://pptr.dev/troubleshooting#chrome-doesnt-launch-on-linux) has the current package list.

**WhatsApp asks for a new QR code**  
Check that the bot runs as the same user and that `data/session` is writable and persistent. If you moved servers, link the device again if the saved session cannot be reused.

**YouTube downloads fail**  
Confirm the bot can access Node.js, FFmpeg, and `$HOME/.venvs/chaos-media/bin/yt-dlp`. Check that the cookie file is present at the project root (or that `YOUTUBE_COOKIES_PATH` is set) and has mode `600`. Cookie exports expire, so refresh them if yt-dlp reports a sign-in or bot-check error. Video requests above 50 MB are rejected.

## 🔄 Updating

If the bot runs under PM2:

```bash
pm2 stop chaos-bot
git pull --ff-only
npm ci
pm2 restart chaos-bot
```

For a foreground run, stop it with **Ctrl+C**, update the checkout with `git pull --ff-only`, run `npm ci`, then start it with `node index.js`.

## 🔐 Keep these files private

Do not commit or publicly share:

- `.env` — API keys and configuration
- `data/` — WhatsApp session, player profiles, and game state
- `downloads/` — requested media files

These paths are ignored by Git where applicable. Check `git status` before pushing deployment changes.

## 📜 License

This project is released under the [MIT License](LICENSE).
