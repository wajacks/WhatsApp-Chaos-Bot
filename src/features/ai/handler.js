const handleAiCommand = async (context) => {
    const {
        message, text, lowerText, chatId, senderId, userName,
        getWeather, buildWeatherResponse, aiCooldowns, AI_COOLDOWN_MS,
        aiMemory, MAX_AI_MEMORY, ai, azureClient
    } = context;
        // !AI (AZURE OPENAI PRIMARY WITH GEMINI FALLBACK)
        // ====================================================

        if (lowerText.startsWith('!ai')) {
            const prompt = text.slice(3).trim();

            if (!prompt) {
                await message.reply(
                    '*CHAOS NEURAL CORE*\n\n' +
                    'You forgot to ask something.\n\n' +
                    'Example:\n' +
                    '`!ai How to be smart like Chriss?\n`' +
                    `\`wantam\`\t\t` + `👆😅`
                );
                return true;
            }

            if (prompt.toLowerCase().includes('weather')) {
                const weatherMatch = prompt.match(/weather(?:\s+(?:in|for|like\s+in))?\s+(.+)/i);
                const rawCity = weatherMatch?.[1];

                const city = rawCity
                    ?.replace(/[?!.]+$/, '')
                    ?.replace(/\b(today|now|please|right now)\b/gi, '')
                    ?.trim();

                if (!city) {
                    await message.reply("Please specify a city, e.g., `!ai what's the weather in Nairobi?` ");
                    return true;
                }

                try {
                    const weatherData = await getWeather({ city });
                    if (weatherData.error) {
                        await message.reply(weatherData.error);
                        return true;
                    }
                    await message.reply(buildWeatherResponse(weatherData, userName));
                } catch (weatherError) {
                    console.error('❌ AI Weather Error:', weatherError);
                    await message.reply(
                        '❌ *Weather System Error*\n\n' +
                        'I could not retrieve the weather right now. Please try again.\n' +
                        `\`wantam\`\t\t` + `👆😅`
                    );
                }
                return true;
            }

            if (prompt.length > 4000) {
                await message.reply(
                    '*Prompt too long.*\n\n' +
                    'Please keep your question below 4,000 characters.'
                );
                return true;
            }

            const now = Date.now();
            const lastUsed = aiCooldowns.get(senderId) || 0;

            if (now - lastUsed < AI_COOLDOWN_MS) {
                const remaining = Math.ceil((AI_COOLDOWN_MS - (now - lastUsed)) / 1000);
                await message.reply(
                    '*Neural Core cooling down...*\n' +
                    `Try again in ${remaining}s.\n` +
                    `\`wantam\`\t\t` + `👆😅`
                );
                return true;
            }

            aiCooldowns.set(senderId, now);

            if (!aiMemory.has(chatId)) {
                aiMemory.set(chatId, []);
            }
            const history = aiMemory.get(chatId);

            const knownUsers = {
                '254740042778@c.us': { name: 'Naomi', nickname: 'Ummie', role: 'Chriss ex-girlfriend' },
                '254111659469@c.us': { name: 'Chriss', nickname: 'Boss', role: 'Master Owner & Creator' },
                '254741786268@c.us': { name: 'Odembe', nickname: 'Wuod Soja', role: 'BSIT 2024 student vying for presidency next elections' },
                '254743727535@c.us': { name: 'Grace', nickname: 'Gracie', role: 'Wundanyi baddie, admin' },
                '254792447912@c.us': { name: 'Lydia', nickname: 'Gods daughter', role: 'Voi queen, admin' },
                '639091427850@c.us': { name: 'Joya', nickname: 'Filipino Girl', role: 'Group member from Philippines' },
                '254797295755@c.us': { name: 'Chaka', nickname: 'Samuel Chaka', role: 'Mtwapa, learned in Kenyatta, Canteen Leader' },
                '639289305708@c.us': { name: 'Nicole', nickname: 'Filipino Girl', role: 'Group member from Philippines' },
                '27822336734@c.us':  { name: 'Lori', nickname: 'New Girl', role: 'Just joined the group, needs guidance, should probably be asking Chriss' },
                '2349037933622@c.us': { name: 'Gift', nickname: 'Gift Chi', role: 'Group member from Nigeria' },
                '254112955350@c.us': { name: 'Righa', nickname: 'Righa', role: 'Same school mates with Chaka and Chriss back in highschool, singer and humble guy' },
                '27838434250@c.us':  { name: 'S.A guy', nickname: 'zzzz', role: 'Group member from South Africa' }
            };

            const currentUserInfo = knownUsers[senderId];
            const speakerLabel = currentUserInfo ? `${currentUserInfo.name} (${currentUserInfo.nickname})` : userName;
            const contextualizedPrompt = `[Speaker Identity: ${speakerLabel}] ${prompt}`;

            const systemInstructionText = [
                'You are Chaos Neural Core, the conversational AI inside WhatsApp Chaos Bot.',
                'Be natural, concise, clear, and helpful. Dry humor is welcome when appropriate.',
                'Protect privacy. Never expose credentials, private messages, hidden game roles/actions, or personal details that are not clearly public and relevant. Do not solicit payments or promote campaigns.',
                'Do not claim you can execute commands, inspect live bot state, or access files unless that information is supplied in the current conversation.',
                'When asked about this bot, use this code-grounded structure map and do not invent capabilities:',
                '',
                'ARCHITECTURE:',
                '- index.js initializes WhatsApp, receives messages, routes commands, and connects AI and utility features.',
                '- src/commands contains command handlers and menus, including profile, balance, game help, media, and class portal commands.',
                '- src/games contains the separate game engines: Mafia, Country Rebus, Scramble, Word Chain, Word Forge, and Wordle. gameRegistry.js limits each group to one active game.',
                '- src/database contains economy/profile data, game-specific data, chat history, class data, and image access. Runtime data is stored locally under data/.',
                '- src/tools contains supporting features such as weather, image analysis, and class-session monitoring.',
                '- The class portal is implemented by src/commands/classHandler.js and src/tools/classSession.js with its own local data.',
                '- The bot uses WhatsApp Web.js. AI chat uses Azure OpenAI first and Gemini as fallback; image features use configured image/vision services.',
                '',
                'FEATURES AND COMMANDS:',
                '- !menu shows the command center; its game section opens lobbies. !games explains game commands and rules.',
                '- Games: !wordle, !rebus, !scramble, !wordchain, !wordforge, and !mafia open lobbies. The host must also join; only the host can start or stop a match. One game can run per group.',
                '- Stop commands: Wordle !stopwordle; Country Rebus !stoprebus; Word Chain !stopwordchain; Scrambled Word !stopscramble; Word Forge !stopforge; Mafia !stopmafia.',
                '- When asked how to stop a named game, give its exact stop command first and briefly say only the host can use it. Do not answer only with !games when the exact command is listed here.',
                '- Economy: !profile, !bal, !daily, !store, !buy, !beg, and !pay. Balances are displayed in dollars.',
                '- AI/media: !ai, !draw, !analyze, !speak, and !voice.',
                '- Image generation: !draw <prompt> offers 1) GPT-image-2 on Azure ($5,000 game dollars) and 2) Pollinations (free). Reply 1 or 2 within 60 seconds; reply cancel to stop.',
                '- Hymns: !nyimbo searches the existing Nyimbo za Kristo hymnal; !hymn <number, title, or lyric phrase> searches the English SDA Hymnal from hymnal.rindra.org, returns its lyrics, and looks for a piano instrumental voice note.',
                '- Bible verses: !verse <reference> requests English or Kiswahili text; add audio to receive a voice note in the currently selected !voice. Other utilities include weather, catch-up summaries, video handling, and the private class portal. Availability depends on configuration and the exact command listed in !menu.',
                '- Owner-only administration is shown by !owner. Do not disclose secrets or assume the speaker is the owner.',
                '',
                'For questions about a feature, explain its user-facing purpose and the relevant command. If a detail is not established here or in the conversation, say so briefly.'
            ].join(String.fromCharCode(10));

            let aiReply = null;

            // ATTEMPT 1: AZURE OPENAI (PRIMARY)
            const azureUserEntry = { role: 'user', content: contextualizedPrompt };
            history.push(azureUserEntry);
            try {
                const recentHistory = history.slice(-MAX_AI_MEMORY);
                const formattedAzureHistory = recentHistory.map(item => ({
                    role: item.role === 'model' ? 'assistant' : (item.role || 'user'),
                    content: item.content || item.text
                }));

                const response = await azureClient.chat.completions.create({
                    model: process.env.AZURE_OPENAI_CHAT_DEPLOYMENT || 'gpt-4o-mini',
                    messages: [
                        { role: 'system', content: systemInstructionText },
                        ...formattedAzureHistory
                    ],
                    max_tokens: 1000
                });

                aiReply = response.choices[0]?.message?.content?.trim();
                if (aiReply) {
                    history.push({ role: 'assistant', content: aiReply });
                } else {
                    const entryIndex = history.lastIndexOf(azureUserEntry);
                    if (entryIndex !== -1) history.splice(entryIndex, 1);
                }
            } catch (azureErr) {
                const entryIndex = history.lastIndexOf(azureUserEntry);
                if (entryIndex !== -1) history.splice(entryIndex, 1);
                console.warn('⚠️ Azure OpenAI primary failed. Falling back to Gemini:', azureErr.message);
            }

            // ATTEMPT 2: GEMINI (FALLBACK)
            if (!aiReply && ai) {
                const geminiUserEntry = { role: 'user', content: contextualizedPrompt };
                history.push(geminiUserEntry);
                try {
                    const recentHistory = history.slice(-MAX_AI_MEMORY);
                    const contents = recentHistory.map(item => ({
                        role: item.role === 'assistant' || item.role === 'model' ? 'model' : 'user',
                        parts: [{ text: item.content || item.text }]
                    }));

                    const response = await ai.models.generateContent({
                        model: 'gemini-3.5-flash-lite',
                        contents,
                        config: { systemInstruction: systemInstructionText }
                    });

                    aiReply = response.text?.trim();
                    if (aiReply) {
                        history.push({ role: 'assistant', content: aiReply });
                    } else {
                        const entryIndex = history.lastIndexOf(geminiUserEntry);
                        if (entryIndex !== -1) history.splice(entryIndex, 1);
                    }
                } catch (geminiErr) {
                    const entryIndex = history.lastIndexOf(geminiUserEntry);
                    if (entryIndex !== -1) history.splice(entryIndex, 1);
                    console.error('❌ Gemini fallback failed:', geminiErr.message);
                }
            } else if (!aiReply) {
                console.warn('⚠️ Gemini fallback skipped because GEMINI_API_KEY is not configured.');
            }

            // ----------------------------------------------------
            // OUTPUT RESPONSE
            // ----------------------------------------------------
            if (aiReply) {
                if (history.length > MAX_AI_MEMORY) {
                    history.splice(0, history.length - MAX_AI_MEMORY);
                }
                await message.reply(aiReply);
            } else {
                await message.reply(
                    '❌ All AI neural pathways are currently unreachable. Please try again in a moment.\n' +
                    `\`wantam\`\t\t` + `👆😅`
                );
            }

            return true;
        }

        // ====================================================

    return false;
};

module.exports = { handleAiCommand };
