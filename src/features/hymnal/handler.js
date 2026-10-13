async function handleHymnalCommand({ message, chatId, lowerText, text, getHymn, getEnglishHymn, sendHymnPianoAudio, client }) {
    if (/^!hymn(?:\s|$)/i.test(text)) {
        const query = text.replace(/^!hymn\b/i, '').trim();
        const result = await getEnglishHymn(query);
        await message.reply(result.text);
        if (result.success && result.song) {
            await client.sendMessage(chatId, '🎹 *Looking for the English SDA hymn instrumental...*');
            await sendHymnPianoAudio(
                chatId,
                result.song.Number ?? result.song.ID,
                result.song.Title,
                client,
                'Seventh-day Adventist Hymnal'
            );
        }
        return true;
    }

    if (!lowerText.startsWith('!nyimbo')) return false;

    const query = text.replace(/^!nyimbo/i, '').trim();
    const result = getHymn(query);

    await message.reply(result.text);

    if (result.success && result.song) {
        await client.sendMessage(chatId, '🎹 *Synthesizing piano instrumental voice note...*');
        await sendHymnPianoAudio(chatId, result.song.ID, result.song.Text, client);
    }
    return true;
}

module.exports = { handleHymnalCommand };
