const fs = require('fs');
const path = require('path');

// Target the exact file name you placed in the data folder
const nyimboPath = path.join(__dirname, '../data/Nyimbo za Kristo Lyrics.json');
let hymnalDB = null;

try {
    const rawData = fs.readFileSync(nyimboPath, 'utf8');
    hymnalDB = JSON.parse(rawData);
} catch (error) {
    console.error('⚠️ Nyimbo database not found at src/data/Nyimbo za Kristo Lyrics.json');
}

function getHymn(query) {
    if (!hymnalDB || !hymnalDB.Songs) {
        return '❌ Hymnal database is currently unavailable.';
    }

    if (!query) {
        return '📖 Please provide a hymn number.\n\n*Example:* `!nyimbo 15`';
    }

    const hymnId = parseInt(query.trim(), 10);
    
    if (isNaN(hymnId)) {
        return '❌ Please provide a valid hymn number.\n\n*Example:* `!nyimbo 15`';
    }

    // Search for the specific song ID in the JSON array
    const song = hymnalDB.Songs.find(s => s.ID === hymnId);

    if (!song) {
        return `❌ Hymn #${hymnId} not found in Nyimbo za Kristo.`;
    }

    // Build the WhatsApp formatted string
    let responseText = `📖 *NYIMBO ZA KRISTO*『${song.ID}』\n`;
    responseText += `🎵 \t❒*${song.Text}*\n━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;

    let verseCounter = 1;

    song.Verses.forEach(verse => {
        // In your JSON, "Tag": 1 denotes a chorus section
        if (verse.Tag === 1) {
            responseText += `➫➫➫➫\t░◈ _*Chorus*_ ◈░\n_*${verse.Text}*_\n\n`;
        } else {
            responseText += `『*${verseCounter}*』 ${verse.Text}\n\n`;
            verseCounter++;
        }
    });

    return responseText.trim();
}

module.exports = { getHymn };