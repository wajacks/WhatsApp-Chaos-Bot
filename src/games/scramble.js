const { addCoins, getBalance, subtractCoins, addXP } = require('../database/db');

const WORDS = [
    { word: 'COMPUTER', category: 'Technology', difficulty: 'medium', hint: 'An electronic device for processing information' },
    { word: 'KEYBOARD', category: 'Technology', difficulty: 'medium', hint: 'A device used to type on a computer' },
    { word: 'INTERNET', category: 'Technology', difficulty: 'medium', hint: 'The global network that connects computers' },
    { word: 'ELEPHANT', category: 'Animals', difficulty: 'medium', hint: 'The largest land animal' },
    { word: 'GIRAFFE', category: 'Animals', difficulty: 'medium', hint: 'A tall animal with a very long neck' },
    { word: 'PENGUIN', category: 'Animals', difficulty: 'easy', hint: 'A flightless bird that swims' },
    { word: 'VOLCANO', category: 'Geography', difficulty: 'medium', hint: 'A mountain that can erupt with lava' },
    { word: 'RAINBOW', category: 'Nature', difficulty: 'easy', hint: 'A colourful arc seen after rain' },
    { word: 'CHOCOLATE', category: 'Food', difficulty: 'medium', hint: 'A sweet treat made from cocoa' },
    { word: 'PINEAPPLE', category: 'Food', difficulty: 'medium', hint: 'A tropical fruit with a spiky skin' },
    { word: 'FOOTBALL', category: 'Sports', difficulty: 'easy', hint: 'A team sport played with a ball and goals' },
    { word: 'BASKETBALL', category: 'Sports', difficulty: 'medium', hint: 'A sport where players shoot into a hoop' },
    { word: 'GUITAR', category: 'Music', difficulty: 'easy', hint: 'A stringed musical instrument' },
    { word: 'CONCERT', category: 'Music', difficulty: 'medium', hint: 'A live music performance' },
    { word: 'PASSPORT', category: 'Travel', difficulty: 'medium', hint: 'A document used for international travel' },
    { word: 'ADVENTURE', category: 'General Knowledge', difficulty: 'medium', hint: 'An exciting and unusual experience' },
    { word: 'BUTTERFLY', category: 'Nature', difficulty: 'medium', hint: 'An insect with colourful wings' },
    { word: 'TREASURE', category: 'General Knowledge', difficulty: 'medium', hint: 'A collection of valuable things' },
    { word: 'HOSPITAL', category: 'Places', difficulty: 'medium', hint: 'A place where sick people receive treatment' },
    { word: 'LANGUAGE', category: 'General Knowledge', difficulty: 'medium', hint: 'A system used for communication' }
];

const activeScrambleGames = new Map();
const LOBBY_TIME_MS = 60 * 1000;
const ROUND_TIME_MS = 25 * 1000;
const MAX_ROUNDS = 12;
const HINT_COST = 500;

function shuffle(array) {
    const result = [...array];
    for (let index = result.length - 1; index > 0; index--) {
        const swapIndex = Math.floor(Math.random() * (index + 1));
        [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
    }
    return result;
}

function scrambleWord(word) {
    let scrambled = word;
    for (let attempt = 0; attempt < 10 && scrambled === word; attempt++) {
        scrambled = shuffle(word.split('')).join('');
    }
    return scrambled.split('').join(' ');
}

function getRoundType(round) {
    if (round % 4 === 0) return { name: '🔥 DOUBLE POINTS', multiplier: 2 };
    if (round % 5 === 0) return { name: '⚡ LIGHTNING ROUND', multiplier: 1, duration: 15 * 1000 };
    return { name: null, multiplier: 1, duration: ROUND_TIME_MS };
}

function calculatePoints(elapsedMs, durationMs, multiplier = 1) {
    const elapsedSeconds = elapsedMs / 1000;
    const base = elapsedSeconds <= 5 ? 100 : elapsedSeconds <= 10 ? 75 : elapsedSeconds <= 15 ? 50 : 30;
    return base * multiplier;
}

function normalizeAnswer(text) {
    return String(text || '').trim().toUpperCase().replace(/[\s-]/g, '');
}

function startScrambleLobby(chatId, client) {
    if (activeScrambleGames.has(chatId)) return '⚠️ A Scrambled Word game is already active or in its lobby in this chat!';

    const game = {
        status: 'LOBBY', players: new Map(), wordPool: shuffle(WORDS), currentRound: 0,
        activeWord: null, roundStartedAt: null, roundTimer: null, lobbyTimer: null,
        categoryTimer: null, letterTimer: null, definitionTimer: null, roundDuration: ROUND_TIME_MS
    };
    activeScrambleGames.set(chatId, game);
    game.lobbyTimer = setTimeout(() => {
        const current = activeScrambleGames.get(chatId);
        if (!current || current.status !== 'LOBBY') return;
        if (current.players.size < 2) {
            activeScrambleGames.delete(chatId);
            client.sendMessage(chatId, '❌ Scrambled Word canceled — at least 2 players are needed.').catch(() => {});
            return;
        }
        startNextRound(chatId, client);
    }, LOBBY_TIME_MS);

    return `🔀 *SCRAMBLED WORD LOBBY OPEN!*\n━━━━━━━━━━━━━━━━━━━━━\nRace to unscramble words before everyone else!\n\nType \`!joinscramble\` to join.\n\n🏁 *12 rounds* | ⏱️ *25 seconds per round*\n💡 Automatic hints unlock as time runs out.\n🔒 Private hint: \`!scramblehint\` (-${HINT_COST} coins; reduced reward)\n\n⌛ Lobby closes in *60 seconds*...`;
}

function joinScrambleLobby(chatId, senderId, userName) {
    const game = activeScrambleGames.get(chatId);
    if (!game) return '❌ No Scrambled Word lobby is open. Start one with `!scramble`.';
    if (game.status !== 'LOBBY') return '⚠️ This Scrambled Word match has already started.';
    if (game.players.has(senderId)) return `⚠️ *${userName}*, you are already registered!`;
    game.players.set(senderId, { id: senderId, name: userName, points: 0, solves: 0, streak: 0, longestStreak: 0, fastestSolveMs: null, usedHint: false });
    return `✅ *${userName}* joined Scrambled Word! (${game.players.size} player(s) ready)`;
}

function clearRoundTimers(game) {
    ['roundTimer', 'categoryTimer', 'letterTimer', 'definitionTimer'].forEach(key => {
        if (game[key]) clearTimeout(game[key]);
        game[key] = null;
    });
}

function startNextRound(chatId, client) {
    const game = activeScrambleGames.get(chatId);
    if (!game) return;
    clearRoundTimers(game);
    game.currentRound++;
    if (game.currentRound > MAX_ROUNDS) return endScrambleGame(chatId, client, '🏁 *SCRAMBLED WORD MATCH COMPLETE!*');
    if (game.wordPool.length === 0) game.wordPool = shuffle(WORDS);
    game.status = 'ACTIVE';
    game.activeWord = game.wordPool.pop();
    game.roundStartedAt = Date.now();
    const roundType = getRoundType(game.currentRound);
    game.roundDuration = roundType.duration || ROUND_TIME_MS;
    for (const player of game.players.values()) player.usedHint = false;

    const word = game.activeWord.word;
    client.sendMessage(chatId, `🔀 *ROUND ${game.currentRound}/${MAX_ROUNDS}* ${roundType.name || ''}\n━━━━━━━━━━━━━━━━━━━━━\n\n👉 \`${scrambleWord(word)}\` 👈\n📏 *${word.length} letters*\n⏱️ *${game.roundDuration / 1000} seconds*\n\n🎯 Registered players: type your answer directly in chat!`).catch(() => {});
    game.categoryTimer = setTimeout(() => client.sendMessage(chatId, `💡 *CATEGORY:* ${game.activeWord.category}`).catch(() => {}), Math.min(8000, game.roundDuration - 1000));
    game.letterTimer = setTimeout(() => client.sendMessage(chatId, `💡 *FIRST LETTER:* ${word[0]}`).catch(() => {}), Math.min(14000, game.roundDuration - 700));
    game.definitionTimer = setTimeout(() => client.sendMessage(chatId, `💡 *FINAL HINT:* ${game.activeWord.hint}`).catch(() => {}), Math.min(19000, game.roundDuration - 300));
    game.roundTimer = setTimeout(() => {
        if (activeScrambleGames.get(chatId) !== game || game.status !== 'ACTIVE') return;
        client.sendMessage(chatId, `⏰ *TIME'S UP!* The word was *${word}*.\n\n⏩ Next round...`).catch(() => {});
        setTimeout(() => startNextRound(chatId, client), 2500);
    }, game.roundDuration);
}

function processScrambleGuess(chatId, text, senderId, userName, client) {
    const game = activeScrambleGames.get(chatId);
    if (!game || game.status !== 'ACTIVE' || !game.players.has(senderId)) return false;
    if (normalizeAnswer(text) !== normalizeAnswer(game.activeWord.word)) return false;
    clearRoundTimers(game);
    const player = game.players.get(senderId);
    const roundType = getRoundType(game.currentRound);
    const elapsedMs = Date.now() - game.roundStartedAt;
    const rawPoints = calculatePoints(elapsedMs, game.roundDuration, roundType.multiplier);
    const points = player.usedHint ? Math.ceil(rawPoints * 0.7) : rawPoints;
    player.points += points;
    player.solves++;
    player.streak++;
    player.longestStreak = Math.max(player.longestStreak, player.streak);
    player.fastestSolveMs = player.fastestSolveMs === null ? elapsedMs : Math.min(player.fastestSolveMs, elapsedMs);
    for (const other of game.players.values()) if (other.id !== senderId) other.streak = 0;
    const streakBonus = player.streak >= 3 ? 30 : player.streak === 2 ? 15 : 0;
    player.points += streakBonus;
    const coins = Math.max(20, Math.round(points / 2));
    addCoins(senderId, coins);
    addXP(senderId, Math.max(10, Math.round(points / 3)), userName);
    const leaderboard = [...game.players.values()].sort((a, b) => b.points - a.points).slice(0, 3)
        .map((entry, index) => `${['🥇', '🥈', '🥉'][index]} *${entry.name}* — ${entry.points} pts`).join('\n');
    client.sendMessage(chatId, `🎉 *SOLVED IN ${(elapsedMs / 1000).toFixed(1)} SECONDS!*\n\n👑 *${userName}* unscrambled *${game.activeWord.word}*\n⚡ +${points} pts | 💰 +${coins} coins${streakBonus ? ` | 🔥 +${streakBonus} streak bonus` : ''}\n\n🏆 *LIVE LEADERBOARD*\n${leaderboard}\n\n⏩ Next round shortly...`).catch(() => {});
    setTimeout(() => startNextRound(chatId, client), 3000);
    return true;
}

function processScrambleHint(chatId, senderId, client) {
    const game = activeScrambleGames.get(chatId);
    if (!game || game.status !== 'ACTIVE') return '❌ There is no active Scrambled Word round.';
    const player = game.players.get(senderId);
    if (!player) return '⚠️ Only registered players can request a private hint.';
    if (player.usedHint) return '💡 You already used your private hint this round.';
    if (getBalance(senderId) < HINT_COST) return `❌ You need ${HINT_COST} coins for a private hint.`;
    subtractCoins(senderId, HINT_COST);
    player.usedHint = true;
    client.sendMessage(senderId, `💡 *PRIVATE SCRAMBLE HINT* (-${HINT_COST} coins)\n\n${game.activeWord.hint}\n\nYour correct-answer points will be reduced by 30% this round.`).catch(() => {});
    return '✅ Private hint sent to your DM. Your reward is reduced by 30% this round.';
}

function endScrambleGame(chatId, client, reason = '🛑 *Scrambled Word match ended.*') {
    const game = activeScrambleGames.get(chatId);
    if (!game) return null;
    clearRoundTimers(game);
    if (game.lobbyTimer) clearTimeout(game.lobbyTimer);
    const players = [...game.players.values()].sort((a, b) => b.points - a.points);
    const fastest = players.filter(player => player.fastestSolveMs !== null).sort((a, b) => a.fastestSolveMs - b.fastestSolveMs)[0];
    const streakLeader = players.filter(player => player.solves > 0).sort((a, b) => b.longestStreak - a.longestStreak)[0];
    const rows = players.map((player, index) => `${index + 1}. *${player.name}* — ${player.points} pts (${player.solves} solved)`).join('\n') || 'No scores recorded.';
    activeScrambleGames.delete(chatId);
    const message = `${reason}\n\n🏆 *FINAL LEADERBOARD*\n━━━━━━━━━━━━━━━━━━━━━\n${rows}${fastest ? `\n\n⚡ Fastest solve: *${fastest.name}* — ${(fastest.fastestSolveMs / 1000).toFixed(1)}s` : ''}${streakLeader ? `\n🔥 Longest streak: *${streakLeader.name}* — ${streakLeader.longestStreak}` : ''}`;
    if (client) client.sendMessage(chatId, message).catch(() => {});
    return message;
}

module.exports = { startScrambleLobby, joinScrambleLobby, processScrambleGuess, processScrambleHint, endScrambleGame, _test: { shuffle, scrambleWord, calculatePoints, normalizeAnswer } };
