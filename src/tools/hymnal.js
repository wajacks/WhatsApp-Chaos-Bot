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
        return { success: false, text: '❌ Hymnal database is currently unavailable.' };
    }

    if (!query) {
        return { success: false, text: '📖 Please provide a hymn number.\n\n*Example:* `!nyimbo 15`' };
    }

    const cleanQuery = query.trim();
    let song = null;

    if (!isNaN(cleanQuery)) {
        // 1. Search by Number (ID)
        const hymnId = parseInt(cleanQuery, 10);
        song = hymnalDB.Songs.find(s => s.ID === hymnId);
    } else {
        const lowerQuery = cleanQuery.toLowerCase();
        
        // 2. Search by Title
        song = hymnalDB.Songs.find(s => s.Text.toLowerCase().includes(lowerQuery));
        
        // 3. Search by Lyrics (if title wasn't found)
        if (!song) {
            song = hymnalDB.Songs.find(s => {
                // Return true if ANY verse in this song contains the search phrase
                return s.Verses.some(verse => verse.Text.toLowerCase().includes(lowerQuery));
            });
        }
    }

    if (!song) {
        return { success: false, text: `❌ No hymn found matching "${cleanQuery}".` };
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

    return {
        success: true,
        song: song,
        text: responseText.trim()
    };
}

module.exports = { getHymn };