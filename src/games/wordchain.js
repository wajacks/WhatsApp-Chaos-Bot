const englishWords = require('an-array-of-english-words');

const {
    getUser,
    readDB,
    writeDB
} = require('../database/db');

// ============================================================
// WORD DICTIONARY
// ============================================================

const wordSet = new Set(
    englishWords
        .map(word => String(word).toLowerCase().trim())
        .filter(word => /^[a-z]{3,}$/.test(word))
);

// ============================================================
// ACTIVE WORD CHAIN GAMES
// ============================================================

const activeWordChainGames = new Map();
const { claimGame, releaseGame } = require('./gameRegistry');

// ============================================================
// CONSTANTS
// ============================================================

const LOBBY_STATE = 'LOBBY';
const RULES_READ_STATE = 'READING_RULES';
const PLAYING_STATE = 'PLAYING';
const STOPPING_STATE = 'STOPPING';

const RULES_READ_DURATION = 20 * 1000;
const TURN_DURATION = 30 * 1000;
const TURNS_PER_PLAYER = 10;

const POINTS_ANY_ORDER = 1;
const POINTS_IN_ORDER = 2;
const POINTS_CONSECUTIVE = 3;
const POINTS_ING_CONSECUTIVE = 1;
const POINTS_ING_SEPARATE_I = 4;
const POINTS_ING_SEPARATED = 2;

const COINS_PER_POINT = 1000;

// ============================================================
// SHUFFLE
// ============================================================

function shuffleArray(array) {
    const copy = [...array];

    for (let i = copy.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));

        [copy[i], copy[j]] = [
            copy[j],
            copy[i]
        ];
    }

    return copy;
}

// ============================================================
// GET PLAYER NAME
// ============================================================

function getPlayerName(player) {
    return player.name || 'Player';
}

function getWordChainPoints(word, requiredLetters) {
    const normalizedWord = String(word || '').toLowerCase();
    const normalizedRequiredLetters = String(requiredLetters || '').toLowerCase();
    const requiredCounts = new Map();

    for (const letter of normalizedRequiredLetters) {
        requiredCounts.set(
            letter,
            (requiredCounts.get(letter) || 0) + 1
        );
    }

    for (const [letter, count] of requiredCounts) {
        const wordCount = normalizedWord.split(letter).length - 1;
        if (wordCount < count) {
            return 0;
        }
    }

    if (normalizedRequiredLetters === 'ing') {
        if (normalizedWord.includes('ing')) {
            return POINTS_ING_CONSECUTIVE;
        }

        // "ng" together with a separated "i" earns 4 points.
        for (let nIndex = 0; nIndex < normalizedWord.length - 1; nIndex++) {
            const gIndex = nIndex + 1;
            if (normalizedWord[nIndex] !== 'n' || normalizedWord[gIndex] !== 'g') continue;

            for (let iIndex = 0; iIndex < normalizedWord.length; iIndex++) {
                if (normalizedWord[iIndex] === 'i' &&
                    Math.abs(iIndex - nIndex) > 1 &&
                    Math.abs(iIndex - gIndex) > 1) {
                    return POINTS_ING_SEPARATE_I;
                }
            }
        }

        // Any order earns 2 when i, n, and g are each separated from the others.
        for (let iIndex = 0; iIndex < normalizedWord.length; iIndex++) {
            if (normalizedWord[iIndex] !== 'i') continue;
            for (let nIndex = 0; nIndex < normalizedWord.length; nIndex++) {
                if (normalizedWord[nIndex] !== 'n' || Math.abs(iIndex - nIndex) <= 1) continue;
                for (let gIndex = 0; gIndex < normalizedWord.length; gIndex++) {
                    if (normalizedWord[gIndex] === 'g' &&
                        Math.abs(iIndex - gIndex) > 1 &&
                        Math.abs(nIndex - gIndex) > 1) {
                        return POINTS_ING_SEPARATED;
                    }
                }
            }
        }
    }

    if (normalizedWord.includes(normalizedRequiredLetters)) {
        return POINTS_CONSECUTIVE;
    }

    let searchFrom = 0;
    for (const letter of normalizedRequiredLetters) {
        const index = normalizedWord.indexOf(letter, searchFrom);
        if (index === -1) {
            return POINTS_ANY_ORDER;
        }
        searchFrom = index + 1;
    }

    return POINTS_IN_ORDER;
}

// ============================================================
// OPEN WORD CHAIN LOBBY
// ============================================================

async function startWordChainLobby(message) {
    const chatId = message.from;
    const hostId = message.author || message.from;

    const existingGame =
        activeWordChainGames.get(chatId);

    if (existingGame) {
        if (existingGame.state === LOBBY_STATE) {
            await message.reply(
                '⚠️ A Word Chain lobby is already open in this chat.\n\n' +
                'Use `!wjoin` to join or `!startwordchain` to start.'
            );

            return;
        }

        if (
            existingGame.state === PLAYING_STATE ||
            existingGame.state === RULES_READ_STATE ||
            existingGame.state === STOPPING_STATE
        ) {
            await message.reply(
                '⚠️ A Word Chain game is already running in this chat.'
            );

            return;
        }
    }

    const contact = await message.getContact();

    const userName =
        contact?.pushname ||
        contact?.name ||
        'Chaos Member';

    const claim = claimGame(chatId, 'wordchain');
    if (!claim.ok) {
        await message.reply(`⚠️ A ${claim.activeGame} game is already active in this group.`);
        return;
    }

    activeWordChainGames.set(chatId, {
        state: LOBBY_STATE,

        host: hostId,

        players: [],

        scores: new Map(),

        turnsTaken: new Map(),

        usedWords: new Set(),

        currentTurnIndex: 0,

        currentWord: null,

        requiredLetters: null,

        rulesTimer: null,

        turnTimer: null,

        turnResolved: false,

        clientRef: null
    });

    await message.reply(
        '🔗 *WORD CHAIN LOBBY OPEN!*\n\n' +
        `Host: *${userName}*\n\n` +
        'Players can join using:\n' +
        '`!wjoin`\n\n' +
        'Host must also join with !wjoin. Minimum players: *2*\n' +
        'Each player gets *10 turns* of up to *30 seconds*.\n' +
        'Ends after all turns (max *5 minutes × players* + 20s briefing).\n\n' +
        'When everyone is ready, the host can use:\n' +
        '`!startwordchain`'
    );
}

// ============================================================
// JOIN WORD CHAIN
// ============================================================

async function joinWordChain(message) {
    const chatId = message.from;
    const playerId =
        message.author || message.from;

    const game =
        activeWordChainGames.get(chatId);

    if (!game) {
        await message.reply(
            '❌ No active Word Chain lobby.\n\n' +
            'Start one with `!wordchain`.'
        );

        return;
    }

    if (game.state !== LOBBY_STATE) {
        await message.reply(
            '❌ The Word Chain game has already started.\n\n' +
            'You cannot join this match now.'
        );

        return;
    }

    const alreadyJoined =
        game.players.some(
            player => player.id === playerId
        );

    if (alreadyJoined) {
        await message.reply(
            '⚠️ You are already in the Word Chain lobby.'
        );

        return;
    }

    const contact =
        await message.getContact();

    const userName =
        contact?.pushname ||
        contact?.name ||
        'Chaos Member';

    game.players.push({
        id: playerId,
        name: userName
    });

    await message.reply(
        `🔗 *${userName} joined Word Chain!*\n\n` +
        `Players: *${game.players.length}*\n\n` +
        'Waiting for the host to use `!startwordchain`.'
    );
}

// ============================================================
// START WORD CHAIN GAME
// ============================================================

async function startWordChainGame(message, client) {
    const chatId = message.from;
    const senderId =
        message.author || message.from;

    const game =
        activeWordChainGames.get(chatId);

    if (!game) {
        await message.reply(
            '❌ No active Word Chain lobby.\n\n' +
            'Start one with `!wordchain`.'
        );

        return;
    }

    if (game.state !== LOBBY_STATE) {
        await message.reply(
            '⚠️ The Word Chain game has already started.'
        );

        return;
    }

    if (senderId !== game.host) {
        await message.reply(
            '❌ Only the host can start the Word Chain game.'
        );

        return;
    }

    if (!game.players.some(player => player.id === game.host)) {
        await message.reply('❌ The host must join with !wjoin before starting.');
        return;
    }

    if (game.players.length < 2) {
        await message.reply(
            '❌ At least *2 players* are required to start Word Chain.'
        );

        return;
    }

    game.state = RULES_READ_STATE;
    game.clientRef = client;

    game.players =
        shuffleArray(game.players);

    game.scores = new Map();

    game.turnsTaken = new Map();

    game.usedWords = new Set();

    game.players.forEach(player => {
        game.scores.set(player.id, 0);
        game.turnsTaken.set(player.id, 0);
    });

    game.currentTurnIndex = 0;

    // ============================================================
    // STARTING WORD
    // ============================================================

    const startingWords = [
        'algorithm',
        'computer',
        'internet',
        'javascript',
        'keyboard',
        'language',
        'network',
        'program',
        'system',
        'technology'
    ];

    const startingWord =
        startingWords[
            Math.floor(
                Math.random() *
                startingWords.length
            )
        ];

    game.currentWord = startingWord;
    game.requiredLetters = startingWord.slice(-3);
    game.usedWords.add(startingWord);

    await message.reply(
        '🔗 *WORD CHAIN HAS STARTED!*\n\n' +
        `Starting word: *${startingWord.toUpperCase()}*\n` +
        `Required letters: *${game.requiredLetters.toUpperCase()}*\n\n` +
        'Use one unused English word containing all 3 letters, in any order.\n' +
        'Example (T-H-E): ENTHUSIASTIC = 1, THUNDER = 2, THEATER = 3.\n' +
        'Other triples: 1 any order; 2 in order with gaps; 3 consecutive in order.\n' +
        'ING exception: consecutive ING = 1; separated I + NG = 4; I, N, and G all separated = 2.\n' +
        'Each player gets 10 turns; the game ends after all 10 are used.\n' +
        'Each turn lasts 30 seconds.\n\n' +
        '⏳ First turn starts in 20 seconds so everyone can read.'
    );

    game.rulesTimer = setTimeout(() => {
        const currentGame = activeWordChainGames.get(chatId);
        if (!currentGame || currentGame.state !== RULES_READ_STATE) {
            return;
        }

        currentGame.rulesTimer = null;
        currentGame.state = PLAYING_STATE;
        promptCurrentPlayer(chatId, client);
    }, RULES_READ_DURATION);
}

// ============================================================
// PROMPT CURRENT PLAYER
// ============================================================

function promptCurrentPlayer(chatId, client) {
    const game =
        activeWordChainGames.get(chatId);

    if (
        !game ||
        game.state !== PLAYING_STATE
    ) {
        return;
    }

    if (game.turnTimer) {
        clearTimeout(game.turnTimer);
        game.turnTimer = null;
    }

    game.turnResolved = false;

    const player =
        game.players[
            game.currentTurnIndex
        ];

    if (!player) {
        return;
    }

    const turnsTaken = game.turnsTaken.get(player.id) || 0;
    const turnNumber = turnsTaken + 1;

    client.sendMessage(
        chatId,
        `🎯 *YOUR TURN!*\n\n` +
        `@${player.id.split('@')[0]}\n\n` +
        `Include all 3 letters in one unused word, any order.\n` +
        `Turn ${turnNumber}/${TURNS_PER_PLAYER} — you have 30 seconds.`,
        {
            mentions: [player.id]
        }
    ).catch(err => {
        console.error(
            '[WORD CHAIN] Prompt error:',
            err
        );
    });

    game.turnTimer = setTimeout(
        async () => {
            const currentGame =
                activeWordChainGames.get(chatId);

            if (
                !currentGame ||
                currentGame.state !== PLAYING_STATE ||
                currentGame.turnResolved
            ) {
                return;
            }

            const currentPlayer =
                currentGame.players[
                    currentGame.currentTurnIndex
                ];

            if (!currentPlayer) {
                return;
            }

            currentGame.turnResolved = true;

            try {
                await client.sendMessage(
                    chatId,
                    `⏰ @${currentPlayer.id.split('@')[0]} ran out of time!\n\n` +
                    `This counts as turn ${(currentGame.turnsTaken.get(currentPlayer.id) || 0) + 1}/${TURNS_PER_PLAYER}.`,
                    {
                        mentions: [currentPlayer.id]
                    }
                );
            } catch (err) {
                console.error('[WORD CHAIN] Timeout notice error:', err);
            }

            advanceTurn(chatId, client);
        },
        TURN_DURATION
    );
}

// ============================================================
// PROCESS WORD CHAIN MESSAGE
// ============================================================

async function processWordChain(message, client) {
    const chatId = message.from;

    const game =
        activeWordChainGames.get(chatId);

    if (
        !game ||
        game.state !== PLAYING_STATE
    ) {
        return false;
    }

    const senderId =
        message.author || message.from;

    const currentPlayer =
        game.players[
            game.currentTurnIndex
        ];

    if (!currentPlayer) {
        return false;
    }

    // ============================================================
    // ONLY CURRENT PLAYER CAN PLAY
    // ============================================================

    if (senderId !== currentPlayer.id) {
        return false;
    }

    if (game.turnResolved) {
        return true;
    }

    const text =
        message.body
            ? message.body.trim()
            : '';

    // ============================================================
    // COMMANDS ARE NOT WORDS
    // ============================================================

    if (text.startsWith('!')) {
        return false;
    }

    // Ignore chat messages and phrases without validating them as guesses.
    if (!text || /\s/.test(text)) {
        return true;
    }

    // ============================================================
    // WORD FORMAT
    // ============================================================

    const word =
        text.toLowerCase();

    if (!/^[a-z]{3,}$/.test(word)) {
        await message.reply(
            '❌ Invalid word.\n\n' +
            'Use letters only and a minimum of 3 letters.'
        );

        return true;
    }


    // ============================================================
    // CHECK DICTIONARY
    // ============================================================

    if (!wordSet.has(word)) {
        await message.reply(
            `❌ *${word.toUpperCase()}* isn't in the dictionary.\n\n` +
            'Try another word.'
        );

        return true;
    }

    // ============================================================
    // CHECK DUPLICATE
    // ============================================================

    if (game.usedWords.has(word)) {
        await message.reply(
            `❌ *${word.toUpperCase()}* has already been used in this match.`
        );

        return true;
    }

    // ============================================================
    // REQUIRED LETTERS AND SCORE
    // ============================================================

    const points = getWordChainPoints(word, game.requiredLetters);
    if (points === 0) {
        await message.reply(
            `❌ Include all three required letters: *${game.requiredLetters.toUpperCase()}*.\n` +
            'You still have the rest of your turn.'
        );
        return true;
    }

    // ============================================================
    // VALID WORD
    // ============================================================

    game.turnResolved = true;

    if (game.turnTimer) {
        clearTimeout(game.turnTimer);
        game.turnTimer = null;
    }

    game.usedWords.add(word);

    game.currentWord = word;
    game.requiredLetters = word.slice(-3);

    const oldScore =
        game.scores.get(
            currentPlayer.id
        ) || 0;

    const newScore =
        oldScore + points;

    game.scores.set(
        currentPlayer.id,
        newScore
    );

    try {
        await message.react('✅');
    } catch (err) {
        console.error('[WORD CHAIN] Reaction error:', err);
    }

    try {
        await client.sendMessage(
            chatId,
            `✅ *${word.toUpperCase()}* accepted!\n\n` +
            `@${currentPlayer.id.split('@')[0]} earns *${points} point${points === 1 ? '' : 's'}*.\n` +
            `Score: *${newScore}*\n` +
            `Next required letters: *${game.requiredLetters.toUpperCase()}*`,
            {
                mentions: [currentPlayer.id]
            }
        );
    } catch (err) {
        console.error('[WORD CHAIN] Accepted-word notice error:', err);
    }

    advanceTurn(
        chatId,
        client
    );

    return true;
}

// ============================================================
// ADVANCE TURN
// ============================================================

function advanceTurn(chatId, client) {
    const game =
        activeWordChainGames.get(chatId);

    if (
        !game ||
        game.state !== PLAYING_STATE
    ) {
        return;
    }

    if (game.turnTimer) {
        clearTimeout(game.turnTimer);
        game.turnTimer = null;
    }

    const completedPlayer = game.players[game.currentTurnIndex];
    if (completedPlayer) {
        const turns = (game.turnsTaken.get(completedPlayer.id) || 0) + 1;
        game.turnsTaken.set(completedPlayer.id, turns);
    }

    const everyoneFinished = game.players.every(
        player => (game.turnsTaken.get(player.id) || 0) >= TURNS_PER_PLAYER
    );

    if (everyoneFinished) {
        stopWordChain(chatId, client, '🎉 *EVERYONE COMPLETED 10 TURNS!*').catch(err => {
            console.error('[WORD CHAIN] Could not finish game:', err);
        });
        return;
    }

    game.currentTurnIndex =
        (game.currentTurnIndex + 1) % game.players.length;

    promptCurrentPlayer(chatId, client);
}

// ============================================================
// STOP WORD CHAIN
// ============================================================

async function stopWordChain(
    chatId,
    client,
    reason = 'Game terminated.'
) {
    const game =
        activeWordChainGames.get(chatId);

    if (!game || game.state === STOPPING_STATE) {
        return;
    }

    const wasLobby = game.state === LOBBY_STATE;
    game.state = STOPPING_STATE;

    if (game.rulesTimer) {
        clearTimeout(game.rulesTimer);
        game.rulesTimer = null;
    }

    if (game.turnTimer) {
        clearTimeout(
            game.turnTimer
        );

        game.turnTimer = null;
    }

    // ============================================================
    // LOBBY CANCELLATION
    // ============================================================

    if (wasLobby) {
        activeWordChainGames.delete(
            chatId
        );
        releaseGame(chatId, 'wordchain');

        if (client) {
            await client.sendMessage(
                chatId,
                `❌ *WORD CHAIN LOBBY CANCELLED*\n\n${reason}`
            );
        }

        return;
    }

    // ============================================================
    // FINAL LEADERBOARD
    // ============================================================

    const leaderboard =
        [...game.players]
            .map(player => {
                const points =
                    game.scores.get(
                        player.id
                    ) || 0;

                const dollars =
                    points *
                    COINS_PER_POINT;

                return {
                    ...player,
                    points,
                    dollars
                };
            })
            .sort(
                (a, b) =>
                    b.points - a.points
            );

    let leaderboardText =
        `${reason}\n\n` +
        '🏆 *WORD CHAIN FINAL LEADERBOARD*\n\n';

    leaderboard.forEach(
        (player, index) => {
            const medal =
                index === 0
                    ? '🥇'
                    : index === 1
                        ? '🥈'
                        : index === 2
                            ? '🥉'
                            : `${index + 1}.`;

            leaderboardText +=
                `${medal} @${player.id.split('@')[0]}\n` +
                `   Points: *${player.points}*\n` +
                `   Reward: *$${player.dollars.toLocaleString()}*\n\n`;
        }
    );

    leaderboardText +=
        `Words played: *${game.usedWords.size}*\n` +
        `Conversion: *1 point = $${COINS_PER_POINT.toLocaleString()}*`;

    if (client) {
        await client.sendMessage(
            chatId,
            leaderboardText,
            {
                mentions:
                    leaderboard.map(
                        player =>
                            player.id
                    )
            }
        );
    }

    // ============================================================
    // PAY COINS
    // ============================================================

    const db = readDB();

    for (const player of leaderboard) {
        if (player.dollars <= 0) {
            continue;
        }

        try {
            const user =
                getUser(
                    player.id,
                    player.name
                );

            user.coins =
                (user.coins || 0) +
                player.dollars;

            db[player.id] = user;

        } catch (err) {
            console.error(
                `[WORD CHAIN] Could not award dollars to ${player.id}:`,
                err
            );
        }
    }

    writeDB(db);

    // ============================================================
    // DELETE SESSION
    // ============================================================

    activeWordChainGames.delete(
        chatId
    );
    releaseGame(chatId, 'wordchain');
}

// ============================================================
// STOP WORD CHAIN COMMAND
// ============================================================

async function stopWordChainCommand(
    message,
    client
) {
    const chatId = message.from;

    const senderId =
        message.author || message.from;

    const game =
        activeWordChainGames.get(chatId);

    if (!game) {
        await message.reply(
            '❌ There is no active Word Chain lobby or game.'
        );

        return;
    }

    if (senderId !== game.host) {
        await message.reply(
            '❌ Only the Word Chain host can stop the game.'
        );

        return;
    }

    await stopWordChain(
        chatId,
        client,
        '🛑 *WORD CHAIN STOPPED BY THE HOST*'
    );
}

// ============================================================
// EXPORTS
// ============================================================

module.exports = {
    startWordChainLobby,
    joinWordChain,
    startWordChainGame,
    processWordChain,
    stopWordChain,
    stopWordChainCommand
};