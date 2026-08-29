const { readDB, writeDB, addXP } = require('../database/db');

// General English 5-letter word bank
const GENERAL_WORD_BANK = [
    { word: 'CANDY', hint: 'Sweet confectionery food item' },
    { word: 'BRAVE', hint: 'Ready to face and endure danger or pain' },
    { word: 'GHOST', hint: 'An apparition of a dead person' },
    { word: 'STORM', hint: 'Violent disturbance of the atmosphere with wind and rain' },
    { word: 'PLANT', hint: 'Living organism absorbing water through roots' },
    { word: 'FLAME', hint: 'Hot glowing body of ignited gas' },
    { word: 'CROWN', hint: 'Traditional ornamental headpiece worn by a monarch' },
    { word: 'CLOCK', hint: 'Instrument used for measuring and showing time' },
    { word: 'OCEAN', hint: 'Very large expanse of sea water' },
    { word: 'TIGER', hint: 'Large wild cat with yellow-orange coat and black stripes' },
    { word: 'MONEY', hint: 'Medium of exchange in the form of coins or banknotes' },
    { word: 'SHARK', hint: 'Large sea fish with sharp teeth and cartilaginous skeleton' },
    { word: 'APPLE', hint: 'Round edible fruit with red, yellow, or green skin' },
    { word: 'BREAD', hint: 'Food made of flour, water, and yeast baked together' },
    { word: 'TRAIN', hint: 'Connected series of railway cars' },
    { word: 'EARTH', hint: 'The planet on which we live' },
    { word: 'RIVER', hint: 'Large natural stream of water flowing in a channel' },
    { word: 'SNAKE', hint: 'Long limbless reptile' },
    { word: 'HEART', hint: 'Organ that pumps blood through the circulatory system' },
    { word: 'PIANO', hint: 'Large keyboard musical instrument' },
    { word: 'SMOKE', hint: 'Visible vapor given off by a burning substance' },
    { word: 'CHAIR', hint: 'A separate seat for one person' },
    { word: 'MAGIC', hint: 'The power of apparently influencing events using supernatural forces' },
    { word: 'STORY', hint: 'An account of imaginary or real people and events' },
    { word: 'LIGHT', hint: 'Natural agent that stimulates sight and makes things visible' },
    { word: 'GLASS', hint: 'Hard, brittle substance used for windows and drinking cups' },
    { word: 'HOUSE', hint: 'A building for human habitation' },
    { word: 'WATER', hint: 'Clear liquid forming seas, lakes, rivers, and rain' },
    { word: 'DREAM', hint: 'Series of thoughts or images occurring during sleep' },
    { word: 'KNIFE', hint: 'Cutting instrument with a blade and handle' },
    { word: 'BEACH', hint: 'Pebbly or sandy shore by the ocean' },
    { word: 'FRUIT', hint: 'Sweet product of a tree or plant containing seeds' },
    { word: 'WORLD', hint: 'The earth together with all its countries and people' },
    { word: 'TOWER', hint: 'Tall narrow structure standing alone or on a building' },
    { word: 'CLOUD', hint: 'Visible mass of condensed water vapor floating in the atmosphere' },
    { word: 'HORSE', hint: 'Solid-hoofed plant-eating domesticated mammal' },
    { word: 'STONE', hint: 'Hard solid non-metallic mineral matter' },
    { word: 'GREEN', hint: 'Color between blue and yellow in the spectrum' },
    { word: 'MUSIC', hint: 'Vocal or instrumental sounds combined in a harmonious way' },
    { word: 'NIGHT', hint: 'Period of ambient darkness between sunset and sunrise' }
];

const activeGames = new Map();

const LOBBY_TIME_MS = 80 * 1000;                  // 1 Minute to join lobby
const ROUND_TIME_MS = 4 * 60 * 1000;              // 4 Minutes per word round (20 min total session)
const WARNING_TIME_MS = 2 * 60 * 1000;            // Send warning at 2 mins (2 mins remaining)
const MAX_ROUNDS = 10;                             // 5 rounds = 20 minutes total session
const PER_PLAYER_ATTEMPTS = 15;                   // 15 guesses max per player per word
const HINT_THRESHOLD_WRONG = 5;                   // Group hint unlocks after 5 wrong guesses

function shuffleArray(array) {
    const arr = [...array];
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
}

function getNextWord(game) {
    if (game.wordPool.length === 0) {
        game.wordPool = shuffleArray(GENERAL_WORD_BANK);
    }
    const nextPick = game.wordPool.pop();
    game.usedWords.add(nextPick.word);
    return nextPick;
}

// Helper to reveal 1 random letter in its correct spot at round start
function generateInitialRevealedMask(targetWord) {
    const wordLen = targetWord.length;
    const randomIndex = Math.floor(Math.random() * wordLen);
    const mask = new Array(wordLen).fill('🟩');
    
    let displayStr = '';
    for (let i = 0; i < wordLen; i++) {
        if (i === randomIndex) {
            displayStr += `${targetWord[i]} `;
        } else {
            displayStr += `_ `;
        }
    }
    return {
        index: randomIndex,
        char: targetWord[randomIndex],
        display: displayStr.trim()
    };
}

function startWordleLobby(chatId, client) {
    if (activeGames.has(chatId)) {
        const game = activeGames.get(chatId);
        if (game.status === 'LOBBY') {
            return '⚠️ Lobby is already open! Type `!join` to enter.';
        }
        return '⚠️ A Wordle match is currently active in this chat!';
    }

    const shuffledPool = shuffleArray(GENERAL_WORD_BANK);

    const gameState = {
        status: 'LOBBY',
        players: new Map(), // senderId -> { name, points, wordsSolved, attemptsLeft }
        wordPool: shuffledPool,
        usedWords: new Set(),
        currentRound: 0,
        targetWord: '',
        hint: '',
        hintRevealed: false,
        revealedLetter: null,
        wrongGuessesCount: 0,
        streak: 0,
        roundTimer: null,
        warningTimer: null
    };

    activeGames.set(chatId, gameState);

    setTimeout(() => {
        if (activeGames.has(chatId)) {
            const game = activeGames.get(chatId);
            if (game.players.size === 0) {
                client.sendMessage(chatId, '❌ Game canceled — nobody joined the lobby!');
                activeGames.delete(chatId);
                return;
            }
            startNextRound(chatId, client);
        }
    }, LOBBY_TIME_MS);

    return `🔤 *WORDLE MATCH LOBBY OPEN!* 🔤\n` +
`━━━━━━━━━━━━━━━━━━━━━\n` +
`🎮 *HOW TO JOIN:* Type *!join* to enter the match!\n\n` +
`📖 *MATCH RULES:* \n` +
`• Total Match Duration: *20 Minutes* (5 Rounds, 4 Mins per Round)\n` +
`• Each Player gets *15 Max Attempts* per word.\n` +
`• Running out of attempts makes you spectate until the next round!\n` +
`• Bot reveals *1 correct letter* at the start of each word.\n` +
`• Simply type your 5-letter guess directly in chat!\n\n` +
`⏱️ Lobby closing soon... Register now with *!join*!`;
}

function joinLobby(chatId, senderId, userName) {
    if (!activeGames.has(chatId)) return '❌ No active game! Start one with `!wordle`.';
    const game = activeGames.get(chatId);

    if (game.status !== 'LOBBY') return '⚠️ Match already in progress! You can join the next match lobby.';
    if (game.players.has(senderId)) return `⚠️ *${userName}*, you are already registered!`;

    game.players.set(senderId, { 
        name: userName, 
        points: 0, 
        wordsSolved: 0, 
        attemptsLeft: PER_PLAYER_ATTEMPTS 
    });

    return `✅ *${userName}* joined the match! (${game.players.size} player(s) ready)`;
}

function startNextRound(chatId, client) {
    const game = activeGames.get(chatId);
    game.currentRound += 1;

    if (game.currentRound > MAX_ROUNDS) {
        endGameSession(chatId, client, '🏁 *20-MINUTE MATCH COMPLETED! (5/5 Rounds Finished)*');
        return;
    }

    game.status = 'ACTIVE';
    const pick = getNextWord(game);
    game.targetWord = pick.word.toUpperCase();
    game.hint = pick.hint;
    game.hintRevealed = false;
    game.wrongGuessesCount = 0;
    game.revealedLetter = generateInitialRevealedMask(game.targetWord);

    // Reset each registered player's attempts for the new round
    for (const [id, player] of game.players.entries()) {
        player.attemptsLeft = PER_PLAYER_ATTEMPTS;
    }

    // Set 2-Minute Warning Timer
    game.warningTimer = setTimeout(() => {
        if (activeGames.has(chatId) && game.status === 'ACTIVE') {
            client.sendMessage(chatId, `⚠️ *TIME WARNING!* Only *2 minutes remaining* for Round ${game.currentRound}/${MAX_ROUNDS}!`);
        }
    }, WARNING_TIME_MS);

    // Set 4-Minute Round Expiration Timer
    game.roundTimer = setTimeout(() => {
        if (activeGames.has(chatId) && game.status === 'ACTIVE') {
            client.sendMessage(
                chatId, 
                `⏰ *ROUND TIME EXPIRED!* Nobody guessed the word.\n` +
                `💡 The secret word was: *${game.targetWord}*\n\n` +
                `⏩ *Preparing next round...*`
            );
            clearTimeout(game.warningTimer);
            startNextRound(chatId, client);
        }
    }, ROUND_TIME_MS);

    client.sendMessage(chatId,
`🔥 *ROUND ${game.currentRound} OF ${MAX_ROUNDS} STARTED!* 🔥\n` +
`━━━━━━━━━━━━━━━━━━━━━\n` +
`👥 Active Players: ${game.players.size}\n` +
`⏱️ Round Duration: 4 Minutes\n` +
`🎯 Attempts per player: 15\n` +
`🔍 *FREE LETTER HINT:* \` ${game.revealedLetter.display} \` (Letter *${game.revealedLetter.char}* is in position ${game.revealedLetter.index + 1})\n\n` +
`💬 *Registered players: Type your 5-letter guess directly in chat!*`
    );
}

function processGuess(chatId, rawText, senderId, userName, client) {
    if (!activeGames.has(chatId)) return null;
    const game = activeGames.get(chatId);

    if (game.status !== 'ACTIVE') return null;
    if (!game.players.has(senderId)) return null;

    const player = game.players.get(senderId);

    // Check if player exhausted their attempts for this word
    if (player.attemptsLeft <= 0) {
        return null; // Ignore silently or let them spectate
    }

    const guess = rawText.trim().toUpperCase();
    if (guess.length !== 5 || !/^[A-Z]+$/.test(guess)) return null;

    const targetArr = game.targetWord.split('');
    const guessArr = guess.split('');
    const feedback = new Array(5).fill('⬛');
    const targetLetterCounts = {};

    for (const char of targetArr) targetLetterCounts[char] = (targetLetterCounts[char] || 0) + 1;

    // Green
    for (let i = 0; i < 5; i++) {
        if (guessArr[i] === targetArr[i]) {
            feedback[i] = '🟩';
            targetLetterCounts[guessArr[i]]--;
        }
    }

    // Yellow / Black
    for (let i = 0; i < 5; i++) {
        if (feedback[i] === '🟩') continue;
        const char = guessArr[i];
        if (targetArr.includes(char) && targetLetterCounts[char] > 0) {
            feedback[i] = '🟨';
            targetLetterCounts[char]--;
        }
    }

    player.attemptsLeft--;
    game.wrongGuessesCount++;

    const formattedGuess = guessArr.join(' ');
    const feedbackGrid = feedback.join(' ');

    // --- CASE 1: WINNER ---
    if (guess === game.targetWord) {
        if (game.roundTimer) clearTimeout(game.roundTimer);
        if (game.warningTimer) clearTimeout(game.warningTimer);

        player.points += (player.attemptsLeft + 1) * 100;
        player.wordsSolved += 1;

        const bonusCoins = (player.attemptsLeft + 1) * 40;
        const xpReward = (player.attemptsLeft + 1) * 25;
        const db = readDB();
        const user = db[senderId] || { coins: 100, xp: 0, wins: 0, wordsSolved: 0 };
        user.coins = (user.coins || 0) + bonusCoins;
        user.wins = (user.wins || 0) + 1;
        user.wordsSolved = (user.wordsSolved || 0) + 1;
        db[senderId] = user;
        writeDB(db);
        addXP(senderId, xpReward, userName);

        const oldWord = game.targetWord;
        game.streak += 1;

        const winMessage = formatRoundWinBoard(game, oldWord, userName, bonusCoins, xpReward);

        // Schedule next round after brief pause
        setTimeout(() => startNextRound(chatId, client), 4000);
        return winMessage;
    }

    // --- CASE 2: PLAYER EXHAUSTED ATTEMPTS ---
    let lockoutNotice = '';
    if (player.attemptsLeft <= 0) {
        lockoutNotice = `\n🚫 *You have used all 15 attempts!* Please watch as remaining players finish this round.`;
    }

    // --- CASE 3: WRONG GUESS - UNLOCK EXTRA HINT IF THRESHOLD MET ---
    let hintNotice = '';
    if (!game.hintRevealed && game.wrongGuessesCount >= HINT_THRESHOLD_WRONG) {
        game.hintRevealed = true;
        hintNotice = `\n💡 *GROUP HINT UNLOCKED:* ${game.hint}`;
    }

    return `👤 *${userName}* guessed *${guess}*:\n` +
            `🔤 ${formattedGuess}\n` +
            `🎨 ${feedbackGrid}\n` +
            `⏳ Guesses remaining: *${player.attemptsLeft}/${PER_PLAYER_ATTEMPTS}*` +
            `${lockoutNotice}` +
            `${hintNotice}`;
}

function formatRoundWinBoard(game, oldWord, solverName, coins, xp) {
    const top3 = Array.from(game.players.values())
        .sort((a, b) => b.points - a.points)
        .slice(0, 3);

    let top3Text = `🏆 *MATCH LEADERBOARD*\n`;
    const medals = ['🥇', '🥈', '🥉'];
    top3.forEach((p, i) => {
        top3Text += `${medals[i]} *${p.name}* — ${p.points} pts (${p.wordsSolved} solved)\n`;
    });

    return `🎉 *ROUND ${game.currentRound} SOLVED!* Secret Word: *${oldWord}*\n` +
`👤 Winner: *${solverName}* (+${coins} coins | +${xp} XP)\n` +
`━━━━━━━━━━━━━━━━━━━━━\n` +
`${top3Text}` +
`━━━━━━━━━━━━━━━━━━━━━\n` +
`⏩ *Next round starting shortly...*`;
}

function endGameSession(chatId, client, reason) {
    if (!activeGames.has(chatId)) return;
    const game = activeGames.get(chatId);

    if (game.roundTimer) clearTimeout(game.roundTimer);
    if (game.warningTimer) clearTimeout(game.warningTimer);

    const allPlayers = Array.from(game.players.values())
        .sort((a, b) => b.points - a.points);

    let summary = `${reason}\n\n📊 *FINAL MATCH RESULTS* 📊\n━━━━━━━━━━━━━━━━━━━━━\n`;
    
    if (allPlayers.length === 0) {
        summary += `No points scored during this session.`;
    } else {
        allPlayers.forEach((p, index) => {
            summary += `${index + 1}. *${p.name}* — ${p.points} pts (${p.wordsSolved} solved)\n`;
        });
    }

    summary += `\n━━━━━━━━━━━━━━━━━━━━━\n🔥 Total Words Solved: *${game.streak}*`;

    activeGames.delete(chatId);
    client.sendMessage(chatId, summary);
}

function stopGame(chatId) {
    if (!activeGames.has(chatId)) {
        return '❌ There is no active Wordle match to end in this chat.';
    }
    
    const game = activeGames.get(chatId);
    if (game.roundTimer) clearTimeout(game.roundTimer);
    if (game.warningTimer) clearTimeout(game.warningTimer);
    
    activeGames.delete(chatId);
    return '🛑 *The Wordle match has been manually ended by a player.*';
}

module.exports = {
    startWordleLobby,
    joinLobby,
    processGuess,
    endGameSession,
    stopGame
};