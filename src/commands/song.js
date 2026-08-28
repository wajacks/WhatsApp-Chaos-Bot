const { MessageMedia } = require('whatsapp-web.js');
const path = require('path');
const fs = require('fs');

let shuffledPlaylist = [];

async function handleSongCommand(message) {
    try {
        const assetsDir = path.join(__dirname, '../assets');

        // Read all files in the assets folder and filter for .ogg files
        const files = fs.readdirSync(assetsDir);
        const songs = files.filter(file =>
            file.toLowerCase().endsWith('.ogg')
        );

        if (songs.length === 0) {
            await message.reply(
                '❌ No OGG song files found in the assets folder!'
            );
            return;
        }

        // If our playlist is empty, shuffle all songs like a deck of cards
        if (shuffledPlaylist.length === 0) {
            shuffledPlaylist = [...songs];

            // Fisher-Yates shuffle algorithm
            for (let i = shuffledPlaylist.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [shuffledPlaylist[i], shuffledPlaylist[j]] = [
                    shuffledPlaylist[j],
                    shuffledPlaylist[i]
                ];
            }
        }

        // Pull the next song off the top of the shuffled deck
        const randomSong = shuffledPlaylist.pop();

        const songPath = path.join(assetsDir, randomSong);
        const audioMedia = MessageMedia.fromFilePath(songPath);

        // Remove .ogg and YouTube-style [randomID] from the displayed name
        const songDisplayName = randomSong
            .replace(/\.[^/.]+$/, '')
            .replace(/\s*\[[a-zA-Z0-9_-]{6,}\]\s*$/, '')
            .trim();

        await message.reply(
            `🎵 *Random Chaos Vibe:* Dropping *${songDisplayName}*...`
        );

        await message.client.sendMessage(
            message.from,
            audioMedia,
            {
                sendAudioAsVoice: true
            }
        );

    } catch (err) {
        console.error('Error sending random song:', err);

        await message.reply(
            "❌ Oops! Couldn't load the audio files right now."
        );
    }
}

module.exports = { handleSongCommand };
