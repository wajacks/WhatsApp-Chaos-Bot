const { handleVoiceCommands } = require('../features/voice/handler');
const { handleAiCommand } = require('../features/ai/handler');
const { handlePendingDrawSelection, handleImageCommands } = require('../features/images/handler');
const { handleBibleMessages } = require('../features/bible/handler');
const { handleHymnalCommand } = require('../features/hymnal/handler');
const { handleChatSummaryCommand } = require('../features/ai/chatSummary');
const { handleWeatherCommand } = require('../features/weather/command');

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

        const imageSelectionHandled = await handlePendingDrawSelection({ message, chatId, senderId, text, client, MessageMedia, axios, imageState, DRAW_COOLDOWN_MS, DRAW_GLOBAL_COOLDOWN_MS, ANALYZE_COOLDOWN_MS, canUseImageFeatures, IMAGE_ACCESS_DENIED_MESSAGE, buildImageAnalysisContent, azureClient });
        if (imageSelectionHandled) return;

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
                const bibleHandled = await handleBibleMessages({
            message,
            chatId,
            senderId,
            text,
            lowerText,
            pendingBibleRequests,
            fetchBibleVerse
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
        const imageCommandHandled = await handleImageCommands({ message, chatId, senderId, text, imageState, DRAW_COOLDOWN_MS, DRAW_GLOBAL_COOLDOWN_MS, ANALYZE_COOLDOWN_MS, canUseImageFeatures, IMAGE_ACCESS_DENIED_MESSAGE, buildImageAnalysisContent, azureClient, client, MessageMedia, axios });
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

        const aiCommandHandled = await handleAiCommand({ message, text, lowerText, chatId, senderId, userName, getWeather, buildWeatherResponse, aiCooldowns, AI_COOLDOWN_MS, aiMemory, MAX_AI_MEMORY, ai, azureClient });
        if (aiCommandHandled) return;

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
    } catch (err) {
        console.error('❌ General Message Handling Error:', err);
    }
});
}

module.exports = { registerMessageHandler };
