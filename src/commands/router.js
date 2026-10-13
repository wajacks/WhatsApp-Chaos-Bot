// Dispatches command messages and active-game inputs in the original order.
function createCommandRouter(dependencies) {
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

    return async function routeCommands(context) {
        const {
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
        } = context;

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
                    return true;
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
                    return true;
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
                    return true;
                }
        
                // ====================================================
                // PING
                // ====================================================
        
                if (lowerText === '!ping') {
                    await message.reply("🏓 Pong! I'm online and responsive.");
                    return true;
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
                    return true;
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
                    return true;
                }
        
                // ====================================================
                // VIDEO
                // ====================================================
        
                if (
                    lowerText.startsWith('!video ') ||
                    lowerText === '!video'
                ) {
                    await handleVideoCommand(message);
                    return true;
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
                    return true;
                }
        
                // ====================================================
                // BUY
                // ====================================================
        
                if (lowerText.startsWith('!buy')) {
                    const parts = text.split(/\s+/);
                    const itemId = parts[1];
        
                    if (!itemId) {
                        await message.reply('Specify what you want to buy.\n\nExample: `!buy civic`');
                        return true;
                    }
        
                    const assetResult = buyAsset(economyUserId, itemId);
        
                    if (!assetResult.success) {
                        await message.reply(assetResult.message);
                        return true;
                    }
        
                    const item = assetResult.item;
                    const currentBalance = getUserBalance(economyUserId);
        
                    if (currentBalance < item.price) {
                        await message.reply(
                            `❌ You cannot afford the *${item.name}*!\n` +
                            `Cost: *$${item.price.toLocaleString()}*\n` +
                            `Balance: *$${currentBalance.toLocaleString()}*`
                        );
                        return true;
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
                    return true;
                }
        
                // ====================================================
                // PAY
                // ====================================================
        
                if (lowerText.startsWith('!pay')) {
                    const parts = text.split(/\s+/);
                    const amount = parseInt(parts[1]);
        
                    if (isNaN(amount) || amount <= 0) {
                        await message.reply('Usage: `!pay 500 @username`');
                        return true;
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
                        return true;
                    }
        
                    if (recipientId === economyUserId) {
                        await message.reply("❌ You can't send dollars to yourself!");
                        return true;
                    }
        
                    const result = transferCoins(economyUserId, recipientId, amount);
        
                    if (!result.success) {
                        await message.reply(result.message);
                        return true;
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
        
                    return true;
                }
        
                // ====================================================
                // BEG
                // ====================================================
        
                if (lowerText === '!beg' || lowerText === '!request') {
                    const user = getUser(economyUserId, userName);
                    const currentCoins = user.coins || 0;
        
                    if (currentCoins > 10000) {
                        await message.reply("You aren't even poor!\nGo grind mini-games or use `!daily`.");
                        return true;
                    }
        
                    const handout = 2000;
                    user.coins = currentCoins + handout;
        
                    const db = readDB();
                    db[economyUserId] = user;
                    writeDB(db);
        
                    await message.reply(
                        `${userName} begged on the streets and received *$${handout}*!\n\nNew balance: *$${user.coins.toLocaleString()}*.`
                    );
        
                    return true;
                }
        
                // ====================================================
                // WORD FORGE
                // ====================================================
        
                if (lowerText === '!wordforge') {
                    const response = startWordForgeLobby(
                        chatId, senderId, userName, client, [message.author, senderContact]
                    );
                    await message.reply(response);
                    return true;
                }
        
                if (lowerText === '!joinforge') {
                    const response = joinWordForgeLobby(
                        chatId, senderId, userName, client, [message.author, senderContact]
                    );
                    await message.reply(response);
                    return true;
                }
        
                if (lowerText === '!startforge') {
                    const response = startWordForgeGame(
                        chatId, senderId, client, [message.author, senderContact]
                    );
                    await message.reply(response);
                    return true;
                }
        
                if (lowerText === '!stopforge') {
                    const response = stopWordForgeGame(
                        chatId, senderId, client, [message.author, senderContact]
                    );
                    await message.reply(response);
                    return true;
                }
        
                // ====================================================
                // WORD CHAIN
                // ====================================================
        
                if (lowerText === '!wordchain') {
                    await startWordChainLobby(message);
                    return true;
                }
        
                if (lowerText === '!wjoin') {
                    await joinWordChain(message);
                    return true;
                }
        
                if (lowerText === '!startwordchain') {
                    await startWordChainGame(message, client);
                    return true;
                }
        
                if (lowerText === '!stopwordchain') {
                    await stopWordChainCommand(message, client);
                    return true;
                }
        
                // ====================================================
                // WORDLE
                // ====================================================
        
                if (lowerText === '!wordle') {
                    const response = startWordleLobby(chatId, client, senderId, userName);
                    await message.reply(response);
                    return true;
                }
        
                if (lowerText === '!startwordle') {
                    await message.reply(startWordleGame(chatId, senderId, client));
                    return true;
                }
        
                if (lowerText === '!end' || lowerText === '!stopwordle') {
                    const resultMessage = stopGame(chatId, senderId);
                    await message.reply(resultMessage);
                    return true;
                }
        
                // ====================================================
                // SCRAMBLED WORD
                // ====================================================
        
                if (lowerText === '!scramble') {
                    await message.reply(startScrambleLobby(chatId, client, senderId, userName));
                    return true;
                }
        
                if (lowerText === '!joinscramble') {
                    await message.reply(joinScrambleLobby(chatId, senderId, userName));
                    return true;
                }
        
                if (lowerText === '!scramblehint') {
                    await message.reply(processScrambleHint(chatId, senderId, client));
                    return true;
                }
        
                if (lowerText === '!startscramble') {
                    await message.reply(startScrambleGame(chatId, senderId, client));
                    return true;
                }
        
                if (lowerText === '!stopscramble') {
                    await message.reply(stopScrambleGame(chatId, senderId, client));
                    return true;
                }
        
                // ====================================================
                // MAFIA
                // ====================================================
        
                // --- Active Game Logic ---
        
                if (lowerText === '!mafia') {
                    await startMafiaLobby(chatId, client, MessageMedia, senderId, userName, generateMafiaNarration);
                    return true;
                }
        
                if (lowerText === '!startmafia') {
                    const startResponse = await startMafiaGame(chatId, senderId);
                    if (startResponse) await message.reply(startResponse);
                    return true;
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
                    return true;
                }
        
                if (lowerText === '!endmafia' || lowerText === '!stopmafia') {
                    const endResponse = await endMafiaGame(chatId, senderId);
                    if (endResponse) {
                        await message.reply(endResponse);
                    }
                    return true;
                }
        
                // ====================================================
                // WORDLE JOIN
                // ====================================================
        
                if (lowerText === '!join') {
                    const wordleResponse = joinLobby(chatId, senderId, userName);
                    await message.reply(wordleResponse);
                    return true;
                }
        
                // ====================================================
                // WORD CHAIN TURN INPUT
                // ====================================================
        
                const wordChainHandled = await processWordChain(message, client);
                if (wordChainHandled) return true;
        
                // ====================================================
                // WORDLE GUESS
                // ====================================================
        
                const wordleResponse = processGuess(chatId, text, senderId, userName, client);
                if (wordleResponse) {
                    await message.reply(wordleResponse);
                    return true;
                }
        
                // ====================================================
                // SCRAMBLED WORD DIRECT CHAT GUESS
                // ====================================================
        
                if (text && !text.startsWith('!')) {
                    const handled = processScrambleGuess(chatId, text, senderId, userName, client);
                    if (handled) return true;
                }
        
                // ====================================================
                // REBUS / COUNTRY GAME
                // ====================================================
        
                if (lowerText === '!rebus') {
                    const rebusResult = await startRebusLobby(chatId, client, senderId, userName);
                    if (rebusResult) {
                        await client.sendMessage(chatId, rebusResult);
                    }
                    return true;
                }
        
                if (lowerText === '!startrebus') {
                    await message.reply(startRebusGame(chatId, senderId, client));
                    return true;
                }
        
                if (lowerText === '!stoprebus') {
                    await message.reply(stopRebusGame(chatId, senderId));
                    return true;
                }
        
                if (lowerText === '!joinrebus' || lowerText === '!rjoin') {
                    const joinRes = joinRebusLobby(chatId, senderId, userName);
                    await message.reply(joinRes);
                    return true;
                }
        
                if (lowerText === '!hint') {
                    const hintRes = processRebusHint(chatId, senderId, client);
                    if (hintRes) {
                        await message.reply(hintRes);
                    }
                    return true;
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
                    return true;
                }
        
                // ====================================================
                // REBUS DIRECT CHAT GUESS
                // ====================================================
        
                if (text && !text.startsWith('!')) {
                    const handled = processRebusGuess(chatId, text, senderId, userName, client);
                    if (handled) return true;
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
                        return true;
                    }
        
                    const targetContact = mentions[0];
                    const targetVoteJid = getContactJid(targetContact);
        
                    if (!targetVoteJid) {
                        await message.reply('❌ I could not identify that player.');
                        return true;
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
                    return true;
                }

        return false;
    };
}

module.exports = { createCommandRouter };
