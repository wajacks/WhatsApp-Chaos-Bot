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
        // cookies.txt should be in the project root directory
        const cookiesPath = path.join(__dirname, '..', '..', 'cookies.txt');
        
        // Check if it's a URL or search query
        const isUrl = text.startsWith('http') || text.includes('youtube.com') || text.includes('youtu.be');
        const searchPrefix = isUrl ? '' : 'ytsearch1:';
        
        const ytDlpCmd = `yt-dlp --cookies "${cookiesPath}" -x --audio-format m4a --no-playlist "${searchPrefix}${text}"`;
        
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

            // Find downloaded file
            const outputLines = stdout.split('\n');
            let audioFile = '';
            
            for (const line of outputLines) {
                if (line.includes('Destination:') || line.includes('Written to:')) {
                    const match = line.match(/(?:Destination:|Written to:)\s*(.+)/);
                    if (match) {
                        audioFile = match[1].trim();
                        break;
                    }
                }
            }
            
            if (!audioFile) {
                // Fallback: find .m4a file in current dir
                const fs = require('fs');
                const files = fs.readdirSync('.');
                const m4aFiles = files.filter(f => f.endsWith('.m4a'));
                if (m4aFiles.length > 0) {
                    audioFile = m4aFiles[0];
                }
            }

            if (!audioFile) {
                await message.reply('Download completed but could not find audio file.');
                return;
            }

            const audioMedia = MessageMedia.fromFilePath(audioFile);
            await message.client.sendMessage(message.from, audioMedia);
        });

    } catch (err) {
        console.error('Error in handlePlayCommand:', err);
        await message.reply('Oops! Something went wrong while processing your request.');
    }
}

module.exports = { handlePlayCommand };
