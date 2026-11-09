const { GAME_CHOICES } = require('./gamePicker');
const { getActiveGame } = require('./gameRegistry');

function sendReturnedMessage(message, response) {
    if (typeof response === 'string' && response.trim()) return message.reply(response);
    return Promise.resolve();
}

async function openSelectedGame(gameKey, context, dependencies) {
    const {
        message, client, chatId, senderId, senderContact, userName
    } = context;
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
        await message.reply(`🎮 *${activeBefore}* is already open in this group. Use !startgame or !stopgame for that lobby.`);
        return false;
    }

    let response;
    switch (gameKey) {
        case 'wordle':
            response = startWordleLobby(chatId, client, senderId, userName);
            break;
        case 'wordchain':
            response = await startWordChainLobby(message);
            break;
        case 'rebus':
            response = await startRebusLobby(chatId, client, senderId, userName);
            break;
        case 'scramble':
            response = await startScrambleLobby(chatId, client, senderId, userName);
            break;
        case 'wordforge':
            response = startWordForgeLobby(chatId, senderId, userName, client, [message.author, senderContact]);
            break;
        case 'numberrun':
            response = startNumberRunLobby(chatId, senderId, userName);
            break;
        case 'truthhunt':
            response = startTruthHuntLobby(chatId, senderId, userName);
            break;
        case 'mafia':
            response = await startMafiaLobby(chatId, client, MessageMedia, senderId, userName, generateMafiaNarration);
            break;
        default:
            return false;
    }

    if (getActiveGame(chatId) === gameKey) {
        await sendReturnedMessage(message, response);
        return true;
    }
    await sendReturnedMessage(message, response);
    return false;
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

module.exports = { openSelectedGame, startActiveGame, stopActiveGame };
