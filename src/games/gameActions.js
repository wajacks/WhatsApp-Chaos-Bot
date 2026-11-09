const { GAME_CHOICES } = require('./gamePicker');
const { getActiveGame, recordGameParticipant, setGameLobbyMessage, getGameLobbyMessage } = require('./gameRegistry');

function getMessageId(message) {
    const id = message?.id;
    if (typeof id === 'string') return id;
    return id?._serialized || id?.id || message?._data?.id || null;
}

function sendReturnedMessage(message, response) {
    if (typeof response === 'string' && response.trim()) return message.reply(response);
    return Promise.resolve();
}

function isSuccessfulJoin(response) {
    if (response === true) return true;
    if (typeof response !== 'string') return false;
    const value = response.toLowerCase();
    return /\bjoined\b|\bregistered successfully\b/.test(value) &&
        !/already|not (?:open|in)|no .*lobby|failed|cannot|can't/.test(value);
}

async function recordParticipation(gameKey, context, dependencies, response) {
    if (!isSuccessfulJoin(response) || getActiveGame(context.chatId) !== gameKey) return false;
    const userId = context.economyUserId || context.senderId;
    if (!recordGameParticipant(context.chatId, gameKey, userId)) return false;
    if (typeof dependencies.recordGameJoin === 'function') {
        await dependencies.recordGameJoin(userId, context.userName, gameKey);
    }
    return true;
}

async function joinSelectedGame(gameKey, context, dependencies, { silent = false } = {}) {
    const { message, client, chatId, senderId, senderContact, userName } = context;
    let response;
    switch (gameKey) {
        case 'wordle':
            response = dependencies.joinLobby(chatId, senderId, userName);
            break;
        case 'wordchain':
            response = await dependencies.joinWordChain(message, { silent });
            break;
        case 'rebus':
            response = dependencies.joinRebusLobby(chatId, senderId, userName);
            break;
        case 'scramble':
            response = dependencies.joinScrambleLobby(chatId, senderId, userName);
            break;
        case 'wordforge':
            response = dependencies.joinWordForgeLobby(
                chatId, senderId, userName, client, [message.author, senderContact]
            );
            break;
        case 'numberrun':
            response = dependencies.joinNumberRunLobby(chatId, senderId, userName);
            break;
        case 'truthhunt':
            response = dependencies.joinTruthHuntLobby(chatId, senderId, userName);
            break;
        case 'mafia': {
            const contact = senderContact || (await dependencies.getSenderContact?.(message));
            const mafiaSenderId = dependencies.getCanonicalJid?.(contact) || senderId;
            response = await dependencies.joinMafiaLobby(chatId, mafiaSenderId, userName, contact);
            break;
        }
        default:
            return { ok: false, response: '❌ I could not identify the selected game.' };
    }

    await recordParticipation(gameKey, context, dependencies, response);

    if (!silent && gameKey === 'wordchain') {
        // Word Chain owns its join reply so it can report player totals and lobby state.
    } else if (!silent) {
        await sendReturnedMessage(message, response);
    }
    return { ok: isSuccessfulJoin(response), response };
}

async function openSelectedGame(gameKey, context, dependencies) {
    const { message, client, chatId, senderId, senderContact, userName } = context;
    const {
        startWordleLobby, startWordChainLobby, startRebusLobby, startScrambleLobby,
        startWordForgeLobby, startNumberRunLobby, startTruthHuntLobby, startMafiaLobby,
        MessageMedia, generateMafiaNarration
    } = dependencies;

    if (!GAME_CHOICES.some(game => game.key === gameKey)) {
        await message.reply('❌ That game is not available from the game picker.');
        return false;
    }
    const activeBefore = getActiveGame(chatId);
    if (activeBefore) {
        await message.reply(`🎮 *${activeBefore}* is already open in this group. Reply START or STOP to its lobby message.`);
        return false;
    }

    let response;
    let lobbyMessageId = null;
    switch (gameKey) {
        case 'wordle': response = startWordleLobby(chatId, client, senderId, userName); break;
        case 'wordchain': response = await startWordChainLobby(message); break;
        case 'rebus': response = await startRebusLobby(chatId, client, senderId, userName); break;
        case 'scramble': response = await startScrambleLobby(chatId, client, senderId, userName); break;
        case 'wordforge': response = startWordForgeLobby(chatId, senderId, userName, client, [message.author, senderContact]); break;
        case 'numberrun': response = startNumberRunLobby(chatId, senderId, userName); break;
        case 'truthhunt': response = startTruthHuntLobby(chatId, senderId, userName); break;
        case 'mafia': {
            const mafiaLobby = await startMafiaLobby(chatId, client, MessageMedia, senderId, userName, generateMafiaNarration);
            lobbyMessageId = mafiaLobby?.lobbyMessageId || global.activeMafiaGame?.lobbyMessageId || null;
            break;
        }
        default: return false;
    }

    if (getActiveGame(chatId) !== gameKey) {
        await sendReturnedMessage(message, response);
        return false;
    }

    const joined = await joinSelectedGame(gameKey, context, dependencies, { silent: true });
    if (gameKey !== 'mafia') {
        const sentLobbyMessage = await sendReturnedMessage(message, response);
        lobbyMessageId = getMessageId(sentLobbyMessage);
    }
    if (lobbyMessageId) setGameLobbyMessage(chatId, gameKey, lobbyMessageId);
    if (!joined.ok) {
        await sendReturnedMessage(
            message,
            joined.response || `⚠️ I could not automatically add the host to ${gameKey}. Reply JOIN to the lobby message to try again.`
        );
    }
    return true;
}

async function isReplyToGameLobby(message, chatId) {
    if (!message?.hasQuotedMsg || typeof message.getQuotedMessage !== 'function') return false;
    try {
        const quoted = await message.getQuotedMessage();
        const body = String(quoted?.body || quoted?.caption || '');
        if (!quoted?.fromMe || !/LOBBY\s+OPEN/i.test(body)) return false;
        const activeLobbyMessageId = getGameLobbyMessage(chatId);
        const quotedId = getMessageId(quoted);
        return !activeLobbyMessageId || quotedId === activeLobbyMessageId;
    } catch (_) {
        return false;
    }
}

async function startActiveGame(context, dependencies) {
    const { message, client, chatId, senderId, senderContact } = context;
    const gameKey = getActiveGame(chatId);
    if (!gameKey) {
        await message.reply('🎮 There is no open game lobby in this group. Type !play to choose one.');
        return false;
    }

    let response;
    switch (gameKey) {
        case 'wordle': response = dependencies.startWordleGame(chatId, senderId, client); break;
        case 'wordchain': response = await dependencies.startWordChainGame(message, client); break;
        case 'rebus': response = dependencies.startRebusGame(chatId, senderId, client); break;
        case 'scramble': response = dependencies.startScrambleGame(chatId, senderId, client); break;
        case 'wordforge': response = dependencies.startWordForgeGame(chatId, senderId, client, [message.author, senderContact]); break;
        case 'numberrun': response = await dependencies.startNumberRunGame(chatId, senderId, dependencies.generateNumberRunBanter); break;
        case 'truthhunt': response = await dependencies.startTruthHuntGame(chatId, senderId, client, dependencies.generateTruthHuntHint); break;
        case 'mafia': response = await dependencies.startMafiaGame(chatId, senderId); break;
        default:
            await message.reply(`❌ I don't recognize the open game (${gameKey}).`);
            return false;
    }
    await sendReturnedMessage(message, response);
    return true;
}

async function stopActiveGame(context, dependencies) {
    const { message, client, chatId, senderId, senderContact } = context;
    const gameKey = getActiveGame(chatId);
    if (!gameKey) {
        await message.reply('🎮 There is no open game lobby in this group.');
        return false;
    }

    let response;
    switch (gameKey) {
        case 'wordle': response = dependencies.stopGame(chatId, senderId); break;
        case 'wordchain': response = await dependencies.stopWordChainCommand(message, client); break;
        case 'rebus': response = dependencies.stopRebusGame(chatId, senderId); break;
        case 'scramble': response = dependencies.stopScrambleGame(chatId, senderId, client); break;
        case 'wordforge': response = dependencies.stopWordForgeGame(chatId, senderId, client, [message.author, senderContact]); break;
        case 'numberrun': response = dependencies.stopNumberRunGame(chatId, senderId); break;
        case 'truthhunt': response = dependencies.stopTruthHuntGame(chatId, senderId); break;
        case 'mafia': response = await dependencies.endMafiaGame(chatId, senderId); break;
        default:
            await message.reply(`❌ I don't recognize the open game (${gameKey}).`);
            return false;
    }
    await sendReturnedMessage(message, response);
    return true;
}

module.exports = { openSelectedGame, joinSelectedGame, isReplyToGameLobby, startActiveGame, stopActiveGame };
