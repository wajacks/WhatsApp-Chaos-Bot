const { addCoins, getBalance, subtractCoins, addXP } = require('../database/db');

const WORDS = [
    // 💻 Technology
    { word: 'COMPUTER', category: 'Technology', difficulty: 'medium', hint: 'An electronic device for processing information' },
    { word: 'KEYBOARD', category: 'Technology', difficulty: 'medium', hint: 'A device used to type on a computer' },
    { word: 'INTERNET', category: 'Technology', difficulty: 'medium', hint: 'The global network that connects computers' },
    { word: 'ALGORITHM', category: 'Technology', difficulty: 'hard', hint: 'A set of instructions used to solve a problem' },
    { word: 'PROCESSOR', category: 'Technology', difficulty: 'medium', hint: 'The brain of a computer' },
    
    // 🦁 Animals
    { word: 'ELEPHANT', category: 'Animals', difficulty: 'medium', hint: 'The largest land animal' },
    { word: 'GIRAFFE', category: 'Animals', difficulty: 'medium', hint: 'A tall animal with a very long neck' },
    { word: 'PENGUIN', category: 'Animals', difficulty: 'easy', hint: 'A flightless bird that swims' },
    { word: 'KANGAROO', category: 'Animals', difficulty: 'medium', hint: 'A marsupial known for hopping' },
    { word: 'CHAMELEON', category: 'Animals', difficulty: 'hard', hint: 'A lizard that can change its color' },
    
    // 🌍 Geography & Nature
    { word: 'VOLCANO', category: 'Geography', difficulty: 'medium', hint: 'A mountain that can erupt with lava' },
    { word: 'RAINBOW', category: 'Nature', difficulty: 'easy', hint: 'A colourful arc seen after rain' },
    { word: 'BUTTERFLY', category: 'Nature', difficulty: 'medium', hint: 'An insect with colourful wings' },
    { word: 'GLACIER', category: 'Geography', difficulty: 'hard', hint: 'A large, slow-moving mass of ice' },
    { word: 'TSUNAMI', category: 'Nature', difficulty: 'hard', hint: 'A massive ocean wave caused by an earthquake' },
    
    // 🍕 Food
    { word: 'CHOCOLATE', category: 'Food', difficulty: 'medium', hint: 'A sweet treat made from cocoa' },
    { word: 'PINEAPPLE', category: 'Food', difficulty: 'medium', hint: 'A tropical fruit with a spiky skin' },
    { word: 'SPAGHETTI', category: 'Food', difficulty: 'hard', hint: 'Long, thin strings of pasta' },
    { word: 'CROISSANT', category: 'Food', difficulty: 'hard', hint: 'A buttery, flaky pastry shaped like a crescent' },
    
    // ⚽ Sports & Hobbies
    { word: 'FOOTBALL', category: 'Sports', difficulty: 'easy', hint: 'A team sport played with a ball and goals' },
    { word: 'BASKETBALL', category: 'Sports', difficulty: 'medium', hint: 'A sport where players shoot into a hoop' },
    { word: 'GYMNASTICS', category: 'Sports', difficulty: 'hard', hint: 'A sport involving physical agility and balance' },
    { word: 'PHOTOGRAPHY', category: 'Hobbies', difficulty: 'medium', hint: 'The art of taking pictures' },
    
    // 🎵 Music & Arts
    { word: 'GUITAR', category: 'Music', difficulty: 'easy', hint: 'A stringed musical instrument' },
    { word: 'CONCERT', category: 'Music', difficulty: 'medium', hint: 'A live music performance' },
    { word: 'SYMPHONY', category: 'Music', difficulty: 'hard', hint: 'A long musical composition for a full orchestra' },
    
    // 🚀 Astronomy (NEW)
    { word: 'UNIVERSE', category: 'Astronomy', difficulty: 'medium', hint: 'All of space and everything in it' },
    { word: 'ASTEROID', category: 'Astronomy', difficulty: 'medium', hint: 'A small rocky body orbiting the sun' },
    { word: 'GALAXY', category: 'Astronomy', difficulty: 'easy', hint: 'A massive system of stars, dust, and gas' },
    
    // 🔬 Science & Anatomy (NEW)
    { word: 'OXYGEN', category: 'Science', difficulty: 'easy', hint: 'The gas we need to breathe' },
    { word: 'SKELETON', category: 'Anatomy', difficulty: 'medium', hint: 'The framework of bones inside the body' },
    { word: 'GRAVITY', category: 'Science', difficulty: 'medium', hint: 'The force that pulls objects toward Earth' },
    { word: 'MOLECULE', category: 'Science', difficulty: 'hard', hint: 'A group of atoms bonded together' },
    { word: 'MICROSCOPE', category: 'Science', difficulty: 'medium', hint: 'An instrument used for viewing extremely small objects' },
    { word: 'ELECTRON', category: 'Science', difficulty: 'hard', hint: 'A subatomic particle with a negative electrical charge' },
    { word: 'VACUUM', category: 'Science', difficulty: 'medium', hint: 'A space that is completely empty of matter' },
    { word: 'THERMOMETER', category: 'Science', difficulty: 'medium', hint: 'An instrument used for measuring temperature' },
    { word: 'FOSSIL', category: 'Science', difficulty: 'easy', hint: 'The preserved remains of a prehistoric plant or animal' },
    { word: 'GENETICS', category: 'Science', difficulty: 'hard', hint: 'The study of genes, heredity, and variation in living organisms' },
    { word: 'BACTERIA', category: 'Science', difficulty: 'medium', hint: 'Microscopic, single-celled organisms' },
    { word: 'ELEMENT', category: 'Science', difficulty: 'medium', hint: 'A pure substance consisting of only one type of atom' },
    { word: 'TELESCOPE', category: 'Science', difficulty: 'medium', hint: 'An optical instrument used to view distant objects in space' },
    { word: 'EVOLUTION', category: 'Science', difficulty: 'hard', hint: 'The process by which living organisms develop over time' },
    { word: 'VELOCITY', category: 'Science', difficulty: 'hard', hint: 'The speed of something in a given direction' },
    
    // 🐉 Mythology (NEW)
    { word: 'DRAGON', category: 'Mythology', difficulty: 'easy', hint: 'A legendary fire-breathing creature' },
    { word: 'PEGASUS', category: 'Mythology', difficulty: 'medium', hint: 'A mythical winged horse' },

    // ✈️ Travel & Places
    { word: 'PASSPORT', category: 'Travel', difficulty: 'medium', hint: 'A document used for international travel' },
    { word: 'HOSPITAL', category: 'Places', difficulty: 'medium', hint: 'A place where sick people receive treatment' },
    { word: 'AIRPORT', category: 'Places', difficulty: 'easy', hint: 'A place where airplanes take off and land' },
    
    // 🧠 General Knowledge
    { word: 'ADVENTURE', category: 'General Knowledge', difficulty: 'medium', hint: 'An exciting and unusual experience' },
    { word: 'TREASURE', category: 'General Knowledge', difficulty: 'medium', hint: 'A collection of valuable things' },
    { word: 'LANGUAGE', category: 'General Knowledge', difficulty: 'medium', hint: 'A system used for communication' },
    { word: 'MYSTERY', category: 'General Knowledge', difficulty: 'medium', hint: 'Something that is difficult to understand or explain' },
    { word: 'CALENDAR', category: 'General Knowledge', difficulty: 'easy', hint: 'A system used to organize days, weeks, and months' },
    { word: 'DICTIONARY', category: 'General Knowledge', difficulty: 'medium', hint: 'A book or resource that lists words and their meanings' },
    { word: 'LIBRARY', category: 'General Knowledge', difficulty: 'easy', hint: 'A place where collections of books are kept for reading' },
    { word: 'PYRAMID', category: 'General Knowledge', difficulty: 'medium', hint: 'An ancient monumental structure with triangular sides' },
    { word: 'MUSEUM', category: 'General Knowledge', difficulty: 'medium', hint: 'A building where historical or scientific artifacts are displayed' },
    { word: 'COMPASS', category: 'General Knowledge', difficulty: 'medium', hint: 'A navigation tool with a magnetic pointer' },
    { word: 'NEWSPAPER', category: 'General Knowledge', difficulty: 'easy', hint: 'A printed publication containing current news' },
    { word: 'DIAMOND', category: 'General Knowledge', difficulty: 'medium', hint: 'A precious gemstone made of pure carbon' },
    { word: 'UMBRELLA', category: 'General Knowledge', difficulty: 'easy', hint: 'A portable canopy used to protect against rain or sunlight' },
    { word: 'ECLIPSE', category: 'General Knowledge', difficulty: 'hard', hint: 'When one celestial body obscures the light of another' },
    { word: 'SCULPTURE', category: 'General Knowledge', difficulty: 'hard', hint: 'Three-dimensional art made by carving or shaping materials' },
    { word: 'TRADITION', category: 'General Knowledge', difficulty: 'medium', hint: 'A custom or belief passed down through generations' },
];

const activeScrambleGames = new Map();
const LOBBY_TIME_MS = 60 * 1000;
const ROUND_TIME_MS = 120 * 1000; // Increased to 120 seconds
const MAX_ROUNDS = 15;
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
    if (round % 5 === 0) return { name: '⚡ LIGHTNING ROUND', multiplier: 1, duration: 25 * 1000 };
    return { name: null, multiplier: 1, duration: ROUND_TIME_MS };
}

function calculatePoints(elapsedMs, durationMs, multiplier = 1) {
    const elapsedSeconds = elapsedMs / 1000;
    const base = elapsedSeconds <= 5 ? 100 : elapsedSeconds <= 15 ? 75 : elapsedSeconds <= 30 ? 50 : 30;
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
        categoryTimer: null, letterTimer: null, definitionTimer: null, roundDuration: ROUND_TIME_MS,
        isRoundActive: false // Flag to prevent multiple concurrent rounds and late answers
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

    return `🔀 *SCRAMBLED WORD LOBBY OPEN!*\n━━━━━━━━━━━━━━━━━━━━━\nRace to unscramble words before everyone else!\n\nType \`!joinscramble\` to join.\n\n🏁 *15 rounds* | ⏱️ *120 seconds per round*\n💡 Automatic hints unlock as time runs out.\n🔒 Private hint: \`!scramblehint\` (-${HINT_COST} coins; reduced reward)\n\n⌛ Lobby closes in *60 seconds*...`;
}

function joinScrambleLobby(chatId, senderId, userName) {
    const game = activeScrambleGames.get(chatId);
    if (!game) return '❌ No Scrambled Word lobby is open. Start one with `!scramble`.';
    if (game.status !== 'LOBBY') return '⚠️ This Scrambled Word match has already started.';
    if (game.players.has(senderId)) return `⚠️️ *${userName}*, you are already registered!`;
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
    if (game.isRoundActive) return; // Prevent overlapping round triggers
    
    clearRoundTimers(game);
    game.currentRound++;
    if (game.currentRound > MAX_ROUNDS) return endScrambleGame(chatId, client, '🏁 *SCRAMBLED WORD MATCH COMPLETE!*');
    if (game.wordPool.length === 0) game.wordPool = shuffle(WORDS);
    
    game.status = 'ACTIVE';
    game.isRoundActive = true; 
    game.activeWord = game.wordPool.pop();
    game.roundStartedAt = Date.now();
    const roundType = getRoundType(game.currentRound);
    game.roundDuration = roundType.duration || ROUND_TIME_MS;
    for (const player of game.players.values()) player.usedHint = false;

    const word = game.activeWord.word;
    client.sendMessage(chatId, `🔀 *ROUND ${game.currentRound}/${MAX_ROUNDS}* ${roundType.name || ''}\n━━━━━━━━━━━━━━━━━━━━━\n\n👉 \`${scrambleWord(word)}\` 👈\n📏 *${word.length} letters*\n⏱️ *${game.roundDuration / 1000} seconds*\n\n🎯 Registered players: type your answer directly in chat!`).catch(() => {});
    
    // Math.min is used to safely handle lightning rounds which are shorter than the 120s timer intervals
    game.categoryTimer = setTimeout(() => {
        if (game.isRoundActive) client.sendMessage(chatId, `💡 *CATEGORY:* ${game.activeWord.category}`).catch(() => {});
    }, Math.min(15000, game.roundDuration - 3000)); // 15s after round starts
    
    game.letterTimer = setTimeout(() => {
        if (game.isRoundActive) client.sendMessage(chatId, `💡 *FIRST LETTER:* ${word[0]}`).catch(() => {});
    }, Math.min(30000, game.roundDuration - 2000)); // 15s after category (30s total)
    
    game.definitionTimer = setTimeout(() => {
        if (game.isRoundActive) client.sendMessage(chatId, `💡 *FINAL HINT:* ${game.activeWord.hint}`).catch(() => {});
    }, Math.min(50000, game.roundDuration - 1000)); // 20s after letter (50s total)
    
    game.roundTimer = setTimeout(() => {
        if (activeScrambleGames.get(chatId) !== game || !game.isRoundActive) return;
        game.isRoundActive = false; // Immediately disable answer checking
        client.sendMessage(chatId, `⏰ *TIME'S UP!* The word was *${word}*.\n\n⏩ Next round...`).catch(() => {});
        setTimeout(() => startNextRound(chatId, client), 2500);
    }, game.roundDuration);
}

function processScrambleGuess(chatId, text, senderId, userName, client) {
    const game = activeScrambleGames.get(chatId);
    if (!game || game.status !== 'ACTIVE' || !game.isRoundActive || !game.players.has(senderId)) return false;
    if (normalizeAnswer(text) !== normalizeAnswer(game.activeWord.word)) return false;
    
    game.isRoundActive = false; // Disable further answers during transition
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
    const message = `${reason}\n\n🏆 *FINAL LEADERBOARD*\n━━━━━━━━━━━━━━━━━━━━━\n${rows}${fastest ? `\n\n⚡ Fastest solve: *${fastest.name}* —${(fastest.fastestSolveMs / 1000).toFixed(1)}s` : ''}${streakLeader ? `\n🔥 Longest streak: *${streakLeader.name}* —${streakLeader.longestStreak}` : ''}`;
    if (client) client.sendMessage(chatId, message).catch(() => {});
    return message;
}

module.exports = { startScrambleLobby, joinScrambleLobby, processScrambleGuess, processScrambleHint, endScrambleGame, _test: { shuffle, scrambleWord, calculatePoints, normalizeAnswer } };