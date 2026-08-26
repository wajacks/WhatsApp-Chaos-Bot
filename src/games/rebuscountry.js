const { addCoins, getBalance, subtractCoins } = require('../database/db');

const puzzleList = [
    { country: 'Singapore', puzzle: '🎤 + 🫗' }, // Sing + Pour
    { country: 'Thailand', puzzle: '👔 + 🏞️' }, // Tie + Land
    { country: 'Iceland', puzzle: '🧊 + 🏞️' }, // Ice + Land
    { country: 'Finland', puzzle: '🦈 + 🏞️' }, // Fin + Land
    { country: 'Ireland', puzzle: '👁️ + 🏞️' }, // Eye + Land
    { country: 'Poland', puzzle: '💈 + 🏞️' }, // Pole + Land
    { country: 'Madagascar', puzzle: '🥩 + ⛽ + 🚗' }, // Meat + Gas + Car
    { country: 'Oman', puzzle: '😮 + 👨' }, // Oh + Man
    { country: 'Germany', puzzle: '🦠 + 🪙' }, // Germ + Money
    { country: 'Cuba', puzzle: '🧊 + 🅰️' }, // Cube + A
    { country: 'Turkey', puzzle: '🦃' },
    { country: 'Wales', puzzle: '🐋' },
    { country: 'Japan', puzzle: '🏺 + 🍳' }, // Jar + Pan
    { country: 'Hungary', puzzle: '🍔 + 🤤' },
    { country: 'Chile', puzzle: '🌶️' },
    { country: 'Canada', puzzle: '🥫 + 🅰️ + 🚪' }, // Can + A + Door
    { country: 'Belize', puzzle: '🐝 + 🔑 + 🇿' }, // Bee + Lees
    { country: 'Peru', puzzle: '💵 + 🦘' }, // Pay + Roo
    { country: 'Chad', puzzle: '👨‍🦱' },
    { country: 'Gabon', puzzle: '💬 + 🔛' } // Gab + On
];

const activeGames = new Map();     // groupId -> gameState
const pendingSteals = new Map();   // winnerId -> { groupId, playerIds: Set<id> }

const LOBBY_TIME_MS = 40 * 1000;       // 40 seconds lobby
const GAME_DURATION_MS = 5 * 60 * 1000; // 5 minutes overall game time

function startRebusLobby(groupId, client) {
    if (activeGames.has(groupId)) {
        return '⚠️ A Rebus game is already active or in lobby in this chat!';
    }

    const gameState = {
        groupId,
        status: 'LOBBY',
        players: new Map(), // senderId -> { id, name, score }
        puzzlesPool: [...puzzleList].sort(() => 0.5 - Math.random()),
        currentRound: 0,
        activePuzzle: null,
        roundTimer: null,
        gameTimer: null
    };

    activeGames.set(groupId, gameState);

    setTimeout(() => {
        if (activeGames.has(groupId)) {
            const game = activeGames.get(groupId);
            if (game.status === 'LOBBY') {
                if (game.players.size < 2) {
                    client.sendMessage(groupId, '❌ Game canceled! Need at least 2 registered players.');
                    activeGames.delete(groupId);
                    return;
                }
                startActiveGame(groupId, client);
            }
        }
    }, LOBBY_TIME_MS);

    return `🧩 *REBUS COUNTRY QUIZ LOBBY OPEN!* 🧩\n` +
`━━━━━━━━━━━━━━━━━━━━━\n` +
`Decode country names built from emoji combinations!\n\n` +
`🎮 *HOW TO JOIN:* Type *!guesscountry* in this chat.\n` +
`⚠️ *ONLY registered players can answer during gameplay!*\n` +
`⏱️ Unlimited rounds for *5 minutes* once started.\n\n` +
`⌛ Lobby closing in *40 seconds*...`;
}

function joinRebusLobby(groupId, senderId, userName) {
    if (!activeGames.has(groupId)) return '❌ No active game! Start one with `!rebus`.';
    const game = activeGames.get(groupId);

    if (game.status !== 'LOBBY') return '⚠️ Lobby is closed. Game in progress!';
    if (game.players.has(senderId)) return `⚠️ *${userName}*, you are already registered!`;

    game.players.set(senderId, { id: senderId, name: userName, score: 0 });
    return `✅ *${userName}* registered! (${game.players.size} player(s) ready)`;
}

function startActiveGame(groupId, client) {
    const game = activeGames.get(groupId);
    game.status = 'ACTIVE';

    client.sendMessage(groupId, `🚀 *REBUS GAME STARTED!* You have 5 minutes of unlimited rounds. GO!`);

    // Master 5-Minute Timer
    game.gameTimer = setTimeout(() => {
        if (activeGames.has(groupId)) {
            clearTimeout(game.roundTimer);
            client.sendMessage(groupId, `⏳ *5 MINUTES IS UP!* The game has officially ended!`);
            endGame(groupId, client);
        }
    }, GAME_DURATION_MS);

    nextRound(groupId, client);
}

function nextRound(groupId, client) {
    const game = activeGames.get(groupId);
    if (!game || game.status !== 'ACTIVE') return;

    // Reshuffle endlessly if we exhaust the list
    if (game.puzzlesPool.length === 0) {
        game.puzzlesPool = [...puzzleList].sort(() => 0.5 - Math.random());
    }

    game.activePuzzle = game.puzzlesPool.pop();
    game.currentRound++;

    client.sendMessage(groupId, 
`🧩 *ROUND ${game.currentRound}* 🧩\n` +
`━━━━━━━━━━━━━━━━━━━━━\n\n` +
`       👉   *${game.activePuzzle.puzzle}*   👈\n\n` +
`━━━━━━━━━━━━━━━━━━━━━\n` +
`⏱️ *Registered players, guess below!*`
    );

    game.roundTimer = setTimeout(() => {
        if (activeGames.has(groupId) && game.status === 'ACTIVE') {
            client.sendMessage(groupId, `⏰ *Time up for Round ${game.currentRound}!* Country: *${game.activePuzzle.country}*`);
            nextRound(groupId, client);
        }
    }, 25000); // 25 seconds per puzzle
}

function processRebusGuess(groupId, text, senderId, userName, client) {
    if (!activeGames.has(groupId)) return null;
    const game = activeGames.get(groupId);

    if (game.status !== 'ACTIVE') return null;

    // Strict check: Only registered players can answer
    if (!game.players.has(senderId)) return null;

    const guess = text.trim().toLowerCase();
    const target = game.activePuzzle.country.toLowerCase();

    if (guess === target) {
        clearTimeout(game.roundTimer);
        const player = game.players.get(senderId);
        player.score += 100;

        client.sendMessage(groupId, `🎉 *CORRECT, ${userName}!* (${game.activePuzzle.puzzle} = *${game.activePuzzle.country}*)\n➕ +100 Points`);
        nextRound(groupId, client);
        return null;
    }

    return null;
}

function endGame(groupId, client) {
    const game = activeGames.get(groupId);
    const sorted = Array.from(game.players.values()).sort((a, b) => b.score - a.score);
    const winner = sorted[0];

    let leaderboard = `🏆 *FINAL REBUS LEADERBOARD* 🏆\n━━━━━━━━━━━━━━━━━━━━━\n`;
    sorted.forEach((p, idx) => {
        leaderboard += `${idx + 1}. *${p.name}* — ${p.score} pts\n`;
    });

    if (!winner || winner.score === 0) {
        leaderboard += `\n❌ Nobody scored any points! No steal unlocked.`;
        client.sendMessage(groupId, leaderboard);
        activeGames.delete(groupId);
        return;
    }

    // Prepare set of valid target IDs for tagging check
    const playerIds = new Set();
    sorted.slice(1).forEach(p => playerIds.add(p.id));

    pendingSteals.set(winner.id, { groupId, playerIds });

    leaderboard += `\n🎉 *CONGRATULATIONS ${winner.name}! YOU WIN!* 👑\n` +
`💰 *WINNER PRIVILEGE:* You can steal *1/8 (12.5%)* of any losing player's savings!\n\n` +
`👉 *${winner.name}*, tag a player to steal from them: \`!steal @User\``;

    client.sendMessage(groupId, leaderboard);
    activeGames.delete(groupId);
}

function handleStealCommand(groupId, senderId, mentionedJid, client) {
    if (!pendingSteals.has(senderId)) return '❌ You have no pending steals available!';

    const stealData = pendingSteals.get(senderId);
    if (stealData.groupId !== groupId) return '❌ You can only steal within the group you won!';

    if (!mentionedJid) {
        return '⚠️ You must tag the player you want to steal from! (e.g., `!steal @User`)';
    }

    if (!stealData.playerIds.has(mentionedJid)) {
        return '❌ You can only steal from players who participated in the game!';
    }

    const victimBal = getBalance(mentionedJid);

    if (victimBal <= 0) {
        pendingSteals.delete(senderId);
        return `💸 Target player has no coins in their wallet! Steal wasted!`;
    }

    const stealAmount = Math.floor(victimBal / 8); // 1/8th of balance
    subtractCoins(mentionedJid, stealAmount);
    addCoins(senderId, stealAmount);

    pendingSteals.delete(senderId);

    return `🥷 *BOOM! SAVINGS STOLEN!* 🥷\n` +
`━━━━━━━━━━━━━━━━━━━━━\n` +
`Stole *${stealAmount} coins* (1/8 of savings) from @${mentionedJid.split('@')[0]}!`;
}

module.exports = {
    startRebusLobby,
    joinRebusLobby,
    processRebusGuess,
    handleStealCommand
};