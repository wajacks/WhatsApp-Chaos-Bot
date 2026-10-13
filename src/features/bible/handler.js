async function handleBibleMessages({ message, chatId, senderId, text, lowerText, pendingBibleRequests, fetchBibleVerse }) {
        const bibleKey = `${chatId}:${senderId}`;

        if (pendingBibleRequests.has(bibleKey)) {
            const pending = pendingBibleRequests.get(bibleKey);

            if (lowerText === '1' || lowerText === '2') {
                pendingBibleRequests.delete(bibleKey);
                const language = lowerText === '1' ? 'english' : 'swahili';
                try {
                    await message.reply('📖 Fetching your verse...');
                    const result = await fetchBibleVerse(pending.reference, language);
                    if (!result.success) {
                        await message.reply(`❌ ${result.error}`);
                        return true;
                    }

                    const verseReference =
                        `${result.book} ${result.chapter}:${result.startVerse}` +
                        (result.endVerse !== result.startVerse ? `-${result.endVerse}` : '');
                    const languageName = language === 'english' ? 'English' : 'Kiswahili';
                    await message.reply(
                        `📖 *${verseReference}*\n\n` +
                        `${result.text}\n\n` +
                        `— *${languageName}*`
                    );
                } catch (error) {
                    console.error('❌ Bible Error:', error);
                    await message.reply(
                        '❌ *Bible System Error*\n\n' +
                        'I could not retrieve that verse right now.'
                    );
                }
                return true;
            }
        }

        if (lowerText === '!verse' || lowerText.startsWith('!verse ')) {
            const reference = text.replace(/^!verse/i, '').trim();
            if (!reference) {
                await message.reply(
                    '📖 *BIBLE VERSE*\n\n' +
                    'Enter a Bible reference.\n\n' +
                    'Example:\n' +
                    '`!verse John 3:16`\n\n' +
                    'You can also request a range:\n' +
                    '`!verse John 3:16-18`'
                );
                return true;
            }

            pendingBibleRequests.set(bibleKey, {
                reference,
                timestamp: Date.now()
            });
            await message.reply(
                `📖 *${reference}*\n\n` +
                'Choose a language:\n\n' +
                '1. 🇬🇧 *English*\n' +
                '2. 🇰🇪 *Kiswahili*\n\n' +
                'Reply with *1* or *2*.'
            );
            return true;
        }

        return false;
}

module.exports = { handleBibleMessages };
