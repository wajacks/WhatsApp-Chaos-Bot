const crypto = require('crypto');
const { claimGame, releaseGame } = require('./gameRegistry');

const activeGames = new Map();
const GLOBAL_MIN = 0;
const GLOBAL_MAX = 150;
const RANGE_SPAN_PER_PLAYER = 20;
const MAX_RANGE_SPAN = 140;
const MIN_PLAYERS = 2;
const MIN_WIN_POINTS = 3;

const FALLBACK_BANTER = [
    'A tiny committee of spoons has reviewed your confidence and requested a second haunting.',
    'The wallpaper is quietly rooting for your calculator.',
    'A very polite ghost has filed paperwork about your aura.',
    'Somewhere, a lamp is rehearsing your apology.',
    'The number has hired a small lawyer. We cannot discuss the ankle.'
];

function randomInt(min, max) {
    return crypto.randomInt(min, max + 1);
}

function randomItem(items) {
    return items[randomInt(0, items.length - 1)];
}

function shuffle(values) {
    const result = values.slice();
    for (let index = result.length - 1; index > 0; index--) {
        const swapIndex = randomInt(0, index);
        [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
    }
    return result;
}

function getStartingRange(playerCount) {
    const span = Math.min(MAX_RANGE_SPAN, RANGE_SPAN_PER_PLAYER * playerCount);
    const low = randomInt(GLOBAL_MIN, GLOBAL_MAX - span);
    return { low, high: low + span };
}

function chooseTarget(game) {
    const unused = [];
    for (let value = game.low; value <= game.high; value++) {
        if (!game.usedNumbers.has(value)) unused.push(value);
    }

    const candidates = unused.length > 0
        ? unused
        : Array.from({ length: game.high - game.low + 1 }, (_, index) => game.low + index);
    const target = randomItem(candidates);
    game.usedNumbers.add(target);
    return target;
}

function makePlayer(id, name) {
    return {
        id,
        name: String(name || 'Player').trim() || 'Player',
        score: 0,
        roundsWon: 0,
        totalMisses: 0,
        missRemainder: 0,
        roundDelta: 0,
        cyclesStarted: 0
    };
}

function getPlayers(game) {
    return Array.from(game.players.values());
}

function createCycleOrder(game) {
    const players = getPlayers(game);
    const fewestStarts = Math.min(...players.map(player => player.cyclesStarted));
    const eligibleStarters = players.filter(player => player.cyclesStarted === fewestStarts);
    const first = randomItem(eligibleStarters);
    first.cyclesStarted += 1;

    const rest = shuffle(players.filter(player => player.id !== first.id));
    return [first].concat(rest);
}

function getBanterLine(generateBanter, player) {
    if (typeof generateBanter !== 'function') {
        return Promise.resolve(randomItem(FALLBACK_BANTER));
    }

    return Promise.resolve()
        .then(() => generateBanter({
            playerName: player.name
        }))
        .then(value => {
            const line = String(value || '').replace(/[\r\n]+/g, ' ').trim();
            const unsafe = !line ||
                line.length > 180 ||
                /\d|\b(?:zero|one|two|three|four|five|six|seven|eight|nine|ten|higher|lower|above|below|warmer|colder|closer|answer|target|range|secret|guess)\b/i.test(line);
            return unsafe ? randomItem(FALLBACK_BANTER) : line;
        })
        .catch(error => {
            console.warn('[NUMBER RUN] AI banter failed:', error.message);
            return randomItem(FALLBACK_BANTER);
        });
}

async function beginCycle(game, generateBanter) {
    game.phase = 'TRANSITION';
    game.cycleNumber += 1;
    game.order = createCycleOrder(game);
    game.turnIndex = 0;

    const first = game.order[0];
    const banter = await getBanterLine(generateBanter, first);
    if (activeGames.get(game.groupId) !== game || game.phase === 'ENDED') return '';

    game.phase = 'ACTIVE';
    const lines = [];

    if (game.cycleNumber === 1) {
        lines.push('🔢 *NUMBER RUN — ROUND ' + game.roundNumber + '/' + game.totalRounds + '*');
        lines.push('The secret is between *' + game.low + '* and *' + game.high + '*.');
    } else {
        lines.push('🔄 *Cycle ' + game.cycleNumber + '* — the turn order has been reshuffled.');
    }

    lines.push('Current turn: *' + first.name + '*.');
    lines.push('🎭 *' + first.name + '*, ' + banter);
    lines.push('When ready, send a whole number on its own.');
    return lines.join('\n');
}

function formatSigned(value) {
    return value > 0 ? '+' + value : String(value);
}

function getLeaderboard(game) {
    return getPlayers(game).sort((left, right) =>
        right.score - left.score || left.name.localeCompare(right.name)
    );
}

function formatLeaderboard(game) {
    return getLeaderboard(game)
        .map((player, index) =>
            (index + 1) + '. *' + player.name + '* — ' + player.score + ' pts (' + player.roundsWon + ' solved)'
        )
        .join('\n');
}

function formatRoundChanges(game) {
    return getLeaderboard(game)
        .map(player => '*' + player.name + '* ' + formatSigned(player.roundDelta))
        .join(' · ');
}

function formatFinalResult(game) {
    const ranked = getLeaderboard(game);
    if (ranked.length === 0) return 'No scores were recorded.';

    const topScore = ranked[0].score;
    const winners = ranked.filter(player => player.score === topScore);
    const winnerText = winners.length === 1
        ? '🏆 *' + winners[0].name + '* wins the match!'
        : '🏆 Match tied: ' + winners.map(player => '*' + player.name + '*').join(', ') + '.';

    return '🏁 *NUMBER RUN COMPLETE*\n\n' + winnerText +
        '\n\n*Final leaderboard*\n' + formatLeaderboard(game);
}

function finishMatch(game) {
    game.phase = 'ENDED';
    activeGames.delete(game.groupId);
    releaseGame(game.groupId, 'numberrun');
}

async function beginNumberRound(game, generateBanter) {
    game.phase = 'TRANSITION';
    game.roundNumber += 1;
    const range = getStartingRange(game.playerCount);
    game.low = range.low;
    game.high = range.high;
    game.target = chooseTarget(game);
    game.cycleNumber = 0;
    game.order = [];
    game.turnIndex = 0;

    for (const player of game.players.values()) {
        player.roundDelta = 0;
    }

    return beginCycle(game, generateBanter);
}

function startNumberRunLobby(groupId, hostId, hostName) {
    if (!groupId || !String(groupId).endsWith('@g.us')) {
        return '⚠️ Number Run lobbies can only be opened in a group chat.';
    }
    if (activeGames.has(groupId)) {
        return '⚠️ A Number Run lobby or match is already active in this group.';
    }

    const claim = claimGame(groupId, 'numberrun');
    if (!claim.ok) return '⚠️ A ' + claim.activeGame + ' game is already active in this group.';

    activeGames.set(groupId, {
        groupId,
        hostId,
        hostName,
        phase: 'LOBBY',
        players: new Map(),
        playerCount: 0,
        totalRounds: 0,
        roundNumber: 0,
        cycleNumber: 0,
        order: [],
        turnIndex: 0,
        low: null,
        high: null,
        target: null,
        usedNumbers: new Set()
    });

    return '🔢 *NUMBER RUN LOBBY OPEN*\n\n' +
        '*' + hostName + '* is the host and must also join with !joinnumberrun.\n' +
        'Players: use !joinnumberrun (2 or more players).\n' +
        'The host starts with !startnumberrun or closes the lobby with !stopnumberrun.\n' +
        'No turn timer; each player gets one guess per turn.';
}

function joinNumberRunLobby(groupId, playerId, playerName) {
    const game = activeGames.get(groupId);
    if (!game || game.phase !== 'LOBBY') {
        return '❌ No Number Run lobby is open here. Start one with !numberrun.';
    }
    if (game.players.has(playerId)) return '⚠️ You already joined this Number Run lobby.';

    game.players.set(playerId, makePlayer(playerId, playerName));
    return '✅ *' + (playerName || 'Player') + '* joined Number Run (' +
        game.players.size + ' player(s)).';
}

async function startNumberRunGame(groupId, senderId, generateBanter) {
    const game = activeGames.get(groupId);
    if (!game || game.phase !== 'LOBBY') return '❌ No Number Run lobby is waiting to start.';
    if (senderId !== game.hostId) return '❌ Only the host can start this match.';
    if (!game.players.has(senderId)) return '❌ The host must join with !joinnumberrun before starting.';
    if (game.players.size < MIN_PLAYERS) return '❌ Number Run needs at least 2 registered players.';

    game.playerCount = game.players.size;
    game.totalRounds = game.playerCount + 2;

    return beginNumberRound(game, generateBanter);
}

function recordMiss(player) {
    player.totalMisses += 1;
    player.missRemainder += 1;

    if (player.missRemainder >= 2) {
        player.missRemainder = 0;
        player.score -= 1;
        player.roundDelta -= 1;
    }
}

function recordWin(game, player) {
    const points = Math.max(MIN_WIN_POINTS, game.playerCount);
    player.score += points;
    player.roundsWon += 1;
    player.roundDelta += points;
    return points;
}

async function processNumberRunGuess(groupId, senderId, messageText, generateBanter) {
    const game = activeGames.get(groupId);
    if (!game || game.phase === 'LOBBY') return null;

    const guessText = String(messageText || '').trim();
    if (!/^-?\d+$/.test(guessText)) return null;
    if (game.phase !== 'ACTIVE') return '⏳ The next Number Run turn is being prepared.';

    const player = game.players.get(senderId);
    if (!player) return '⚠️ Only registered Number Run players can guess.';

    const guess = Number(guessText);
    if (!Number.isSafeInteger(guess) || guess < game.low || guess > game.high) {
        return 'Choose a whole number from ' + game.low + ' to ' + game.high + '.';
    }

    const currentPlayer = game.order[game.turnIndex];
    if (!currentPlayer || currentPlayer.id !== senderId) {
        return '⏳ It is *' + (currentPlayer ? currentPlayer.name : 'another player') + '’s* turn.';
    }

    if (guess === game.target) {
        game.phase = 'TRANSITION';
        const points = recordWin(game, player);
        const solvedSummary =
            '🎯 *Correct!* ' + player.name + ' found ' + game.target + '.\n' +
            '🏅 +' + points + ' win points.\n' +
            '*This round:* ' + formatRoundChanges(game);

        if (game.roundNumber >= game.totalRounds) {
            finishMatch(game);
            return solvedSummary + '\n\n' + formatFinalResult(game);
        }

        const nextRound = await beginNumberRound(game, generateBanter);
        if (!nextRound) return solvedSummary;
        return solvedSummary + '\n*Match scores*\n' + formatLeaderboard(game) + '\n\n' + nextRound;
    }

    recordMiss(player);
    const feedback = guess < game.target ? '⬆️ Higher.' : '⬇️ Lower.';
    game.turnIndex += 1;

    if (game.turnIndex < game.order.length) {
        const nextPlayer = game.order[game.turnIndex];
        return feedback + '\nNext turn: *' + nextPlayer.name + '*.';
    }

    const nextCycle = await beginCycle(game, generateBanter);
    if (!nextCycle) return feedback;
    return feedback + '\n\n' + nextCycle;
}

function stopNumberRunGame(groupId, senderId) {
    const game = activeGames.get(groupId);
    if (!game) return '❌ There is no Number Run game in this group.';
    if (senderId !== game.hostId) return '❌ Only the host can stop Number Run.';

    const scores = formatLeaderboard(game);
    game.phase = 'ENDED';
    activeGames.delete(groupId);
    releaseGame(groupId, 'numberrun');
    return '🛑 *Number Run stopped.*\n\n' +
        (scores ? '*Scores so far*\n' + scores : 'No scores recorded.');
}

module.exports = {
    startNumberRunLobby,
    joinNumberRunLobby,
    startNumberRunGame,
    stopNumberRunGame,
    processNumberRunGuess
};