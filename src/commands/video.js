const { MessageMedia } = require('whatsapp-web.js');
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');

// Active video requests store: Map<userChatId, { targetQuery, timeoutId }>
const pendingVideoRequests = new Map();

// Active audio format selection steps: Map<userChatId, { targetQuery, timeoutId }>
const pendingAudioFormatRequests = new Map();

// Active audio quality selection steps: Map<userChatId, { targetQuery, isVoiceNote, timeoutId }>
const pendingAudioQualityRequests = new Map();

// Active oversize file approvals: Map<userChatId, { filePath, fileSizeMB, timeoutId }>
const pendingOversizeApprovals = new Map();

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

        clearUserPendingStates(chatId);

        const timeoutId = setTimeout(() => {
            clearUserPendingStates(chatId);
        }, 2 * 60 * 1000);

        pendingVideoRequests.set(chatId, { targetQuery, timeoutId });

        const promptText = 
            `🎬 *Select Media Type / Quality*\n\n` +
            `Reply with the number of your choice within 2 minutes:\n\n` +
            `1️⃣ *360p* (Fast / Small file size)\n` +
            `2️⃣ *480p* (Balanced quality)\n` +
            `3️⃣ *720p* (High Quality)\n` +
            `4️⃣ *1080p* (Full HD - Usually sent as Document)\n` +
            `5️⃣ *Audio Only* (MP3 / Voice Note Options)\n\n` +
            `\t\t‧₊˚🖇️✩ ₊˚🎧⊹♡\n` +
            `_Reply with \`1\`, \`2\`, \`3\`, \`4\`, or \`5\`_\n\n` +
            `\`wantam\`\t\t` + `👆😅`;

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
    // 1. Check for Pending Oversized File Decision (Y / N)
    // ----------------------------------------------------
    if (pendingOversizeApprovals.has(chatId)) {
        const approvalData = pendingOversizeApprovals.get(chatId);

        if (selection === 'y' || selection === 'yes' || selection === '1') {
            clearTimeout(approvalData.timeoutId);
            pendingOversizeApprovals.delete(chatId);

            await message.reply('📄 *Sending as Document...* Please wait while the file uploads.');

            try {
                const media = MessageMedia.fromFilePath(approvalData.filePath);
                await message.client.sendMessage(message.from, media, {
                    sendMediaAsDocument: true
                });
            } catch (err) {
                console.error('Error sending oversized document:', err);
                await message.reply('❌ Upload failed. The file was too large for Puppeteer to process.');
            } finally {
                cleanupFilePath(approvalData.filePath);
            }
            return true;

        } else if (selection === 'n' || selection === 'no' || selection === '2') {
            clearTimeout(approvalData.timeoutId);
            pendingOversizeApprovals.delete(chatId);

            cleanupFilePath(approvalData.filePath);
            await message.reply('🗑️ Request cancelled. File deleted from server.');
            return true;
        }
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
            `\`wantam\`\t\t` + `👆😅`;

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
        const cookiesPath = path.join(projectRoot, 'cookies.txt');
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
            processMediaInBackground(message, audioData.targetQuery, chosenOption, cookiesPath, requestDir);
        });

        return true;
    }

    // ----------------------------------------------------
    // 4. Initial Main Menu Selection (1, 2, 3, 4, 5)
    // ----------------------------------------------------
    if (!pendingVideoRequests.has(chatId)) return false;

    const validChoices = ['1', '2', '3', '4', '5'];
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
            `1️⃣ *Voice Note* (Playable waveform message)\n` +
            `2️⃣ *MP3 Audio* (Downloadable music file)\n\n` +
            `\t\t‧₊˚🖇️✩ ₊˚🎧⊹♡\n` +
            `_Reply with \`1\` or \`2\`_\n\n` +
            `\`wantam\`\t\t` + `👆😅`;

        await message.reply(formatPrompt);
        return true;
    }

    // Handles standard video options (1 = 360p, 2 = 480p, 3 = 720p, 4 = 1080p)
    const qualityMap = {
        '1': { height: 360,  label: '360p',  audioOnly: false },
        '2': { height: 480,  label: '480p',  audioOnly: false },
        '3': { height: 720,  label: '720p',  audioOnly: false },
        '4': { height: 1080, label: '1080p', audioOnly: false }
    };

    const chosenOption = qualityMap[selection];

    await message.reply(`⏳ *Processing...* Fetching ${chosenOption.label} video in the background.`);

    const projectRoot = path.join(__dirname, '..', '..');
    const cookiesPath = path.join(projectRoot, 'cookies.txt');
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
 * Executes yt-dlp download and handles file delivery
 */
function processMediaInBackground(message, targetQuery, chosenOption, cookiesPath, requestDir) {
    const outputTemplate = path.join(requestDir, '%(title)s.%(ext)s');
    const safeQuery = targetQuery.replace(/'/g, "'\\''");

    let ytDlpCmd = '';

    if (chosenOption.audioOnly) {
        if (chosenOption.isVoiceNote) {
            ytDlpCmd = `yt-dlp --cookies "${cookiesPath}" --restrict-filenames -x --audio-format m4a --no-playlist -o "${outputTemplate}" '${safeQuery}'`;
        } else {
            ytDlpCmd = `yt-dlp --cookies "${cookiesPath}" --restrict-filenames -x --audio-format mp3 --audio-quality ${chosenOption.bitrate} --no-playlist -o "${outputTemplate}" '${safeQuery}'`;
        }
    } else {
        const height = chosenOption.height;
        const formatRule = `bv*[height<=${height}][vcodec^=avc1]+ba[acodec^=mp4a]/bv*[height<=${height}]+ba/b[height<=${height}]/b`;
        ytDlpCmd = `yt-dlp --cookies "${cookiesPath}" --restrict-filenames -f "${formatRule}" --merge-output-format mp4 --postprocessor-args "ffmpeg:-c:v libx264 -c:a aac -b:a 128k" --no-playlist -o "${outputTemplate}" '${safeQuery}'`;
    }

    exec(ytDlpCmd, { maxBuffer: 50 * 1024 * 1024 }, async (error) => {
        let downloadedFilePath = null;
        let isOversizedPending = false; // Flag to prevent early cleanup

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
            const chatId = message.from;

            // Handle oversized files (> 60 MB) for video requests
            if (fileSizeInMB > 63 && !chosenOption.audioOnly) {
                console.log(`[OVERSIZE] Video file size is ${fileSizeInMB.toFixed(2)} MB. Prompting user.`);
                
                isOversizedPending = true; // Mark true so finally block bypasses deletion

                const timeoutId = setTimeout(() => {
                    if (pendingOversizeApprovals.has(chatId)) {
                        cleanupFilePath(downloadedFilePath);
                        pendingOversizeApprovals.delete(chatId);
                    }
                }, 2 * 60 * 1000);

                pendingOversizeApprovals.set(chatId, {
                    filePath: downloadedFilePath,
                    fileSizeMB: fileSizeInMB,
                    timeoutId
                });

                const oversizePrompt = 
                    `⚠️ *Large File Notice*\n\n` +
                    `The requested video is *${fileSizeInMB.toFixed(1)} MB*, which exceeds standard WhatsApp media stream limits (60MB).\n\n` +
                    `Do you want me to send it as a *Document* instead?\n\n` +
                    `Reply with:\n` +
                    `*Y* — Yes, send as Document\n` +
                    `*N* — No, cancel request`;

                await message.reply(oversizePrompt);
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
            // Delete folder ONLY if not waiting for an oversize Y/N response
            if (!isOversizedPending) {
                cleanupFilePath(downloadedFilePath || requestDir);
            }
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