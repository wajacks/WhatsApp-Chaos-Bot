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

        const outputTemplate = path.join(downloadDir, '%(id)s.%(ext)s');

        const ytDlpCmd = `yt-dlp --cookies "${cookiesPath}" -x --audio-format m4a --no-playlist -o "${outputTemplate}" "${searchPrefix}${text}"`;

        await message.reply('Searching and downloading... this may take a moment.');

        exec(ytDlpCmd, { maxBuffer: 20 * 1024 * 1024 }, async (error, stdout, stderr) => {
            try {
                if (error) {
                    console.error('ytdlp error:', error.message);
                    console.error('ytdlp stderr:', stderr);
                    await message.reply('Failed to download the song. Check if the URL/name is correct and cookies are valid.');
                    return;
                }

                if (stderr) {
                    console.error('ytdlp stderr:', stderr);
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
                    await message.reply('Download completed but could not find the audio file.');
                    return;
                }

                const audioFile = path.join(downloadDir, m4aFiles[0].name);

                console.log('[PLAY] Sending:', audioFile);

                const audioMedia = MessageMedia.fromFilePath(audioFile);

                await message.client.sendMessage(message.from, audioMedia);

                fs.unlink(audioFile, err => {
                    if (err) {
                        console.error('[PLAY] Failed to delete:', err.message);
                    } else {
                        console.log('[PLAY] Deleted:', audioFile);
                    }
                });
            } catch (err) {
                console.error('Error processing downloaded audio:', err);
                await message.reply('The song downloaded, but I could not send it.');
            }
        });

    } catch (err) {
        console.error('Error in handlePlayCommand:', err);
        await message.reply('Oops! Something went wrong while processing your request.');
    }
}

module.exports = { handlePlayCommand };
