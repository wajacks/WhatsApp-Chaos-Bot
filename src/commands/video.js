const { MessageMedia } = require('whatsapp-web.js');
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');

const IS_VIDEO_UNDER_MAINTENANCE = false;

// Active video requests store: Map<userChatId, { targetQuery, timeoutId }>
const pendingVideoRequests = new Map();

// Active audio format selection steps: Map<userChatId, { targetQuery, timeoutId }>
const pendingAudioFormatRequests = new Map();

// Active audio quality selection steps: Map<userChatId, { targetQuery, isVoiceNote, timeoutId }>
const pendingAudioQualityRequests = new Map();

/**
 * Main entry point for !video command
 */
async function handleVideoCommand(message) {
    try {
        if (IS_VIDEO_UNDER_MAINTENANCE) {
            await message.reply(
                '⚠️ *SYSTEM MAINTENANCE NOTICE*\n\n' +
                'Video and media download services are temporarily offline for updates.\n\n' +
                '🛠️ *Status:* Under Active Maintenance\n' +
                '📢 *Notice:* Check back later once the system is patched!'
            );
            return;
        }

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

        clearUserPendingStates(chatId);

        const timeoutId = setTimeout(() => {
            clearUserPendingStates(chatId);
        }, 2 * 60 * 1000);

        pendingVideoRequests.set(chatId, { targetQuery, timeoutId });

        const promptText = 
            `🎬 *Select Media Type / Quality*\n\n` +
            `Reply with the number of your choice within 2 minutes:\n\n` +
            `\`I prefer 360p so you don't request large files taking forever to download\`\n\n` +
            `1️⃣ *360p max* (Fast / Small file size)\n` +
            `5️⃣ *Audio Only* (MP3 / Voice Note Options)\n\n` +
            `\t\t‧₊˚🖇️✩ ₊˚🎧⊹♡\n` +
            `_Reply with \`1\` or \`5\`_\n\n` +
            `\`wantam\`\t\t\t\t` + `👆😅`;

        await message.reply(promptText);

    } catch (err) {
        console.error('Error in handleVideoCommand:', err);
        await message.reply('❌ Something went wrong initializing your request.');
    }
}

/**
 * Main listener for menu replies & confirmations
 */
async function handleVideoQualityReply(message) {
    const chatId = message.from;
    const selection = message.body.trim().toLowerCase();

    // ----------------------------------------------------
    // 1. Initial Main Menu Selection (1 = 360p, 5 = audio)
    // ----------------------------------------------------
    if (pendingVideoRequests.has(chatId)) {
        const validChoices = ['1', '5'];
        if (!validChoices.includes(selection)) return false;

        const requestData = pendingVideoRequests.get(chatId);
        clearTimeout(requestData.timeoutId);
        pendingVideoRequests.delete(chatId);

        // If 5 is selected, proceed to Audio Format Selection Prompt
        if (selection === '5') {
            const timeoutId = setTimeout(() => {
                clearUserPendingStates(chatId);
            }, 2 * 60 * 1000);

            pendingAudioFormatRequests.set(chatId, {
                targetQuery: requestData.targetQuery,
                timeoutId
            });

            const formatPrompt = 
                `🎙️ *Select Audio Output Format*\n\n` +
                `1️⃣ *Voice Note* \`IPHONE USER\`\n` +
                `2️⃣ *MP3 Audio* \`ANDROID USER\`\n\n` +
                `\t\t‧₊˚🖇️✩ ₊˚🎧⊹♡\n` +
                `_Reply with \`1\` or \`2\`_\n\n` +
                `\`wantam\`\t\t\t\t` + `👆😅`;

            await message.reply(formatPrompt);
            return true;
        }

        // Handles standard video options (1 = 360p, 2 = 480p, 3 = 720p, 4 = 1080p)
        const qualityMap = {
            '1': { height: 360, label: '360p', audioOnly: false }
        };

        const chosenOption = qualityMap[selection];

        await message.reply(`⏳ *Processing...* Fetching ${chosenOption.label} video in the background.`);

        const projectRoot = path.join(__dirname, '..', '..');
        const requestDir = path.join(projectRoot, 'downloads', `req_${Date.now()}_${Math.floor(Math.random() * 1000)}`);
        
        if (!fs.existsSync(requestDir)) {
            fs.mkdirSync(requestDir, { recursive: true });
        }

        setImmediate(() => {
            processMediaInBackground(message, requestData.targetQuery, chosenOption, requestDir);
        });

        return true;
    }

    // ----------------------------------------------------
    // 2. Audio Step 1: Format Selection (1 = Voice Note, 2 = MP3)
    // ----------------------------------------------------
    if (pendingAudioFormatRequests.has(chatId)) {
        if (!['1', '2'].includes(selection)) return false;

        const formatData = pendingAudioFormatRequests.get(chatId);
        clearTimeout(formatData.timeoutId);
        pendingAudioFormatRequests.delete(chatId);

        const isVoiceNote = selection === '1';

        const timeoutId = setTimeout(() => {
            clearUserPendingStates(chatId);
        }, 2 * 60 * 1000);

        pendingAudioQualityRequests.set(chatId, {
            targetQuery: formatData.targetQuery,
            isVoiceNote,
            timeoutId
        });

        const qualityPrompt = 
            `🎵 *Select Audio Quality*\n\n` +
            `1️⃣ *High Quality* (320 kbps)\n` +
            `2️⃣ *Medium Quality* (192 kbps)\n` +
            `3️⃣ *Low / Fast* (128 kbps)\n\n` +
            `\t\t‧₊˚🖇️✩ ₊˚🎧⊹♡\n` +
            `_Reply with \`1\`, \`2\`, or \`3\`_\n\n` + 
            `\`wantam\`\t\t\t\t` + `👆😅`;

        await message.reply(qualityPrompt);
        return true;
    }

    // ----------------------------------------------------
    // 3. Audio Step 2: Bitrate Selection (1 = 320k, 2 = 192k, 3 = 128k)
    // ----------------------------------------------------
    if (pendingAudioQualityRequests.has(chatId)) {
        if (!['1', '2', '3'].includes(selection)) return false;

        const audioData = pendingAudioQualityRequests.get(chatId);
        clearTimeout(audioData.timeoutId);
        pendingAudioQualityRequests.delete(chatId);

        const bitrateMap = {
            '1': '320k',
            '2': '192k',
            '3': '128k'
        };

        const chosenBitrate = bitrateMap[selection];
        const mediaTypeLabel = audioData.isVoiceNote ? 'Voice Note' : 'MP3 File';

        await message.reply(`⏳ *Processing...* Fetching ${chosenBitrate} ${mediaTypeLabel} in the background.`);

        const projectRoot = path.join(__dirname, '..', '..');
        const requestDir = path.join(projectRoot, 'downloads', `req_${Date.now()}_${Math.floor(Math.random() * 1000)}`);
        
        if (!fs.existsSync(requestDir)) {
            fs.mkdirSync(requestDir, { recursive: true });
        }

        const chosenOption = {
            audioOnly: true,
            isVoiceNote: audioData.isVoiceNote,
            bitrate: chosenBitrate
        };

        setImmediate(() => {
            processMediaInBackground(message, audioData.targetQuery, chosenOption, requestDir);
        });

        return true;
    }

    return false;
}

/**
 * Executes yt-dlp download and handles file delivery with a strict 50MB size guardrail
 */
function processMediaInBackground(message, targetQuery, chosenOption, requestDir) {
    const outputTemplate = path.join(requestDir, '%(title)s.%(ext)s');
    const safeQuery = targetQuery.replace(/'/g, "'\\''");

    let ytDlpCmd = '';

    if (chosenOption.audioOnly) {
        if (chosenOption.isVoiceNote) {
            ytDlpCmd = `yt-dlp --extractor-args "youtube:player_client=android,ios" --restrict-filenames -x --audio-format m4a --no-playlist -o "${outputTemplate}" '${safeQuery}'`;
        } else {
            ytDlpCmd = `yt-dlp --extractor-args "youtube:player_client=android,ios" --restrict-filenames -x --audio-format mp3 --audio-quality ${chosenOption.bitrate} --no-playlist -o "${outputTemplate}" '${safeQuery}'`;
        }
    } else {
        const height = chosenOption.height;
        const formatRule = `bv*[height<=${height}][vcodec^=avc1]+ba[acodec^=mp4a]/bv*[height<=${height}]+ba/b[height<=${height}]`;
        // Use Android/iOS player clients; no cookies file is passed.
        ytDlpCmd = `yt-dlp --extractor-args "youtube:player_client=android,ios" --restrict-filenames -f "${formatRule}" --merge-output-format mp4 --postprocessor-args "ffmpeg:-c:v libx264 -c:a aac -b:a 128k" --no-playlist -o "${outputTemplate}" '${safeQuery}'`;
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

            // HARD CAP GUARDRAIL: Block video files over 50MB from crashing Puppeteer
            if (fileSizeInMB > 50 && !chosenOption.audioOnly) {
                console.log(`[OVERSIZE BLOCKED] File size was ${fileSizeInMB.toFixed(2)} MB. Purging download.`);
                await message.reply(
                    `❌ *File Too Large (${fileSizeInMB.toFixed(1)} MB)*\n\n` +
                    `Files over 50MB overwhelm WhatsApp Web and cause Puppeteer to freeze.\n` +
                    `Please choose *1️⃣ (360p)* or *2️⃣ (480p)* to download a smaller, safe version!`
                );
                return;
            }

            const media = MessageMedia.fromFilePath(downloadedFilePath);

            console.log(`[MEDIA] Sending: ${downloadedFilePath} | Size: ${fileSizeInMB.toFixed(2)} MB | Audio: ${chosenOption.audioOnly}`);

            if (chosenOption.audioOnly) {
                if (chosenOption.isVoiceNote) {
                    await message.client.sendMessage(message.from, media);
                } else {
                    const mp3Media = new MessageMedia(
                        'audio/mpeg', 
                        fs.readFileSync(downloadedFilePath).toString('base64'), 
                        path.basename(downloadedFilePath)
                    );
                    await message.client.sendMessage(message.from, mp3Media);
                }
            } else {
                await message.client.sendMessage(message.from, media);
            }

        } catch (err) {
            console.error('Error processing or sending media:', err);
            await message.reply('❌ Media downloaded, but failed to send it over WhatsApp.');
        } finally {
            cleanupFilePath(downloadedFilePath || requestDir);
        }
    });
}

/**
 * Resets user pending state maps
 */
function clearUserPendingStates(chatId) {
    if (pendingVideoRequests.has(chatId)) {
        clearTimeout(pendingVideoRequests.get(chatId).timeoutId);
        pendingVideoRequests.delete(chatId);
    }
    if (pendingAudioFormatRequests.has(chatId)) {
        clearTimeout(pendingAudioFormatRequests.get(chatId).timeoutId);
        pendingAudioFormatRequests.delete(chatId);
    }
    if (pendingAudioQualityRequests.has(chatId)) {
        clearTimeout(pendingAudioQualityRequests.get(chatId).timeoutId);
        pendingAudioQualityRequests.delete(chatId);
    }
}

/**
 * Synchronously and safely removes temporary file or directory
 */
function cleanupFilePath(targetPath) {
    if (!targetPath) return;

    try {
        const dirToDelete = fs.existsSync(targetPath) && fs.statSync(targetPath).isFile() 
            ? path.dirname(targetPath) 
            : targetPath;

        if (fs.existsSync(dirToDelete)) {
            fs.rmSync(dirToDelete, { recursive: true, force: true });
            console.log(`[CLEANUP] Successfully purged directory: ${dirToDelete}`);
        }
    } catch (err) {
        console.error('[CLEANUP] Failed to purge directory:', err.message);
    }
}

module.exports = { 
    handleVideoCommand, 
    handleVideoQualityReply 
};