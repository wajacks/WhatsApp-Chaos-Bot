const fs = require('fs');
const path = require('path');
const { promisify } = require('util');
const { execFile } = require('child_process');
const execFileAsync = promisify(execFile);
const { MessageMedia } = require('whatsapp-web.js');

async function sendHymnPianoAudio(chatId, hymnNumber, hymnTitle, client, hymnalName = 'Nyimbo za Kristo') {
    const projectRoot = path.join(__dirname, '../..');
    const homeDir = process.env.HOME || require('os').homedir();
    const venvYtDlp = path.join(homeDir, '.venvs', 'chaos-media', 'bin', 'yt-dlp');
    const ytDlpExecutable = process.env.YT_DLP_PATH || (fs.existsSync(venvYtDlp) ? venvYtDlp : 'yt-dlp');
    const configuredCookiesPath = process.env.YOUTUBE_COOKIES_PATH || path.join(projectRoot, 'cookies.txt');
    const cookiesPath = path.isAbsolute(configuredCookiesPath)
        ? configuredCookiesPath
        : path.resolve(projectRoot, configuredCookiesPath);
    const tempDir = path.join(projectRoot, 'temp');
    const timestamp = `${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
    const outputMp3 = path.join(tempDir, `hymn-${timestamp}.mp3`);
    const outputOgg = path.join(tempDir, `hymn-${timestamp}.ogg`);

    try {
        if (!fs.existsSync(tempDir)) {
            fs.mkdirSync(tempDir, { recursive: true });
        }

        const searchQuery = `ytsearch1:${hymnalName} ${hymnNumber} ${hymnTitle} piano instrumental`;
        console.log(`🎵 [HYMN AUDIO] Searching: ${searchQuery}`);

        const ytDlpArgs = ['--js-runtimes', 'node'];

        // Use the same managed yt-dlp and cookie configuration as video downloads.
        if (fs.existsSync(cookiesPath)) {
            ytDlpArgs.push('--cookies', cookiesPath);
        } else {
            console.warn('[HYMN AUDIO] YouTube cookies not found; attempting download without them.');
        }

        ytDlpArgs.push(
            '--no-playlist',
            searchQuery,
            '-x',
            '--audio-format', 'mp3',
            '-o', outputMp3
        );

        await execFileAsync(ytDlpExecutable, ytDlpArgs, { windowsHide: true });

        if (!fs.existsSync(outputMp3)) return;

        // Convert MP3 to WhatsApp Ogg/Opus format via FFmpeg
        await execFileAsync(
            'ffmpeg',
            [
                '-y',
                '-i', outputMp3,
                '-ac', '1',
                '-ar', '48000',
                '-c:a', 'libopus',
                '-b:a', '32k',
                '-vbr', 'on',
                '-application', 'voip',
                outputOgg
            ],
            { windowsHide: true }
        );

        if (!fs.existsSync(outputOgg)) return;

        // Send as a WhatsApp voice note
        const oggBuffer = fs.readFileSync(outputOgg);
        const audioMedia = MessageMedia.fromFilePath(outputOgg); // or buffer
        
        const voiceMedia = new MessageMedia(
            'audio/ogg; codecs=opus', 
            oggBuffer.toString('base64'), 
            'hymn.ogg'
        );

        await client.sendMessage(chatId, voiceMedia, { sendAudioAsVoice: true });

    } catch (err) {
        console.error('❌ Hymn Audio Error:', err.message);
    } finally {
        try {
            if (fs.existsSync(outputMp3)) fs.unlinkSync(outputMp3);
            if (fs.existsSync(outputOgg)) fs.unlinkSync(outputOgg);
        } catch (e) {}
    }
}

module.exports = { sendHymnPianoAudio };