const { execFile } = require('child_process');
const { handleVoiceCommands } = require('../features/voice/handler');
const { handleAiCommand } = require('../features/ai/handler');
const { handlePendingDrawSelection, handleImageCommands } = require('../features/images/handler');
const { handleBibleMessages } = require('../features/bible/handler');
const { handleHymnalCommand } = require('../features/hymnal/handler');
const { handleChatSummaryCommand } = require('../features/ai/chatSummary');
const { handleWeatherCommand } = require('../features/weather/command');
const { handleCoinPurchaseCommand } = require('../features/economy/purchaseHandler');
const { createCommandRouter } = require('../commands/router');

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
        addCoins,
        createCoinPurchaseRequest,
        listPendingCoinPurchases,
        approveCoinPurchase,
        rejectCoinPurchase,
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
        processTruthHuntDmMessage,
        handleWordForgeStealCommand,
        getGamesList,
        handleBalanceCommand,
        getWeather,
        fetchBibleVerse,
        getHymn,
        getEnglishHymn,
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

    const routeCommands = createCommandRouter(dependencies);

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

        // Handle owner application decisions before interactive games or portal
        // sessions can consume the reply text.
        if (isOwner(senderId) && !isGroup && message.hasQuotedMsg && /^(accept|reject)(?:\s|$)/i.test(text)) {
            try {
                const quotedMsg = await message.getQuotedMessage();
                if (quotedMsg?.fromMe && quotedMsg.body?.includes('📩 *NEW CLASS REP APPLICATION*')) {
                    const appMatch = quotedMsg.body.match(/🆔 \*Application ID:\* \`(app_[^`]+)\`/);
                    if (appMatch) {
                        await classHandler.handleOwnerApplicationReply(client, message, text, appMatch[1]);
                        return;
                    }
                    await message.reply('⚠️ This is an older application card without a persistent ID. Ask the applicant to submit it again so I can route the decision safely.');
                    return;
                }
            } catch (error) {
                console.error('[OWNER APP REPLY ERROR]', error);
            }
        }
        if (isOwner(senderId) && !isGroup && !message.hasQuotedMsg) {
            const handled = await classHandler.handleOwnerPlaintextResponse(client, message, text, lowerText);
            if (handled) return;
        }

        const purchaseHandled = await handleCoinPurchaseCommand({
            message,
            text,
            senderId,
            userName,
            client,
            ownerNumber: OWNER_NUMBER,
            createCoinPurchaseRequest
        });
        if (purchaseHandled) return;

        const imageSelectionHandled = await handlePendingDrawSelection({
            message, chatId, senderId, text, client, MessageMedia, axios, imageState,
            DRAW_COOLDOWN_MS, DRAW_GLOBAL_COOLDOWN_MS, ANALYZE_COOLDOWN_MS,
            getUserBalance, deductBalance, addCoins, isOwner, userName,
            canUseImageFeatures, IMAGE_ACCESS_DENIED_MESSAGE, buildImageAnalysisContent, azureClient
        });
        if (imageSelectionHandled) return;

        const wasHandledAsVideoReply = await handleVideoQualityReply(message);
        if (wasHandledAsVideoReply) {
            return;
        }

        // Truth Hunt answers are plain-message DM replies during the answer window.
        if (!isGroup) {
            const truthHuntResult = await processTruthHuntDmMessage(senderId, text);
            if (truthHuntResult && truthHuntResult.handled) {
                if (truthHuntResult.response) await client.sendMessage(chatId, truthHuntResult.response);
                return;
            }
        }

        // Word Forge guesses are plain one-word DM messages; no quoted reply is required.
        if (!isGroup) {
            const forgeResult = processWordForgeDmMessage(senderId, senderContact, text, client);
            if (forgeResult && forgeResult.handled) {
                if (forgeResult.response) await client.sendMessage(chatId, forgeResult.response);
                return;
            }
        }

        let quotedPollIdForSession = null;
        if (!isGroup && /^\d+$/.test(lowerText) && message.hasQuotedMsg) {
            try {
                const quotedMessage = await message.getQuotedMessage();
                quotedPollIdForSession = quotedMessage?.body?.match(/Poll ID:\s*(poll_[A-Za-z0-9_-]+)/i)?.[1] || null;
            } catch (error) {
                console.warn('[POLL] Could not inspect quoted message:', error.message);
            }
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
            } else if (!quotedPollIdForSession) {
                // Attendance confirmations must remain available while the
                // student is inside a Class Portal menu session.
                if (lowerText === 'present') {
                    const wasHandledAsAttendance = await handleAttendance(message, senderId, client);
                    if (wasHandledAsAttendance) return;
                }

                // Route your standard portal menu input directly to the class state machine
                await classHandler.handleInput(client, message, senderId, text, userName);
                return; // CRITICAL: Stop execution for regular portal inputs
            }
        }

        // ====================================================
                const bibleHandled = await handleBibleMessages({
            message,
            chatId,
            senderId,
            text,
            lowerText,
            pendingBibleRequests,
            fetchBibleVerse,
            googleTTS,
            voiceSelections,
            EDGE_TTS_VOICES,
            DEFAULT_EDGE_VOICE,
            voiceCooldowns,
            VOICE_COOLDOWN_MS,
            EdgeTTS,
            execFileAsync,
            baseDir,
            fs,
            path,
            MessageMedia,
            client
        });
        if (bibleHandled) return;

                const hymnalHandled = await handleHymnalCommand({
            message,
            chatId,
            lowerText,
            text,
            getHymn,
            getEnglishHymn,
            sendHymnPianoAudio,
            client
        });
        if (hymnalHandled) return;

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
        if (!isGroup && /^\d+$/.test(lowerText) && (!isUserInClassSession(senderId) || quotedPollIdForSession)) {
            const db = readClassDB();
            const canonicalSender = getCanonicalJid(senderId) || senderId;
            const memberships = [];

            for (const [className, classData] of Object.entries(db.classes || {})) {
                for (const [memberId, member] of Object.entries(classData.members || {})) {
                    const canonicalMember = getCanonicalJid(member.phoneId) || member.phoneId;
                    if ((member.phoneId === senderId || canonicalMember === canonicalSender) &&
                        !memberships.some(item => item.className === className)) {
                        memberships.push({ className, classData, memberId });
                    }
                }
            }

            if (memberships.length) {
                let quotedPollId = quotedPollIdForSession;
                if (message.hasQuotedMsg) {
                    try {
                        const quotedMessage = await message.getQuotedMessage();
                        quotedPollId = quotedPollId || quotedMessage?.body?.match(/Poll ID:\s*(poll_[A-Za-z0-9_-]+)/i)?.[1] || null;
                    } catch (error) {
                        console.warn('[POLL] Could not inspect quoted message:', error.message);
                    }
                }

                const polls = memberships.flatMap(membership =>
                    (membership.classData.polls || []).map(poll => ({ ...membership, poll }))
                );
                const isExpired = poll => !Number.isFinite(Number(poll.expiresAt)) || Number(poll.expiresAt) <= Date.now();
                let selected = null;

                if (quotedPollId) {
                    selected = polls.find(item => item.poll.id === quotedPollId);
                    if (!selected) {
                        await message.reply('❌ I could not match that poll to one of your registered classes.');
                        return;
                    }
                    if (selected.poll.status !== 'ACTIVE' || isExpired(selected.poll)) {
                        await message.reply('🛑 This poll has closed. Its results will be sent shortly.');
                        return;
                    }
                } else {
                    const openPolls = polls.filter(({ poll }) =>
                        poll.status === 'ACTIVE' && !isExpired(poll)
                    );
                    if (openPolls.length > 1) {
                        await message.reply('📊 You have more than one active class poll. Reply to the specific poll message you want to vote on, then send your option number.');
                        return;
                    }
                    if (openPolls.length === 1) {
                        selected = openPolls[0];
                    } else if (polls.some(({ poll }) => poll.status === 'ACTIVE' && isExpired(poll))) {
                        await message.reply('🛑 This poll has closed. Its results will be sent shortly.');
                        return;
                    }
                }

                if (selected) {
                    const { memberId, poll } = selected;
                    const voteIdx = Number(lowerText) - 1;
                    if (!poll.votes || typeof poll.votes !== 'object') poll.votes = {};

                    if (poll.votes[memberId] !== undefined) {
                        await message.reply('❌ You have already voted on this poll.');
                        return;
                    }
                    if (voteIdx < 0 || voteIdx >= poll.options.length) {
                        await message.reply(`❌ Invalid option. Please reply with a number between 1 and ${poll.options.length}.`);
                        return;
                    }
                    if (isExpired(poll)) {
                        await message.reply('🛑 This poll has closed. Its results will be sent shortly.');
                        return;
                    }

                    poll.votes[memberId] = voteIdx;
                    writeClassDB(db);
                    const dateObj = new Date(poll.expiresAt);
                    const timeStr = dateObj.toLocaleString('en-KE', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Africa/Nairobi' });
                    await message.reply(`✅ *Vote locked in anonymously.*\n\nThe final results will be available in your Student Hub when the poll closes at *${timeStr}*.`);
                    return;
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
        const imageCommandHandled = await handleImageCommands({
            message, chatId, senderId, text, imageState,
            DRAW_COOLDOWN_MS, DRAW_GLOBAL_COOLDOWN_MS, ANALYZE_COOLDOWN_MS,
            getUserBalance, deductBalance, addCoins, isOwner, userName,
            canUseImageFeatures, IMAGE_ACCESS_DENIED_MESSAGE,
            buildImageAnalysisContent, azureClient, client, MessageMedia, axios
        });
        if (imageCommandHandled) return;

        const summaryHandled = await handleChatSummaryCommand({
            message,
            chatId,
            lowerText,
            getChatHistory,
            azureClient
        });
        if (summaryHandled) return;

        const voiceCommandHandled = await handleVoiceCommands({ message, text, lowerText, chatId, senderId, client, baseDir, fs, path, execFileAsync, googleTTS, EdgeTTS, MessageMedia, speakCooldowns, SPEAK_COOLDOWN_MS, voiceCooldowns, VOICE_COOLDOWN_MS, voiceSelections, EDGE_TTS_VOICES, DEFAULT_EDGE_VOICE });
        if (voiceCommandHandled) return;

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
                const weatherHandled = await handleWeatherCommand({
            message,
            lowerText,
            text,
            userName,
            getWeather,
            buildWeatherResponse
        });
        if (weatherHandled) return;

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
            // Manual real-money purchase review
            // --------------------------------------------

            if (ownerCommand === 'payments') {
                if (message.from.endsWith('@g.us')) {
                    await message.reply('🔒 Review payment requests in a private chat so transaction references stay private.');
                    return;
                }
                const pending = listPendingCoinPurchases();
                if (!pending.length) {
                    await message.reply('📋 There are no pending game dollar purchases.');
                    return;
                }
                const lines = pending.map(request =>
                    request.id + ' — KSh ' + request.amountKsh.toLocaleString() +
                    ' → $' + request.coins.toLocaleString() +
                    ' — ' + request.userName + ' (' + request.userId + ')' +
                    ' — ref ' + request.transactionCode
                );
                await message.reply('💳 *Pending purchase requests*\n\n' + lines.join('\n') +
                    '\n\nVerify each payment in your payment account before approving.');
                return;
            }

            if (ownerCommand === 'approvepayment') {
                if (message.from.endsWith('@g.us')) {
                    await message.reply('🔒 Approve payment requests in a private chat.');
                    return;
                }
                const requestId = ownerArgs[2];
                if (!requestId) {
                    await message.reply('Usage: !owner approvepayment <request ID>');
                    return;
                }
                try {
                    const result = approveCoinPurchase(requestId, senderId);
                    if (!result.success) {
                        await message.reply(result.reason === 'already_resolved'
                            ? 'ℹ️ That purchase request has already been reviewed.'
                            : '❌ I could not find that pending purchase request.');
                        return;
                    }
                    const request = result.request;
                    await message.reply(
                        '✅ Approved ' + request.id + ': KSh ' + request.amountKsh.toLocaleString() +
                        ' credited as $' + request.coins.toLocaleString() + ' game dollars.'
                    );
                    try {
                        await client.sendMessage(
                            request.userId,
                            '✅ Your payment for request ' + request.id + ' was verified. $' +
                            request.coins.toLocaleString() + ' game dollars have been added.\n' +
                            'New balance: $' + Number(request.balanceAfter || 0).toLocaleString() + '.'
                        );
                    } catch (notifyError) {
                        console.warn('[COIN PURCHASE] Could not notify the player:', notifyError.message);
                    }
                } catch (error) {
                    console.error('[COIN PURCHASE] Approval failed:', error);
                    await message.reply('❌ Approval failed. Check the bot logs and balance database.');
                }
                return;
            }

            if (ownerCommand === 'rejectpayment') {
                if (message.from.endsWith('@g.us')) {
                    await message.reply('🔒 Reject payment requests in a private chat.');
                    return;
                }
                const requestId = ownerArgs[2];
                if (!requestId) {
                    await message.reply('Usage: !owner rejectpayment <request ID> [reason]');
                    return;
                }
                try {
                    const reason = ownerArgs.slice(3).join(' ').trim();
                    const result = rejectCoinPurchase(requestId, senderId, reason);
                    if (!result.success) {
                        await message.reply(result.reason === 'already_resolved'
                            ? 'ℹ️ That purchase request has already been reviewed.'
                            : '❌ I could not find that pending purchase request.');
                        return;
                    }
                    const request = result.request;
                    await message.reply('❌ Rejected purchase request ' + request.id + '.');
                    try {
                        await client.sendMessage(
                            request.userId,
                            '❌ Your game dollar purchase request ' + request.id +
                            ' was not approved. Please contact the owner if you need help.'
                        );
                    } catch (notifyError) {
                        console.warn('[COIN PURCHASE] Could not notify the player:', notifyError.message);
                    }
                } catch (error) {
                    console.error('[COIN PURCHASE] Rejection failed:', error);
                    await message.reply('❌ I could not update that purchase request.');
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
                    let localChangesStash = null;
                    const stashRecoveryNote = () => {
                        if (!localChangesStash) return '';
                        return '\n\nLocal changes remain saved in Git stash ' + localChangesStash +
                            ' and are not reapplied automatically. Inspect with git stash show -p ' + localChangesStash +
                            ' and restore with git stash apply --index ' + localChangesStash + '.';
                    };

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

                        const stashLabel =
                            'chaos-bot-owner-update-' +
                            new Date().toISOString().replace(/[:.]/g, '-');
                        let previousStashRef = '';

                        try {
                            const previousStash = await runCommand(
                                'git',
                                ['rev-parse', '-q', '--verify', 'refs/stash'],
                                { cwd: projectDir, maxBuffer: 1024 * 1024 }
                            );
                            previousStashRef = previousStash.stdout.trim();
                        } catch {
                            // An empty stash list is normal on a new VPS.
                        }

                        try {
                            await runCommand(
                                'git',
                                [
                                    'stash',
                                    'push',
                                    '--include-untracked',
                                    '-m',
                                    stashLabel,
                                    '--',
                                    '.',
                                    ':(exclude).env'
                                ],
                                { cwd: projectDir, maxBuffer: 5 * 1024 * 1024 }
                            );

                            const currentStash = await runCommand(
                                'git',
                                ['rev-parse', '-q', '--verify', 'refs/stash'],
                                { cwd: projectDir, maxBuffer: 1024 * 1024 }
                            );
                            localChangesStash = currentStash.stdout.trim();

                            if (!localChangesStash || localChangesStash === previousStashRef) {
                                localChangesStash = null;
                                throw new Error('Git did not create a new recovery stash.');
                            }

                            const remainingChanges = await runCommand(
                                'git',
                                ['status', '--porcelain'],
                                { cwd: projectDir, maxBuffer: 1024 * 1024 }
                            );

                            if (remainingChanges.stdout.trim()) {
                                console.warn(
                                    '[OWNER UPDATE] Changes remain after stashing:',
                                    remainingChanges.stdout
                                );
                                await message.reply(
                                    '*UPDATE STOPPED*\n\n' +
                                    'I saved recoverable local changes, but some files could not be stashed. Nothing was pulled or restarted.' +
                                    stashRecoveryNote() +
                                    '\n\nInspect the remaining files with git status --short. The .env file is excluded from the stash.'
                                );
                                return;
                            }

                            console.log(
                                '[OWNER UPDATE] Saved local changes in stash:',
                                localChangesStash
                            );
                            await message.reply(
                                '*LOCAL CHANGES PRESERVED*\n\n' +
                                'I saved the VPS changes to a recoverable Git stash before updating. Ignored files, including .env, stay in place.' +
                                stashRecoveryNote()
                            );
                        } catch (error) {
                            console.error(
                                '[OWNER UPDATE] Could not safely stash local changes:',
                                error
                            );
                            await message.reply(
                                '*UPDATE STOPPED*\n\n' +
                                'I did not pull or restart. Any recovery stash is preserved, and changes not stashed remain on disk.' +
                                stashRecoveryNote() +
                                '\n\nInspect them with git status --short and try again after resolving the issue.'
                            );
                            return;
                        }
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
                        '*Updated by*: `Chriss`' +
                        stashRecoveryNote()
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

                const commandHandled = await routeCommands({
            message,
            client,
            chatId,
            senderContact,
            senderId,
            economyUserId,
            userName,
            text,
            lowerText,
            isGroup
        });
        if (commandHandled) return;

        // Natural-language AI runs after commands and active workflows. This keeps
        // menu replies, poll votes, game moves, and Class Portal steps on their
        // existing deterministic routes.
        const isExplicitAi = /^!ai(?:\s|$)/i.test(lowerText);
        let shouldHandleNaturalText = false;
        if (!isExplicitAi && text && !message.hasMedia && message.type !== 'ptt') {
            if (!isGroup) {
                shouldHandleNaturalText = true;
            } else if (!message.fromMe) {
                const normalizeJid = value => {
                    if (!value) return '';
                    try { return String(getCanonicalJid(value) || value).toLowerCase(); }
                    catch (_) { return String(value).toLowerCase(); }
                };
                const botId = client.info && client.info.wid && client.info.wid._serialized;
                const mentionedIds = Array.isArray(message.mentionedIds) ? message.mentionedIds : [];
                const botMentioned = botId && mentionedIds.some(id =>
                    normalizeJid(id) === normalizeJid(botId) ||
                    String(id).split('@')[0] === String(botId).split('@')[0]
                );
                let botRepliedTo = false;
                if (!botMentioned && message.hasQuotedMsg) {
                    try {
                        const quotedMessage = await message.getQuotedMessage();
                        botRepliedTo = !!quotedMessage?.fromMe;
                    } catch (quoteError) {
                        console.warn('[AI ROUTING] Could not inspect quoted message:', quoteError.message);
                    }
                }
                shouldHandleNaturalText = !!(botMentioned || botRepliedTo);
            }
        }

        const AI_FEATURE_COMMANDS = {
            show_menu: '!menu',
            show_help: '!help',
            show_games: '!games',
            game_help: '!help games',
            show_balance: '!bal',
            show_profile: '!profile',
            show_store: '!store',
            claim_daily: '!daily',
            random_song: '!song',
            create_wordforge_lobby: '!wordforge',
            join_wordforge: '!joinforge',
            start_wordforge: '!startforge',
            create_wordchain_lobby: '!wordchain',
            join_wordchain: '!wjoin',
            start_wordchain: '!startwordchain',
            create_wordle_lobby: '!wordle',
            join_wordle: '!join',
            start_wordle: '!startwordle',
            create_scramble_lobby: '!scramble',
            join_scramble: '!joinscramble',
            start_scramble: '!startscramble',
            create_mafia_lobby: '!mafia',
            join_mafia: '!joinmafia',
            start_mafia: '!startmafia',
            create_rebus_lobby: '!rebus',
            join_rebus: '!joinrebus',
            start_rebus: '!startrebus',
            create_truthhunt_lobby: '!truthhunt',
            join_truthhunt: '!jointruth',
            start_truthhunt: '!starttruth',
            create_numberrun_lobby: '!numberrun',
            join_numberrun: '!joinnumberrun',
            start_numberrun: '!startnumberrun'
        };
        const executeBotFeature = async ({ action, query }) => {
            const baseCommand = AI_FEATURE_COMMANDS[action];
            if (!baseCommand && action !== 'search_video') return { error: 'That bot feature is not available through AI.' };
            const commandText = action === 'search_video'
                ? '!video ' + String(query || '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim()
                : baseCommand;
            if (action === 'search_video' && commandText === '!video') {
                return { error: 'Please specify the video or song title to search for.' };
            }

            const commandMessage = Object.create(message);
            Object.defineProperty(commandMessage, 'body', { value: commandText, configurable: true });
            Object.defineProperty(commandMessage, 'mentionedIds', { value: [], configurable: true });
            commandMessage.reply = message.reply.bind(message);
            commandMessage.getMentions = async () => [];

            const handled = await routeCommands({
                message: commandMessage,
                client,
                chatId,
                senderContact,
                senderId,
                economyUserId,
                userName,
                text: commandText,
                lowerText: commandText.toLowerCase(),
                isGroup
            });
            return handled
                ? { delivered: true }
                : { error: 'The normal bot router did not accept that feature request.' };
        };

        const getMyClassPortalSummary = () => {
            if (typeof readClassDB !== 'function') return { authorized: false, message: 'Class Portal data is unavailable.' };
            const db = readClassDB();
            const canonical = value => {
                if (!value) return '';
                try { return String(getCanonicalJid(value) || value).toLowerCase(); }
                catch (_) { return String(value).toLowerCase(); }
            };
            const currentId = canonical(senderId);
            const now = Date.now();
            const dayMs = 24 * 60 * 60 * 1000;
            const classes = [];

            for (const [className, classData] of Object.entries(db.classes || {})) {
                const members = classData.members || {};
                const matchedMember = Object.entries(members).find(([, member]) =>
                    canonical(member && member.phoneId) === currentId
                );
                const isMainRep = canonical(classData.repId) === currentId;
                const isAssistant = (classData.assistantReps || []).some(id => canonical(id) === currentId);
                if (!matchedMember && !isMainRep && !isAssistant) continue;

                const memberKey = matchedMember && matchedMember[0];
                const role = isMainRep ? 'Class Rep' : isAssistant ? 'Assistant Rep' : 'Student';
                const data = {
                    className,
                    role,
                    schedule: [],
                    deadlines: [],
                    activePolls: [],
                    updates: [],
                    ownAttendance: []
                };
                const schedule = classData.timetable || {};
                const eatTodayParts = new Intl.DateTimeFormat('en-CA', {
                    timeZone: 'Africa/Nairobi', year: 'numeric', month: '2-digit', day: '2-digit'
                }).formatToParts(new Date(now));
                const todayParts = Object.fromEntries(eatTodayParts.map(part => [part.type, part.value]));
                const todayStartUtc = Date.UTC(Number(todayParts.year), Number(todayParts.month) - 1, Number(todayParts.day)) - (3 * 60 * 60 * 1000);

                for (let offset = 0; offset < 7; offset++) {
                    const dayDate = new Date(todayStartUtc + offset * dayMs);
                    const weekday = new Intl.DateTimeFormat('en-US', {
                        timeZone: 'Africa/Nairobi', weekday: 'long'
                    }).format(dayDate).toLowerCase();
                    for (const item of (schedule[weekday] || []).slice(0, 5)) {
                        data.schedule.push({
                            day: weekday,
                            unit: String(item.unit || '').slice(0, 100),
                            time: String(item.time || '').slice(0, 40)
                        });
                    }
                }
                data.deadlines = (classData.assessments || [])
                    .filter(item => Number(item.timestamp) > now && Number(item.timestamp) <= now + 14 * dayMs)
                    .sort((a, b) => Number(a.timestamp) - Number(b.timestamp)
                    ).slice(0, 8).map(item => ({
                        unit: String(item.unit || item.type || 'Class work').slice(0, 100),
                        type: String(item.type || 'deadline').slice(0, 40),
                        due: new Date(Number(item.timestamp)).toLocaleString('en-KE', { timeZone: 'Africa/Nairobi' })
                    }));
                data.activePolls = (classData.polls || [])
                    .filter(poll => poll.status === 'ACTIVE')
                    .slice(0, 5).map(poll => ({
                        question: String(poll.question || '').slice(0, 220),
                        options: (poll.options || []).slice(0, 8).map(option => String(option).slice(0, 120))
                    }));
                data.updates = (classData.updates || [])
                    .filter(update => Number(update.timestamp) >= now - 7 * dayMs)
                    .slice(-5).map(update => ({
                        posted: new Date(Number(update.timestamp)).toLocaleString('en-KE', { timeZone: 'Africa/Nairobi' }),
                        text: String(update.text || '').slice(0, 400)
                    }));
                if (memberKey) {
                    data.ownAttendance = (classData.attendanceHistory || [])
                        .slice().sort((a, b) => Number(b.closedAt || 0) - Number(a.closedAt || 0))
                        .flatMap(record => {
                            const item = (record.attendance || []).find(entry => entry.memberKey === memberKey);
                            return item ? [{
                                date: record.dateKey || '',
                                unit: String(record.unit || '').slice(0, 100),
                                status: String(item.status || 'ABSENT'),
                                checkInTime: item.checkInTime || null,
                                correctionReason: item.reason || null
                            }] : [];
                        }).slice(0, 10);
                }
                classes.push(data);
                if (classes.length >= 3) break;
            }
            return classes.length
                ? { authorized: true, classes }
                : { authorized: false, message: 'This user is not enrolled in a Class Portal.' };
        };

        const aiCommandHandled = await handleAiCommand({
            message, text, lowerText, chatId, senderId, userName,
            getWeather, buildWeatherResponse, aiCooldowns, AI_COOLDOWN_MS,
            aiMemory, MAX_AI_MEMORY, ai, azureClient, shouldHandleNaturalText,
            executeBotFeature, getMyClassPortalSummary
        });
        if (aiCommandHandled) return;
    } catch (err) {
        console.error('❌ General Message Handling Error:', err);
    }
});
}

module.exports = { registerMessageHandler };
