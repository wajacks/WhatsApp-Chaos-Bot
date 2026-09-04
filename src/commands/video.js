const { MessageMedia } = require('whatsapp-web.js');
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');

async function handleVideoCommand(message) {
    try {
        const text = message.body.replace('!video', '').trim();

        if (!text) {
            await message.reply('Please provide a video name or YouTube URL after !video. Example: !video Shape of You');
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

        await message.reply('Checking video details... please wait.');

        // 1. Fetch metadata first to get duration in seconds
        const infoCmd = `yt-dlp --cookies "${cookiesPath}" --get-duration --no-playlist "${targetQuery}"`;

        exec(infoCmd, async (infoErr, stdout) => {
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

                // Video is considered long if 10 minutes (600s) or more
                if (seconds >= 600) {
                    isLongVideo = true;
                }
            }

            // 2. Select format rule based on duration
            // Short: Cap at 720p for inline video playback
            // Long: Max 1080p high quality sent as document
            const formatRule = isLongVideo
                ? 'bv*[height<=1080][ext=mp4]+ba[ext=m4a]/b[height<=1080][ext=mp4]'
                : 'bv*[height<=720][ext=mp4]+ba[ext=m4a]/b[height<=720][ext=mp4]';

            const outputTemplate = path.join(downloadDir, '%(id)s.%(ext)s');
            const ytDlpCmd = `yt-dlp --cookies "${cookiesPath}" -f "${formatRule}" --no-playlist -o "${outputTemplate}" "${targetQuery}"`;

            await message.reply(
                isLongVideo
                    ? '📹 *Long video detected.* Downloading high quality... sending as document.'
                    : '📹 *Downloading video (720p HD)...*'
            );

            // 3. Download video file
            exec(ytDlpCmd, { maxBuffer: 50 * 1024 * 1024 }, async (error, stdout, stderr) => {
                try {
                    if (error) {
                        console.error('ytdlp video error:', error.message);
                        await message.reply('Failed to download the video.');
                        return;
                    }

                    const files = fs.readdirSync(downloadDir);
                    const mp4Files = files
                        .filter(file => file.endsWith('.mp4'))
                        .map(file => ({
                            name: file,
                            time: fs.statSync(path.join(downloadDir, file)).mtimeMs
                        }))
                        .sort((a, b) => b.time - a.time);

                    if (mp4Files.length === 0) {
                        await message.reply('Download completed but could not find the video file.');
                        return;
                    }

                    const videoFile = path.join(downloadDir, mp4Files[0].name);

                    console.log('[VIDEO] Sending:', videoFile, '| isDocument:', isLongVideo);

                    const videoMedia = MessageMedia.fromFilePath(videoFile);

                    // 4. Send as document if >= 10 mins, otherwise standard inline video
                    if (isLongVideo) {
                        await message.client.sendMessage(message.from, videoMedia, {
                            sendMediaAsDocument: true
                        });
                    } else {
                        await message.client.sendMessage(message.from, videoMedia);
                    }

                    fs.unlink(videoFile, err => {
                        if (err) {
                            console.error('[VIDEO] Failed to delete:', err.message);
                        } else {
                            console.log('[VIDEO] Deleted:', videoFile);
                        }
                    });
                } catch (err) {
                    console.error('Error processing downloaded video:', err);
                    await message.reply('The video downloaded, but I could not send it over WhatsApp.');
                }
            });
        });

    } catch (err) {
        console.error('Error in handleVideoCommand:', err);
        await message.reply('Oops! Something went wrong while processing your video request.');
    }
}

module.exports = { handleVideoCommand };