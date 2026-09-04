const { readDB, writeDB, addXP } = require('../database/db');

// General English 5-letter word bank
const GENERAL_WORD_BANK = [

    { word: 'BLAZE', hint: 'A very large or fiercely burning fire' },
    { word: 'BRICK', hint: 'A rectangular block used in building construction' },
    { word: 'BROOM', hint: 'Tool used for sweeping floors' },
    { word: 'BUNCH', hint: 'A group of things gathered together' },
    { word: 'CANDLE', hint: 'Wax object with a wick that produces light' },
    { word: 'CANDY', hint: 'Sweet confectionery food item' },
    { word: 'CARGO', hint: 'Goods transported by ship, plane, or vehicle' },
    { word: 'CAVES', hint: 'Natural hollow spaces inside rock or underground' },
    { word: 'CHAIN', hint: 'Series of connected metal links' },
    { word: 'CHESS', hint: 'Board game played between two opponents' },
    { word: 'CHEST', hint: 'Large strong box used for storing things' },
    { word: 'CHILI', hint: 'Spicy pepper or dish made with peppers' },
    { word: 'CHIMP', hint: 'Intelligent ape closely related to humans' },
    { word: 'CHOIR', hint: 'Group of people who sing together' },
    { word: 'CLOUD', hint: 'Visible mass of water vapor in the sky' },
    { word: 'COAST', hint: 'Land bordering a sea or ocean' },
    { word: 'CORAL', hint: 'Hard marine structure formed by tiny sea animals' },
    { word: 'CRANE', hint: 'Large machine used for lifting heavy objects' },
    { word: 'CREAM', hint: 'Thick part of milk used in food' },
    { word: 'CROSS', hint: 'Object formed by two intersecting lines' },

    { word: 'DAILY', hint: 'Something happening every day' },
    { word: 'DAISY', hint: 'Common flower with white petals and a yellow center' },
    { word: 'DANCE', hint: 'Movement of the body to music' },
    { word: 'DEMON', hint: 'Supernatural evil being' },
    { word: 'DEVIL', hint: 'Supernatural figure associated with evil' },
    { word: 'DINER', hint: 'Person who is eating a meal' },
    { word: 'DIVER', hint: 'Person who swims underwater using diving equipment' },
    { word: 'DREAM', hint: 'Series of thoughts or images during sleep' },
    { word: 'DRINK', hint: 'Liquid consumed by a person' },
    { word: 'DRIVE', hint: 'Operate or control a vehicle' },
    { word: 'EAGLE', hint: 'Large bird of prey with powerful claws' },
    { word: 'EARLY', hint: 'Happening before the expected time' },
    { word: 'EMPTY', hint: 'Containing nothing' },
    { word: 'ENEMY', hint: 'Person who is hostile toward another' },
    { word: 'ENTRY', hint: 'Act or place of entering' },
    { word: 'EVENT', hint: 'Something that happens, especially something planned' },
    { word: 'FAIRY', hint: 'Small magical creature from folklore' },
    { word: 'FENCE', hint: 'Structure built to enclose or divide an area' },
    { word: 'FIELD', hint: 'Open area of land, often used for farming' },
    { word: 'FIERY', hint: 'Burning or resembling fire' },

    { word: 'FLASK', hint: 'Small container used for holding liquids' },
    { word: 'FLOOD', hint: 'Large amount of water covering normally dry land' },
    { word: 'FLOOR', hint: 'Bottom surface of a room' },
    { word: 'FOCUS', hint: 'Center of attention or concentration' },
    { word: 'FORCE', hint: 'Strength or energy that causes movement or change' },
    { word: 'FRANK', hint: 'Open, honest, and direct' },
    { word: 'FROST', hint: 'Thin layer of ice formed on cold surfaces' },
    { word: 'GIANT', hint: 'Extremely large person or thing' },
    { word: 'GLOBE', hint: 'Spherical model of the Earth' },
    { word: 'GRAPE', hint: 'Small round fruit often used to make wine' },
    { word: 'GRASS', hint: 'Green plant commonly covering lawns and fields' },
    { word: 'GRILL', hint: 'Device or surface used for cooking food' },
    { word: 'GHOST', hint: 'Apparition of a dead person' },
    { word: 'GLOVE', hint: 'Covering worn on the hand' },
    { word: 'GRAIN', hint: 'Seed of a cereal plant such as wheat or rice' },
    { word: 'GRASS', hint: 'Green plant that commonly grows across fields and lawns' },
    { word: 'HEAVY', hint: 'Having a lot of weight' },
    { word: 'HONEY', hint: 'Sweet substance produced by bees' },
    { word: 'HORSE', hint: 'Large domesticated animal often used for riding' },
    { word: 'HOTEL', hint: 'Building where people pay to stay temporarily' },

    { word: 'IMAGE', hint: 'Visual representation of something' },
    { word: 'JUICE', hint: 'Liquid obtained from fruits or vegetables' },
    { word: 'KNEEL', hint: 'To lower the body onto one or both knees' },
    { word: 'LEMON', hint: 'Yellow citrus fruit with a sour taste' },
    { word: 'LEVER', hint: 'Rigid bar used to lift or move something' },
    { word: 'LOCAL', hint: 'Relating to a particular area or place' },
    { word: 'MAGIC', hint: 'Power of apparently supernatural influence' },
    { word: 'MEDAL', hint: 'Metal award given for achievement' },
    { word: 'METAL', hint: 'Hard material that conducts heat and electricity' },
    { word: 'MODEL', hint: 'Representation of an object or system' },
    { word: 'MOUSE', hint: 'Small animal or computer pointing device' },
    { word: 'MOVIE', hint: 'Motion picture shown on a screen' },
    { word: 'NERVE', hint: 'Fiber that carries signals through the body' },
    { word: 'NIGHT', hint: 'Period of darkness between sunset and sunrise' },
    { word: 'NORTH', hint: 'Direction opposite to south' },
    { word: 'NOVEL', hint: 'Long fictional story in book form' },
    { word: 'OASIS', hint: 'Fertile place with water in a desert' },
    { word: 'OCCUR', hint: 'To happen or take place' },
    { word: 'PAINT', hint: 'Colored substance used to cover or decorate surfaces' },
    { word: 'PAPER', hint: 'Thin material commonly used for writing or printing' },

    { word: 'PEACH', hint: 'Soft round fruit with fuzzy skin' },
    { word: 'PEARL', hint: 'Smooth valuable object formed inside certain shells' },
    { word: 'PHASE', hint: 'Distinct stage in a process or cycle' },
    { word: 'PILOT', hint: 'Person trained to operate an aircraft' },
    { word: 'PLUMB', hint: 'Completely vertical or straight up and down' },
    { word: 'POUND', hint: 'Unit of weight or an action involving striking' },
    { word: 'PRIDE', hint: 'Feeling of satisfaction or self-respect' },
    { word: 'QUEEN', hint: 'Female ruler of a kingdom' },
    { word: 'QUIET', hint: 'Making little or no noise' },
    { word: 'RADIO', hint: 'Device used to receive audio broadcasts' },
    { word: 'REBEL', hint: 'Person who resists authority or control' },
    { word: 'ROBOT', hint: 'Machine capable of performing tasks automatically' },
    { word: 'ROCKY', hint: 'Covered with or consisting of rocks' },
    { word: 'ROUND', hint: 'Having a circular or curved shape' },
    { word: 'ROYAL', hint: 'Relating to a king, queen, or monarchy' },
    { word: 'RULER', hint: 'Straight tool used for measuring length' },
    { word: 'SAUCE', hint: 'Liquid or semi-liquid food served with a meal' },
    { word: 'SHEEP', hint: 'Domesticated farm animal raised for wool or meat' },
    { word: 'SHELL', hint: 'Hard outer covering of certain animals' },
    { word: 'SHIRT', hint: 'Piece of clothing worn on the upper body' },

    { word: 'SHOCK', hint: 'Sudden strong feeling of surprise or distress' },
    { word: 'SHORE', hint: 'Land along the edge of a body of water' },
    { word: 'SKATE', hint: 'Move across a surface using skates' },
    { word: 'SKULL', hint: 'Bones forming the head and protecting the brain' },
    { word: 'SLICE', hint: 'Thin piece cut from something' },
    { word: 'SMILE', hint: 'Expression made by turning up the corners of the mouth' },
    { word: 'SOLAR', hint: 'Relating to the sun' },
    { word: 'SPOON', hint: 'Utensil with a rounded end used for eating' },
    { word: 'SPORT', hint: 'Physical activity involving skill or competition' },
    { word: 'STAIR', hint: 'A step used for moving between levels' },
    { word: 'STEAM', hint: 'Hot vapor produced when water is heated' },
    { word: 'STEEL', hint: 'Strong alloy mainly made from iron and carbon' },
    { word: 'SWEET', hint: 'Having a taste like sugar' },
    { word: 'SWORD', hint: 'Long bladed weapon used historically in combat' },
    { word: 'TABLE', hint: 'Furniture with a flat surface and legs' },
    { word: 'TEETH', hint: 'Hard structures in the mouth used for biting' },
    { word: 'TIGER', hint: 'Large wild cat with black stripes' },
    { word: 'TOAST', hint: 'Bread browned by exposure to heat' },
    { word: 'TOUCH', hint: 'Come into contact with something' },
    { word: 'TRACK', hint: 'Path or course followed by someone or something' },

    { word: 'TRAIL', hint: 'Path through a countryside or natural area' },
    { word: 'TRUCK', hint: 'Large motor vehicle used for transporting goods' },
    { word: 'TRUNK', hint: 'Large storage compartment or main stem of a tree' },
    { word: 'UNCLE', hint: 'Brother of your parent' },
    { word: 'VIDEO', hint: 'Recording of moving images' },
    { word: 'VIRUS', hint: 'Tiny infectious agent that can cause disease' },
    { word: 'VOICE', hint: 'Sound produced by a person when speaking' },
    { word: 'WATCH', hint: 'Small timepiece worn on the wrist' },
    { word: 'WHEEL', hint: 'Circular object that rotates around an axle' },
    { word: 'WITCH', hint: 'Person traditionally believed to practice magic' },
    { word: 'WOMAN', hint: 'Adult human female' },
    { word: 'WORLD', hint: 'The Earth and everything associated with it' },
    { word: 'YACHT', hint: 'Private boat used for recreation or pleasure' },
    { word: 'YOUTH', hint: 'Period of life between childhood and adulthood' },
    { word: 'ZEBRA', hint: 'African animal with distinctive black and white stripes' }

];

const activeGames = new Map();

const LOBBY_TIME_MS = 160 * 1000;                  // 80 Seconds to join lobby
const ROUND_TIME_MS = 5 * 60 * 1000;              // 4 Minutes per word round
const WARNING_TIME_MS = 2 * 60 * 1000;            // Send warning at 2 mins remaining
const MAX_ROUNDS = 15;                            // Total rounds per match
const PER_PLAYER_ATTEMPTS = 15;                   // 15 guesses max per player per word
const HINT_THRESHOLD_WRONG = 10;                   // Group hint unlocks after 5 wrong guesses

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
        // Filter out already used words to avoid repeats
        const availableWords = GENERAL_WORD_BANK.filter(item => !game.usedWords.has(item.word));
        if (availableWords.length === 0) {
            game.usedWords.clear(); // Reset history if all words have been exhausted
            game.wordPool = shuffleArray(GENERAL_WORD_BANK);
        } else {
            game.wordPool = shuffleArray(availableWords);
        }
    }
    const nextPick = game.wordPool.pop();
    game.usedWords.add(nextPick.word);
    return nextPick;
}

// Helper to reveal 1 random letter in its correct spot at round start
function generateInitialRevealedMask(targetWord) {
    const wordLen = targetWord.length;
    const randomIndex = Math.floor(Math.random() * wordLen);
    
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
`• Total Match Duration: *Rounds based* (Up to 15 Rounds, 5 Mins per Round)\n` +
`• Each Player gets *15 Max Attempts* per word.\n` +
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
    if (!game) return;

    // Clear any dangling timers from previous state
    if (game.roundTimer) clearTimeout(game.roundTimer);
    if (game.warningTimer) clearTimeout(game.warningTimer);

    game.currentRound += 1;

    if (game.currentRound > MAX_ROUNDS) {
        endGameSession(chatId, client, `🏁 *MATCH COMPLETED! (${MAX_ROUNDS}/${MAX_ROUNDS} Rounds Finished)*`);
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
            startNextRound(chatId, client);
        }
    }, ROUND_TIME_MS);

    client.sendMessage(chatId,
`🔥 *ROUND ${game.currentRound} OF ${MAX_ROUNDS} STARTED!* 🔥\n` +
`━━━━━━━━━━━━━━━━━━━━━\n` +
`👥 Active Players: ${game.players.size}\n` +
`⏱️ Round Duration: 5 Minutes\n` +
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
        return null; 
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
        // 🛑 Clear active timers immediately so they don't fire midway
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

        // Increased pause from 4s to 7s for better pacing between rounds
        setTimeout(() => startNextRound(chatId, client), 7000);
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