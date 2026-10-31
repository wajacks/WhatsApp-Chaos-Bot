const { addCoins, getBalance, subtractCoins } = require('../database/db');

// ============================================================
// 🌍 REBUS COUNTRY PUZZLES
// ============================================================

const puzzleList = [

    // 🇯🇵 JAPAN
    { country: 'Japan', puzzle: '🫙 + 🍳', hint: 'JAR + PAN...' },

    // 🇸🇬 SINGAPORE
    { country: 'Singapore', puzzle: '🎤 + 🔤A + 🫗', hint: 'SING + A + POUR...' },

    // 🇹🇭 THAILAND
    { country: 'Thailand', puzzle: '👔 + 🏞️', hint: 'The first emoji sounds like TIE.' },

    // 🇮🇸 ICELAND
    { country: 'Iceland', puzzle: '🧊 + 🏞️', hint: 'ICE + LAND.' },

    // 🇫🇮 FINLAND
    { country: 'Finland', puzzle: '🏁 + 🏞️', hint: 'Think about the FIN of a race.' },

    // 🇮🇪 IRELAND
    { country: 'Ireland', puzzle: '😡 + 🏞️', hint: 'Angry = IRE.' },

    // 🇵🇱 POLAND
    { country: 'Poland', puzzle: '🪧 + 🏞️', hint: 'Think POLE + LAND.' },

    // 🇲🇬 MADAGASCAR
    { country: 'Madagascar', puzzle: '😡 + 🔤A + ⛽ + 🚗', hint: 'MAD + A + GAS + CAR.' },

    // 🇴🇲 OMAN
    { country: 'Oman', puzzle: '😮 + 👨', hint: 'OH + MAN.' },

    // 🇩🇪 GERMANY
    { country: 'Germany', puzzle: '🦠 + 👨', hint: 'The first emoji is something that can make you sick.' },

    // 🇨🇺 CUBA
    { country: 'Cuba', puzzle: '🧊 + 🔤A', hint: 'CUBE + A.' },

    // 🇹🇷 TURKEY
    { country: 'Turkey', puzzle: '🦃', hint: 'This bird has the same name as the country.' },

    // 🏴 WALES
    { country: 'Wales', puzzle: '🐋', hint: 'WHALE...' },

    // 🇭🇺 HUNGARY
    { country: 'Hungary', puzzle: '🍔 + 🤤', hint: 'How do you feel when you really need food?' },

    // 🇨🇱 CHILE
    { country: 'Chile', puzzle: '🌶️', hint: 'A spicy pepper.' },

    // 🇨🇦 CANADA
    { country: 'Canada', puzzle: '🥫 + 🔤A + 🦌', hint: 'CAN + A + DA...' },

    // 🇮🇷 IRAN
    { country: 'Iran', puzzle: '👁️ + 🏃', hint: 'I + RAN.' },

    // 🇰🇪 KENYA
    { country: 'Kenya', puzzle: '🥫 + 🙋', hint: 'CAN + YA.' },

    // 🇵🇦 PANAMA
    { country: 'Panama', puzzle: '🍳 + 👩', hint: 'PAN + MA.' },

    // 🇪🇸 SPAIN
    { country: 'Spain', puzzle: '🧽 + 🌧️', hint: 'Think SPONGE + RAIN.' },

    // 🇮🇹 ITALY
    { country: 'Italy', puzzle: '👁️ + 🍵', hint: 'Start with I + T...' },

    // 🇨🇳 CHINA
    { country: 'China', puzzle: '👄 + 🔤A', hint: 'CHIN + A.' },

    // 🇮🇳 INDIA
    { country: 'India', puzzle: '👖 + 🔤A', hint: 'Think of something you wear.' },

    // 🇦🇷 ARGENTINA
    { country: 'Argentina', puzzle: '🥈 + 👩', hint: 'The first clue is related to SILVER.' },

    // 🇪🇬 EGYPT
    { country: 'Egypt', puzzle: '🥚 + 🎹', hint: 'EGG + a musical instrument.' },

    // 🇧🇸 BAHAMAS
    { country: 'Bahamas', puzzle: '🐝 + 🏠 + 👥', hint: 'BEE + HOME + US.' },

    // 🇵🇭 PHILIPPINES
    { country: 'Philippines', puzzle: '🖊️ + 📌📌', hint: 'Think PHIL + PINS.' },

    // 🇵🇰 PAKISTAN
    { country: 'Pakistan', puzzle: '📦 + 👨', hint: 'PACK + ISTAN.' },

    // 🇲🇽 MEXICO
    { country: 'Mexico', puzzle: '👨 + 🔵', hint: 'The first part sounds like MEX.' },

    // 🇬🇦 GABON
    { country: 'Gabon', puzzle: '💬 + 🔛', hint: 'GAB + ON.' },

    // 🇹🇩 CHAD
    { country: 'Chad', puzzle: '👨', hint: 'A common male name.' },

    // 🇵🇪 PERU
    { country: 'Peru', puzzle: '🅿️ + 🦘', hint: 'P + ROO.' },

    // 🇮🇶 IRAQ
    { country: 'Iraq', puzzle: '👁️ + 🦆', hint: 'I + the sound a duck makes.' },

    // 🇩🇰 DENMARK
    { country: 'Denmark', puzzle: '🦌 + 🏷️', hint: 'DEER + MARK.' },

    // 🇳🇴 NORWAY
    { country: 'Norway', puzzle: '🚫 + 🛣️', hint: 'NO + WAY.' },

    // 🇨🇷 COSTA RICA
    { country: 'Costa Rica', puzzle: '🏖️ + 💰', hint: 'COAST + RICH.' },

    // 🇦🇲 ARMENIA
    { country: 'Armenia', puzzle: '💪 + 🔤A', hint: 'ARM + ...' },

    // 🇬🇪 GEORGIA
    { country: 'Georgia', puzzle: '👨 + 🔤A', hint: 'Think of the name GEORGE.' },

    // 🇲🇹 MALTA
    { country: 'Malta', puzzle: '👩 + 🍵', hint: 'MA + TEA.' },

    // 🇲🇨 MONACO
    { country: 'Monaco', puzzle: '🐒 + 🐄', hint: 'MONKEY + COW...' },

    // 🇧🇧 BARBADOS
    { country: 'Barbados', puzzle: '💈 + 👨‍🦲', hint: 'Think BARBER...' },

    // 🇸🇪 SWEDEN
    { country: 'Sweden', puzzle: '🍬 + 🏠', hint: 'SWEET + DEN.' },

    // 🇨🇭 SWITZERLAND
    { country: 'Switzerland', puzzle: '🏊 + 🏞️', hint: 'SWIM + LAND.' },

    // 🇱🇮 LIECHTENSTEIN
    { country: 'Liechtenstein', puzzle: '💡 + 🪨', hint: 'LIGHT + STONE.' },

    // 🇸🇰 SLOVAKIA
    { country: 'Slovakia', puzzle: '🐌 + 🔤A', hint: 'SLOW...' },

    // 🇧🇷 BRAZIL
    { country: 'Brazil', puzzle: '🧠 + 🦓', hint: 'BRA + ZIL...' },

    // 🇷🇴 ROMANIA
    { country: 'Romania', puzzle: '🏛️ + 🔤A', hint: 'ROMAN + IA.' },

    // 🇬🇷 GREECE
    { country: 'Greece', puzzle: '🟢 + 🧀', hint: 'GREEN + CHEESE...' },

    // 🇵🇾 PARAGUAY
    { country: 'Paraguay', puzzle: '🅿️ + 🚗 + 🛣️', hint: 'PARA + GUAY...' },

    // 🇺🇾 URUGUAY
    { country: 'Uruguay', puzzle: '👂 + 🛣️', hint: 'Start with EAR.' },

    // 🇯🇲 JAMAICA
    { country: 'Jamaica', puzzle: '🫙 + 🦙', hint: 'JAR + ...' },

    // 🇱🇧 LEBANON
    { country: 'Lebanon', puzzle: '🦁 + 🔛', hint: 'LEO + ON.' },

    // 🇶🇦 QATAR
    { country: 'Qatar', puzzle: '🐱 + 🚗', hint: 'CAT + CAR.' },

    // 🇧🇭 BAHRAIN
    { country: 'Bahrain', puzzle: '🍺 + 🌧️', hint: 'BAR + RAIN.' },

    // 🇲🇦 MOROCCO
    { country: 'Morocco', puzzle: '➕ + 🐄', hint: 'MORE + COW.' },

    // 🇬🇭 GHANA
    { country: 'Ghana', puzzle: '🔫 + 🔤A', hint: 'GUN + A.' },

    // 🇷🇼 RWANDA
    { country: 'Rwanda', puzzle: '🏃 + 🔤A', hint: 'RUN + DA...' },

    // 🇺🇬 UGANDA
    { country: 'Uganda', puzzle: '🫵 + 🔤A', hint: 'YOU + ...' },

    // 🇿🇦 SOUTH AFRICA
    { country: 'South Africa', puzzle: '⬇️ + 👂 + 🧊', hint: 'SOUTH + AFRICA.' }

];

// ============================================================
// 🎮 GAME STATE
// ============================================================

const activeGames = new Map();
const { claimGame, releaseGame } = require('./gameRegistry');     // groupId -> gameState
const pendingSteals = new Map();   // winnerId -> { groupId, playerIds: Set<id> }

// ============================================================
// ⏱️ TIMERS & COSTS
// ============================================================

const GAME_DURATION_MS = 10 * 60 * 1000; // 10 minutes
const ROUND_DURATION_MS = 80 * 1000;    // 50 seconds
const STEAL_WINDOW_MS = 120 * 1000;      // 2 minute
const HINT_COST = 1000;                   // Dollars deducted to use !hint

// ============================================================
// 🚪 START LOBBY
// ============================================================

function startRebusLobby(groupId, client, hostId, hostName) {

    if (activeGames.has(groupId)) {
        return '⚠️ A Rebus game is already active or in lobby in this chat!';
    }

    const claim = claimGame(groupId, 'rebus');
    if (!claim.ok) return `⚠️ A ${claim.activeGame} game is already active in this group.`;

    const gameState = {
        groupId,
        hostId,
        hostName,
        status: 'LOBBY',
        players: new Map(),
        puzzlesPool: [...puzzleList].sort(() => 0.5 - Math.random()),
        currentRound: 0,
        activePuzzle: null,
        roundTimer: null,
        gameTimer: null,
        hintBuyers: []
    };

    activeGames.set(groupId, gameState);

    return `🧩 *COUNTRY REBUS LOBBY OPEN*
Host: *${hostName}* (host must also join with !joinrebus)
Players: use !joinrebus. Minimum: 2.
Only the host can use !startrebus or !stoprebus.
The lobby stays open until the host starts or stops it.`;
}

// ============================================================
// 👥 JOIN LOBBY (FREE ENTRY)
// ============================================================

function joinRebusLobby(groupId, senderId, userName) {

    if (!activeGames.has(groupId)) {
        return '❌ No active game! Start one with `!rebus`.';
    }

    const game = activeGames.get(groupId);

    if (game.status !== 'LOBBY') {
        return '⚠️ Lobby is closed. Game in progress!';
    }

    if (game.players.has(senderId)) {
        return `⚠️ *${userName}*, you are already registered!`;
    }

    game.players.set(senderId, {
        id: senderId,
        name: userName,
        score: 0
    });

    return `✅ *${userName}* registered successfully! (${game.players.size} player(s) ready)`;
}

// ============================================================
// 🚀 START GAME
// ============================================================

function startRebusGame(groupId, senderId, client) {
    const game = activeGames.get(groupId);
    if (!game || game.status !== 'LOBBY') return '❌ No Country Rebus lobby is waiting to start.';
    if (senderId !== game.hostId) return '❌ Only the host can start this game.';
    if (!game.players.has(senderId)) return '❌ The host must join with !joinrebus before starting.';
    if (game.players.size < 2) return '❌ At least 2 registered players are required.';
    startActiveGame(groupId, client);
    return '🌍 Country Rebus has started.';
}

function stopRebusGame(groupId, senderId) {
    const game = activeGames.get(groupId);
    if (!game) return '❌ There is no Country Rebus game in this group.';
    if (senderId !== game.hostId) return '❌ Only the host can stop this game.';
    clearTimeout(game.roundTimer);
    clearTimeout(game.gameTimer);
    activeGames.delete(groupId);
    releaseGame(groupId, 'rebus');
    return '🛑 The host stopped Country Rebus.';
}

function startActiveGame(groupId, client) {

    const game = activeGames.get(groupId);
    if (!game) return;

    game.status = 'ACTIVE';

    client.sendMessage(
        groupId,
`🚀 *REBUS GAME STARTED!* 🚀

You have *10 minutes* to score as many points as possible!

💯 Correct answer = *+100 points*
💡 Need a hint? Type \`!hint\` (-$${HINT_COST}).

🌍 Registered players, guess directly in chat! GO!`
    ).catch(() => {});

    // Overall game timer
    game.gameTimer = setTimeout(() => {

        if (!activeGames.has(groupId)) return;

        clearTimeout(game.roundTimer);

        client.sendMessage(
            groupId,
            `⏳ *10 MINUTES IS UP!*\n\nThe Rebus game has officially ended!`
        ).catch(() => {});

        endGame(groupId, client);

    }, GAME_DURATION_MS);

    nextRound(groupId, client);
}

// ============================================================
// 🧩 NEXT ROUND
// ============================================================

function nextRound(groupId, client) {

    const game = activeGames.get(groupId);
    if (!game || game.status !== 'ACTIVE') return;

    clearTimeout(game.roundTimer);

    // Refill puzzle pool when empty
    if (game.puzzlesPool.length === 0) {
        game.puzzlesPool = [...puzzleList].sort(() => 0.5 - Math.random());
    }

    game.activePuzzle = game.puzzlesPool.pop();
    game.currentRound++;
    game.hintBuyers = [];

    client.sendMessage(
        groupId,
`🧩 *ROUND ${game.currentRound}* 🧩
━━━━━━━━━━━━━━━━━━━━━

     👉 *${game.activePuzzle.puzzle}* 👈

━━━━━━━━━━━━━━━━━━━━━

⏱️ *80 seconds!*
💡 Need a hint? Type \`!hint\` (-$${HINT_COST})

🎯 Registered players, type your guess below!`
    ).catch(() => {});

    // Round timer
    game.roundTimer = setTimeout(() => {

        if (activeGames.has(groupId) && game.status === 'ACTIVE') {

            client.sendMessage(
                groupId,
`⏰ *TIME'S UP!*

The answer was:
🌍 *${game.activePuzzle.country}*

Get ready for the next round...`
            ).catch(() => {});

            nextRound(groupId, client);
        }

    }, ROUND_DURATION_MS);
}

// ============================================================
// 💡 HINT COMMAND (DEDUCTS WALLET COINS)
// ============================================================

function processRebusHint(groupId, senderId, client) {

    if (!activeGames.has(groupId)) {
        return '❌ No active Rebus game in this chat!';
    }

    const game = activeGames.get(groupId);

    if (game.status !== 'ACTIVE') {
        return '❌ There is no active round right now!';
    }

    if (!game.players.has(senderId)) {
        return '⚠️ Only registered players can request a hint!';
    }

    if (!game.activePuzzle) {
        return '⚠️ There is no active puzzle!';
    }

    // Ensure the array exists (failsafe)
    if (!game.hintBuyers) game.hintBuyers = [];

    // Check if this specific player already bought the hint
    if (game.hintBuyers.includes(senderId)) {
        return '💡 You have already purchased the hint for this round! Check your DMs.';
    }

    const userBalance = getBalance(senderId);

    if (userBalance < HINT_COST) {
        return `❌ You don't have enough dollars! A hint costs \`$${HINT_COST}\`.`;
    }

    // Deduct hint fee from user wallet and record the purchase
    subtractCoins(senderId, HINT_COST);
    game.hintBuyers.push(senderId);

    // Send the hint PRIVATELY to the user who requested it
    client.sendMessage(
        senderId,
`💡 *HINT — ROUND ${game.currentRound}* (\`-$${HINT_COST}\`)
━━━━━━━━━━━━━━━━━━━━━

${game.activePuzzle.hint}

🧠 *Keep guessing in the group!*
🎯 Correct answer = *+100 points*`
    ).catch(() => {});

    // Return a public confirmation to the group chat
    return `✅ Hint sent to your DM! (-$${HINT_COST})\n\nCheck your private messages with me.`;
}

// ============================================================
// 🎯 PROCESS DIRECT GUESS (NO COMMAND PREFIX REQUIRED)
// ============================================================

function processRebusGuess(
    groupId,
    text,
    senderId,
    userName,
    client
) {

    if (!activeGames.has(groupId)) return null;

    const game = activeGames.get(groupId);

    if (game.status !== 'ACTIVE') return null;
    if (!game.players.has(senderId)) return null;
    if (!game.activePuzzle) return null;

    const cleanInput = text.trim().toLowerCase().replace(/[^\w\s]/gi, '');
    const targetCountry = game.activePuzzle.country.toLowerCase().replace(/[^\w\s]/gi, '');

    if (cleanInput === targetCountry) {

        clearTimeout(game.roundTimer);

        const player = game.players.get(senderId);
        player.score += 100;

        client.sendMessage(
            groupId,
`🎉 *CORRECT, ${userName}!* 🎉
━━━━━━━━━━━━━━━━━━━━━

${game.activePuzzle.puzzle}

⬇️

🌍 *${game.activePuzzle.country}*

➕ *+100 Points*
🏆 *${player.score} pts total*`
        ).catch(() => {});

        nextRound(groupId, client);
        return true;
    }

    return null;
}

// ============================================================
// 🏆 END GAME
// ============================================================

function endGame(groupId, client) {

    const game = activeGames.get(groupId);
    if (!game) return;

    clearTimeout(game.roundTimer);
    clearTimeout(game.gameTimer);

    const sorted = Array
        .from(game.players.values())
        .sort((a, b) => b.score - a.score);

    const winner = sorted[0];

    let leaderboard =
`🏆 *FINAL REBUS LEADERBOARD* 🏆
━━━━━━━━━━━━━━━━━━━━━
`;

    sorted.forEach((p, idx) => {
        leaderboard += `${idx + 1}. *${p.name}* — ${p.score} pts\n`;
    });

    // Nobody scored
    if (!winner || winner.score === 0) {

        leaderboard += `\n❌ Nobody scored any points! No steal unlocked.`;

        client.sendMessage(
            groupId,
            leaderboard
        ).catch(() => {});

        activeGames.delete(groupId);
        releaseGame(groupId, 'rebus');
        return;
    }

    // Players eligible to be robbed
    const playerIds = new Set();

    sorted.forEach(p => {
        if (p.id !== winner.id) {
            playerIds.add(p.id);
        }
    });

    pendingSteals.set(
        winner.id,
        {
            groupId,
            playerIds
        }
    );

    // Steal timeout
    setTimeout(() => {

        if (pendingSteals.has(winner.id)) {

            pendingSteals.delete(winner.id);

            client.sendMessage(
                groupId,
                `⌛ *${winner.name}'s steal window has expired!*\n\nNo wallet was robbed.`
            ).catch(() => {});
        }

    }, STEAL_WINDOW_MS);

    leaderboard +=
`\n🎉 *CONGRATULATIONS ${winner.name}! YOU WIN! 👑*

💰 *WINNER PRIVILEGE:*
You have \`120 seconds\` to steal \`25%\` of any losing player's wallet savings!

👉 *${winner.name}*, tag a player now:
\`!steal @User\``;

    client.sendMessage(
        groupId,
        leaderboard
    ).catch(() => {});

    activeGames.delete(groupId);
    releaseGame(groupId, 'rebus');
}

// ============================================================
// 🥷 STEAL COMMAND
// ============================================================

function handleStealCommand(
    groupId,
    senderId,
    mentionedJid,
    client
) {

    if (!pendingSteals.has(senderId)) {
        return '❌ You have no pending steals available, or your steal window expired!';
    }

    const stealData = pendingSteals.get(senderId);

    if (stealData.groupId !== groupId) {
        return '❌ You can only steal within the group you won!';
    }

    if (!mentionedJid) {
        return '⚠️ You must tag the player you want to steal from! (e.g., `!steal @User`)';
    }

    if (!stealData.playerIds.has(mentionedJid)) {
        return '❌ You can only steal from players who registered and participated in the game!';
    }

    const victimBal = getBalance(mentionedJid);

    if (victimBal <= 0) {
        pendingSteals.delete(senderId);
        return '💸 Target player has no dollars in their wallet! Steal wasted!';
    }

    // 12.5% = 1/8
    const stealAmount = Math.floor(victimBal / 4);

    subtractCoins(
        mentionedJid,
        stealAmount
    );

    addCoins(
        senderId,
        stealAmount
    );

    pendingSteals.delete(senderId);

    return `🥷 *BOOM! WALLET STOLEN!* 🥷
━━━━━━━━━━━━━━━━━━━━━

Stole *$${stealAmount}* from @${mentionedJid.split('@')[0]}!`;
}

// ============================================================
// 📦 EXPORTS
// ============================================================

module.exports = {
    hasActiveGames: () => activeGames.size > 0,
    startRebusLobby,
    startRebusGame,
    stopRebusGame,
    joinRebusLobby,
    processRebusGuess,
    processRebusHint,
    handleStealCommand
};