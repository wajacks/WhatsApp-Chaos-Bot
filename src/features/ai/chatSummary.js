async function handleChatSummaryCommand({ message, chatId, lowerText, getChatHistory, azureClient }) {
    if (lowerText !== '!catchup' && lowerText !== '!summary') return false;

    const history = getChatHistory(chatId);
    if (history.length === 0) {
        await message.reply('📭 Not enough recent chat history to summarize yet.');
        return true;
    }

    await message.reply('⏳ *Analyzing recent group conversations...*');
    try {
        const transcript = history.map(h => `${h.sender}: ${h.text}`).join('\n');
        const response = await azureClient.chat.completions.create({
            model: process.env.AZURE_OPENAI_CHAT_DEPLOYMENT || 'gpt-4o-mini',
            messages: [
                {
                    role: 'system',
                    content: 'You are an intelligent group chat summarizer. Read the recent chat transcript and provide a brief, engaging, and slightly humorous "While you were away" summary highlighting key topics, arguments, or inside jokes.'
                },
                {
                    role: 'user',
                    content: `Here is the recent group chat history:\n\n${transcript}`
                }
            ],
            max_tokens: 400
        });

        const summary = response.choices[0]?.message?.content?.trim();
        await message.reply(`📜 *Group Catch-Up Summary:*\n\n${summary}`);
    } catch (err) {
        console.error('❌ Catchup Error:', err);
        await message.reply('❌ Failed to generate chat summary.');
    }
    return true;
}

module.exports = { handleChatSummaryCommand };
