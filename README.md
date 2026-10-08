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
- **Progression:** profiles, levels, XP, coins, daily rewards, and a shop.
- **AI and utilities:** AI chat, image generation, Bible verses, hymns, weather, and class tools.
- **Group and private play:** several games use group lobbies with private-message actions or clues.

Open `!menu` for the command center or `!games` for the current game list.

## 🎮 Game lineup

| Game | How to start |
|---|---|
| Country Rebus | `!rebus` → players join with `!joinrebus`; use `!hint` for a clue |
| Wordle | `!wordle` → players join with `!join` |
| Word Chain | `!wordchain` → join with `!wjoin`, then the host uses `!startwordchain` |
| Scrambled Word | `!scramble` → join with `!joinscramble` |
| Word Forge | `!wordforge` → join with `!joinforge`, then the host uses `!startforge` |
| Mafia | `!mafia` → join with `!joinmafia`; voting and night actions happen in the group and DMs |

Use `!games` in WhatsApp for the latest command list. Hosts can use the game-specific stop command shown in `!menu`.

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
sudo apt-get install -y \\
  ca-certificates fonts-liberation libasound2 libatk-bridge2.0-0 \\
  libatk1.0-0 libc6 libcairo2 libcups2 libdbus-1-3 libexpat1 \\
  libfontconfig1 libgbm1 libgcc1 libglib2.0-0 libgtk-3-0 \\
  libnspr4 libnss3 libpango-1.0-0 libpangocairo-1.0-0 \\
  libstdc++6 libx11-6 libx11-xcb1 libxcb1 libxcomposite1 \\
  libxcursor1 libxdamage1 libxext6 libxfixes3 libxi6 \\
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
| `AZURE_OPENAI_KEY` | **Yes for startup** | Azure OpenAI credential. The current app constructs this client during startup. |
| `AZURE_OPENAI_ENDPOINT` | **Yes for startup** | Azure resource endpoint, for example `https://your-resource.openai.azure.com/`. |
| `AZURE_OPENAI_CHAT_DEPLOYMENT` | Recommended | The deployment name configured in your Azure resource. The code falls back to `gpt-4o-mini`. |
| `OWNER_NUMBER` | Recommended | Owner controls. Use the full international number with digits only, such as `254712345678`. |
| `GEMINI_API_KEY` | Optional | Enables Gemini-powered features. |
| `OPENWEATHERMAP_API_KEY` | Optional | Enables live weather lookups. |
| `PAIRING_NUMBER` | Optional | Request a WhatsApp pairing code. Leave blank to use a QR code. |

The Azure key and endpoint are needed even if you do not plan to use the AI commands, because the current app initializes the Azure client when it starts. Keep your real `.env` private; never commit it or paste its contents into an issue.

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

See the [PM2 startup guide](https://pm2.keymetrics.io/docs/usage/startup/) for details. The setup script intentionally leaves process-manager installation and boot configuration to you.

Useful commands:

```bash
pm2 status
pm2 logs chaos-bot
pm2 restart chaos-bot
pm2 stop chaos-bot
```

## 🎵 Optional media and assets

These tools are separate from the core setup. Add them only when you need the related features.

### Voice and audio conversion

Install FFmpeg on Ubuntu/Debian:

```bash
sudo apt-get install -y ffmpeg
```

### YouTube downloads

The media downloader needs `yt-dlp`; audio extraction and media conversion also use FFmpeg. The current `!video` handler is marked as under maintenance, so installing these tools does not enable it.

<details>
<summary><strong>Optional yt-dlp and bgutil setup</strong></summary>

Use a Python virtual environment so the media packages do not modify the server’s system Python:

```bash
sudo apt-get install -y python3-venv
python3 -m venv "$HOME/.venvs/chaos-media"
"$HOME/.venvs/chaos-media/bin/python" -m pip install --upgrade pip yt-dlp bgutil-ytdlp-pot-provider
export PATH="$HOME/.venvs/chaos-media/bin:$PATH"
yt-dlp --version
```

The bgutil package installed above is the yt-dlp plugin. Its HTTP token server is a separate Node application. Follow the [upstream setup guide](https://github.com/Brainicism/bgutil-ytdlp-pot-provider#installation) and choose matching plugin/server versions. The native server setup is:

```bash
git clone --single-branch --branch 2.0.2 https://github.com/Brainicism/bgutil-ytdlp-pot-provider.git "$HOME/bgutil-ytdlp-pot-provider"
cd "$HOME/bgutil-ytdlp-pot-provider/server"
npm ci
npx tsc
node build/main.js
```

The example uses provider release `2.0.2`; check the upstream guide for the current matching release before installing. The server listens locally on port `4416` by default. Keep it on localhost and never expose that port publicly. To manage it with PM2, install PM2 as described below and start the built `server/build/main.js` process from the server directory.

The bot’s current video code passes a project-root `cookies.txt` file to yt-dlp. If you re-enable that handler, provide a valid cookies file or remove the cookie argument in code. Keep cookies private and out of Git.

</details>

### Optional game assets

- **Mafia:** `rules.pdf` and either `briefing.mp3` or `briefing.ogg` may be placed in the project root. Missing files are skipped by the game.
- **Random songs:** OGG files belong under `src/assets`. The current random-song handler is marked as under maintenance.

### Memory and swap

The core setup does not change swap settings. Use your VPS provider’s guidance if the server needs additional swap; some containers and managed servers do not allow creating a swap file.

## 💾 Sessions, data, and moving servers

The WhatsApp login is saved under `data/session`. User economy data and game state are stored as local files under `data/`; they are not in Git.

- Keep the bot running as the same operating-system user so it can read its session and data.
- Back up `data/` securely before replacing a server or reinstalling.
- Stop the old instance before moving the WhatsApp session to another server. Do not run two bot instances with the same WhatsApp session at once.
- Treat backups of `data/` as private: they can contain authentication state and player identifiers.

## 🧰 Troubleshooting

**The bot exits with an Azure credentials error**  
Set both `AZURE_OPENAI_KEY` and `AZURE_OPENAI_ENDPOINT` in `.env`, then start it again.

**Chrome fails to launch or reports a missing shared library**  
Install the Ubuntu/Debian libraries above. Puppeteer’s [troubleshooting guide](https://pptr.dev/troubleshooting#chrome-doesnt-launch-on-linux) has the current package list.

**WhatsApp asks for a new QR code**  
Check that the bot runs as the same user and that `data/session` is writable and persistent. If you moved servers, link the device again if the saved session cannot be reused.

**YouTube downloads fail**  
Confirm `yt-dlp` and FFmpeg are installed, then check whether your network or YouTube requires cookies or the optional bgutil provider. The provider does not guarantee that YouTube will allow a download.

## 🔄 Updating

Stop the process, update the checkout, install the locked dependencies, and restart:

```bash
pm2 stop chaos-bot
git pull --ff-only
npm ci
pm2 restart chaos-bot
```

For a foreground run, stop it with **Ctrl+C**, update the code, then run `node index.js` again.

## 🔐 Keep these files private

Do not commit or publicly share:

- `.env` — API keys and configuration
- `data/` — WhatsApp session, player profiles, and game state
- `cookies.txt` — YouTube cookies, if used
- `downloads/` — requested media files

These paths are ignored by Git where applicable. Check `git status` before pushing deployment changes.

## 📜 License

This project is released under the [MIT License](LICENSE).
