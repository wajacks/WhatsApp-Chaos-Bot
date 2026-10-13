async function handleHymnalCommand({ message, chatId, lowerText, text, getHymn, sendHymnPianoAudio, client }) {
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
