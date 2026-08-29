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
    { country: 'South Africa', puzzle: '⬇️ + 👂 + 🧊', hint: 'SOUTH + AFRICA.' },

];


// ============================================================
// 🎮 GAME STATE
// ============================================================

const activeGames = new Map();     // groupId -> gameState

const pendingSteals = new Map();   // winnerId -> { groupId, playerIds: Set<id> }


// ============================================================
// ⏱️ TIMERS & COSTS
// ============================================================

const LOBBY_TIME_MS = 40 * 1000;        // 40 seconds
const GAME_DURATION_MS = 5 * 60 * 1000; // 5 minutes
const ROUND_DURATION_MS = 50 * 1000;    // 50 seconds
const STEAL_WINDOW_MS = 60 * 1000;      // 1 minute
const HINT_COST = 10;                   // Coins deducted to use !hint


// ============================================================
// 🚪 START LOBBY
// ============================================================

function startRebusLobby(groupId, client) {

    if (activeGames.has(groupId)) {
        return '⚠️ A Rebus game is already active or in lobby in this chat!';
    }

    const gameState = {

        groupId,

        status: 'LOBBY',

        players: new Map(),

        puzzlesPool: [...puzzleList]
            .sort(() => 0.5 - Math.random()),

        currentRound: 0,

        activePuzzle: null,

        roundTimer: null,

        gameTimer: null,

        hintGiven: false
    };

    activeGames.set(groupId, gameState);


    // Lobby countdown
    setTimeout(() => {

        if (!activeGames.has(groupId)) return;

        const game = activeGames.get(groupId);

        if (game.status !== 'LOBBY') return;


        if (game.players.size < 2) {

            client.sendMessage(
                groupId,
                '❌ Game canceled! Need at least 2 registered players.'
            );

            activeGames.delete(groupId);

            return;
        }


        startActiveGame(groupId, client);

    }, LOBBY_TIME_MS);


    return `🧩 *REBUS COUNTRY QUIZ LOBBY OPEN!* 🧩
━━━━━━━━━━━━━━━━━━━━━
Decode country names using emoji clues!

🎮 *HOW TO JOIN:*
Type *!guesscountry* in this chat (Free entry!).

⚠️ *ONLY registered players can answer and use hints!*
💡 *Hint Cost:* \`${HINT_COST} coins\` (Deducted from wallet)
🏆 Correct answer = *+100 points*

⏱️ Game duration: *5 minutes*

⌛ Lobby closing in *40 seconds*...`;
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

function startActiveGame(groupId, client) {

    const game = activeGames.get(groupId);

    if (!game) return;

    game.status = 'ACTIVE';


    client.sendMessage(
        groupId,
`🚀 *REBUS GAME STARTED!* 🚀

You have *5 minutes* to score as many points as possible!

💯 Correct answer = *+100 points*
💡 Need a hint? Type \`!hint\` (-${HINT_COST} coins).

🌍 GO!`
    );


    // Overall game timer
    game.gameTimer = setTimeout(() => {

        if (!activeGames.has(groupId)) return;

        clearTimeout(game.roundTimer);

        client.sendMessage(
            groupId,
            `⏳ *5 MINUTES IS UP!*

The Rebus game has officially ended!`
        );

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

        game.puzzlesPool = [...puzzleList]
            .sort(() => 0.5 - Math.random());
    }


    game.activePuzzle = game.puzzlesPool.pop();

    game.currentRound++;

    game.hintGiven = false;


    client.sendMessage(
        groupId,
`🧩 *ROUND ${game.currentRound}* 🧩
━━━━━━━━━━━━━━━━━━━━━

        👉 *${game.activePuzzle.puzzle}* 👈

━━━━━━━━━━━━━━━━━━━━━

⏱️ *50 seconds!*
💡 Need a hint? Type \`!hint\` (-${HINT_COST} coins)

🎯 Registered players, guess below!`
    );


    // Round timer
    game.roundTimer = setTimeout(() => {

        if (
            activeGames.has(groupId) &&
            game.status === 'ACTIVE'
        ) {

            client.sendMessage(
                groupId,
`⏰ *TIME'S UP!*

The answer was:
🌍 *${game.activePuzzle.country}*

Get ready for the next round...`
            );

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

    // Only one hint per round
    if (game.hintGiven) {
        return '💡 The hint for this round has already been revealed!';
    }

    const userBalance = getBalance(senderId);

    if (userBalance < HINT_COST) {
        return `❌ You don't have enough coins! A hint costs \`${HINT_COST} coins\`.`;
    }

    // Deduct hint fee from user wallet
    subtractCoins(senderId, HINT_COST);
    game.hintGiven = true;


    client.sendMessage(
        groupId,
`💡 *HINT — ROUND ${game.currentRound}* (\`-${HINT_COST} coins\`)
━━━━━━━━━━━━━━━━━━━━━

${game.activePuzzle.hint}

🧠 *Keep guessing!*
🎯 Correct answer = *+100 points*`
    );


    return null;
}


// ============================================================
// 🎯 PROCESS GUESS
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


    const guess = text
        .trim()
        .toLowerCase();

    const target = game.activePuzzle.country
        .toLowerCase();


    if (guess === target) {

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
        );


        nextRound(groupId, client);

        return null;
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

        leaderboard +=
            `${idx + 1}. *${p.name}* — ${p.score} pts\n`;

    });


    // Nobody scored
    if (!winner || winner.score === 0) {

        leaderboard +=
            `\n❌ Nobody scored any points! No steal unlocked.`;

        client.sendMessage(
            groupId,
            leaderboard
        );

        activeGames.delete(groupId);

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
                `⌛ *${winner.name}'s steal window has expired!*

No wallet was robbed.`
            );
        }

    }, STEAL_WINDOW_MS);


    leaderboard +=
`\n🎉 *CONGRATULATIONS ${winner.name}! YOU WIN! 👑*

💰 *WINNER PRIVILEGE:*
You have \`60 seconds\` to steal \`12.5%\` of any losing player's wallet savings!

👉 *${winner.name}*, tag a player now:
\`!steal @User\``;


    client.sendMessage(
        groupId,
        leaderboard
    );


    activeGames.delete(groupId);
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

        return '💸 Target player has no coins in their wallet! Steal wasted!';

    }


    // 12.5% = 1/8
    const stealAmount = Math.floor(victimBal / 8);


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

Stole *${stealAmount} coins* from @${mentionedJid.split('@')[0]}!`;
}


// ============================================================
// 📦 EXPORTS
// ============================================================

module.exports = {

    startRebusLobby,

    joinRebusLobby,

    processRebusGuess,

    processRebusHint,

    handleStealCommand

};