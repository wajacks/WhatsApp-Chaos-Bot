const { MessageMedia } = require('whatsapp-web.js');
const { execFile } = require('child_process');
const { promisify } = require('util');
const execFileAsync = promisify(execFile);
const fs = require('fs');
const path = require('path');

const IS_VIDEO_UNDER_MAINTENANCE = false;

// Active video requests store: Map<userChatId, { targetQuery, timeoutId }>
const pendingVideoRequests = new Map();

// Active audio format selection steps: Map<userChatId, { targetQuery, timeoutId }>
const pendingAudioFormatRequests = new Map();

// Active audio quality selection steps: Map<userChatId, { targetQuery, isVoiceNote, timeoutId }>
const pendingAudioQualityRequests = new Map();
const VIDEO_UPLOAD_LIMIT_BYTES = 50 * 1024 * 1024;
const recentVideoTransferRates = [];
const DEFAULT_VIDEO_TRANSFER_MBPS = 0.35;

function getYtDlpConfig() {
    const projectRoot = path.resolve(__dirname, '..', '..');
    const homeDir = process.env.HOME || require('os').homedir();
    const venvYtDlp = path.join(homeDir, '.venvs', 'chaos-media', 'bin', 'yt-dlp');
    const executable = process.env.YT_DLP_PATH || (fs.existsSync(venvYtDlp) ? venvYtDlp : 'yt-dlp');
    const configuredCookiesPath = process.env.YOUTUBE_COOKIES_PATH || path.join(projectRoot, 'cookies.txt');
    const cookiesPath = path.isAbsolute(configuredCookiesPath)
        ? configuredCookiesPath
        : path.resolve(projectRoot, configuredCookiesPath);
    const baseArgs = ['--js-runtimes', 'node'];

    if (fs.existsSync(cookiesPath)) {
        baseArgs.push('--cookies', cookiesPath);
    }

    return { executable, baseArgs, cookiesPath };
}

function hasVideoStream(format) {
    return Boolean(format.vcodec && format.vcodec !== 'none');
}

function hasAudioStream(format) {
    return Boolean(format.acodec && format.acodec !== 'none');
}

function compareFormatQuality(a, b) {
    return (Number(b.height) || 0) - (Number(a.height) || 0)
        || (Number(b.fps) || 0) - (Number(a.fps) || 0)
        || (Number(b.tbr) || 0) - (Number(a.tbr) || 0);
}

function bestFormat(formats) {
    return [...formats].sort(compareFormatQuality)[0] || null;
}

function estimateFormatBytes(format, durationSeconds) {
    const exactSize = Number(format.filesize);
    if (Number.isFinite(exactSize) && exactSize > 0) return exactSize;

    const approximateSize = Number(format.filesize_approx);
    if (Number.isFinite(approximateSize) && approximateSize > 0) return approximateSize;

    const totalBitrate = Number(format.tbr)
        || ((Number(format.vbr) || 0) + (Number(format.abr) || 0));
    if (totalBitrate > 0 && durationSeconds > 0) {
        return totalBitrate * 1000 / 8 * durationSeconds;
    }

    return null;
}

function estimateQualitySize(info, maxHeight) {
    const formats = Array.isArray(info.formats) ? info.formats : [];
    const duration = Number(info.duration) || 0;
    const hasHeight = format => Number(format.height) > 0 && Number(format.height) <= maxHeight;
    const videoOnly = formats.filter(format => hasVideoStream(format) && !hasAudioStream(format) && hasHeight(format));
    const audioOnly = formats.filter(format => hasAudioStream(format) && !hasVideoStream(format));
    const preferredVideo = videoOnly.filter(format =>
        format.ext === 'mp4' && String(format.vcodec).startsWith('avc1')
    );
    const preferredAudio = audioOnly.filter(format =>
        format.ext === 'm4a' && String(format.acodec).startsWith('mp4a')
    );

    const estimatePair = (video, audio) => {
        if (!video || !audio) return null;
        const videoBytes = estimateFormatBytes(video, duration);
        const audioBytes = estimateFormatBytes(audio, duration);
        if (!videoBytes || !audioBytes) return null;
        return { bytes: videoBytes + audioBytes, height: Number(video.height) || maxHeight };
    };

    const preferredPair = estimatePair(bestFormat(preferredVideo), bestFormat(preferredAudio));
    if (preferredPair) return preferredPair;

    const combinedMp4 = bestFormat(formats.filter(format =>
        hasVideoStream(format) && hasAudioStream(format) && format.ext === 'mp4' && hasHeight(format)
    ));
    if (combinedMp4) {
        const bytes = estimateFormatBytes(combinedMp4, duration);
        if (bytes) return { bytes, height: Number(combinedMp4.height) || maxHeight };
    }

    const genericPair = estimatePair(bestFormat(videoOnly), bestFormat(audioOnly));
    if (genericPair) return genericPair;

    const combined = bestFormat(formats.filter(format =>
        hasVideoStream(format) && hasAudioStream(format) && hasHeight(format)
    ));
    if (combined) {
        const bytes = estimateFormatBytes(combined, duration);
        if (bytes) return { bytes, height: Number(combined.height) || maxHeight };
    }

    return null;
}

async function getVideoQualityEstimates(targetQuery) {
    const config = getYtDlpConfig();
    const args = [
        ...config.baseArgs,
        '--no-warnings',
        '--dump-single-json',
        '--no-playlist',
        targetQuery
    ];
    const result = await execFileAsync(config.executable, args, {
        windowsHide: true,
        maxBuffer: 25 * 1024 * 1024,
        timeout: 90000
    });
    const jsonStart = result.stdout.indexOf('{');
    if (jsonStart < 0) throw new Error('yt-dlp returned no JSON metadata');

    const info = JSON.parse(result.stdout.slice(jsonStart));
    return {
        360: estimateQualitySize(info, 360),
        480: estimateQualitySize(info, 480),
        720: estimateQualitySize(info, 720)
    };
}

function formatSize(bytes) {
    const megabytes = bytes / (1024 * 1024);
    return megabytes < 10 ? megabytes.toFixed(1) + ' MB' : Math.round(megabytes) + ' MB';
}

function formatWaitPart(seconds) {
    if (seconds < 60) return Math.max(10, Math.round(seconds / 5) * 5) + ' sec';
    return Math.max(1, Math.round(seconds / 60)) + ' min';
}

function estimateWaitRange(bytes) {
    const rates = [...recentVideoTransferRates].sort((a, b) => a - b);
    const rate = rates.length ? rates[Math.floor(rates.length / 2)] : DEFAULT_VIDEO_TRANSFER_MBPS;
    const seconds = bytes / (1024 * 1024) / rate + 15;
    const lower = formatWaitPart(seconds * 0.7);
    const upper = formatWaitPart(seconds * 1.5);
    return lower === upper ? '~' + lower : '~' + lower + '–' + upper;
}

function formatQualityLine(number, label, height, estimates) {
    const estimate = estimates && estimates[height];
    if (!estimate || !estimate.bytes) {
        return number + '️⃣ *' + label + '* — size estimate unavailable';
    }

    const warning = estimate.bytes > VIDEO_UPLOAD_LIMIT_BYTES ? ' ⚠️ likely over 50 MB' : '';
    return number + '️⃣ *' + label + '* — ~' + formatSize(estimate.bytes)
        + ' · ' + estimateWaitRange(estimate.bytes) + warning;
}

function recordVideoTransfer(bytes, elapsedMs) {
    if (!bytes || !elapsedMs || elapsedMs < 1000) return;
    const rate = bytes / (1024 * 1024) / (elapsedMs / 1000);
    if (!Number.isFinite(rate) || rate <= 0) return;
    recentVideoTransferRates.push(rate);
    if (recentVideoTransferRates.length > 5) recentVideoTransferRates.shift();
}

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
        await message.reply('🔎 Checking available video sizes…');

        let qualityEstimates = null;
        try {
            qualityEstimates = await getVideoQualityEstimates(targetQuery);
        } catch (estimateError) {
            console.warn('[MEDIA] Could not preflight video sizes:', estimateError.message);
        }

        const timeoutId = setTimeout(() => {
            clearUserPendingStates(chatId);
        }, 2 * 60 * 1000);

        pendingVideoRequests.set(chatId, { targetQuery, timeoutId, qualityEstimates });

        const promptText =
            '🎬 *Select Media Type / Quality*\n\n' +
            'Reply with the number of your choice within 2 minutes:\n\n' +
            formatQualityLine('1', 'Up to 360p', 360, qualityEstimates) + '\n' +
            formatQualityLine('2', 'Up to 480p', 480, qualityEstimates) + '\n' +
            formatQualityLine('3', 'Up to 720p', 720, qualityEstimates) + '\n' +
            '5️⃣ *Audio Only* (MP3 / Voice Note Options)\n\n' +
            '\t\t‧₊˚🖇️✩ ₊˚🎧⊹♡\n' +
            '_Reply with 1, 2, 3, or 5_\n\n' +
            '_Size and total wait estimates are approximate; the final 50 MB check still applies._\n' +
            'wantam\t\t\t\t👆😅';

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
    // 1. Initial Main Menu Selection (1 = 360p, 2 = 480p, 3 = 720p, 5 = audio)
    // ----------------------------------------------------
    if (pendingVideoRequests.has(chatId)) {
        const validChoices = ['1', '2', '3', '5'];
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

        // Video choices stay within the existing 50 MB WhatsApp send guard.
        const qualityMap = {
            '1': { height: 360, label: '360p', audioOnly: false },
            '2': { height: 480, label: '480p', audioOnly: false },
            '3': { height: 720, label: '720p', audioOnly: false }
        };

        const chosenOption = qualityMap[selection];

        const estimate = requestData.qualityEstimates && requestData.qualityEstimates[chosenOption.height];
        const estimateNote = estimate && estimate.bytes
            ? ' Estimated size ~' + formatSize(estimate.bytes) + ', rough total wait ' + estimateWaitRange(estimate.bytes) + '.'
            : ' Size and wait estimate unavailable; the 50 MB cap will still be checked after download.';
        await message.reply('⏳ *Processing...* Fetching ' + chosenOption.label + ' video.' + estimateNote);

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
    const projectRoot = path.join(__dirname, '..', '..');
    const processingStartedAt = Date.now();
    const config = getYtDlpConfig();
    const ytDlpExecutable = config.executable;

    const args = [...config.baseArgs];
    if (!fs.existsSync(config.cookiesPath)) {
        console.warn('[MEDIA] cookies.txt not found; attempting download without YouTube cookies.');
    }

        args.push('--restrict-filenames');

    if (chosenOption.audioOnly) {
        args.push('-x', '--audio-format', chosenOption.isVoiceNote ? 'm4a' : 'mp3');
        if (!chosenOption.isVoiceNote) {
            args.push('--audio-quality', chosenOption.bitrate);
        }
    } else {
        const height = chosenOption.height;
        const formatRule = `bv*[height<=${height}][vcodec^=avc1][ext=mp4]+ba[acodec^=mp4a][ext=m4a]/b[height<=${height}][ext=mp4]/bv*[height<=${height}]+ba/b[height<=${height}]`;
        args.push('-f', formatRule, '--merge-output-format', 'mp4');
    }

    args.push('--no-playlist', '-o', outputTemplate, targetQuery);

    execFile(ytDlpExecutable, args, { maxBuffer: 50 * 1024 * 1024 }, async (error) => {
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
            if (stats.size > VIDEO_UPLOAD_LIMIT_BYTES && !chosenOption.audioOnly) {
                console.log(`[OVERSIZE BLOCKED] File size was ${fileSizeInMB.toFixed(2)} MB. Purging download.`);
                await message.reply(
                    `❌ *File Too Large (${fileSizeInMB.toFixed(1)} MB)*\n\n` +
                    `Files over 50MB overwhelm WhatsApp Web and cause Puppeteer to freeze.\n` +
                    `Try a shorter video or choose *5️⃣ Audio Only* to stay within WhatsApp's video size limit.`
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
                recordVideoTransfer(stats.size, Date.now() - processingStartedAt);
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