const { MessageMedia } = require('whatsapp-web.js');
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');

async function handleVideoCommand(message) {
    try {
        const text = message.body.replace('!video', '').trim();

        if (!text) {
            await message.reply('Please provide a video name or YouTube URL after !video.\n\nExample: `!video Shape of You`');
            return;
        }

        const projectRoot = path.join(__dirname, '..', '..');
        const cookiesPath = path.join(projectRoot, 'cookies.txt');
        const downloadDir = path.join(projectRoot, 'downloads');

        if (!fs.existsSync(downloadDir)) {
            fs.mkdirSync(downloadDir, { recursive: true });
        }

        const isUrl = text.startsWith('http') || text.includes('youtube.com') || text.includes('youtu.be');
        const searchPrefix = isUrl ? '' : 'ytsearch1:';
        const targetQuery = `${searchPrefix}${text}`;

        await message.reply('🎬 *Request received!* Processing your 360p video in the background...' +'\`©chriss\`');

        setImmediate(() => {
            processVideoInBackground(message, targetQuery, cookiesPath, downloadDir);
        });

    } catch (err) {
        console.error('Error in handleVideoCommand:', err);
        await message.reply('Oops! Something went wrong while processing your video request.');
    }
}

function processVideoInBackground(message, targetQuery, cookiesPath, downloadDir) {
    const infoCmd = `yt-dlp --cookies "${cookiesPath}" --get-duration --no-playlist "${targetQuery}"`;

    exec(infoCmd, (infoErr, stdout) => {
        let isLongVideo = false;

        if (!infoErr && stdout) {
            const durationStr = stdout.trim();
            const parts = durationStr.split(':').map(Number);
            let seconds = 0;

            if (parts.length === 3) {
                seconds = parts[0] * 3600 + parts[1] * 60 + parts[2];
            } else if (parts.length === 2) {
                seconds = parts[0] * 60 + parts[1];
            } else if (parts.length === 1) {
                seconds = parts[0];
            }

            if (seconds >= 600) {
                isLongVideo = true;
            }
        }

        // Force 360p H.264 video stream + AAC audio stream for universal device playback
        const formatRule = isLongVideo
            ? 'bv*[height<=480][vcodec^=avc1]+ba[acodec^=mp4a]/bv*[height<=480]+ba/b[height<=480]/b'
            : 'bv*[height<=360][vcodec^=avc1]+ba[acodec^=mp4a]/bv*[height<=360]+ba/b[height<=360]/b';

        const outputTemplate = path.join(downloadDir, '%(id)s.%(ext)s');

        // Force FFmpeg to encode video to H.264 and audio to AAC
        const ytDlpCmd = `yt-dlp --cookies "${cookiesPath}" -f "${formatRule}" --merge-output-format mp4 --postprocessor-args "ffmpeg:-c:v libx264 -c:a aac -b:a 128k" --no-playlist -o "${outputTemplate}" "${targetQuery}"`;

        exec(ytDlpCmd, { maxBuffer: 50 * 1024 * 1024 }, async (error, stdout, stderr) => {
            let downloadedFilePath = null;

            try {
                if (error) {
                    console.error('ytdlp video error:', error.message);
                    await message.reply('❌ Failed to download the video.');
                    return;
                }

                const files = fs.readdirSync(downloadDir);
                const validFiles = files
                    .filter(file => file.endsWith('.mp4') || file.endsWith('.mkv') || file.endsWith('.webm'))
                    .map(file => ({
                        name: file,
                        time: fs.statSync(path.join(downloadDir, file)).mtimeMs
                    }))
                    .sort((a, b) => b.time - a.time);

                if (validFiles.length === 0) {
                    await message.reply('❌ Download completed, but could not find the video file.');
                    return;
                }

                downloadedFilePath = path.join(downloadDir, validFiles[0].name);

                const stats = fs.statSync(downloadedFilePath);
                const fileSizeInMB = stats.size / (1024 * 1024);

                // If file is under 16 MB, send as playable video; if over 16 MB or long video, send as document
                const sendAsDocument = isLongVideo || fileSizeInMB > 60;

                console.log(`[VIDEO] Sending: ${downloadedFilePath} | Size: ${fileSizeInMB.toFixed(2)} MB | Document Mode: ${sendAsDocument}`);

                const videoMedia = MessageMedia.fromFilePath(downloadedFilePath);

                if (sendAsDocument) {
                    await message.client.sendMessage(message.from, videoMedia, {
                        sendMediaAsDocument: true
                    });
                } else {
                    await message.client.sendMessage(message.from, videoMedia);
                }

            } catch (err) {
                console.error('Error processing downloaded video:', err);
                await message.reply('❌ The video downloaded, but I could not send it over WhatsApp.');

            } finally {
                // Guaranteed VPS disk cleanup
                if (downloadedFilePath && fs.existsSync(downloadedFilePath)) {
                    fs.unlink(downloadedFilePath, err => {
                        if (err) {
                            console.error('[VIDEO] Failed to delete:', err.message);
                        } else {
                            console.log('[VIDEO] Cleaned up temp file:', downloadedFilePath);
                        }
                    });
                }
            }
        });
    });
}

module.exports = { handleVideoCommand };