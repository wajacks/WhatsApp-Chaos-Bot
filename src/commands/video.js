const { MessageMedia } = require('whatsapp-web.js');
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');

// Active video requests store: Map<userChatId, { targetQuery, timeoutId }>
const pendingVideoRequests = new Map();

/**
 * Main entry point for !video command
 */
async function handleVideoCommand(message) {
    try {
        const text = message.body.replace('!video', '').trim();
        const chatId = message.from;

        if (!text) {
            await message.reply(
                '❌ Please provide a video name or YouTube URL after !video.\n\n*Example:* `!video Shape of You`'
            );
            return;
        }

        const isUrl = text.startsWith('http') || text.includes('youtube.com') || text.includes('youtu.be');
        const searchPrefix = isUrl ? '' : 'ytsearch1:';
        const targetQuery = `${searchPrefix}${text}`;

        // Clear existing request if user makes a new one before picking
        if (pendingVideoRequests.has(chatId)) {
            clearTimeout(pendingVideoRequests.get(chatId).timeoutId);
        }

        // Auto-expire pending request after 2 minutes
        const timeoutId = setTimeout(() => {
            if (pendingVideoRequests.has(chatId)) {
                pendingVideoRequests.delete(chatId);
            }
        }, 2 * 60 * 1000);

        pendingVideoRequests.set(chatId, { targetQuery, timeoutId });

        const promptText = 
            `🎬 *Select Video Quality*\n\n` +
            `Reply with the number of your choice within 2 minutes:\n\n` +
            `1️⃣ *360p* (Fast / Small file size)\n` +
            `2️⃣ *480p* (Balanced quality)\n` +
            `3️⃣ *720p* (High Definition - larger file)\n` +
            `4️⃣ *Audio Only* (MP3 format)\n\n` +
            `_Reply with 1, 2, 3, or 4_`;

        await message.reply(promptText);

    } catch (err) {
        console.error('Error in handleVideoCommand:', err);
        await message.reply('❌ Something went wrong initializing your request.');
    }
}

/**
 * Message listener to capture quality selection reply (1, 2, 3, or 4)
 * Call this function from your main message handler (e.g., in index.js)
 */
async function handleVideoQualityReply(message) {
    const chatId = message.from;
    const selection = message.body.trim();

    if (!pendingVideoRequests.has(chatId)) return false;

    const validChoices = ['1', '2', '3', '4'];
    if (!validChoices.includes(selection)) return false;

    const requestData = pendingVideoRequests.get(chatId);
    clearTimeout(requestData.timeoutId);
    pendingVideoRequests.delete(chatId);

    const qualityMap = {
        '1': { height: 360, label: '360p', audioOnly: false },
        '2': { height: 480, label: '480p', audioOnly: false },
        '3': { height: 720, label: '720p', audioOnly: false },
        '4': { height: 0,   label: 'Audio Only', audioOnly: true }
    };

    const chosenOption = qualityMap[selection];

    await message.reply(`⏳ *Processing...* Fetching ${chosenOption.label} media in the background.`);

    const projectRoot = path.join(__dirname, '..', '..');
    const cookiesPath = path.join(projectRoot, 'cookies.txt');
    
    // Unique output directory per request to prevent race conditions during concurrent downloads
    const requestDir = path.join(projectRoot, 'downloads', `req_${Date.now()}_${Math.floor(Math.random() * 1000)}`);
    
    if (!fs.existsSync(requestDir)) {
        fs.mkdirSync(requestDir, { recursive: true });
    }

    setImmediate(() => {
        processMediaInBackground(message, requestData.targetQuery, chosenOption, cookiesPath, requestDir);
    });

    return true;
}

/**
 * Downloads and sends media based on chosen quality
 */
function processMediaInBackground(message, targetQuery, chosenOption, cookiesPath, requestDir) {
    const outputTemplate = path.join(requestDir, '%(id)s.%(ext)s');
    
    // Safely escape single quotes for shell safety
    const safeQuery = targetQuery.replace(/'/g, "'\\''");

    let ytDlpCmd = '';

    if (chosenOption.audioOnly) {
        ytDlpCmd = `yt-dlp --cookies "${cookiesPath}" -x --audio-format mp3 --audio-quality 0 --no-playlist -o "${outputTemplate}" '${safeQuery}'`;
    } else {
        const height = chosenOption.height;
        const formatRule = `bv*[height<=${height}][vcodec^=avc1]+ba[acodec^=mp4a]/bv*[height<=${height}]+ba/b[height<=${height}]/b`;
        ytDlpCmd = `yt-dlp --cookies "${cookiesPath}" -f "${formatRule}" --merge-output-format mp4 --postprocessor-args "ffmpeg:-c:v libx264 -c:a aac -b:a 128k" --no-playlist -o "${outputTemplate}" '${safeQuery}'`;
    }

    exec(ytDlpCmd, { maxBuffer: 50 * 1024 * 1024 }, async (error) => {
        let downloadedFilePath = null;

        try {
            if (error) {
                console.error('ytdlp execution error:', error.message);
                await message.reply('❌ Failed to download the requested media.');
                return;
            }

            const files = fs.readdirSync(requestDir);
            const validFiles = files.filter(f => !f.endsWith('.part') && !f.endsWith('.ytdl'));

            if (validFiles.length === 0) {
                await message.reply('❌ Media downloaded, but the output file could not be found.');
                return;
            }

            downloadedFilePath = path.join(requestDir, validFiles[0]);
            const stats = fs.statSync(downloadedFilePath);
            const fileSizeInMB = stats.size / (1024 * 1024);

            const media = MessageMedia.fromFilePath(downloadedFilePath);
            const sendAsDocument = fileSizeInMB > 60 || chosenOption.audioOnly;

            console.log(`[MEDIA] Sending: ${downloadedFilePath} | Size: ${fileSizeInMB.toFixed(2)} MB | Document: ${sendAsDocument}`);

            if (sendAsDocument) {
                await message.client.sendMessage(message.from, media, {
                    sendMediaAsDocument: true
                });
            } else {
                await message.client.sendMessage(message.from, media);
            }

        } catch (err) {
            console.error('Error processing or sending media:', err);
            await message.reply('❌ Media downloaded, but failed to send it over WhatsApp.');
        } finally {
            // Cleanup directory and temp files
            if (fs.existsSync(requestDir)) {
                fs.rm(requestDir, { recursive: true, force: true }, (err) => {
                    if (err) console.error('[CLEANUP] Failed to delete temp directory:', err.message);
                });
            }
        }
    });
}

module.exports = { 
    handleVideoCommand, 
    handleVideoQualityReply 
};