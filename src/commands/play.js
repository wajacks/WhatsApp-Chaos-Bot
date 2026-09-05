const { MessageMedia } = require('whatsapp-web.js');
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');

async function handlePlayCommand(message) {
    try {
        const text = message.body.replace('!play', '').trim();

        if (!text) {
            await message.reply('Please provide a song name or YouTube URL after !play. Example: !play Shape of You');
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

        // Send immediate acknowledgment so user knows request was received
        await message.reply('🎵 *Request received!* Downloading audio in the background...');

        // Yield execution to the main event loop so other commands process immediately
        setImmediate(() => {
            processAudioInBackground(message, targetQuery, cookiesPath, downloadDir);
        });

    } catch (err) {
        console.error('Error in handlePlayCommand:', err);
        await message.reply('Oops! Something went wrong while processing your request.');
    }
}

function processAudioInBackground(message, targetQuery, cookiesPath, downloadDir) {
    const outputTemplate = path.join(downloadDir, '%(id)s.%(ext)s');

    // Extract m4a audio stream
    const ytDlpCmd = `yt-dlp --cookies "${cookiesPath}" -x --audio-format m4a --no-playlist -o "${outputTemplate}" "${targetQuery}"`;

    exec(ytDlpCmd, { maxBuffer: 20 * 1024 * 1024 }, async (error, stdout, stderr) => {
        let downloadedFilePath = null;

        try {
            if (error) {
                console.error('[PLAY] ytdlp error:', error.message);
                await message.reply('❌ Failed to download the song. Check if the URL/name is correct and cookies are valid.');
                return;
            }

            const files = fs.readdirSync(downloadDir);
            const m4aFiles = files
                .filter(file => file.endsWith('.m4a'))
                .map(file => ({
                    name: file,
                    time: fs.statSync(path.join(downloadDir, file)).mtimeMs
                }))
                .sort((a, b) => b.time - a.time);

            if (m4aFiles.length === 0) {
                await message.reply('❌ Download completed, but could not find the audio file.');
                return;
            }

            downloadedFilePath = path.join(downloadDir, m4aFiles[0].name);

            console.log('[PLAY] Sending:', downloadedFilePath);

            const audioMedia = MessageMedia.fromFilePath(downloadedFilePath);

            // Send audio payload back to chat
            await message.client.sendMessage(message.from, audioMedia, {
                sendAudioAsVoice: true
            });

        } catch (err) {
            console.error('[PLAY] Processing error:', err);
            await message.reply('❌ The song downloaded, but I could not send it over WhatsApp.');

        } finally {
            // GUARANTEED CLEANUP: Deletes temp audio file from VPS regardless of success or failure
            if (downloadedFilePath && fs.existsSync(downloadedFilePath)) {
                fs.unlink(downloadedFilePath, err => {
                    if (err) {
                        console.error('[PLAY] Failed to delete:', err.message);
                    } else {
                        console.log('[PLAY] Cleaned up temp file:', downloadedFilePath);
                    }
                });
            }
        }
    });
}

module.exports = { handlePlayCommand };