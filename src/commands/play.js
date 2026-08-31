const { MessageMedia } = require('whatsapp-web.js');
const { exec } = require('child_process');
const path = require('path');

async function handlePlayCommand(message) {
    try {
        const text = message.body.replace('!play', '').trim();
        
        if (!text) {
            await message.reply('Please provide a song name or YouTube URL after !play. Example: !play Shape of You');
            return;
        }

        // Use ytdlp to download and convert to audio
        // cookies.txt should be in the same directory as the bot
        const cookiesPath = path.join(__dirname, '..', 'cookies.txt');
        
        const ytDlpCmd = `yt-dlp --cookies "${cookiesPath}" -x --audio-format m4a --no-playlist "${text}"`;
        
        await message.reply('Searching and downloading... this may take a moment.');
        
        exec(ytDlpCmd, { maxBuffer: 10 * 1024 * 1024 }, async (error, stdout, stderr) => {
            if (error) {
                console.error('ytdlp error:', error.message);
                await message.reply('Failed to download the song. Check if the URL/name is correct and cookies are valid.');
                return;
            }

            if (stderr) {
                console.error('ytdlp stderr:', stderr);
            }

            // Handle download and send audio
            const audioFile = './' + path.basename(text) + '.m4a';
            const audioMedia = MessageMedia.fromFilePath(audioFile);
            
            await message.client.sendMessage(message.from, audioMedia);
        });

    } catch (err) {
        console.error('Error in handlePlayCommand:', err);
        await message.reply('Oops! Something went wrong while processing your request.');
    }
}

module.exports = { handlePlayCommand };
