function registerMessageHandler(client, dependencies) {
    const {
        baseDir,
        fs,
        path,
        execFileAsync,
        axios,
        googleTTS,
        EdgeTTS,
        MessageMedia,
        getUserBalance,
        deductBalance,
        transferCoins,
        getUser,
        readDB,
        writeDB,
        resetEconomy,
        handleProfileCommand,
        startWordleLobby,
        startWordleGame,
        joinLobby,
        processGuess,
        stopGame,
        startWordChainLobby,
        joinWordChain,
        startWordChainGame,
        processWordChain,
        stopWordChainCommand,
        startRebusLobby,
        startRebusGame,
        stopRebusGame,
        joinRebusLobby,
        processRebusGuess,
        processRebusHint,
        handleStealCommand,
        startScrambleLobby,
        startScrambleGame,
        stopScrambleGame,
        joinScrambleLobby,
        processScrambleGuess,
        processScrambleHint,
        startWordForgeLobby,
        joinWordForgeLobby,
        startWordForgeGame,
        stopWordForgeGame,
        processWordForgeDmMessage,
        handleWordForgeStealCommand,
        getGamesList,
        handleBalanceCommand,
        getWeather,
        fetchBibleVerse,
        getHymn,
        sendHymnPianoAudio,
        logMessage,
        getChatHistory,
        resetClassDB,
        readClassDB,
        writeClassDB,
        isUserInClassSession,
        endSession,
        classHandler,
        handleAttendance,
        startMafiaLobby,
        startMafiaGame,
        handleMafiaPublicMessage,
        joinMafiaLobby,
        handleNightAction,
        castVote,
        endMafiaGame,
        getCatalogMenu,
        buyAsset,
        saveUserAsset,
        getBotMenu,
        handleSongCommand,
        handleVideoCommand,
        handleVideoQualityReply,
        buildImageAnalysisContent,
        normalizeWhatsAppNumber,
        parseDuration,
        grantImageAccess,
        revokeImageAccess,
        listImageAccess,
        buildWeatherResponse,
        generateMafiaNarration,
        ai,
        azureClient,
        aiMemory,
        MAX_AI_MEMORY,
        aiCooldowns,
        imageState,
        speakCooldowns,
        voiceCooldowns,
        pendingBibleRequests,
        knownGroupChats,
        knownPrivateChats,
        voiceSelections,
        EDGE_TTS_VOICES,
        DEFAULT_EDGE_VOICE,
        VOICE_COOLDOWN_MS,
        AI_COOLDOWN_MS,
        DRAW_COOLDOWN_MS,
        DRAW_GLOBAL_COOLDOWN_MS,
        ANALYZE_COOLDOWN_MS,
        SPEAK_COOLDOWN_MS,
        isOwner,
        canUseImageFeatures,
        getOwnerMenu,
        IMAGE_ACCESS_DENIED_MESSAGE,
        OWNER_NUMBER,
        getCanonicalJid,
        getSenderContact,
        getSenderJid,
        getContactJid,
        reactToCommand
    } = dependencies;

    client.on('message', async message => {
    if (message.from === 'status@broadcast') return;
    await reactToCommand(message);


    try {
        const chatId = message.from;
        // Track chats for Owner Statistics
        if (chatId.endsWith('@g.us')) {
            knownGroupChats.add(chatId);
        } else if (chatId.endsWith('@c.us')) {
            knownPrivateChats.add(chatId);
        }

        const isGroup = message.from.endsWith('@g.us');
        const senderContact = await getSenderContact(message);
        const senderId = await getSenderJid(message, senderContact);
        const economyUserId = senderId;

        const userName = senderContact?.pushname || senderContact?.name || 'Chaos Member';
        const text = message.body ? message.body.trim() : '';
        const lowerText = text.toLowerCase();

        const generateSelectedImage = async (prompt, choice) => {
            if (!canUseImageFeatures(senderId)) {
                await message.reply(IMAGE_ACCESS_DENIED_MESSAGE);
                return;
            }
            if (imageState.drawGenerationInProgress) {
                await message.reply('🎨 Another image job is running. Please try again shortly.');
                return;
            }

            const deployment = choice.kind === 'azure'
                ? (process.env[choice.envName] || choice.defaultDeployment)
                : null;
            if (choice.kind === 'azure' && (!process.env.AZURE_OPENAI_KEY || !process.env.AZURE_OPENAI_ENDPOINT)) {
                await message.reply('⚙️ Azure image generation is not configured. Ask the bot owner to check the Azure settings.');
                return;
            }

            const now = Date.now();
            const lastUsed = imageState.drawCooldowns.get(senderId) || 0;
            if (now - lastUsed < DRAW_COOLDOWN_MS) {
                const remaining = Math.ceil((DRAW_COOLDOWN_MS - (now - lastUsed)) / 1000);
                await message.reply('⏳ *Image Studio Cooling Down...*\nPlease wait ' + remaining + 's.');
                return;
            }

            const globalRemaining = DRAW_GLOBAL_COOLDOWN_MS - (now - imageState.lastDrawAt);
            if (globalRemaining > 0) {
                await message.reply('⏳ Image Studio is pacing requests. Please wait ' + Math.ceil(globalRemaining / 1000) + 's.');
                return;
            }

            imageState.drawCooldowns.set(senderId, now);
            imageState.lastDrawAt = now;
            imageState.drawGenerationInProgress = true;

            const providerStartedAt = Date.now();
            try {
                await message.reply('🎨 *Image Studio Active...* Generating with ' + choice.label + '.');
                let imageMedia;

                if (choice.kind === 'pollinations') {
                    const encodedPrompt = encodeURIComponent(prompt);
                    const imageUrl = 'https://image.pollinations.ai/prompt/' + encodedPrompt + '?width=1024&height=1024&nologo=true';
                    imageMedia = await MessageMedia.fromUrl(imageUrl, { unsafeMime: true });
                } else {
                    const endpoint = process.env.AZURE_OPENAI_ENDPOINT.replace(/\/+$/, '');
                    const configuredTimeout = Number(process.env.AZURE_OPENAI_IMAGE_TIMEOUT_MS);
                    const imageTimeoutMs = Number.isFinite(configuredTimeout) && configuredTimeout > 0
                        ? configuredTimeout
                        : 300000;
                    const response = await axios.post(
                        endpoint + '/openai/v1/images/generations?api-version=preview',
                        {
                            model: deployment,
                            prompt,
                            size: '1024x1024',
                            n: 1,
                            quality: 'high',
                            output_format: 'png'
                        },
                        {
                            headers: {
                                'Content-Type': 'application/json',
                                'api-key': process.env.AZURE_OPENAI_KEY
                            },
                            timeout: imageTimeoutMs
                        }
                    );

                    const imageData = response.data?.data?.[0]?.b64_json;
                    if (!imageData) {
                        throw new Error('Azure returned no base64 image data.');
                    }

                    console.log('✅ Azure image generated with ' + deployment + ' in ' + ((Date.now() - providerStartedAt) / 1000).toFixed(1) + 's.');
                    imageMedia = new MessageMedia('image/png', imageData, 'chaos-image.png');
                }

                const captionPrompt = prompt.length > 800 ? prompt.slice(0, 797) + '...' : prompt;
                const caption = '🎨 *' + choice.label + '*\n*Prompt:* "' + captionPrompt + '"\n`wantam`👆😅';
                await client.sendMessage(chatId, imageMedia, { caption });
            } catch (imgErr) {
                const providerMessage = imgErr.response?.data?.error?.message || imgErr.message || 'Unknown image generation error';
                console.error('❌ Image Generation Error:', {
                    provider: choice.label,
                    status: imgErr.response?.status,
                    code: imgErr.code,
                    elapsedSeconds: ((Date.now() - providerStartedAt) / 1000).toFixed(1),
                    message: providerMessage
                });
                await message.reply('❌ ' + choice.label + ' image generation failed. Check provider settings, Azure quota, and bot logs.');
            } finally {
                imageState.drawGenerationInProgress = false;
            }
        };

        const imageChoiceKey = chatId + ':' + senderId;
        let pendingDrawChoice = imageState.pendingDrawChoices.get(imageChoiceKey);
        if (pendingDrawChoice && pendingDrawChoice.expiresAt <= Date.now()) {
            clearTimeout(pendingDrawChoice.timer);
            imageState.pendingDrawChoices.delete(imageChoiceKey);
            if (/^[1-3]$/.test(text)) {
                await message.reply('⌛ That image selection expired. Send !draw <prompt> to start again.');
                return;
            }
            pendingDrawChoice = null;
        }

        if (pendingDrawChoice && /^(cancel|cancel draw)$/i.test(text)) {
            clearTimeout(pendingDrawChoice.timer);
            imageState.pendingDrawChoices.delete(imageChoiceKey);
            await message.reply('🛑 Image generation cancelled.');
            return;
        }

        if (pendingDrawChoice && /^\d+$/.test(text)) {
            if (!canUseImageFeatures(senderId)) {
                clearTimeout(pendingDrawChoice.timer);
                imageState.pendingDrawChoices.delete(imageChoiceKey);
                await message.reply(IMAGE_ACCESS_DENIED_MESSAGE);
                return;
            }
            const choice = imageState.IMAGE_MODEL_CHOICES.find((item) => item.number === text);
            if (!choice) {
                await message.reply('Choose 1, 2, or 3, or reply `cancel`.');
                return;
            }
            if (imageState.drawGenerationInProgress) {
                await message.reply('🎨 Another image job is running. Your selection is still waiting; try again shortly.');
                return;
            }
            const lastUsed = imageState.drawCooldowns.get(senderId) || 0;
            const remaining = DRAW_COOLDOWN_MS - (Date.now() - lastUsed);
            if (remaining > 0) {
                await message.reply('⏳ Image Studio is cooling down. Reply ' + text + ' again in ' + Math.ceil(remaining / 1000) + 's.');
                return;
            }
            const globalRemaining = DRAW_GLOBAL_COOLDOWN_MS - (Date.now() - imageState.lastDrawAt);
            if (globalRemaining > 0) {
                await message.reply('⏳ Image Studio is pacing requests. Reply ' + text + ' again in ' + Math.ceil(globalRemaining / 1000) + 's.');
                return;
            }
            if (choice.kind === 'azure' && (!process.env.AZURE_OPENAI_KEY || !process.env.AZURE_OPENAI_ENDPOINT)) {
                await message.reply('⚙️ Azure image generation is not configured. You can choose 3 for Pollinations instead.');
                return;
            }

            clearTimeout(pendingDrawChoice.timer);
            imageState.pendingDrawChoices.delete(imageChoiceKey);
            await generateSelectedImage(pendingDrawChoice.prompt, choice);
            return;
        }

        const wasHandledAsVideoReply = await handleVideoQualityReply(message);
        if (wasHandledAsVideoReply) {
            return;
        }

        // Word Forge guesses are plain one-word DM messages; no quoted reply is required.
        if (!isGroup) {
            const forgeResult = processWordForgeDmMessage(senderId, senderContact, text, client);
            if (forgeResult && forgeResult.handled) {
                if (forgeResult.response) await client.sendMessage(chatId, forgeResult.response);
                return;
            }
        }

        // ====================================================
        // 👑 OWNER: DIRECT PLAIN-TEXT APPLICATION INTERCEPT
        // ====================================================
        if (isOwner(senderId) && !isGroup) {
            const handled = await classHandler.handleOwnerPlaintextResponse(client, message, text, lowerText);
            if (handled) return; // Stops normal bot commands or AI from triggering
        }

        // ============================================================
        // 🎓 CLASS PORTAL INTERCEPT (SESSION LOCKOUT)
        // ============================================================
        // Sessions are strictly confined to DMs. Group chats remain 100% independent!
        if (!isGroup && isUserInClassSession(senderId)) {
            
            // Universal Escape Hatch
            if (text === '99') {
                endSession(senderId);
                await message.reply('🚪 You have safely logged out of the Class Portal.');
                return;
            }

            // AUTO-EXIT ON GLOBAL COMMANDS IN DM: If you type a command starting with '!' 
            // while in your portal session, automatically exit the session and run the command.
            if (text.startsWith('!')) {
                endSession(senderId);
                // Falls through smoothly to execute your command
            } else {
                // Route your standard portal menu input directly to the class state machine
                await classHandler.handleInput(client, message, senderId, text, userName);
                return; // CRITICAL: Stop execution for regular portal inputs
            }
        }

        // ====================================================
        // 📖 BIBLE VERSE
        // ====================================================

        const bibleKey = `${chatId}:${senderId}`;

        if (pendingBibleRequests.has(bibleKey)) {
            const pending = pendingBibleRequests.get(bibleKey);

            if (lowerText === '1' || lowerText === '2') {
                pendingBibleRequests.delete(bibleKey);

                const language = lowerText === '1' ? 'english' : 'swahili';

                try {
                    await message.reply('📖 Fetching your verse...');

                    const result = await fetchBibleVerse(
                        pending.reference,
                        language
                    );

                    if (!result.success) {
                        await message.reply(`❌ ${result.error}`);
                        return;
                    }

                    const verseReference =
                        `${result.book} ${result.chapter}:${result.startVerse}` +
                        (result.endVerse !== result.startVerse
                            ? `-${result.endVerse}`
                            : '');

                    const languageName =
                        language === 'english'
                            ? 'English'
                            : 'Kiswahili';

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

                return;
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
                return;
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

            return;
        }

        // ====================================================
        // 🎵 NYIMBO ZA KRISTO
        // ====================================================

        if (lowerText.startsWith('!nyimbo')) {
            const query = text.replace(/^!nyimbo/i, '').trim();
            const result = getHymn(query);
            
            // 1. Reply with the text lyrics instantly
            await message.reply(result.text);

            // 2. If a valid song was found, generate and send the piano voice note
            if (result.success && result.song) {
                await client.sendMessage(chatId, '🎹 *Synthesizing piano instrumental voice note...*');
                await sendHymnPianoAudio(chatId, result.song.ID, result.song.Text, client);
            }
            return;
        }

        // Save chat history and let the active Mafia narrator see eligible public game chat.
        logMessage(chatId, userName, text);
        if (isGroup && text && !text.startsWith('!')) {
            void handleMafiaPublicMessage(chatId, senderId, userName, text)
                .catch(error => console.warn('[MAFIA AI NARRATOR] Message hook error:', error.message));
        }

        // ====================================================
        // CLASS ROLL CALL DIRECT MESSAGE LISTENER
        // ====================================================
        if (!isGroup && lowerText === 'present') {
            const wasHandledAsAttendance = await handleAttendance(message, senderId, client);
            if (wasHandledAsAttendance) return;
        }

        // ====================================================
        // 📊 CLASS POLL DIRECT MESSAGE INTERCEPTOR
        // ====================================================
        if (!isGroup && /^\d+$/.test(lowerText) && !isUserInClassSession(senderId)) {
            const db = readClassDB();
            let studentClass = null;
            let studentId = null;

            // Find if sender is a registered student
            for (const className in db.classes) {
                if (db.classes[className].members) {
                    const memberId = Object.keys(db.classes[className].members).find(
                        key => db.classes[className].members[key].phoneId === senderId
                    );
                    if (memberId) {
                        studentClass = className;
                        studentId = memberId;
                        break;
                    }
                }
            }

            if (studentClass && db.classes[studentClass].polls) {
                const activePoll = db.classes[studentClass].polls.find(p => p.status === 'ACTIVE');
                if (activePoll) {
                    const voteIdx = parseInt(lowerText) - 1;
                    
                    if (activePoll.votes[studentId] !== undefined) {
                        await message.reply("❌ You have already voted on this poll.");
                        return; // Stop execution
                    }

                    if (voteIdx >= 0 && voteIdx < activePoll.options.length) {
                        activePoll.votes[studentId] = voteIdx;
                        writeClassDB(db);
                        
                        const dateObj = new Date(activePoll.expiresAt);
                        const timeStr = dateObj.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Nairobi' });
                        
                        await message.reply(`✅ *Vote locked in anonymously.*\n\nThe final results will be available in your Student Hub today at *${timeStr}*.`);
                        return; // Stop execution
                    } else {
                        await message.reply(`❌ Invalid option. Please reply with a number between 1 and ${activePoll.options.length}.`);
                        return; // Stop execution
                    }
                }
            }
        }

        // ====================================================
        // MAFIA PRIVATE NIGHT COMMANDS & REPLIES
        // ====================================================

        if (!isGroup) {
            if (message.hasQuotedMsg) {
                try {
                    const quotedMsg = await message.getQuotedMessage();
                    if (quotedMsg && quotedMsg.body && quotedMsg.body.includes('PROJECT MAFIA CASE')) {
                        await message.reply(
                            '✅ *Private channel established!*\n\n' +
                            'Your direct chat session with the bot is now active.\n' +
                            'Head back to the group and type `!joinmafia` to complete your registration!'
                        );
                        return;
                    }
                } catch (quotedErr) {
                    console.warn('[MAFIA DM] Could not check quoted message:', quotedErr.message);
                }
            }

            if (
                lowerText.startsWith('!kill') ||
                lowerText.startsWith('!save') ||
                lowerText.startsWith('!investigate')
            ) {
                const parts = text.split(/\s+/);
                const command = parts[0].toLowerCase().replace(/^!/, '');
                const targetLetter = parts[1];

                if (!targetLetter) {
                    await message.reply(`Specify a player letter.\n\nExample: \`!${command} C\``);
                    return;
                }

                await handleNightAction(senderId, command, targetLetter, senderContact);
                return;
            }
        } else {
            if (
                lowerText.startsWith('!kill') ||
                lowerText.startsWith('!save') ||
                lowerText.startsWith('!investigate')
            ) {
                await message.reply(
                    '❌ *Night actions are top secret!*\n\n' +
                    'Long-press my message, select *Reply Privately*, and send `!kill`, `!save`, or `!investigate` to me in secret.'
                );
                return;
            }
        }

        // ====================================================
        // IMAGE GENERATOR (!draw)
        // ====================================================

        const drawCommandMatch = text.match(/^!draw(?:\s+([\s\S]*))?$/i);
        if (drawCommandMatch) {
            if (!canUseImageFeatures(senderId)) {
                await message.reply(IMAGE_ACCESS_DENIED_MESSAGE);
                return;
            }
            const prompt = (drawCommandMatch[1] || '').trim();
            if (!prompt) {
                await message.reply('🎨 Use one command: !draw <prompt>. I will show you the image model menu.');
                return;
            }

            if (prompt.length > 4000) {
                await message.reply('✂️ Please keep the image prompt under 4,000 characters.');
                return;
            }

            if (imageState.drawGenerationInProgress) {
                await message.reply('🎨 Another image job is running. Please try again shortly.');
                return;
            }

            const existingChoice = imageState.pendingDrawChoices.get(imageChoiceKey);
            if (existingChoice) clearTimeout(existingChoice.timer);
            const pendingChoice = { prompt, expiresAt: Date.now() + 60000, timer: null };
            pendingChoice.timer = setTimeout(() => {
                if (imageState.pendingDrawChoices.get(imageChoiceKey) === pendingChoice) {
                    imageState.pendingDrawChoices.delete(imageChoiceKey);
                }
            }, 60000);
            if (typeof pendingChoice.timer.unref === 'function') pendingChoice.timer.unref();
            imageState.pendingDrawChoices.set(imageChoiceKey, pendingChoice);

            const menu = imageState.IMAGE_MODEL_CHOICES.map((choice) =>
                choice.number + '. ' + choice.label + ' — ' + choice.description + (choice.kind === 'azure' ? ' (Azure credits)' : ' (free)')
            ).join('\n');
            await message.reply('🎨 *Image Studio — best-first model choices*\n\n' + menu + '\n\nReply with 1, 2, or 3 within 60 seconds. Reply `cancel` to stop.');
            return;
        }

        // ====================================================
        // IMAGE ANALYSIS (!analyze)
        // ====================================================

        const analyzeCommandMatch = text.match(/^!analyze(?:\s+([\s\S]*))?$/i);
        if (analyzeCommandMatch) {
            if (!canUseImageFeatures(senderId)) {
                await message.reply(IMAGE_ACCESS_DENIED_MESSAGE);
                return;
            }
            const question = (analyzeCommandMatch[1] || '').trim();
            let imageMessage = message;

            if (!imageMessage.hasMedia && message.hasQuotedMsg) {
                try {
                    imageMessage = await message.getQuotedMessage();
                } catch (quoteErr) {
                    console.warn('[IMAGE ANALYSIS] Could not access the replied-to message:', quoteErr.message);
                    imageMessage = null;
                }
            }

            if (!imageMessage || !imageMessage.hasMedia) {
                await message.reply(
                    '🔎 Attach a photo with !analyze <question> in its caption, or reply to a photo with !analyze <question>.'
                );
                return;
            }

            if (imageMessage.type && imageMessage.type !== 'image') {
                await message.reply('🖼️ I can analyze photos only. Please send a JPEG, PNG, WebP, or GIF image.');
                return;
            }

            const lastAnalyzeAt = imageState.analyzeCooldowns.get(senderId) || 0;
            const cooldownRemaining = ANALYZE_COOLDOWN_MS - (Date.now() - lastAnalyzeAt);
            if (cooldownRemaining > 0) {
                await message.reply('⏳ Please wait ' + Math.ceil(cooldownRemaining / 1000) + 's before analyzing another image.');
                return;
            }

            if (!process.env.AZURE_OPENAI_KEY || !process.env.AZURE_OPENAI_ENDPOINT) {
                await message.reply('⚙️ Azure image analysis is not configured. Ask the bot owner to check the Azure settings.');
                return;
            }

            if (!canUseImageFeatures(senderId)) {
                await message.reply(IMAGE_ACCESS_DENIED_MESSAGE);
                return;
            }
            imageState.analyzeCooldowns.set(senderId, Date.now());
            try {
                await message.reply('🔎 Analyzing your image with the Azure vision model...');
                const imageMedia = await imageMessage.downloadMedia();
                const imageContent = buildImageAnalysisContent(imageMedia, question);
                if (!canUseImageFeatures(senderId)) {
                    await message.reply(IMAGE_ACCESS_DENIED_MESSAGE);
                    return;
                }
                const response = await azureClient.chat.completions.create({
                    model: process.env.AZURE_OPENAI_CHAT_DEPLOYMENT || 'gpt-4o-mini',
                    messages: [
                        {
                            role: 'system',
                            content: 'You analyze user-provided images. Describe only what is visible, answer the user’s question, and be clear when a detail is uncertain.'
                        },
                        {
                            role: 'user',
                            content: imageContent
                        }
                    ],
                    max_tokens: 800
                });

                const analysis = response.choices[0]?.message?.content?.trim();
                if (!analysis) {
                    await message.reply('⚠️ The vision model returned an empty analysis. Please try again.');
                    return;
                }

                await message.reply('🖼️ *Image analysis*\n\n' + analysis);
            } catch (analyzeErr) {
                console.error('❌ Image Analysis Error:', {
                    status: analyzeErr.response?.status,
                    code: analyzeErr.code,
                    message: analyzeErr.response?.data?.error?.message || analyzeErr.message
                });

                const knownFailureMessages = {
                    IMAGE_ANALYSIS_MEDIA_MISSING: 'I could not download that photo. Please resend it as a regular image (not view-once) and try again.',
                    IMAGE_ANALYSIS_UNSUPPORTED_TYPE: 'I can analyze JPEG, PNG, WebP, and GIF photos.',
                    IMAGE_ANALYSIS_TOO_LARGE: 'That image is too large. Please send an image smaller than 10 MB.',
                    IMAGE_ANALYSIS_INVALID_DATA: 'I could not read that image. Please resend the photo and try again.'
                };
                const failureMessage = knownFailureMessages[analyzeErr.code] ||
                    '❌ Image analysis failed. Check the Azure vision deployment, quota, and bot logs.';
                await message.reply(failureMessage);
            }

            return;
        }

        // ====================================================
        // CATCHUP SUMMARY COMMAND (!catchup)
        // ====================================================

        if (lowerText === '!catchup' || lowerText === '!summary') {
            const history = getChatHistory(chatId);

            if (history.length === 0) {
                await message.reply('📭 Not enough recent chat history to summarize yet.');
                return;
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

            return;
        }

        // ============================================================
        // FREE TEXT-TO-SPEECH (!speak / !tts) VIA GOOGLE-TTS-API
        // REAL OGG/OPUS WHATSAPP VOICE NOTE
        // ============================================================

        if (lowerText.startsWith('!speak ') || lowerText.startsWith('!tts ')) {
            const speechText = text.replace(/^!(speak|tts)\s+/i, '').trim();

            if (!speechText) {
                await message.reply('🎙️ Please provide text.\n\n*Example:* `!speak Hello Chaos Group!`');
                return;
            }

            const now = Date.now();
            const lastUsed = speakCooldowns.get(senderId) || 0;

            if (now - lastUsed < SPEAK_COOLDOWN_MS) {
                const remaining = Math.ceil((SPEAK_COOLDOWN_MS - (now - lastUsed)) / 1000);
                await message.reply(`⏳ *Voice Engine Cooling Down...*\nPlease wait ${remaining}s.`);
                return;
            }

            speakCooldowns.set(senderId, now);

            const tempDir = path.join(baseDir, 'temp');
            const timestamp = `${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
            const inputFile = path.join(tempDir, `chaos-tts-${timestamp}.mp3`);
            const outputFile = path.join(tempDir, `chaos-tts-${timestamp}.ogg`);

            try {
                if (!fs.existsSync(tempDir)) {
                    fs.mkdirSync(tempDir, { recursive: true });
                }

                await message.reply('🎙️ *CHAOS VOICE ENGINE*\nGenerating voice audio...');

                const audioBase64 = await googleTTS.getAudioBase64(
                    speechText,
                    {
                        lang: 'en',
                        slow: false,
                        host: 'https://translate.google.com'
                    }
                );

                fs.writeFileSync(inputFile, Buffer.from(audioBase64, 'base64'));

                console.log('🎙️ Converting TTS audio to OGG/Opus...');

                await execFileAsync(
                    'ffmpeg',
                    [
                        '-y',
                        '-i', inputFile,
                        '-ac', '1',
                        '-c:a', 'libopus',
                        '-b:a', '32k',
                        '-vbr', 'on',
                        '-application', 'voip',
                        outputFile
                    ],
                    { windowsHide: true }
                );

                if (!fs.existsSync(outputFile)) {
                    throw new Error('FFmpeg did not create the OGG voice file.');
                }

                const outputStats = fs.statSync(outputFile);
                if (outputStats.size === 0) {
                    throw new Error('FFmpeg created an empty OGG voice file.');
                }

                console.log(`✅ TTS conversion successful: ${(outputStats.size / 1024).toFixed(1)} KB`);

                const oggBuffer = fs.readFileSync(outputFile);
                const oggBase64 = oggBuffer.toString('base64');

                const audioMedia = new MessageMedia(
                    'audio/ogg; codecs=opus',
                    oggBase64,
                    'chaos-tts.ogg'
                );

                await client.sendMessage(chatId, audioMedia, { sendAudioAsVoice: true });
                console.log(`🎙️ Chaos TTS voice note sent successfully to ${chatId}`);

            } catch (ttsErr) {
                console.error('❌ Speech Generation Error:', ttsErr);
                await message.reply(`❌ Text-to-speech engine failed.\n\nError: ${ttsErr.message}`);
            } finally {
                try {
                    if (fs.existsSync(inputFile)) fs.unlinkSync(inputFile);
                    if (fs.existsSync(outputFile)) fs.unlinkSync(outputFile);
                } catch (cleanupErr) {
                    console.warn('⚠️ TTS cleanup warning:', cleanupErr.message);
                }
            }

            return;
        }
        
        // ============================================================
        // EDGE TTS VOICE SYSTEM      
        
        if (lowerText === '!voice' || lowerText.startsWith('!voice ')) {
            const voiceInput = text.replace(/^!voice\s*/i, '').trim();
        
            if (!voiceInput) {
                const currentVoiceKey = voiceSelections.get(senderId) || DEFAULT_EDGE_VOICE;
                const currentVoice = EDGE_TTS_VOICES[currentVoiceKey];
        
                await message.reply(
                    `🎙️ *CHAOS VOICE ENGINE*\n\n` +
                    `Current voice:\n🔊 *${currentVoice.name}*\n\n` +
                    `*Available Voices*\n` +
                    `👨 *American Male* \`!voice male\`\n` +
                    `👩 *American Female* \`!voice female\`\n` +
                    `🎭 *Aria* \`!voice aria\`\n` +
                    `🇬🇧 *British Female* \`!voice british\`\n` +
                    `🇬🇧 *British Male* \`!voice britishmale\`\n` +
                    `🇰🇪 *Kenyan Female* \`!voice kenya\`\n` +
                    `🇰🇪 *Kenyan Male* \`!voice kenyanmale\`\n` +
                    `🇮🇳 *Indian Female* \`!voice indian\`\n` +
                    `🇮🇳 *Indian Male* \`!voice indianmale\`\n\n` +
                    `━━━━━━━━━━━━━━━━━━\n\n` +
                    `*Select a voice:* \`!voice kenyanmale\`\n` +
                    `Then speak: \`!voice Hello Chaos Group!\``
                );
                return;
            }
        
            const requestedVoice = voiceInput.toLowerCase();
        
            if (EDGE_TTS_VOICES[requestedVoice]) {
                voiceSelections.set(senderId, requestedVoice);
                const selectedVoice = EDGE_TTS_VOICES[requestedVoice];
        
                await message.reply(
                    `🎙️ *VOICE CHANGED*\n\n` +
                    `🔊 *${selectedVoice.name}*\n\n` +
                    `Voice engine:\n*Microsoft Edge TTS*\n\n` +
                    `Use: \`!voice Your message here\`\n` +
                    `to speak with this voice.`
                );
                return;
            }
        
            const speechText = voiceInput.trim();
            if (!speechText) return;
        
            const now = Date.now();
            const lastUsed = voiceCooldowns.get(senderId) || 0;
        
            if (now - lastUsed < VOICE_COOLDOWN_MS) {
                const remaining = Math.ceil(
                    (VOICE_COOLDOWN_MS - (now - lastUsed)) / 1000
                );
        
                await message.reply(
                    `⏳ *Voice Engine Cooling Down...*\n\n` +
                    `Please wait ${remaining}s.`
                );
        
                return;
            }
        
            voiceCooldowns.set(senderId, now);
        
            const selectedVoiceKey =
                voiceSelections.get(senderId) || DEFAULT_EDGE_VOICE;
        
            const selectedVoice =
                EDGE_TTS_VOICES[selectedVoiceKey] ||
                EDGE_TTS_VOICES[DEFAULT_EDGE_VOICE];
        
            const tempDir = path.join(baseDir, 'temp');
        
            const timestamp =
                `${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
        
            const edgeInputFile =
                path.join(tempDir, `chaos-edge-${timestamp}.mp3`);
        
            const opusOutputFile =
                path.join(tempDir, `chaos-edge-${timestamp}.ogg`);
        
            try {
                if (!fs.existsSync(tempDir)) {
                    fs.mkdirSync(tempDir, { recursive: true });
                }
        
                await message.reply(
                    `🎙️ *CHAOS VOICE ENGINE*\n\n` +
                    `🔊 *${selectedVoice.name}*\n` +
                    `Generating voice...`
                );
        
                console.log(
                    `🎙️ Edge TTS voice: ${selectedVoice.voice}`
                );
        
                // ============================================
                // MICROSOFT EDGE TTS
                // ============================================
        
                const tts = new EdgeTTS({
                    voice: selectedVoice.voice,
                    lang: selectedVoice.voice.split('-').slice(0, 2).join('-')
                });
        
                await tts.ttsPromise(
                    speechText,
                    edgeInputFile
                );
        
                if (!fs.existsSync(edgeInputFile)) {
                    throw new Error(
                        'Edge TTS did not create the audio file.'
                    );
                }
        
                const inputStats = fs.statSync(edgeInputFile);
        
                if (inputStats.size === 0) {
                    throw new Error(
                        'Edge TTS created an empty audio file.'
                    );
                }
        
                console.log(
                    `✅ Edge TTS audio created: ${(inputStats.size / 1024).toFixed(1)} KB`
                );
        
                console.log(
                    '🎙️ Converting Edge TTS → OGG/Opus...'
                );
        
                // ============================================
                // CONVERT TO REAL WHATSAPP OGG/OPUS
                // ============================================
        
                await execFileAsync(
                    'ffmpeg',
                    [
                        '-y',
                        '-i', edgeInputFile,
                        '-ac', '1',
                        '-ar', '48000',
                        '-c:a', 'libopus',
                        '-b:a', '32k',
                        '-vbr', 'on',
                        '-application', 'voip',
                        opusOutputFile
                    ],
                    {
                        windowsHide: true
                    }
                );
        
                if (!fs.existsSync(opusOutputFile)) {
                    throw new Error(
                        'FFmpeg did not create the OGG/Opus file.'
                    );
                }
        
                const outputStats = fs.statSync(opusOutputFile);
        
                if (outputStats.size === 0) {
                    throw new Error(
                        'FFmpeg created an empty OGG/Opus file.'
                    );
                }
        
                console.log(
                    `✅ OGG/Opus created: ${(outputStats.size / 1024).toFixed(1)} KB`
                );
        
                // ============================================
                // SEND AS REAL WHATSAPP VOICE NOTE
                // ============================================
        
                const oggBuffer =
                    fs.readFileSync(opusOutputFile);
        
                const oggBase64 =
                    oggBuffer.toString('base64');
        
                const audioMedia = new MessageMedia(
                    'audio/ogg; codecs=opus',
                    oggBase64,
                    'chaos-voice.ogg'
                );
        
                await client.sendMessage(
                    chatId,
                    audioMedia,
                    {
                        sendAudioAsVoice: true
                    }
                );
        
                console.log(
                    '🎙️ Edge TTS voice note sent successfully'
                );
        
            } catch (voiceErr) {
        
                console.error(
                    '❌ Edge TTS Error:',
                    voiceErr
                );
        
                await message.reply(
                    `❌ *Voice engine failed.*\n\n` +
                    `Error: ${voiceErr.message}`
                );
        
            } finally {
        
                try {
        
                    if (fs.existsSync(edgeInputFile)) {
                        fs.unlinkSync(edgeInputFile);
                    }
        
                    if (fs.existsSync(opusOutputFile)) {
                        fs.unlinkSync(opusOutputFile);
                    }
        
                } catch (cleanupErr) {
        
                    console.warn(
                        '⚠️ Voice cleanup warning:',
                        cleanupErr.message
                    );
                }
            }
        
            return;
        }

        // ====================================================
        // !AI (HYBRID GEMINI WITH AZURE GPT-4O FALLBACK)
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
                return;
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
                    return;
                }

                try {
                    const weatherData = await getWeather({ city });
                    if (weatherData.error) {
                        await message.reply(weatherData.error);
                        return;
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
                return;
            }

            if (prompt.length > 4000) {
                await message.reply(
                    '*Prompt too long.*\n\n' +
                    'Please keep your question below 4,000 characters.'
                );
                return;
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
                return;
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
                '- The bot uses WhatsApp Web.js. AI chat uses Gemini first and Azure OpenAI as fallback; image features use configured image/vision services.',
                '',
                'FEATURES AND COMMANDS:',
                '- !menu shows the command center; its game section opens lobbies. !games explains game commands and rules.',
                '- Games: !wordle, !rebus, !scramble, !wordchain, !wordforge, and !mafia open lobbies. Players join with the command shown in that lobby; the host must also register and is the only one who can start or stop it. One game can run per group.',
                '- Economy: !profile, !bal, !daily, !store, !buy, !beg, and !pay. Balances are displayed in dollars.',
                '- AI/media: !ai, !draw, !analyze, !speak, and !voice.',
                '- Utilities include weather, Bible verses, hymns, catch-up summaries, video handling, and the private class portal. Availability depends on configuration and the exact command listed in !menu.',
                '- Owner-only administration is shown by !owner. Do not disclose secrets or assume the speaker is the owner.',
                '',
                'For questions about a feature, explain its user-facing purpose and the relevant command. If a detail is not established here or in the conversation, say so briefly.'
            ].join(String.fromCharCode(10));

            let aiReply = null;

            // ----------------------------------------------------
            // ATTEMPT 1: GOOGLE GEMINI (PRIMARY)
            // ----------------------------------------------------
            try {
                history.push({ role: 'user', text: contextualizedPrompt });
                const recentHistory = history.slice(-MAX_AI_MEMORY);
                const contents = recentHistory.map(item => ({
                    role: item.role === 'assistant' ? 'model' : item.role,
                    parts: [{ text: item.text || item.content }]
                }));

                const response = await ai.models.generateContent({
                    model: 'gemini-3.5-flash-lite',
                    contents,
                    config: { systemInstruction: systemInstructionText }
                });

                aiReply = response.text?.trim();

                if (aiReply) {
                    history.push({ role: 'model', text: aiReply });
                }

            } catch (geminiErr) {
                console.warn('⚠️ Gemini Primary Failed. Failing over to Azure GPT-4o:', geminiErr.message);
                
                // Roll back prompt from history array so it isn't duplicated on retry
                history.pop();
            }

            // ----------------------------------------------------
            // ATTEMPT 2: AZURE GPT-4O (FALLBACK)
            // ----------------------------------------------------
            if (!aiReply) {
                try {
                    history.push({ role: 'user', content: contextualizedPrompt });
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
                    }

                } catch (azureErr) {
                    console.error('❌ Both Gemini & Azure OpenAI failed:', azureErr.message);
                }
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

            return;
        }

        // ====================================================
        // CLASS PORTAL
        // ====================================================
        // ====================================================
        // CLASS PORTAL (DM REDIRECTION FOR SECURITY)
        // ====================================================
        if (lowerText === '!class' || lowerText === '!classes') {
            if (isGroup) {
                // 1. Gently notify the group without cluttering it
                await message.reply('🏫 *Class Portal*\n\nFor privacy, security, and password protection, the Class Portal runs exclusively in **Private DMs**. \n\n📩 *I have sent the gateway to your inbox!*');
                
                try {
                    // 2. Automatically open the session and send the menu directly to their DM inbox
                    createSession(senderId, 'MAIN_MENU');
                    // We simulate a message object so sendMainMenu works in their DM
                    const dmMockMessage = {
                        reply: async (text) => await client.sendMessage(senderId, text)
                    };
                    await sendMainMenu(dmMockMessage); // Or call handleClassCommand equivalent for DM
                } catch (e) {
                    await message.reply('❌ Please open a direct chat with me privately to use the Class Portal.');
                }
            } else {
                // If already in DM, run normally
                await classHandler.handleClassCommand(client, message, senderId, userName);
            }
            return;
        }
        
        // ====================================================
        // WEATHER COMMAND
        // ====================================================

        if (lowerText.startsWith('!weather')) {
            const city = text.replace(/^!weather/i, '').trim();

            if (!city) {
                await message.reply('Please specify a city, e.g., `!weather Nairobi`.');
                return;
            }

            try {
                const weatherData = await getWeather({ city });
                if (weatherData.error) {
                    await message.reply(weatherData.error);
                } else {
                    await message.reply(buildWeatherResponse(weatherData, userName));
                }
            } catch (weatherError) {
                console.error('❌ Weather Command Error:', weatherError);
                await message.reply('❌ *Weather System Error*');
            }
            return;
        }

        // ====================================================
        // 👤 OWNER CONTACT
        // ====================================================

        if (
            lowerText === '!ownercontact' ||
            lowerText === '!contactowner'
        ) {
            try {
                const ownerContact = await client.getContactById(
                    `${OWNER_NUMBER}@c.us`
                );

                if (!ownerContact) {
                    await message.reply(
                        '❌ *Owner contact could not be found right now.*'
                    );
                    return;
                }

                await message.reply(
                    '👑 *MASTER OWNER*\n\n' +
                    'Here is the contact for the Chaos Bot Owner.\n\n' +
                    '📇 *Tap the contact card below to save the Master Owner.*'
                );

                await client.sendMessage(
                    chatId,
                    ownerContact
                );

            } catch (err) {
                console.error(
                    '[OWNER CONTACT] Error:',
                    err
                );

                await message.reply(
                    '❌ *Could not send the owner contact card.*\n\n' +
                    'Please try again.'
                );
            }

            return;
        }

        // ====================================================
        // 👑 OWNER: QUICK-REPLY APPLICATION HANDLING
        // ====================================================
        if (isOwner(senderId) && message.hasQuotedMsg && !isGroup) {
            try {
                const quotedMsg = await message.getQuotedMessage();
                
                // Check if you are replying to an Application generated by the bot
                if (quotedMsg && quotedMsg.fromMe && quotedMsg.body.includes('📩 *NEW CLASS REP APPLICATION*')) {
                    
                    // Magically extract the User ID from the quoted text
                    const match = quotedMsg.body.match(/📱 \*User ID:\* \`(.+?)\`/);
                    
                    if (match && match[1]) {
                        const targetJid = match[1];
                        const action = lowerText.split(/\s+/)[0]; // Gets the first word (accept or reject)

                        if (action === 'accept') {
                            const { readClassDB, writeClassDB } = require('../database/classdb');
                            const db = readClassDB();
                            
                            // Generate OTP
                            const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; 
                            let code = 'REP-';
                            for (let i = 0; i < 5; i++) {
                                code += chars.charAt(Math.floor(Math.random() * chars.length));
                            }
                            
                            // Save code
                            if (!db.repCodes) db.repCodes = [];
                            db.repCodes.push(code);
                            writeClassDB(db);

                            // Auto-DM applicant
                            await client.sendMessage(
                                targetJid, 
                                `🎉 *APPLICATION APPROVED!*\n━━━━━━━━━━━━━━━━━━\n\nYour request to become a Class Representative has been verified and accepted.\n\n🎟️ *Your Authorization Code:* \`${code}\`\n\nTo setup your class:\n1. Type \`!class\`\n2. Select *Create a New Class*\n3. Enter your code when prompted.`
                            );
                            
                            // Confirm to you
                            await message.reply(`✅ *APPLICATION ACCEPTED*\n\nThe auth code \`${code}\` has been generated and delivered automatically to the applicant.`);
                            return; // Stop processing the message
                            
                        } else if (action === 'reject') {
                            // Grabs everything you typed after the word "reject"
                            const reason = text.slice(6).trim() || 'Failed security verification checks.';
                            
                            // Auto-DM applicant
                            await client.sendMessage(
                                targetJid, 
                                `❌ *APPLICATION REJECTED*\n━━━━━━━━━━━━━━━━━━\n\nYour request to create a Class Portal was denied by the administrators.\n\n*Reason:* ${reason}`
                            );
                            
                            // Confirm to you
                            await message.reply(`✅ *APPLICATION REJECTED*\n\nThe rejection notice has been delivered to the applicant.`);
                            return; // Stop processing the message
                        }
                    }
                }
            } catch (err) {
                console.error('[OWNER APP REPLY ERROR]', err);
            }
        }
        
        // ====================================================
        // 👑 OWNER CONTROL PANEL
        // ====================================================

        if (lowerText === '!owner' || lowerText.startsWith('!owner ')) {

            if (!isOwner(senderId)) {
                await message.reply(
                    '❌ *Access Denied*\n\n' +
                    'This command is restricted to the Master Owner. 👑'
                );
                return;
            }

            const ownerArgs = text.split(/\s+/);
            const ownerCommand = (ownerArgs[1] || 'help').toLowerCase();

            // --------------------------------------------
            // !owner / !owner help
            // --------------------------------------------

            if (ownerCommand === 'help') {
                await message.reply(getOwnerMenu());
                return;
            }

            // --------------------------------------------
            // !owner allow <WhatsApp number> <duration>
            // --------------------------------------------

            if (ownerCommand === 'allow') {
                const durationMs = parseDuration(ownerArgs[ownerArgs.length - 1]);
                const recipientInput = ownerArgs.slice(2, -1).join(' ');
                const recipientJid = normalizeWhatsAppNumber(recipientInput);
                const ownerJid = normalizeWhatsAppNumber(OWNER_NUMBER || '');

                if (!recipientJid || !durationMs) {
                    await message.reply(
                        'Usage: !owner allow <WhatsApp number> <duration>\n' +
                        'Examples: !owner allow 254712345678 2h, !owner allow +254 712 345 678 7d\n' +
                        'Duration units: m, h, or d; maximum 365 days.'
                    );
                    return;
                }

                if (recipientJid === ownerJid) {
                    await message.reply('👑 The owner already has permanent access to image generation and analysis.');
                    return;
                }

                try {
                    const grant = grantImageAccess(recipientJid, durationMs, senderId);
                    const grantedNumber = grant.number.slice(0, -'@c.us'.length);
                    await message.reply(
                        '✅ Temporary image access enabled for +' + grantedNumber + '.\n' +
                        'Access covers !draw and !analyze until ' + new Date(grant.expiresAt).toLocaleString() + '.'
                    );
                } catch (error) {
                    console.error('[IMAGE ACCESS] Could not grant access:', error.message);
                    await message.reply('❌ I could not save that access grant. Check the bot data folder and logs.');
                }
                return;
            }

            // --------------------------------------------
            // !owner revoke <WhatsApp number>
            // --------------------------------------------

            if (ownerCommand === 'revoke') {
                const recipientJid = normalizeWhatsAppNumber(ownerArgs.slice(2).join(' '));
                if (!recipientJid) {
                    await message.reply('Usage: !owner revoke <WhatsApp number>');
                    return;
                }

                try {
                    const revoked = revokeImageAccess(recipientJid);
                    await message.reply(revoked
                        ? '✅ Temporary image access revoked for +' + recipientJid.slice(0, -'@c.us'.length) + '.'
                        : 'ℹ️ That number has no saved image access grant.');
                } catch (error) {
                    console.error('[IMAGE ACCESS] Could not revoke access:', error.message);
                    await message.reply('❌ I could not update image access. Check the bot data folder and logs.');
                }
                return;
            }

            // --------------------------------------------
            // !owner allowed
            // --------------------------------------------

            if (ownerCommand === 'allowed') {
                try {
                    const grants = listImageAccess();
                    if (grants.length === 0) {
                        await message.reply('📋 There are no active temporary image access grants.');
                        return;
                    }
                    const lines = grants.map((grant, index) =>
                        (index + 1) + '. +' + grant.number.slice(0, -'@c.us'.length) +
                        ' — expires ' + new Date(grant.expiresAt).toLocaleString()
                    );
                    await message.reply('📋 *Active image access grants*\n\n' + lines.join('\n'));
                } catch (error) {
                    console.error('[IMAGE ACCESS] Could not list grants:', error.message);
                    await message.reply('❌ I could not read image access grants. Check the bot data folder and logs.');
                }
                return;
            }

            // --------------------------------------------
            // !owner reset
            // --------------------------------------------

            if (ownerCommand === 'reset') {
                try {
                    resetEconomy();

                    await message.reply(
                        '💥 *ECONOMY RESET SUCCESSFUL!*\n\n' +
                        'All wallets, user scores, and economy statistics have been wiped.\n\n' +
                        '👑 *Executed by: Master Owner*'
                    );
                } catch (err) {
                    console.error('Owner reset error:', err);

                    await message.reply(
                        '❌ *ECONOMY RESET FAILED*\n\n' +
                        'An error occurred while resetting the economy.'
                    );
                }

                return;
            }

            // --------------------------------------------
            // !owner classreset [classname] [reset|delete]
            // --------------------------------------------

            if (ownerCommand === 'classreset') {
                try {
                    const db = readClassDB();
                    const fullArgs = ownerArgs.slice(2);
                    
                    // Parse the action (reset or delete) if it's the last word typed
                    let action = fullArgs[fullArgs.length - 1]?.toLowerCase();
                    let targetClassArg = '';

                    if (action === 'reset' || action === 'delete') {
                        targetClassArg = fullArgs.slice(0, -1).join(' ').trim();
                    } else {
                        targetClassArg = fullArgs.join(' ').trim();
                        action = null;
                    }

                    // 1. If no argument is given, list the available classes with instructions
                    if (!targetClassArg) {
                        const classes = Object.keys(db.classes || {});
                        if (classes.length === 0) {
                            await message.reply('⚠️ No classes currently exist in the database.');
                            return;
                        }

                        let listMsg = '🏫 *CLASS RESET MANAGER*\n━━━━━━━━━━━━━━━━━━\nTo manage a specific class, add `reset` or `delete` after the name.\n\n*Available Classes:*\n';
                        classes.forEach((cls, idx) => {
                            listMsg += `${idx + 1}. \`${cls}\`\n`;
                        });
                        listMsg += `\n*Examples:*\n👉 \`!owner classreset BSIT/2024 reset\`\n(Wipes data, keeps Rep & Password)\n\n👉 \`!owner classreset BSIT/2024 delete\`\n(Removes portal completely)\n\n*(To wipe the entire database, type \`!owner classreset all\`)*`;
                        
                        await message.reply(listMsg);
                        return;
                    }

                    // 2. Full database wipe option
                    if (targetClassArg.toLowerCase() === 'all') {
                        resetClassDB();
                        await message.reply(
                            '💥 *GLOBAL CLASS PORTAL RESET SUCCESSFUL!*\n\n' +
                            'All classes, student profiles, and timetables have been completely wiped clean.\n\n' +
                            '👑 *Executed by: Master Owner*'
                        );
                        return;
                    }

                    // 3. Specific class target (case-insensitive search)
                    const matchedClassKey = Object.keys(db.classes || {}).find(
                        c => c.toLowerCase() === targetClassArg.toLowerCase()
                    );

                    if (!matchedClassKey) {
                        await message.reply(`❌ Class *"${targetClassArg}"* not found.\n\nType \`!owner classreset\` to see the list of active classes.`);
                        return;
                    }

                    const classData = db.classes[matchedClassKey];

                    // 4. Prompt if action is missing (They just typed the class name)
                    if (!action) {
                        await message.reply(
                            `⚠️ *ACTION REQUIRED FOR: ${matchedClassKey}*\n\n` +
                            `Please specify whether you want to reset or delete this class:\n\n` +
                            `1️⃣ *Reset:* Wipes all students, timetables, and logs, but keeps the Rep and Class Password intact.\n` +
                            `👉 \`!owner classreset ${matchedClassKey} reset\`\n\n` +
                            `2️⃣ *Delete:* Completely destroys the portal and removes Rep access.\n` +
                            `👉 \`!owner classreset ${matchedClassKey} delete\``
                        );
                        return;
                    }

                    // 5. Execute Action: DELETE
                    if (action === 'delete') {
                        // Notify the Rep via DM
                        if (classData.repId) {
                            try {
                                await client.sendMessage(
                                    classData.repId,
                                    `🚨 *CRITICAL SYSTEM ALERT* 🚨\n━━━━━━━━━━━━━━━━━━\n\nYour Class Portal for *${matchedClassKey}* has been permanently *DELETED* by the Master Owner.\n\nYour Class Rep privileges for this portal have been revoked.`
                                );
                            } catch (e) {
                                console.warn(`Could not notify rep ${classData.repId} about deletion.`);
                            }
                        }

                        // Delete from DB and save
                        delete db.classes[matchedClassKey];
                        writeClassDB(db);

                        await message.reply(
                            `💥 *CLASS DELETED*\n\n` +
                            `Portal *${matchedClassKey}* has been completely destroyed.\nThe Class Rep has been notified via DM.\n\n` +
                            `👑 *Executed by: Master Owner*`
                        );

                    // 6. Execute Action: RESET
                    } else if (action === 'reset') {
                        // Notify the Rep via DM
                        if (classData.repId) {
                            try {
                                await client.sendMessage(
                                    classData.repId,
                                    `🚨 *SYSTEM RESET ALERT* 🚨\n━━━━━━━━━━━━━━━━━━\n\nYour Class Portal for *${matchedClassKey}* has been *RESET* by the Master Owner.\n\nAll student records, timetables, deadlines, and logs have been wiped. However, your Class Rep privileges and the Class Password remain active. You will need to set up the portal again.`
                                );
                            } catch (e) {
                                console.warn(`Could not notify rep ${classData.repId} about reset.`);
                            }
                        }

                        // Reset properties but strictly preserve Rep identity and Class Password
                        db.classes[matchedClassKey] = {
                            repName: classData.repName, 
                            repId: classData.repId,
                            assistantReps: [],     
                            classPassword: classData.classPassword,
                            timetable: { sunday: [], monday: [], tuesday: [], wednesday: [], thursday: [], friday: [], saturday: [] },
                            updates: [],
                            members: {}, 
                            issues: [],
                            logs: [{ text: `Portal reset by Master Owner`, timestamp: Date.now() }],
                            assessments: [],
                            syndicates: [],
                            whispers: []
                        };
                        writeClassDB(db);

                        await message.reply(
                            `🔄 *CLASS RESET SUCCESSFUL*\n\n` +
                            `Portal *${matchedClassKey}* has been wiped clean (students, timetables cleared), but the Rep (*${classData.repName}*) and class password were preserved.\nThe Class Rep has been notified via DM.\n\n` +
                            `👑 *Executed by: Master Owner*`
                        );
                    }

                } catch (err) {
                    console.error('Owner class reset error:', err);
                    await message.reply(
                        '❌ *CLASS ACTION FAILED*\n\n' +
                        'An error occurred while modifying the class.'
                    );
                }

                return;
            }
            
            // --------------------------------------------
            // !owner stats
            // --------------------------------------------

            if (ownerCommand === 'stats') {

                try {
                    const db = readDB();

                    const users = db;

                    const userCount = Object.keys(users).length;

                    let totalCoins = 0;
                    let totalXP = 0;

                    for (const user of Object.values(users)) {
                        if (!user || typeof user !== 'object') continue;

                        totalCoins += Number(user.coins || 0);
                        totalXP += Number(user.xp || 0);
                    }

                    // WhatsApp chat statistics
                    const groups = knownGroupChats;
                    const privateChats = knownPrivateChats;
                    const totalChats =
                        groups.size + privateChats.size;

                    // Node process statistics
                    const memory = process.memoryUsage();

                    const ramUsedMB = (
                        memory.rss / 1024 / 1024
                    ).toFixed(0);

                    const heapUsedMB = (
                        memory.heapUsed / 1024 / 1024
                    ).toFixed(0);

                    // VPS memory
                    let vpsMemory = 'Unavailable';

                    try {
                        const { stdout } = await execFileAsync(
                            'free',
                            ['-m']
                        );

                        const lines = stdout.trim().split('\n');

                        const memLine = lines.find(line =>
                            line.startsWith('Mem:')
                        );

                        if (memLine) {
                            const parts = memLine.trim().split(/\s+/);

                            const total = Number(parts[1]);
                            const used = Number(parts[2]);

                            if (total) {
                                const percentage = (
                                    (used / total) * 100
                                ).toFixed(0);

                                vpsMemory =
                                    `${used} MB / ${total} MB (${percentage}%)`;
                            }
                        }
                    } catch (err) {
                        console.warn(
                            '[OWNER] Could not read VPS memory:',
                            err.message
                        );
                    }

                    // VPS disk
                    let diskUsage = 'Unavailable';

                    try {
                        const { stdout } = await execFileAsync(
                            'df',
                            ['-h', '/']
                        );

                        const lines = stdout.trim().split('\n');

                        if (lines.length >= 2) {
                            const parts = lines[1].trim().split(/\s+/);

                            diskUsage =
                                `${parts[2]} / ${parts[1]} (${parts[4]})`;
                        }
                    } catch (err) {
                        console.warn(
                            '[OWNER] Could not read VPS disk:',
                            err.message
                        );
                    }

                    // VPS CPU load
                    let cpuLoad = 'Unavailable';

                    try {
                        const { stdout } = await execFileAsync(
                            'uptime'
                        );

                        const match = stdout.match(
                            /load average[s]?:\s*([0-9.]+)/
                        );

                        if (match) {
                            cpuLoad = match[1];
                        }
                    } catch (err) {
                        console.warn(
                            '[OWNER] Could not read CPU load:',
                            err.message
                        );
                    }

                    // PM2 status
                    let pm2Status = 'Unavailable';

                    try {
                        const { stdout } = await execFileAsync(
                            'pm2',
                            ['jlist']
                        );

                        const processes = JSON.parse(stdout);

                        const chaosProcess = processes.find(
                            process =>
                                process.name === 'chaos-bot'
                        );

                        if (chaosProcess) {
                            const status =
                                chaosProcess.pm2_env?.status;

                            pm2Status =
                                status === 'online'
                                    ? '🟢 ONLINE'
                                    : `🔴 ${String(status).toUpperCase()}`;
                        } else {
                            pm2Status = '🔴 NOT FOUND';
                        }

                    } catch (err) {
                        console.warn(
                            '[OWNER] Could not read PM2 status:',
                            err.message
                        );
                    }

                    const uptimeSeconds = process.uptime();

                    const days = Math.floor(
                        uptimeSeconds / 86400
                    );

                    const hours = Math.floor(
                        (uptimeSeconds % 86400) / 3600
                    );

                    const minutes = Math.floor(
                        (uptimeSeconds % 3600) / 60
                    );

                    const seconds = Math.floor(
                        uptimeSeconds % 60
                    );

                    let botUptime = '';

                    if (days > 0) {
                        botUptime += `${days}d `;
                    }

                    if (hours > 0 || days > 0) {
                        botUptime += `${hours}h `;
                    }

                    if (minutes > 0 || hours > 0 || days > 0) {
                        botUptime += `${minutes}m `;
                    }

                    botUptime += `${seconds}s`;

                    const statsMessage =
                        '👑 *CHAOS SERVER STATUS*\n' +
                        '━━━━━━━━━━━━━━━━━━\n\n' +

                        '🤖 *BOT*\n' +
                        `🟢 Status: ONLINE\n` +
                        `⚙️ PM2: ${pm2Status}\n` +
                        `🟢 Node: ${process.version}\n` +
                        `⏱️ Uptime: ${botUptime}\n\n` +

                        '🖥️ *VPS*\n' +
                        `⚡ Load Average: ${cpuLoad}\n` +
                        `🧠 RAM: ${vpsMemory}\n` +
                        `💾 Disk: ${diskUsage}\n\n` +

                        '💻 *NODE PROCESS*\n' +
                        `📦 RSS Memory: ${ramUsedMB} MB\n` +
                        `🧩 Heap Used: ${heapUsedMB} MB\n\n` +

                        '💬 *WHATSAPP*\n' +
                        `👥 Groups: ${groups.size}\n` +
                        `👤 Private Chats: ${privateChats.size}\n` +
                        `💬 Total Chats: ${totalChats}\n\n` +

                        '💰 *ECONOMY*\n' +
                        `👤 Users: ${userCount}\n` +
                        `💵 Total Dollars: $${totalCoins.toLocaleString()}\n` +
                        `⭐ Total XP: ${totalXP.toLocaleString()}\n\n` +

                        '━━━━━━━━━━━━━━━━━━\n' +
                        '👑 *Master Owner*: \`Chriss\`';

                    await message.reply(statsMessage);

                } catch (err) {
                    console.error(
                        '[OWNER] Stats error:',
                        err
                    );

                    await message.reply(
                        '❌ *Could not retrieve server statistics.*\n\n' +
                        'Check the bot console for details.'
                    );
                }

                return;
            }

            // --------------------------------------------
            // !owner restart
            // --------------------------------------------

            if (ownerCommand === 'restart') {

                await message.reply(
                    '🔄 *CHAOS BOT RESTARTING...*\n\n' +
                    'PM2 is restarting the bot now. 👑\n\n' +
                    'See you in a moment, Boss.'
                );

                setTimeout(() => {

                    const pm2Command =
                        process.platform === 'win32'
                            ? 'pm2.cmd'
                            : 'pm2';

                            execFile(
                                pm2Command,
                                ['restart', 'chaos-bot', '--node-args=--max-old-space-size=1024'],
                                {
                                    windowsHide: true
                                },
                                (error, stdout, stderr) => {

                            if (error) {
                                console.error(
                                    '[OWNER] PM2 restart failed:',
                                    error.message
                                );

                                console.error(stderr);

                                // Fallback
                                process.exit(0);
                            }

                            console.log(
                                '[OWNER] Chaos Bot restarted through PM2.'
                            );

                            if (stdout) {
                                console.log(stdout);
                            }
                        }
                    );

                }, 1500);

                return;
            }

            // ====================================================
            // OWNER UPDATE - GIT PULL + OPTIONAL NPM INSTALL + RESTART
            // ====================================================

            if (ownerCommand === 'update') {

                const runCommand = (command, args, options = {}) => {
                    return new Promise((resolve, reject) => {

                        execFile(
                            command,
                            args,
                            {
                                ...options,
                                windowsHide: true
                            },
                            (error, stdout, stderr) => {

                                if (error) {
                                    error.stdout = stdout;
                                    error.stderr = stderr;
                                    reject(error);
                                    return;
                                }

                                resolve({
                                    stdout: stdout || '',
                                    stderr: stderr || ''
                                });
                            }
                        );

                    });
                };

                try {

                    await message.reply(
                        '*CHAOS BOT UPDATE STARTING...*\n\n' +
                        'Checking GitHub for new changes...\n' +
                        'Please wait.'
                    );

                    const projectDir = process.cwd();

                    // ------------------------------------------------
                    // STEP 1 - FETCH FROM GITHUB
                    // ------------------------------------------------

                    try {

                        await runCommand(
                            'git',
                            ['fetch', 'origin'],
                            {
                                cwd: projectDir,
                                maxBuffer: 1024 * 1024
                            }
                        );

                    } catch (error) {

                        console.error(
                            '[OWNER UPDATE] git fetch failed:',
                            error
                        );

                        await message.reply(
                            '*UPDATE FAILED*\n\n' +
                            'Could not contact GitHub.\n\n' +
                            `Error: ${error.message}`
                        );

                        return;
                    }

                    // ------------------------------------------------
                    // STEP 2 - CHECK FOR LOCAL CHANGES
                    // ------------------------------------------------

                    let statusResult;

                    try {

                        statusResult = await runCommand(
                            'git',
                            ['status', '--porcelain'],
                            {
                                cwd: projectDir,
                                maxBuffer: 1024 * 1024
                            }
                        );

                    } catch (error) {

                        console.error(
                            '[OWNER UPDATE] git status failed:',
                            error
                        );

                        await message.reply(
                            '*UPDATE FAILED*\n\n' +
                            'Could not check the VPS Git status.'
                        );

                        return;
                    }

                    if (statusResult.stdout.trim()) {

                        console.warn(
                            '[OWNER UPDATE] Local changes detected:',
                            statusResult.stdout
                        );

                        await message.reply(
                            '*UPDATE STOPPED*\n\n' +
                            'Local uncommitted changes were detected on the VPS.\n\n' +
                            'I will not overwrite them automatically.\n\n' +
                            'Use SSH to inspect the changes before updating.'
                        );

                        return;
                    }

                    // ------------------------------------------------
                    // STEP 3 - GET CURRENT COMMIT
                    // ------------------------------------------------

                    let oldCommit;

                    try {

                        const commitResult = await runCommand(
                            'git',
                            ['rev-parse', 'HEAD'],
                            {
                                cwd: projectDir,
                                maxBuffer: 1024 * 1024
                            }
                        );

                        oldCommit = commitResult.stdout.trim();

                    } catch (error) {

                        console.error(
                            '[OWNER UPDATE] Could not get current commit:',
                            error
                        );

                        await message.reply(
                            '*UPDATE FAILED*\n\n' +
                            'Could not determine the current Git commit.'
                        );

                        return;
                    }

                    // ------------------------------------------------
                    // STEP 4 - PULL LATEST CODE
                    // ------------------------------------------------

                    let pullResult;

                    try {

                        pullResult = await runCommand(
                            'git',
                            ['pull', '--ff-only'],
                            {
                                cwd: projectDir,
                                maxBuffer: 5 * 1024 * 1024
                            }
                        );

                    } catch (error) {

                        console.error(
                            '[OWNER UPDATE] git pull failed:',
                            error
                        );

                        console.error(
                            '[OWNER UPDATE] stderr:',
                            error.stderr
                        );

                        await message.reply(
                            '*UPDATE FAILED*\n\n' +
                            'Git could not safely pull the latest changes.\n\n' +
                            'No automatic restart was performed.\n\n' +
                            `Error: ${error.message}`
                        );

                        return;
                    }

                    const pullOutput =
                        `${pullResult.stdout}\n${pullResult.stderr}`.trim();

                    // ------------------------------------------------
                    // STEP 5 - CHECK IF ANYTHING CHANGED
                    // ------------------------------------------------

                    if (
                        pullOutput.includes('Already up to date') ||
                        pullOutput.includes('Already up-to-date')
                    ) {

                        await message.reply(
                            '*CHAOS BOT IS ALREADY UP TO DATE*\n\n' +
                            'No new GitHub changes were found.\n\n' +
                            'No restart was necessary.'
                        );

                        return;
                    }

                    // ------------------------------------------------
                    // STEP 6 - FIND CHANGED FILES
                    // ------------------------------------------------

                    let changedFiles = [];

                    try {

                        const diffResult = await runCommand(
                            'git',
                            [
                                'diff',
                                '--name-only',
                                oldCommit,
                                'HEAD'
                            ],
                            {
                                cwd: projectDir,
                                maxBuffer: 1024 * 1024
                            }
                        );

                        changedFiles = diffResult.stdout
                            .split(/\r?\n/)
                            .map(file => file.trim())
                            .filter(Boolean);

                    } catch (error) {

                        console.error(
                            '[OWNER UPDATE] git diff failed:',
                            error
                        );

                        await message.reply(
                            '*CODE UPDATED*\n\n' +
                            'Git pull succeeded, but I could not determine whether dependencies changed.\n\n' +
                            'Continuing without npm install.'
                        );
                    }

                    // ------------------------------------------------
                    // STEP 7 - CHECK DEPENDENCIES
                    // ------------------------------------------------

                    const packageChanged =
                        changedFiles.includes('package.json') ||
                        changedFiles.includes('package-lock.json');

                    if (packageChanged) {

                        await message.reply(
                            '*DEPENDENCIES CHANGED*\n\n' +
                            'Running npm install before restarting Chaos Bot...'
                        );

                        try {

                            const npmResult = await runCommand(
                                'npm',
                                ['install'],
                                {
                                    cwd: projectDir,
                                    maxBuffer: 10 * 1024 * 1024
                                }
                            );

                            console.log(
                                '[OWNER UPDATE] npm install successful:',
                                npmResult.stdout
                            );

                        } catch (error) {

                            console.error(
                                '[OWNER UPDATE] npm install failed:',
                                error
                            );

                            console.error(
                                '[OWNER UPDATE] npm stderr:',
                                error.stderr
                            );

                            await message.reply(
                                '*UPDATE FAILED*\n\n' +
                                'GitHub code was pulled, but npm install failed.\n\n' +
                                'Chaos Bot was NOT automatically restarted.'
                            );

                            return;
                        }
                    }

                    // ------------------------------------------------
                    // STEP 8 - GET LATEST COMMIT MESSAGE
                    // ------------------------------------------------

                    let commitMessage =
                        'Latest changes pulled from GitHub.';

                    try {

                        const commitResult = await runCommand(
                            'git',
                            [
                                'log',
                                '-1',
                                '--pretty=%s'
                            ],
                            {
                                cwd: projectDir,
                                maxBuffer: 1024 * 1024
                            }
                        );

                        commitMessage =
                            commitResult.stdout.trim() ||
                            'Latest changes pulled from GitHub.';

                    } catch (error) {

                        console.error(
                            '[OWNER UPDATE] Could not get commit message:',
                            error
                        );
                    }

                    // ------------------------------------------------
                    // STEP 9 - ANNOUNCE BEFORE PM2 RESTART
                    // ------------------------------------------------

                    await message.reply(
                        '*CHAOS BOT UPDATE COMPLETE*\n\n' +
                        '*CHANGE*\n' +
                        '`' + commitMessage + '`\n\n' +
                        (
                            packageChanged
                                ? 'Dependencies updated.\n'
                                : ''
                        ) +
                        'Latest code pulled from GitHub.\n' +
                        'Chaos Bot is restarting now.\n\n' +
                        '*Updated by*: `Chriss`'
                    );

                    // ------------------------------------------------
                    // STEP 10 - RESTART PM2
                    // ------------------------------------------------

                    const pm2Command =
                        process.platform === 'win32'
                            ? 'pm2.cmd'
                            : 'pm2';

                    // Delay the restart by 2 seconds so the "UPDATE COMPLETE" message fully sends.
                    setTimeout(() => {
                        runCommand(
                            pm2Command,
                            // ADDED: V8 Garbage Collection Memory Cap
                            ['restart', 'chaos-bot', '--node-args=--max-old-space-size=1024'],
                            {
                                cwd: projectDir,
                                maxBuffer: 1024 * 1024
                            }
                        ).catch(err => {
                            console.error('[OWNER UPDATE] PM2 restart failed:', err);
                        });
                    }, 2000);

                    return; // Exit the command successfully before PM2 kills the process!

                } catch (error) {

                    console.error(
                        '[OWNER UPDATE] Unexpected error:',
                        error
                    );

                    console.error(
                        '[OWNER UPDATE] stderr:',
                        error.stderr
                    );

                    try {

                        await message.reply(
                            '*UPDATE FAILED*\n\n' +
                            'An unexpected error occurred while updating Chaos Bot.\n\n' +
                            `Error: ${error.message}`
                        );

                    } catch (replyError) {

                        console.error(
                            '[OWNER UPDATE] Could not send failure message:',
                            replyError
                        );
                    }

                    return;
                }

                return;
            }

            // --------------------------------------------
            // !owner broadcast <message>
            // --------------------------------------------

            if (ownerCommand === 'broadcast') {

                const announcement =
                    ownerArgs.slice(2).join(' ').trim();
            
                if (!announcement) {
                    await message.reply(
                        '❌ Usage:\n' +
                        '`!owner broadcast <message>`'
                    );
                    return;
                }
            
                await message.reply(
                    '📡 *BROADCAST STARTING...*\n\n' +
                    'Sending your announcement to all known groups.'
                );
            
                let successful = 0;
                let failed = 0;
            
                try {
            
                    const groupIds = [...knownGroupChats];
            
                    if (groupIds.length === 0) {
                        await message.reply(
                            '⚠️ *No known groups found.*\n\n' +
                            'The bot has not seen any group messages since its last restart.'
                        );
                        return;
                    }
            
                    for (const groupId of groupIds) {
            
                        try {

                            await client.sendMessage(
                                groupId,
                                '📢 *MASTER OWNER ANNOUNCEMENT*\n\n' +
                                announcement +
                                '\n\n👑 *— \`Chriss\`, Chaos Bot Owner*'
                            );
                        
                            successful++;
                        
                            // Small delay between groups
                            await new Promise(resolve =>
                                setTimeout(resolve, 1000)
                            );
                        
                        } catch (err) {
                        
                            failed++;
                        
                            console.error(
                                `[OWNER] Broadcast failed for ${groupId}:`,
                                err
                            );
                        
                            console.error(
                                `[OWNER] Broadcast error stack for ${groupId}:`,
                                err?.stack
                            );
                        }
                    }
            
                    await message.reply(
                        '📡 *BROADCAST COMPLETE*\n\n' +
                        `✅ Sent: ${successful}\n` +
                        `❌ Failed: ${failed}\n` +
                        `👥 Groups: ${groupIds.length}`
                    );
            
                } catch (err) {
            
                    console.error(
                        '[OWNER] Broadcast error:',
                        err
                    );
            
                    await message.reply(
                        '❌ *Broadcast failed.*\n\n' +
                        'Unable to send the announcement to known groups.'
                    );
                }
            
                return;
            }

            // --------------------------------------------
            // UNKNOWN OWNER COMMAND
            // --------------------------------------------

            await message.reply(
                '❌ *Unknown Owner Command*\n\n' +
                `You entered: *${ownerCommand}*\n\n` +
                'Use `!owner` to view the available commands.'
            );

            return;
        }

        // ====================================================
        // 👑 OWNER RESET
        // ====================================================

        if (lowerText === '!reset' || lowerText === '!clearance' || lowerText === '!wipe') {
            if (!isOwner(senderId)) {
                await message.reply(
                    '❌ *Access Denied*\n\n' +
                    'Only the Master Owner can execute a system reset. 👑'
                );
                return;
            }

            try {
                resetEconomy();

                await message.reply(
                    '💥 *SYSTEM RESET SUCCESSFUL!*\n\n' +
                    'All wallets, user scores, and economy statistics have been wiped.\n\n' +
                    '👑 *Executed by: Master Owner*'
                );
            } catch (err) {
                console.error('System reset error:', err);

                await message.reply(
                    '❌ *SYSTEM RESET FAILED*\n\n' +
                    'An error occurred while resetting the economy.'
                );
            }

            return;
        }

        // ====================================================
        // MENU
        // ====================================================

        if (
            lowerText === '!help' ||
            lowerText === '!menu' ||
            lowerText === '!commands' ||
            lowerText === 'menu'
        ) {
            try {
                // 🎛️ TEMPORARY TOGGLE: Flip to true once whatsapp-web.js fixes voice notes
                const ENABLE_MENU_AUDIO = false;
                
                const assetsDir = path.join(baseDir, 'src/assets/gifs');
                let sentMedia = false;

                if (fs.existsSync(assetsDir)) {
                    const files = fs.readdirSync(assetsDir);
                    // Filter for all MP4 menu videos in the assets folder
                    const menuVideos = files.filter(file => file.toLowerCase().endsWith('.mp4'));

                    if (menuVideos.length > 0) {
                        // Pick a random MP4 from the pool
                        const randomVideo = menuVideos[Math.floor(Math.random() * menuVideos.length)];
                        const media = MessageMedia.fromFilePath(path.join(assetsDir, randomVideo));

                        // Send the random animated video with gifPlayback enabled
                        await client.sendMessage(chatId, media, { 
                            caption: getBotMenu(),
                            gifPlayback: false 
                        });
                        sentMedia = true;
                    }
                }

                // Fallback to text if no MP4 videos exist in assets
                if (!sentMedia) {
                    await message.reply(getBotMenu());
                }

                // Audio block is safely bypassed while toggle is false
                if (ENABLE_MENU_AUDIO) {
                    if (fs.existsSync(assetsDir)) {
                        const files = fs.readdirSync(assetsDir);
                        const songs = files.filter(file => file.toLowerCase().endsWith('.ogg'));

                        if (songs.length > 0) {
                            const randomSong = songs[Math.floor(Math.random() * songs.length)];
                            const audioMedia = MessageMedia.fromFilePath(path.join(assetsDir, randomSong));
                            await client.sendMessage(chatId, audioMedia, { sendAudioAsVoice: true });
                        }
                    }
                }
            } catch (err) {
                console.warn('Could not load menu assets:', err);
                await message.reply(getBotMenu());
            }
            return;
        }

        // ====================================================
        // GAMES LIST
        // ====================================================

        if (
            lowerText === '!games' ||
            lowerText === '!gamelist' ||
            lowerText === '!help games' ||
            lowerText === 'games'
        ) {
            await message.reply(getGamesList());
            return;
        }

        // ====================================================
        // BALANCE
        // ====================================================

        if (lowerText === '!bal' || lowerText === '!balance') {
            const mentions = await message.getMentions();
            const mentionedJid = mentions.length > 0 ? getContactJid(mentions[0]) : null;

            const balanceResponse = await handleBalanceCommand(
                economyUserId,
                userName,
                mentionedJid,
                client
            );

            await message.reply(balanceResponse, chatId, {
                mentions: mentionedJid ? [mentionedJid] : [senderId]
            });
            return;
        }

        // ====================================================
        // PING
        // ====================================================

        if (lowerText === '!ping') {
            await message.reply("🏓 Pong! I'm online and responsive.");
            return;
        }

        // ====================================================
        // PROFILE
        // ====================================================

        if (
            lowerText === '!profile' ||
            lowerText === '!daily' ||
            lowerText === '!leaderboard' ||
            lowerText === '!lb'
        ) {
            await handleProfileCommand(message, client);
            return;
        }

        // ====================================================
        // SONG
        // ====================================================

        if (
            lowerText === '!song' ||
            lowerText === '!randomsong' ||
            lowerText === 'track'
        ) {
            await handleSongCommand(message);
            return;
        }

        // ====================================================
        // VIDEO
        // ====================================================

        if (
            lowerText.startsWith('!video ') ||
            lowerText === '!video'
        ) {
            await handleVideoCommand(message);
            return;
        }

        // ====================================================
        // STORE
        // ====================================================

        if (
            lowerText === '!store' ||
            lowerText === '!catalog' ||
            lowerText === '!market'
        ) {
            await message.reply(getCatalogMenu());
            return;
        }

        // ====================================================
        // BUY
        // ====================================================

        if (lowerText.startsWith('!buy')) {
            const parts = text.split(/\s+/);
            const itemId = parts[1];

            if (!itemId) {
                await message.reply('Specify what you want to buy.\n\nExample: `!buy civic`');
                return;
            }

            const assetResult = buyAsset(economyUserId, itemId);

            if (!assetResult.success) {
                await message.reply(assetResult.message);
                return;
            }

            const item = assetResult.item;
            const currentBalance = getUserBalance(economyUserId);

            if (currentBalance < item.price) {
                await message.reply(
                    `❌ You cannot afford the *${item.name}*!\n` +
                    `Cost: *$${item.price.toLocaleString()}*\n` +
                    `Balance: *$${currentBalance.toLocaleString()}*`
                );
                return;
            }

            const deducted = deductBalance(economyUserId, item.price);

            if (deducted) {
                saveUserAsset(economyUserId, item);
                await message.reply(
                    '*CONGRATULATIONS!*\n\n' +
                    `${userName} purchased *${item.name}* for *${item.price.toLocaleString()}*!\n\n` +
                    'Check `!profile`.'
                );
            } else {
                await message.reply('❌ Transaction failed. Please try again.');
            }
            return;
        }

        // ====================================================
        // PAY
        // ====================================================

        if (lowerText.startsWith('!pay')) {
            const parts = text.split(/\s+/);
            const amount = parseInt(parts[1]);

            if (isNaN(amount) || amount <= 0) {
                await message.reply('Usage: `!pay 500 @username`');
                return;
            }

            let recipientId = null;
            let recipientName = 'Friend';
            let recipientContact = null;

            const mentions = await message.getMentions();

            if (mentions.length > 0) {
                recipientContact = mentions[0];
                recipientId = getContactJid(recipientContact);
                recipientName = recipientContact.pushname || recipientContact.name || 'Friend';
            } else {
                try {
                    const quotedMessage = await message.getQuotedMessage();
                    if (quotedMessage) {
                        const quotedContact = await quotedMessage.getContact();
                        recipientContact = quotedContact;
                        recipientId = getContactJid(quotedContact);
                        recipientName = quotedContact.pushname || quotedContact.name || 'Friend';
                    }
                } catch (quoteErr) {
                    console.warn('Could not retrieve quoted message for payment.');
                }
            }

            if (!recipientId) {
                await message.reply("You must either *reply* to someone's message or *tag* them.");
                return;
            }

            if (recipientId === economyUserId) {
                await message.reply("❌ You can't send dollars to yourself!");
                return;
            }

            const result = transferCoins(economyUserId, recipientId, amount);

            if (!result.success) {
                await message.reply(result.message);
                return;
            }

            await message.reply(
                '*TRANSFER SUCCESSFUL!*\n\n' +
                `You sent *${amount.toLocaleString()}* to *${recipientName}*.\n` +
                `New balance: *$${result.senderBalance.toLocaleString()}*`
            );

            try {
                await client.sendMessage(
                    recipientId,
                    `*${userName} just sent you $${amount.toLocaleString()}*!\n\nCheck your balance with \`!profile\`.`
                );
            } catch (e) {}

            return;
        }

        // ====================================================
        // BEG
        // ====================================================

        if (lowerText === '!beg' || lowerText === '!request') {
            const user = getUser(economyUserId, userName);
            const currentCoins = user.coins || 0;

            if (currentCoins > 10000) {
                await message.reply("You aren't even poor!\nGo grind mini-games or use `!daily`.");
                return;
            }

            const handout = 2000;
            user.coins = currentCoins + handout;

            const db = readDB();
            db[economyUserId] = user;
            writeDB(db);

            await message.reply(
                `${userName} begged on the streets and received *$${handout}*!\n\nNew balance: *$${user.coins.toLocaleString()}*.`
            );

            return;
        }

        // ====================================================
        // WORD FORGE
        // ====================================================

        if (lowerText === '!wordforge') {
            const response = startWordForgeLobby(
                chatId, senderId, userName, client, [message.author, senderContact]
            );
            await message.reply(response);
            return;
        }

        if (lowerText === '!joinforge') {
            const response = joinWordForgeLobby(
                chatId, senderId, userName, client, [message.author, senderContact]
            );
            await message.reply(response);
            return;
        }

        if (lowerText === '!startforge') {
            const response = startWordForgeGame(
                chatId, senderId, client, [message.author, senderContact]
            );
            await message.reply(response);
            return;
        }

        if (lowerText === '!stopforge') {
            const response = stopWordForgeGame(
                chatId, senderId, client, [message.author, senderContact]
            );
            await message.reply(response);
            return;
        }

        // ====================================================
        // WORD CHAIN
        // ====================================================

        if (lowerText === '!wordchain') {
            await startWordChainLobby(message);
            return;
        }

        if (lowerText === '!wjoin') {
            await joinWordChain(message);
            return;
        }

        if (lowerText === '!startwordchain') {
            await startWordChainGame(message, client);
            return;
        }

        if (lowerText === '!stopwordchain') {
            await stopWordChainCommand(message, client);
            return;
        }

        // ====================================================
        // WORDLE
        // ====================================================

        if (lowerText === '!wordle') {
            const response = startWordleLobby(chatId, client, senderId, userName);
            await message.reply(response);
            return;
        }

        if (lowerText === '!startwordle') {
            await message.reply(startWordleGame(chatId, senderId, client));
            return;
        }

        if (lowerText === '!end' || lowerText === '!stopwordle') {
            const resultMessage = stopGame(chatId, senderId);
            await message.reply(resultMessage);
            return;
        }

        // ====================================================
        // SCRAMBLED WORD
        // ====================================================

        if (lowerText === '!scramble') {
            await message.reply(startScrambleLobby(chatId, client, senderId, userName));
            return;
        }

        if (lowerText === '!joinscramble') {
            await message.reply(joinScrambleLobby(chatId, senderId, userName));
            return;
        }

        if (lowerText === '!scramblehint') {
            await message.reply(processScrambleHint(chatId, senderId, client));
            return;
        }

        if (lowerText === '!startscramble') {
            await message.reply(startScrambleGame(chatId, senderId, client));
            return;
        }

        if (lowerText === '!stopscramble') {
            await message.reply(stopScrambleGame(chatId, senderId, client));
            return;
        }

        // ====================================================
        // MAFIA
        // ====================================================

        // --- Active Game Logic ---

        if (lowerText === '!mafia') {
            await startMafiaLobby(chatId, client, MessageMedia, senderId, userName, generateMafiaNarration);
            return;
        }

        if (lowerText === '!startmafia') {
            const startResponse = await startMafiaGame(chatId, senderId);
            if (startResponse) await message.reply(startResponse);
            return;
        }

        if (lowerText === '!joinmafia') {
            const mafiaContact = senderContact || (await getSenderContact(message));
            const mafiaSenderId = getCanonicalJid(mafiaContact) || senderId;

            const mafiaResponse = await joinMafiaLobby(
                chatId,
                mafiaSenderId,
                userName,
                mafiaContact
            );

            if (mafiaResponse) {
                await message.reply(mafiaResponse);
            }
            return;
        }

        if (lowerText === '!endmafia' || lowerText === '!stopmafia') {
            const endResponse = await endMafiaGame(chatId, senderId);
            if (endResponse) {
                await message.reply(endResponse);
            }
            return;
        }

        // ====================================================
        // WORDLE JOIN
        // ====================================================

        if (lowerText === '!join') {
            const wordleResponse = joinLobby(chatId, senderId, userName);
            await message.reply(wordleResponse);
            return;
        }

        // ====================================================
        // WORD CHAIN TURN INPUT
        // ====================================================

        const wordChainHandled = await processWordChain(message, client);
        if (wordChainHandled) return;

        // ====================================================
        // WORDLE GUESS
        // ====================================================

        const wordleResponse = processGuess(chatId, text, senderId, userName, client);
        if (wordleResponse) {
            await message.reply(wordleResponse);
            return;
        }

        // ====================================================
        // SCRAMBLED WORD DIRECT CHAT GUESS
        // ====================================================

        if (text && !text.startsWith('!')) {
            const handled = processScrambleGuess(chatId, text, senderId, userName, client);
            if (handled) return;
        }

        // ====================================================
        // REBUS / COUNTRY GAME
        // ====================================================

        if (lowerText === '!rebus') {
            const rebusResult = await startRebusLobby(chatId, client, senderId, userName);
            if (rebusResult) {
                await client.sendMessage(chatId, rebusResult);
            }
            return;
        }

        if (lowerText === '!startrebus') {
            await message.reply(startRebusGame(chatId, senderId, client));
            return;
        }

        if (lowerText === '!stoprebus') {
            await message.reply(stopRebusGame(chatId, senderId));
            return;
        }

        if (lowerText === '!joinrebus' || lowerText === '!rjoin') {
            const joinRes = joinRebusLobby(chatId, senderId, userName);
            await message.reply(joinRes);
            return;
        }

        if (lowerText === '!hint') {
            const hintRes = processRebusHint(chatId, senderId, client);
            if (hintRes) {
                await message.reply(hintRes);
            }
            return;
        }

        if (lowerText.startsWith('!steal')) {
            const mentions = await message.getMentions();
            const targetMention = mentions.length > 0 ? getContactJid(mentions[0]) : null;
            const wordForgeStealRes = handleWordForgeStealCommand(
                chatId, senderId, targetMention, client, senderContact
            );
            const stealRes = wordForgeStealRes || handleStealCommand(chatId, senderId, targetMention, client);

            if (stealRes) {
                await message.reply(stealRes, chatId, {
                    mentions: targetMention ? [senderId, targetMention] : [senderId]
                });
            }
            return;
        }

        // ====================================================
        // REBUS DIRECT CHAT GUESS
        // ====================================================

        if (text && !text.startsWith('!')) {
            const handled = processRebusGuess(chatId, text, senderId, userName, client);
            if (handled) return;
        }

        // ====================================================
        // MAFIA VOTE
        // ====================================================

        if (lowerText.startsWith('!vote')) {
            const mentions = await message.getMentions();
            if (mentions.length === 0) {
                await message.reply(
                    '❌ *Invalid Vote*\n\nPlease tag the player you want to vote out during the Day phase.\nExample: `!vote @user`'
                );
                return;
            }

            const targetContact = mentions[0];
            const targetVoteJid = getContactJid(targetContact);

            if (!targetVoteJid) {
                await message.reply('❌ I could not identify that player.');
                return;
            }

            const voteResult = castVote(
                chatId,
                senderId,
                targetVoteJid,
                targetContact?.pushname || targetContact?.name || 'Target',
                targetContact
            );

            await message.reply(voteResult, chatId, {
                mentions: [senderId, targetVoteJid]
            });
            return;
        }

    } catch (err) {
        console.error('❌ General Message Handling Error:', err);
    }
});
}

module.exports = { registerMessageHandler };
