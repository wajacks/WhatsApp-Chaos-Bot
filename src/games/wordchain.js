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

// ============================================================
// CONSTANTS
// ============================================================

const LOBBY_STATE = 'LOBBY';
const PLAYING_STATE = 'PLAYING';

const GAME_DURATION = 5 * 60 * 1000;
const TURN_DURATION = 10 * 1000;

const POINTS_3_4 = 1;
const POINTS_5_6 = 2;
const POINTS_7_PLUS = 3;

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

        if (existingGame.state === PLAYING_STATE) {
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

    activeWordChainGames.set(chatId, {
        state: LOBBY_STATE,

        host: hostId,

        players: [
            {
                id: hostId,
                name: userName
            }
        ],

        scores: new Map(),

        usedWords: new Set(),

        currentTurnIndex: 0,

        currentWord: null,

        lastLetter: null,

        matchTimer: null,

        turnTimer: null,

        clientRef: null
    });

    await message.reply(
        '🔗 *WORD CHAIN LOBBY OPEN!*\n\n' +
        `Host: *${userName}*\n\n` +
        'Players can join using:\n' +
        '`!wjoin`\n\n' +
        'Minimum players: *2*\n' +
        'Game duration: *5 minutes*\n' +
        'Turn duration: *10 seconds*\n\n' +
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

    if (game.players.length < 2) {
        await message.reply(
            '❌ At least *2 players* are required to start Word Chain.'
        );

        return;
    }

    game.state = PLAYING_STATE;
    game.clientRef = client;

    game.players =
        shuffleArray(game.players);

    game.scores = new Map();

    game.usedWords = new Set();

    game.players.forEach(player => {
        game.scores.set(player.id, 0);
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

    game.lastLetter =
        startingWord[
            startingWord.length - 1
        ];

    game.usedWords.add(startingWord);

    // ============================================================
    // FIVE MINUTE MATCH TIMER
    // ============================================================

    game.matchTimer = setTimeout(
        async () => {
            await stopWordChain(
                chatId,
                client,
                '⏰ *5 MINUTES ARE UP!*'
            );
        },
        GAME_DURATION
    );

    await message.reply(
        '🔗 *WORD CHAIN HAS STARTED!*\n\n' +
        `Starting word: *${startingWord.toUpperCase()}*\n` +
        `Next word must start with: *${game.lastLetter.toUpperCase()}*\n\n` +
        'Each player has *10 seconds* per turn.\n' +
        'Valid words score points.\n\n' +
        'Good luck! 🔥'
    );

    promptCurrentPlayer(
        chatId,
        client
    );
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

    const player =
        game.players[
            game.currentTurnIndex
        ];

    if (!player) {
        return;
    }

    const nextLetter =
        game.lastLetter.toUpperCase();

    client.sendMessage(
        chatId,
        `🎯 *YOUR TURN!*\n\n` +
        `@${player.id.split('@')[0]}\n\n` +
        `Your word must start with: *${nextLetter}*\n` +
        `You have *10 seconds!*`,
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
                currentGame.state !== PLAYING_STATE
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

            await client.sendMessage(
                chatId,
                `⏰ @${currentPlayer.id.split('@')[0]} ran out of time!\n\n` +
                `No word was submitted.\n` +
                `The turn goes to the next player.`,
                {
                    mentions: [
                        currentPlayer.id
                    ]
                }
            );

            advanceTurn(
                chatId,
                client
            );
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
    // CHECK FIRST LETTER
    // ============================================================

    if (
        word[0] !==
        game.lastLetter.toLowerCase()
    ) {
        await message.reply(
            `❌ Wrong starting letter!\n\n` +
            `Your word must start with *${game.lastLetter.toUpperCase()}*.\n` +
            `You still have the rest of your turn.`
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
    // VALID WORD
    // ============================================================

    if (game.turnTimer) {
        clearTimeout(game.turnTimer);
        game.turnTimer = null;
    }

    game.usedWords.add(word);

    game.currentWord = word;

    game.lastLetter =
        word[word.length - 1];

    let points = 0;

    if (word.length <= 4) {
        points = POINTS_3_4;
    } else if (word.length <= 6) {
        points = POINTS_5_6;
    } else {
        points = POINTS_7_PLUS;
    }

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

    await message.react('✅');

    await client.sendMessage(
        chatId,
        `✅ *${word.toUpperCase()}* accepted!\n\n` +
        `@${currentPlayer.id.split('@')[0]} earns *${points} point${points === 1 ? '' : 's'}*.\n` +
        `Score: *${newScore}*\n\n` +
        `Next letter: *${game.lastLetter.toUpperCase()}*`,
        {
            mentions: [
                currentPlayer.id
            ]
        }
    );

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

    game.currentTurnIndex =
        (
            game.currentTurnIndex + 1
        ) % game.players.length;

    promptCurrentPlayer(
        chatId,
        client
    );
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

    if (!game) {
        return;
    }

    if (game.matchTimer) {
        clearTimeout(
            game.matchTimer
        );

        game.matchTimer = null;
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

    if (game.state === LOBBY_STATE) {
        activeWordChainGames.delete(
            chatId
        );

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

                const coins =
                    points *
                    COINS_PER_POINT;

                return {
                    ...player,
                    points,
                    coins
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
                `   Reward: *${player.coins.toLocaleString()} coins*\n\n`;
        }
    );

    leaderboardText +=
        `Words played: *${game.usedWords.size}*\n` +
        `Conversion: *1 point = ${COINS_PER_POINT.toLocaleString()} coins*`;

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
        if (player.coins <= 0) {
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
                player.coins;

            db[player.id] = user;

        } catch (err) {
            console.error(
                `[WORD CHAIN] Could not award coins to ${player.id}:`,
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