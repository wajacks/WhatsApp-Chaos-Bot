const crypto = require('crypto');
const englishWords = require('an-array-of-english-words');
const {
    getBalance,
    transferCoins
} = require('../database/db');
const {
    getKnownPlayerLinks,
    rememberPlayerIdentities
} = require('../database/mafiadb');
const wordForgeDB = require('../database/wordforgedb');

const ROUND_DURATION_MS = 90 * 1000;
const BREAK_DURATION_MS = 10 * 1000;
const LOBBY_DURATION_MS = 3 * 60 * 1000;
const MAX_ROUNDS = 8;
const MAX_PLAYERS = 10;
const MIN_PLAYERS = 2;
const STEAL_WINDOW_MS = 120 * 1000;
const STEAL_FRACTION = 0.25;
const MAX_TIEBREAK_ROUNDS = 3;
const LETTER_POOL = 'eeeeeeeeeeeeaaaaaaaaaiiiiiiiiioooooooonnnnnnrrrrrrttttttllllssssuuuuddddgggbbbccmmmppffhhvvwwyyk';
const VOWELS = new Set(['a', 'e', 'i', 'o', 'u']);
const FLAVOR_LINES = [
    'The letters are getting restless...',
    'Somebody is staring very hard at that rack.',
    'The clock is moving. The tiles are not.',
    'A valid word is still hiding in plain sight.',
    'The pressure is building inside the forge.'
];

const dictionary = new Set(
    englishWords
        .map(word => String(word).toLowerCase().trim())
        .filter(word => /^[a-z]{3,8}$/.test(word))
);
const wordList = Array.from(dictionary);
const activeGames = new Map();
const timers = new Map();
const identityAliases = new Map(getKnownPlayerLinks());
let gamesRestored = false;

function randomIndex(length) {
    return length > 1 ? crypto.randomInt(length) : 0;
}

function randomItem(items) {
    return items[randomIndex(items.length)];
}

function normalizeIdentity(value) {
    if (value === null || value === undefined) return null;
    const clean = String(value).trim().split('_')[0];
    return clean || null;
}

function collectIdentityAliases(value, result, seen) {
    if (!value) return;

    if (typeof value === 'string') {
        const normalized = normalizeIdentity(value);
        if (normalized) result.add(normalized);
        return;
    }

    if (typeof value !== 'object' || seen.has(value)) return;
    seen.add(value);

    if (value.id) {
        if (typeof value.id === 'object') {
            if (value.id._serialized) collectIdentityAliases(value.id._serialized, result, seen);
        } else {
            collectIdentityAliases(value.id, result, seen);
        }
    }

    if (value._serialized) collectIdentityAliases(value._serialized, result, seen);
    if (value.number) {
        const number = String(value.number).trim().replace(/[^\d]/g, '');
        if (number) result.add(number + '@c.us');
    }
}

function identityBundle(primary, extraIdentities, persistAliases = true) {
    const aliases = new Set();
    const seen = new Set();
    collectIdentityAliases(primary, aliases, seen);
    for (const identity of extraIdentities || []) {
        collectIdentityAliases(identity, aliases, seen);
    }

    const originalAliases = Array.from(aliases);
    let canonical = null;
    for (const alias of originalAliases) {
        const known = identityAliases.get(alias);
        if (known) {
            canonical = known;
            break;
        }
    }

    if (!canonical) {
        canonical = originalAliases.find(alias => alias.endsWith('@c.us')) || originalAliases[0] || null;
    }

    if (canonical) {
        aliases.add(canonical);
        const needsPersistence = Array.from(aliases).some(alias => identityAliases.get(alias) !== canonical);
        if (persistAliases && needsPersistence) {
            try {
                rememberPlayerIdentities(canonical, Array.from(aliases));
                for (const alias of aliases) identityAliases.set(alias, canonical);
                identityAliases.set(canonical, canonical);
            } catch (error) {
                console.error('[WORD FORGE] Could not save player identity aliases:', error.message);
            }
        }
    }

    for (const alias of Array.from(aliases)) {
        const known = identityAliases.get(alias);
        if (known) aliases.add(known);
    }

    return { canonical, aliases: Array.from(aliases) };
}

function matchesIdentity(player, bundle) {
    if (!player || !bundle) return false;
    const candidates = new Set(bundle.aliases || []);
    if (bundle.canonical) candidates.add(bundle.canonical);

    // FIX: Checks if the new player matches the existing player, without mixing their IDs!
    if (player.id && candidates.has(player.id)) return true;

    const stored = player.identityAliases || [];
    for (const alias of stored) {
        if (candidates.has(alias)) return true;
        const canonical = identityAliases.get(alias);
        if (canonical && candidates.has(canonical)) return true;
    }
    return false;
}

function findPlayer(game, bundle) {
    if (!game || !bundle) return null;
    for (const playerId of game.playerOrder || []) {
        const player = game.players[playerId];
        if (matchesIdentity(player, bundle)) return player;
    }
    return null;
}

function findPlayerInAnyMatch(bundle) {
    for (const game of activeGames.values()) {
        const player = findPlayer(game, bundle);
        if (player) return { game, player };
    }
    return null;
}

function safeName(value) {
    const name = String(value || '').trim().replace(/\s+/g, ' ').slice(0, 40);
    return name || 'Chaos Member';
}

function makeAnonymousId(game) {
    const used = new Set((game.playerOrder || []).map(id => game.players[id].anonymousId));
    let candidate;
    do {
        candidate = 'WF-' + crypto.randomBytes(3).toString('hex').toUpperCase();
    } while (used.has(candidate));
    return candidate;
}

function makePlayer(game, bundle, name) {
    return {
        id: bundle.canonical,
        name: safeName(name),
        anonymousId: makeAnonymousId(game),
        identityAliases: bundle.aliases,
        score: 0,
        solvedRounds: 0,
        cumulativeSolveMs: 0,
        roundSolved: false,
        roundGuess: null,
        roundPoints: 0,
        roundElapsedMs: null,
        puzzle: null
    };
}

function createMatch(groupId, playerId, userName, bundle) {
    const game = {
        id: crypto.randomBytes(8).toString('hex').toUpperCase(),
        groupId,
        hostId: playerId,
        phase: 'LOBBY',
        createdAt: Date.now(),
        lobbyExpiresAt: Date.now() + LOBBY_DURATION_MS,
        currentRound: 0,
        roundStartedAt: null,
        roundEndsAt: null,
        breakEndsAt: null,
        roundResults: [],
        playerOrder: [],
        players: {},
        tiebreakCandidates: null,
        tiebreakCount: 0,
        timers: null
    };

    const player = makePlayer(game, bundle, userName);
    game.players[player.id] = player;
    game.playerOrder.push(player.id);
    return game;
}

function getTimerSet(groupId) {
    if (!timers.has(groupId)) {
        timers.set(groupId, {
            lobby: null,
            round: null,
            break: null,
            comments: [],
            steal: []
        });
    }
    return timers.get(groupId);
}

function clearTimer(timerSet, key) {
    if (timerSet[key]) clearTimeout(timerSet[key]);
    timerSet[key] = null;
}

function clearRoundTimers(groupId) {
    const timerSet = getTimerSet(groupId);
    clearTimer(timerSet, 'round');
    clearTimer(timerSet, 'break');
    for (const timer of timerSet.comments) clearTimeout(timer);
    timerSet.comments = [];
}

function clearGameTimers(groupId) {
    const timerSet = getTimerSet(groupId);
    clearTimer(timerSet, 'lobby');
    clearRoundTimers(groupId);
    timers.delete(groupId);
}

function safeSend(client, chatId, content) {
    if (!client || !chatId || !content) return;
    try {
        const result = client.sendMessage(chatId, content);
        if (result && typeof result.catch === 'function') {
            result.catch(error => console.warn('[WORD FORGE] Message delivery failed:', error.message));
        }
    } catch (error) {
        console.warn('[WORD FORGE] Message delivery failed:', error.message);
    }
}

function scheduleGuardedTimeout(groupId, delayMs, callback, client, pauseMatch = true) {
    const timer = setTimeout(() => {
        try {
            callback();
        } catch (error) {
            console.error('[WORD FORGE TIMER] Scheduled action failed:', error.message);
            const game = activeGames.get(groupId);
            if (pauseMatch && game) {
                game.phase = 'PAUSED';
                clearGameTimers(groupId);
                try {
                    wordForgeDB.saveMatch(groupId, game);
                } catch (saveError) {
                    console.error('[WORD FORGE DB] Could not persist paused match:', saveError.message);
                }
            }
            safeSend(client, groupId, pauseMatch
                ? '⚠️ Word Forge paused after an internal timer error. The last saved match state is preserved.'
                : '⚠️ A Word Forge steal timer failed; no match state was changed.');
        }
    }, Math.max(0, delayMs));
    if (timer.unref) timer.unref();
    return timer;
}

function saveGame(game, client) {
    try {
        wordForgeDB.saveMatch(game.groupId, game);
        return true;
    } catch (error) {
        console.error('[WORD FORGE DB] Could not save match state:', error.message);
        game.phase = 'PAUSED';
        clearGameTimers(game.groupId);
        safeSend(client, game.groupId,
            '⚠️ Word Forge has paused because its score database could not be saved. The last saved match state is preserved.');
        return false;
    }
}

function registerPlayer(game, bundle, name) {
    const player = makePlayer(game, bundle, name);
    game.players[player.id] = player;
    game.playerOrder.push(player.id);
    return player;
}

function startWordForgeLobby(groupId, playerId, userName, client, aliases) {
    if (!groupId || !String(groupId).endsWith('@g.us')) {
        return '⚠️ Word Forge lobbies can only be started in a group chat.';
    }
    if (activeGames.has(groupId)) {
        return '⚠️ A Word Forge lobby or match is already active in this group.';
    }

    const bundle = identityBundle(playerId, aliases);
    if (!bundle.canonical) return '❌ I could not identify the host for Word Forge.';
    if (findPlayerInAnyMatch(bundle)) {
        return '⚠️ You are already registered in another active Word Forge match.';
    }

    const game = createMatch(groupId, bundle.canonical, userName, bundle);
    activeGames.set(groupId, game);
    if (!saveGame(game, client)) {
        activeGames.delete(groupId);
        return '❌ Word Forge could not open because its database is unavailable.';
    }

    safeSend(client, bundle.canonical,
        'Your private Word Forge leaderboard ID is *' + game.players[bundle.canonical].anonymousId +
        '*; only you will know this ID until the final reveal.');

    const timerSet = getTimerSet(groupId);
    timerSet.lobby = scheduleGuardedTimeout(groupId, LOBBY_DURATION_MS, () => {
        const current = activeGames.get(groupId);
        if (current !== game || current.phase !== 'LOBBY') return;
        cancelMatch(groupId, client, '⌛ The Word Forge lobby expired before the host started the match.');
    }, client);
    if (timerSet.lobby.unref) timerSet.lobby.unref();

    return '⚒️ WORD FORGE LOBBY OPEN!\n\n' +
        '*' + safeName(userName) + '* is registered.\n' +
        'Players: use !joinforge to register (2–10 players).\n' +
        'Host: use !startforge when ready.\n\n' +
        'The match has 8 rounds. Each round lasts up to 90 seconds, followed by a 10-second anonymous break leaderboard. ' +
        'Every player receives a different rack and rule privately in DM. A word must be in the English dictionary, use rack letters no more times than shown, and obey your rule. ' +
        'Wrong guesses score zero but may be retried; the first valid word locks your round. Score is 10 per letter plus up to 20 speed points.';
}

function joinWordForgeLobby(groupId, playerId, userName, client, aliases) {
    const game = activeGames.get(groupId);
    if (!game) return '❌ There is no Word Forge lobby in this group. Start one with !wordforge.';
    if (game.phase !== 'LOBBY') return '⚠️ This Word Forge match has already started.';
    const bundle = identityBundle(playerId, aliases);
    if (!bundle.canonical) return '❌ I could not identify you for Word Forge.';

    const alreadyJoined = findPlayer(game, bundle);
    if (alreadyJoined) return '⚠️ You are already registered in this Word Forge match.';
    if (findPlayerInAnyMatch(bundle)) return '⚠️ You are already registered in another active Word Forge match.';
    if (game.playerOrder.length >= MAX_PLAYERS) return '❌ This Word Forge lobby is full (10 players maximum).';

    const player = registerPlayer(game, bundle, userName);
    if (!saveGame(game, client)) {
        delete game.players[player.id];
        game.playerOrder.pop();
        return '❌ Your registration could not be saved. Please try again.';
    }

    safeSend(client, player.id,
        'Your private Word Forge leaderboard ID is *' + player.anonymousId +
        '*; only you will know this ID until the final reveal.');
    return '✅ *' + player.name + '* joined Word Forge. (' +
        game.playerOrder.length + '/' + MAX_PLAYERS + ')\n\nOnly the host can start with !startforge.';
}

function startWordForgeGame(groupId, senderId, client, aliases) {
    const game = activeGames.get(groupId);
    if (!game) return '❌ No Word Forge lobby is open in this group.';
    if (game.phase !== 'LOBBY') return '⚠️ The Word Forge match has already started.';
    const bundle = identityBundle(senderId, aliases);
    if (!matchesIdentity(game.players[game.hostId], bundle)) return '❌ Only the host can start this Word Forge match.';
    if (game.playerOrder.length < MIN_PLAYERS) return '❌ At least 2 players are required to start Word Forge.';

    clearTimer(getTimerSet(groupId), 'lobby');
    game.phase = 'ACTIVE';
    startRound(game, client);
    if (game.phase !== 'ACTIVE') return '❌ Word Forge could not start because its database is unavailable.';
    return '⚒️ Word Forge is starting. Check your DM for your private rack and round rule.';
}

function shuffled(values) {
    const result = values.slice();
    for (let index = result.length - 1; index > 0; index--) {
        const swap = randomIndex(index + 1);
        [result[index], result[swap]] = [result[swap], result[index]];
    }
    return result;
}

function countVowels(word) {
    let total = 0;
    for (const letter of word) if (VOWELS.has(letter)) total++;
    return total;
}

function chooseRule(seed) {
    const containsLetter = seed[randomIndex(seed.length)];
    const options = [
        { kind: 'starts', value: seed[0], label: 'Your word must start with ' + seed[0].toUpperCase() + '.' },
        { kind: 'ends', value: seed[seed.length - 1], label: 'Your word must end with ' + seed[seed.length - 1].toUpperCase() + '.' },
        { kind: 'contains', value: containsLetter, label: 'Your word must include the letter ' + containsLetter.toUpperCase() + '.' }
    ];

    if (seed.length >= 4) options.push({ kind: 'minLength', value: 4, label: 'Your word must be at least 4 letters long.' });
    if (seed.length >= 5) options.push({ kind: 'minLength', value: 5, label: 'Your word must be at least 5 letters long.' });
    if (seed.length >= 6) options.push({ kind: 'minLength', value: 6, label: 'Your word must be at least 6 letters long.' });
    if (countVowels(seed) >= 2) options.push({ kind: 'vowels', value: 2, label: 'Your word must contain at least 2 vowels.' });
    return randomItem(options);
}

function createPuzzle(usedSeeds, usedSignatures) {
    for (let attempt = 0; attempt < 100; attempt++) {
        const seed = randomItem(wordList);
        if (usedSeeds.has(seed)) continue;
        const rule = chooseRule(seed);
        const rack = shuffled(seed.split('').concat(
            Array.from({ length: 8 - seed.length }, () => LETTER_POOL[randomIndex(LETTER_POOL.length)])
        )).join('').toUpperCase();
        const signature = rack.split('').sort().join('') + ':' + rule.kind + ':' + rule.value;
        if (usedSignatures.has(signature)) continue;
        usedSeeds.add(seed);
        usedSignatures.add(signature);
        return { rack, rule };
    }

    const fallback = wordList.find(word => !usedSeeds.has(word)) || randomItem(wordList);
    const rule = { kind: 'minLength', value: 3, label: 'Your word must be at least 3 letters long.' };
    const rack = shuffled(fallback.split('').concat(
        Array.from({ length: 8 - fallback.length }, () => LETTER_POOL[randomIndex(LETTER_POOL.length)])
    )).join('').toUpperCase();
    usedSeeds.add(fallback);
    usedSignatures.add(rack.split('').sort().join('') + ':' + rule.kind + ':' + rule.value);
    return { rack, rule };
}

function wordUsesRack(word, rack) {
    const available = Object.create(null);
    for (const letter of rack.toLowerCase()) available[letter] = (available[letter] || 0) + 1;
    for (const letter of word) {
        if (!available[letter]) return false;
        available[letter]--;
    }
    return true;
}

function followsRule(word, rule) {
    if (!rule) return false;
    if (rule.kind === 'starts') return word.startsWith(rule.value);
    if (rule.kind === 'ends') return word.endsWith(rule.value);
    if (rule.kind === 'contains') return word.includes(rule.value);
    if (rule.kind === 'minLength') return word.length >= rule.value;
    if (rule.kind === 'vowels') return countVowels(word) >= rule.value;
    return false;
}

function validateWord(text, puzzle) {
    const word = String(text || '').trim().toLowerCase();
    if (!/^[a-z]{3,8}$/.test(word)) return { valid: false, reason: 'length' };
    if (!dictionary.has(word)) return { valid: false, reason: 'dictionary' };
    if (!wordUsesRack(word, puzzle.rack)) return { valid: false, reason: 'rack' };
    if (!followsRule(word, puzzle.rule)) return { valid: false, reason: 'rule' };
    return { valid: true, word };
}

function calculatePoints(wordLength, elapsedMs) {
    const speedBonus = Math.max(0, Math.floor((1 - Math.max(0, elapsedMs) / ROUND_DURATION_MS) * 20));
    return { base: wordLength * 10, speedBonus, total: wordLength * 10 + speedBonus };
}

function sendPuzzleToPlayer(game, player, client, resumed) {
    const roundLabel = game.tiebreakCandidates ? 'SUDDEN DEATH' : 'ROUND ' + game.currentRound + '/' + MAX_ROUNDS;
    const text = '⚒️ *WORD FORGE — ' + roundLabel + '*\n' +
        '━━━━━━━━━━━━━━━━━━━━\n\n' +
        'Your anonymous ID: *' + player.anonymousId + '*\n' +
        'Letter rack: *' + player.puzzle.rack + '*\n' +
        'Round rule: *' + player.puzzle.rule.label + '*\n\n' +
        'Send one word only in this DM. Your word must be in the English dictionary, use only these letters, never more times than they appear in your rack; you do not need to use every tile, and follow the rule above.\n' +
        'The first valid word locks your score. Wrong guesses earn 0 points, but you may try again.\n' +
        'Score: 10 points per letter + up to 20 speed points.\n' +
        'Time remaining: ' + Math.max(1, Math.ceil((game.roundEndsAt - Date.now()) / 1000)) + ' seconds.' +
        (resumed ? '\n\nThe match resumed after a bot restart.' : '');
    safeSend(client, player.id, text);
}

function startRound(game, client, resumed) {
    if (!game || activeGames.get(game.groupId) !== game || game.phase === 'PAUSED') return;
    clearRoundTimers(game.groupId);

    game.currentRound++;
    if (game.tiebreakCandidates) game.tiebreakCount++;
    game.phase = 'ACTIVE';
    game.roundStartedAt = Date.now();
    game.roundEndsAt = game.roundStartedAt + ROUND_DURATION_MS;
    game.breakEndsAt = null;

    const usedSeeds = new Set();
    const usedSignatures = new Set();
    const eligible = new Set(game.tiebreakCandidates || game.playerOrder);
    for (const playerId of game.playerOrder) {
        const player = game.players[playerId];
        player.roundSolved = false;
        player.roundGuess = null;
        player.roundPoints = 0;
        player.roundElapsedMs = null;
        player.puzzle = eligible.has(playerId) ? createPuzzle(usedSeeds, usedSignatures) : null;
    }

    const result = {
        round: game.currentRound,
        suddenDeath: Boolean(game.tiebreakCandidates),
        ruleLabels: Object.fromEntries(game.playerOrder.map(id => [id, game.players[id].puzzle ? game.players[id].puzzle.rule.label : null])),
        results: {}
    };
    game.roundResults.push(result);

    if (!saveGame(game, client)) return;

    const roundLabel = game.tiebreakCandidates
        ? 'SUDDEN DEATH'
        : 'ROUND ' + game.currentRound + '/' + MAX_ROUNDS;
    safeSend(client, game.groupId,
        '⚒️ *WORD FORGE — ' + roundLabel + ' IS LIVE!*\n\n' +
        'Registered players: go to your DM with the bot for your private rack and rule.\n' +
        'Every player has a different puzzle. Send one word per message; wrong guesses score 0 and can be retried.\n' +
        'Your first valid word locks your round. The round lasts up to 90 seconds and may end early when everyone eligible is locked.\n' +
        'I will post everyone’s current situation at the 30-second and 60-second marks.');

    for (const playerId of game.playerOrder) {
        const player = game.players[playerId];
        if (player.puzzle) sendPuzzleToPlayer(game, player, client, resumed);
    }

    scheduleRound(game, client);
}

function scheduleRound(game, client) {
    const groupId = game.groupId;
    const timerSet = getTimerSet(groupId);
    const roundNumber = game.currentRound;
    const startedAt = game.roundStartedAt;
    const elapsed = Date.now() - startedAt;

    for (const mark of [30 * 1000, 60 * 1000]) {
        if (elapsed < mark) {
            const timer = scheduleGuardedTimeout(groupId, mark - Math.max(0, elapsed), () => {
                if (activeGames.get(groupId) !== game || game.phase !== 'ACTIVE' || game.currentRound !== roundNumber) return;
                postRoundStatus(game, client, mark);
            }, client);
            if (timer.unref) timer.unref();
            timerSet.comments.push(timer);
        }
    }

    const remaining = game.roundEndsAt - Date.now();
    if (remaining <= 0) {
        endRound(game, client, '⏰ Time is up.');
        return;
    }

    timerSet.round = scheduleGuardedTimeout(groupId, remaining, () => {
        if (activeGames.get(groupId) !== game || game.phase !== 'ACTIVE' || game.currentRound !== roundNumber) return;
        endRound(game, client, '⏰ Time is up.');
    }, client);
    if (timerSet.round.unref) timerSet.round.unref();
}

function postRoundStatus(game, client, elapsedMs) {
    const rows = [];
    const eligible = new Set(game.tiebreakCandidates || game.playerOrder);
    for (const playerId of game.playerOrder) {
        const player = game.players[playerId];
        if (!eligible.has(playerId)) {
            rows.push('• *' + player.name + '* — watching sudden death');
        } else if (player.roundSolved) {
            rows.push('• *' + player.name + '* — 🔒 valid word submitted');
        } else {
            rows.push('• *' + player.name + '* — 🤔 still thinking');
        }
    }

    const seconds = Math.round(elapsedMs / 1000);
    safeSend(client, game.groupId,
        '📡 *ROUND STATUS — ' + seconds + ' SECONDS*\n' +
        rows.join('\n') + '\n\n' +
        randomItem(FLAVOR_LINES));
}

function buildBreakLeaderboard(match, roundNumber) {
    const record = (match.roundResults || []).find(item => item.round === roundNumber);
    const results = record && record.results ? Object.values(record.results) : [];
    results.sort((a, b) => (b.points || 0) - (a.points || 0) ||
        (a.elapsedMs === null ? Number.MAX_SAFE_INTEGER : a.elapsedMs) -
        (b.elapsedMs === null ? Number.MAX_SAFE_INTEGER : b.elapsedMs));

    const rows = results.map((result, index) => {
        const guess = result.guess ? '“' + result.guess.toUpperCase() + '”' : 'no valid word';
        return (index + 1) + '. *' + result.anonymousId + '* — ' + guess + ' — +' + (result.points || 0) + ' pts';
    });

    return '📊 *ANONYMOUS ROUND LEADERBOARD — ROUND ' + roundNumber + '*\n' +
        '━━━━━━━━━━━━━━━━━━━━\n' +
        (rows.join('\n') || 'No guesses were recorded.') +
        '\n\nNext round begins in 10 seconds. Check your DM when it starts.';
}

function endRound(game, client, reason) {
    if (!game || activeGames.get(game.groupId) !== game || game.phase !== 'ACTIVE') return;
    const groupId = game.groupId;
    clearRoundTimers(groupId);
    game.phase = 'BREAK';
    game.roundEndsAt = null;
    game.breakEndsAt = Date.now() + BREAK_DURATION_MS;

    const result = game.roundResults[game.roundResults.length - 1];
    for (const playerId of game.playerOrder) {
        const player = game.players[playerId];
        if (!result.results[playerId]) {
            result.results[playerId] = {
                anonymousId: player.anonymousId,
                guess: player.roundGuess,
                points: player.roundPoints || 0,
                elapsedMs: player.roundElapsedMs,
                solved: Boolean(player.roundSolved)
            };
        }
    }

    if (!saveGame(game, client)) return;

    const savedMatch = wordForgeDB.getMatch(groupId);
    const leaderboard = buildBreakLeaderboard(savedMatch || game, game.currentRound);
    safeSend(client, groupId,
        (reason ? reason + '\n\n' : '') + leaderboard);

    for (const playerId of game.playerOrder) {
        const player = game.players[playerId];
        const resultForPlayer = result.results[playerId];
        const points = resultForPlayer ? resultForPlayer.points : 0;
        safeSend(client, player.id,
            '🧾 *ROUND ' + game.currentRound + ' PRIVATE SCORE*\n' +
            'ID: ' + player.anonymousId + '\n' +
            'Your word: ' + (resultForPlayer && resultForPlayer.guess ? resultForPlayer.guess.toUpperCase() : 'no valid word') + '\n' +
            'Round points: +' + points + '\n' +
            'Match total: ' + player.score + ' pts.');
    }

    const timerSet = getTimerSet(groupId);
    const roundNumber = game.currentRound;
    timerSet.break = scheduleGuardedTimeout(groupId, BREAK_DURATION_MS, () => {
        if (activeGames.get(groupId) !== game || game.phase !== 'BREAK' || game.currentRound !== roundNumber) return;
        advanceAfterBreak(game, client);
    }, client);
    if (timerSet.break.unref) timerSet.break.unref();
}

function ranking(players) {
    return players.slice().sort((a, b) =>
        (b.score || 0) - (a.score || 0) ||
        (b.solvedRounds || 0) - (a.solvedRounds || 0) ||
        (a.cumulativeSolveMs || 0) - (b.cumulativeSolveMs || 0)
    );
}

function topTie(players) {
    const ordered = ranking(players);
    if (ordered.length < 2) return ordered;
    return ordered.filter(player =>
        player.score === ordered[0].score &&
        player.solvedRounds === ordered[0].solvedRounds &&
        player.cumulativeSolveMs === ordered[0].cumulativeSolveMs
    );
}

function advanceAfterBreak(game, client) {
    if (activeGames.get(game.groupId) !== game || game.phase !== 'BREAK') return;
    clearTimer(getTimerSet(game.groupId), 'break');

    if (!game.tiebreakCandidates && game.currentRound < MAX_ROUNDS) {
        startRound(game, client);
        return;
    }

    if (!game.tiebreakCandidates) {
        const tied = topTie(game.playerOrder.map(id => game.players[id]));
        if (tied.length <= 1) {
            finishMatch(game, client, tied[0] || null);
            return;
        }
        game.tiebreakCandidates = tied.map(player => player.id);
        game.tiebreakCount = 0;
        safeSend(client, game.groupId,
            '⚖️ The final leaderboard is tied after the score and speed tie-breaks. The tied players will enter sudden death.');
        if (!saveGame(game, client)) return;
        startRound(game, client);
        return;
    }

    const candidates = game.tiebreakCandidates.map(id => game.players[id]).filter(Boolean);
    const tied = topTie(candidates);
    if (tied.length <= 1) {
        finishMatch(game, client, tied[0] || null);
        return;
    }

    if (game.tiebreakCount >= MAX_TIEBREAK_ROUNDS) {
        finishMatch(game, client, tied[randomIndex(tied.length)] || tied[0]);
        return;
    }

    safeSend(client, game.groupId, '⚖️ Sudden death is still tied. One more tiebreak round starts now.');
    startRound(game, client);
}

function buildFinalLeaderboard(game, winner) {
    const ordered = ranking(game.playerOrder.map(id => game.players[id]));
    const rows = ordered.map((player, index) =>
        (index + 1) + '. *' + player.name + '* (' + player.anonymousId + ') — ' +
        player.score + ' pts, ' + player.solvedRounds + ' valid rounds'
    );

    const details = [];
    for (const player of ordered) {
        const guesses = (game.roundResults || []).map(result => {
            const entry = result.results && result.results[player.id];
            const label = result.suddenDeath ? 'SD' + (result.round - MAX_ROUNDS) : 'R' + result.round;
            if (!entry || !entry.guess) return label + ': — (0)';
            return label + ': ' + entry.guess.toUpperCase() + ' (+' + entry.points + ')';
        });
        details.push('*' + player.name + '* [' + player.anonymousId + ']: ' + guesses.join(' · '));
    }

    let message = '🏆 *WORD FORGE — FINAL LEADERBOARD*\n' +
        '━━━━━━━━━━━━━━━━━━━━\n' +
        (rows.join('\n') || 'No players scored.') +
        '\n\n🔎 *FULL MATCH REVEAL*\n' + details.join('\n');

    if (winner && winner.score > 0) {
        message += '\n\n👑 *' + winner.name + '* is the match winner and has 120 seconds to steal 25% of one losing registered player’s wallet.\n' +
            'Use !steal @user in this group.';
    } else {
        message += '\n\nNo player scored, so no steal is unlocked.';
    }
    return message;
}

function scheduleStealExpiry(winnerId, steal, client) {
    const timerSet = getTimerSet(steal.groupId);
    const timer = scheduleGuardedTimeout(steal.groupId, steal.expiresAt - Date.now(), () => {
        const current = wordForgeDB.getPendingSteal(winnerId);
        if (!current || current.expiresAt !== steal.expiresAt) return;
        try {
            wordForgeDB.removePendingSteal(winnerId);
        } catch (error) {
            console.error('[WORD FORGE DB] Could not expire a steal:', error.message);
        }
        safeSend(client, steal.groupId, '⌛ ' + steal.winnerName + '’s Word Forge steal window has expired.');
    }, client, false);
    if (timer.unref) timer.unref();
    timerSet.steal.push(timer);
}

function finishMatch(game, client, winner) {
    if (!game || activeGames.get(game.groupId) !== game || game.phase === 'COMPLETE') return;
    clearGameTimers(game.groupId);
    game.phase = 'COMPLETE';
    game.completedAt = Date.now();

    let pendingSteal = null;
    if (winner && winner.score > 0) {
        pendingSteal = {
            id: 'WFSTEAL-' + game.id,
            groupId: game.groupId,
            winnerId: winner.id,
            winnerName: winner.name,
            aliases: winner.identityAliases || [],
            eligiblePlayers: game.playerOrder
                .filter(id => id !== winner.id)
                .map(id => ({
                    id,
                    aliases: game.players[id].identityAliases || []
                })),
            expiresAt: Date.now() + STEAL_WINDOW_MS
        };
    }

    try {
        wordForgeDB.archiveMatch(game.groupId, game, pendingSteal);
    } catch (error) {
        console.error('[WORD FORGE DB] Could not archive completed match:', error.message);
        game.phase = 'PAUSED';
        activeGames.set(game.groupId, game);
        safeSend(client, game.groupId, '⚠️ Word Forge could not save the final results. The match remains paused for recovery.');
        return;
    }

    activeGames.delete(game.groupId);
    for (const playerId of game.playerOrder) {
        const player = game.players[playerId];
        for (const alias of player.identityAliases || []) identityAliases.delete(alias);
        identityAliases.delete(player.id);
    }

    safeSend(client, game.groupId, buildFinalLeaderboard(game, winner));
    if (pendingSteal) {
        scheduleStealExpiry(pendingSteal.id, pendingSteal, client);
    }
}

function cancelMatch(groupId, client, reason) {
    const game = activeGames.get(groupId);
    if (!game) return false;
    clearGameTimers(groupId);
    game.phase = 'CANCELLED';
    game.completedAt = Date.now();

    try {
        wordForgeDB.archiveMatch(groupId, game);
    } catch (error) {
        console.error('[WORD FORGE DB] Could not archive cancelled match:', error.message);
        game.phase = 'PAUSED';
        activeGames.set(groupId, game);
        try {
            wordForgeDB.saveMatch(groupId, game);
        } catch (saveError) {
            console.error('[WORD FORGE DB] Could not persist paused cancelled match:', saveError.message);
        }
        safeSend(client, groupId, '⚠️ Word Forge could not safely archive this match, so it remains paused. Try !stopforge again later.');
        return false;
    }

    activeGames.delete(groupId);
    safeSend(client, groupId, reason || '🛑 Word Forge has been stopped.');
    return true;
}

function stopWordForgeGame(groupId, senderId, client, aliases) {
    const game = activeGames.get(groupId);
    if (!game) return '❌ There is no active Word Forge match in this group.';
    const bundle = identityBundle(senderId, aliases);
    if (!matchesIdentity(game.players[game.hostId], bundle)) return '❌ Only the host can stop this Word Forge match.';
    const stopped = cancelMatch(groupId, client, '🛑 The host stopped this Word Forge match.');
    return stopped ? '🛑 Word Forge stopped.' : '⚠️ Word Forge could not be stopped safely; its state is paused.';
}

function processWordForgeDmMessage(senderId, senderContact, text, client) {
    const body = String(text || '').trim();
    if (!/^[A-Za-z]+$/.test(body)) return { handled: false };

    let bundle = identityBundle(senderId, [senderContact], false);
    const found = findPlayerInAnyMatch(bundle);
    if (!found) return { handled: false };
    bundle = identityBundle(senderId, [senderContact], true);

    const game = found.game;
    const player = found.player;
    if (game.phase === 'LOBBY') return { handled: false };

    if (game.phase === 'PAUSED') {
        return { handled: true, response: '⚠️ Word Forge is temporarily paused while the bot recovers its saved game state.' };
    }
    if (game.phase === 'BREAK') {
        return { handled: true, response: '⏳ This round has ended. Your next private rack will arrive when the 10-second break ends.' };
    }
    if (game.phase !== 'ACTIVE') return { handled: false };

    if (game.tiebreakCandidates && !game.tiebreakCandidates.includes(player.id)) {
        return { handled: true, response: '⚖️ You are watching this sudden-death round; your private guess is not active.' };
    }
    if (player.roundSolved) {
        return { handled: true, response: '🔒 You already submitted a valid word this round. Your score is locked.' };
    }
    if (Date.now() >= game.roundEndsAt) {
        endRound(game, client, '⏰ Time is up.');
        return { handled: true, response: '⏰ That round has ended. Check the group for the anonymous break leaderboard.' };
    }

    const validation = validateWord(body, player.puzzle);
    if (!validation.valid) {
        let response;
        if (validation.reason === 'dictionary') {
            response = '❌ That is not in the English dictionary. No points; try another single word.';
        } else if (validation.reason === 'rack') {
            response = '❌ Those letters are not available in your rack. No points; try another word.';
        } else if (validation.reason === 'rule') {
            response = '❌ That word breaks your round rule: ' + player.puzzle.rule.label + ' No points; try another word.';
        } else {
            response = '❌ Use a single 3–8 letter word. No points; try again.';
        }
        return { handled: true, response };
    }

    const previousPlayerState = {
        score: player.score,
        solvedRounds: player.solvedRounds,
        cumulativeSolveMs: player.cumulativeSolveMs,
        roundSolved: player.roundSolved,
        roundGuess: player.roundGuess,
        roundPoints: player.roundPoints,
        roundElapsedMs: player.roundElapsedMs
    };
    const elapsedMs = Math.max(0, Date.now() - game.roundStartedAt);
    const score = calculatePoints(validation.word.length, elapsedMs);
    player.roundSolved = true;
    player.roundGuess = validation.word;
    player.roundPoints = score.total;
    player.roundElapsedMs = elapsedMs;
    player.score += score.total;
    player.solvedRounds++;
    player.cumulativeSolveMs += elapsedMs;

    const result = game.roundResults[game.roundResults.length - 1];
    result.results[player.id] = {
        anonymousId: player.anonymousId,
        guess: validation.word,
        points: score.total,
        elapsedMs,
        solved: true
    };

    if (!saveGame(game, client)) {
        player.score = previousPlayerState.score;
        player.solvedRounds = previousPlayerState.solvedRounds;
        player.cumulativeSolveMs = previousPlayerState.cumulativeSolveMs;
        player.roundSolved = previousPlayerState.roundSolved;
        player.roundGuess = previousPlayerState.roundGuess;
        player.roundPoints = previousPlayerState.roundPoints;
        player.roundElapsedMs = previousPlayerState.roundElapsedMs;
        delete result.results[player.id];
        return { handled: true, response: '⚠️ The score database failed, so this guess was not saved or scored. The match has been paused.' };
    }

    const reply = '✅ *VALID WORD — SCORE LOCKED*\n\n' +
        'Word: *' + validation.word.toUpperCase() + '*\n' +
        'ID: ' + player.anonymousId + '\n' +
        'Points: +' + score.base + ' word points' +
        (score.speedBonus ? ' + ' + score.speedBonus + ' speed points' : '') +
        ' = *' + score.total + '*\n' +
        'Match total: ' + player.score + ' pts.\n\n' +
        'You are locked for this round.';
    if ((game.tiebreakCandidates || game.playerOrder).every(id => game.players[id].roundSolved)) {
        endRound(game, client, '✅ Everyone eligible has locked a valid word. The round ends early.');
    }
    return { handled: true, response: reply };
}

function handleWordForgeStealCommand(groupId, senderId, mentionedJid, client, senderContact) {
    const bundle = identityBundle(senderId, [senderContact], false);
    const winnerId = bundle.canonical;
    if (!winnerId) return null;

    const pendingEntries = Object.entries(wordForgeDB.loadPendingSteals())
        .filter(([, candidate]) =>
            candidate.winnerId === winnerId ||
            (candidate.aliases || []).some(alias => bundle.aliases.includes(alias))
        )
        .sort((a, b) => a[1].expiresAt - b[1].expiresAt);
    const selected = pendingEntries.find(([, candidate]) => candidate.groupId === groupId);
    if (!selected) return null;

    const pendingKey = selected[0];
    const steal = selected[1];
    if (Date.now() >= steal.expiresAt) {
        try {
            wordForgeDB.removePendingSteal(pendingKey);
        } catch (error) {
            console.error('[WORD FORGE DB] Could not remove expired steal:', error.message);
        }
        return '⌛ Your Word Forge steal window has expired.';
    }
    if (!mentionedJid) return '⚠️ Tag the losing player you want to steal from.';

    const targetBundle = identityBundle(mentionedJid, [], false);
    const eligible = (steal.eligiblePlayers || []).find(player =>
        player.id === targetBundle.canonical ||
        (player.aliases || []).some(alias => targetBundle.aliases.includes(alias))
    );
    if (!eligible) return null;

    const balance = getBalance(eligible.id);
    const amount = Math.floor(balance * STEAL_FRACTION);
    if (amount <= 0) return '💸 That player has too few coins for a 25% steal. Your steal chance is still available.';

    const winnerBalanceBefore = getBalance(winnerId);
    try {
        wordForgeDB.removePendingSteal(pendingKey);
    } catch (error) {
        console.error('[WORD FORGE DB] Could not claim steal:', error.message);
        return '❌ The steal could not be safely claimed. No wallet was changed.';
    }

    let transfer;
    try {
        transfer = transferCoins(eligible.id, winnerId, amount);
    } catch (error) {
        console.error('[WORD FORGE] Wallet transfer failed:', error.message);
        try {
            wordForgeDB.savePendingSteal(pendingKey, steal);
        } catch (restoreError) {
            console.error('[WORD FORGE DB] Could not restore failed steal:', restoreError.message);
        }
        return '❌ The wallet transfer failed. Your steal chance remains available.';
    }

    const victimBalanceAfter = getBalance(eligible.id);
    const winnerBalanceAfter = getBalance(winnerId);
    if (!transfer.success ||
        victimBalanceAfter !== balance - amount ||
        winnerBalanceAfter !== winnerBalanceBefore + amount) {
        try {
            wordForgeDB.savePendingSteal(pendingKey, steal);
        } catch (error) {
            console.error('[WORD FORGE DB] Could not restore an uncompleted steal:', error.message);
        }
        return (transfer && transfer.message) ||
            '❌ The wallet transfer could not be confirmed. Your steal chance remains available.';
    }

    return '🥷 *WORD FORGE STEAL COMPLETE!*\n\nYou stole *' + amount + ' coins* (25%) from @' +
        String(eligible.id).split('@')[0] + '.';
}

function resolveStealTimer(winnerId, steal, client) {
    scheduleStealExpiry(winnerId, steal, client);
}

function restoreWordForgeGames(client) {
    if (gamesRestored) return;
    gamesRestored = true;
    for (const game of wordForgeDB.loadActiveMatches()) {
        if (!game || !game.groupId || !game.players || !game.playerOrder) continue;
        game.timers = null;
        activeGames.set(game.groupId, game);
        if (game.phase === 'LOBBY') {
            const delay = game.lobbyExpiresAt - Date.now();
            if (delay <= 0) {
                cancelMatch(game.groupId, client, '⌛ The Word Forge lobby expired while the bot was offline.');
            } else {
                const timerSet = getTimerSet(game.groupId);
                timerSet.lobby = scheduleGuardedTimeout(game.groupId, delay, () => {
                    if (activeGames.get(game.groupId) === game && game.phase === 'LOBBY') {
                        cancelMatch(game.groupId, client, '⌛ The Word Forge lobby expired before the host started the match.');
                    }
                }, client);
                if (timerSet.lobby.unref) timerSet.lobby.unref();
            }
        } else if (game.phase === 'ACTIVE') {
            if ((game.tiebreakCandidates || game.playerOrder).every(id => game.players[id].roundSolved)) {
                endRound(game, client, '✅ Everyone eligible had already locked a valid word before restart.');
            } else {
                scheduleRound(game, client);
                if (game.phase === 'ACTIVE') {
                    for (const playerId of game.playerOrder) {
                        const player = game.players[playerId];
                        if (player.puzzle && !player.roundSolved) sendPuzzleToPlayer(game, player, client, true);
                    }
                }
            }
        } else if (game.phase === 'BREAK') {
            const delay = game.breakEndsAt - Date.now();
            if (delay <= 0) advanceAfterBreak(game, client);
            else {
                const timerSet = getTimerSet(game.groupId);
                timerSet.break = scheduleGuardedTimeout(game.groupId, delay, () => {
                    if (activeGames.get(game.groupId) === game && game.phase === 'BREAK') {
                        advanceAfterBreak(game, client);
                    }
                }, client);
                if (timerSet.break.unref) timerSet.break.unref();
            }
        }
    }

    for (const [winnerId, steal] of Object.entries(wordForgeDB.loadPendingSteals())) {
        if (!steal || !steal.expiresAt) continue;
        if (steal.expiresAt <= Date.now()) {
            try { wordForgeDB.removePendingSteal(winnerId); } catch (error) {
                console.error('[WORD FORGE DB] Could not prune expired steal:', error.message);
            }
        } else {
            resolveStealTimer(winnerId, steal, client);
        }
    }
}

module.exports = {
    startWordForgeLobby,
    joinWordForgeLobby,
    startWordForgeGame,
    stopWordForgeGame,
    processWordForgeDmMessage,
    handleWordForgeStealCommand,
    restoreWordForgeGames,
    _test: {
        validateWord,
        wordUsesRack,
        followsRule,
        calculatePoints,
        createPuzzle,
        dictionary
    }
};
