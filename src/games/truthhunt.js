const crypto = require('crypto');
const { claimGame, releaseGame } = require('./gameRegistry');
const FACT_BANK = require('../data/truthHuntFacts.json');

const activeGames = new Map();
const MIN_PLAYERS = 2;
const MAX_PLAYERS = 10;
const READING_TIME_MS = 60 * 1000;
const DM_START_PAUSE_MS = 5 * 1000;
const ANSWER_TIME_MS = 30 * 1000;
const REVEAL_DELAY_MS = 5 * 1000;
const ROUND_BREAK_MS = 30 * 1000;
const HINT_DELAY_MIN_MS = 12000;
const HINT_DELAY_MAX_MS = 36000;

function randomInt(min, max) {
    return crypto.randomInt(min, max + 1);
}

function randomItem(items) {
    return items[randomInt(0, items.length - 1)];
}

function shuffle(items) {
    const result = items.slice();
    for (let index = result.length - 1; index > 0; index--) {
        const swap = randomInt(0, index);
        [result[index], result[swap]] = [result[swap], result[index]];
    }
    return result;
}

function safeName(value) {
    const name = String(value || 'Player')
        .replace(/[\r\n\u0000-\u001f]/g, ' ')
        .replace(/[*_~]/g, '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 40);
    return name || 'Player';
}

function makeAnonymousId(game) {
    const used = new Set(Array.from(game.players.values()).map(player => player.anonymousId));
    let candidate;
    do {
        candidate = 'TH-' + crypto.randomBytes(3).toString('hex').toUpperCase();
    } while (used.has(candidate));
    return candidate;
}

function validateClaim(claim, sources, topicId) {
    if (!claim || typeof claim.statement !== 'string' || claim.statement.length < 15 || claim.statement.length > 240) {
        throw new Error('Invalid statement in Truth Hunt topic ' + topicId);
    }
    if (claim.statement.includes(':') || /[\r\n]/.test(claim.statement)) {
        throw new Error('Truth Hunt statements must be single flowing sentences');
    }
    if (typeof claim.explanation !== 'string' || claim.explanation.length < 12 || claim.explanation.length > 360) {
        throw new Error('Invalid explanation in Truth Hunt topic ' + topicId);
    }
    const source = sources[claim.sourceId];
    if (!source || typeof source.title !== 'string' || !source.title.trim()) {
        throw new Error('Missing source metadata in Truth Hunt topic ' + topicId);
    }
    try {
        if (new URL(source.url).protocol !== 'https:') throw new Error('not https');
    } catch {
        throw new Error('Invalid HTTPS source in Truth Hunt topic ' + topicId);
    }
}

function validateFactBank(bank) {
    if (!bank || bank.version !== 1 || !Array.isArray(bank.topics) || bank.topics.length !== 19) {
        throw new Error('Truth Hunt fact bank must contain exactly 19 topics');
    }
    if (!bank.sources || typeof bank.sources !== 'object') {
        throw new Error('Truth Hunt fact bank is missing its source catalog');
    }

    const topicIds = new Set();
    for (const topic of bank.topics) {
        if (!topic || typeof topic.id !== 'string' || !topic.id || topicIds.has(topic.id)) {
            throw new Error('Truth Hunt topic IDs must be unique');
        }
        topicIds.add(topic.id);
        if (typeof topic.name !== 'string' || !topic.name.trim()) {
            throw new Error('Truth Hunt topic is missing its display name');
        }
        if (!Array.isArray(topic.truths) || topic.truths.length !== 15) {
            throw new Error('Truth Hunt topic ' + topic.id + ' must have exactly 15 truths');
        }
        if (!Array.isArray(topic.misconceptions) || topic.misconceptions.length !== 15) {
            throw new Error('Truth Hunt topic ' + topic.id + ' must have exactly 15 misconceptions');
        }
        for (const claim of topic.truths) validateClaim(claim, bank.sources, topic.id);
        for (const claim of topic.misconceptions) validateClaim(claim, bank.sources, topic.id);
    }
}

validateFactBank(FACT_BANK);

function claimKey(topic, claim) {
    return topic.id + '|' + claim.sourceId + '|' + claim.statement;
}

function selectClaim(game, topic, listName, isTrue) {
    const choices = topic[listName].filter(claim => !game.usedFacts.has(claimKey(topic, claim)));
    if (choices.length === 0) return null;
    const claim = randomItem(choices);
    game.usedFacts.add(claimKey(topic, claim));
    const source = FACT_BANK.sources[claim.sourceId];
    return {
        topicId: topic.id,
        topicName: topic.name,
        statement: claim.statement,
        explanation: claim.explanation,
        sourceTitle: source.title,
        sourceUrl: source.url,
        isTrue
    };
}

function buildRoundStatements(game) {
    const selectedTopics = shuffle(FACT_BANK.topics).slice(0, 3);
    const truthExists = crypto.randomInt(0, 6) !== 0;
    const truthTopic = truthExists ? randomItem(selectedTopics) : null;
    const statements = selectedTopics.map(topic => {
        const isTrue = Boolean(truthTopic && topic.id === truthTopic.id);
        return selectClaim(game, topic, isTrue ? 'truths' : 'misconceptions', isTrue);
    });
    if (statements.some(item => !item)) return null;
    return { statements: shuffle(statements), truthExists };
}

function sendGroup(game, message, options) {
    if (!game.client || !message) return Promise.resolve(false);
    return game.client.sendMessage(game.groupId, message, options || {})
        .then(() => true)
        .catch(error => {
            console.warn('[TRUTH HUNT] Group message failed:', error.message);
            return false;
        });
}

async function sendReadingHint(game) {
    if (activeGames.get(game.groupId) !== game || game.phase !== 'READING' || typeof game.generateHint !== 'function') return;
    try {
        const hint = await game.generateHint({
            statements: game.statements.map(item => item.statement)
        });
        if (!hint || activeGames.get(game.groupId) !== game || game.phase !== 'READING') return;

        const shouldTagPlayer = crypto.randomInt(0, 4) === 0;
        if (shouldTagPlayer && game.players.size > 0) {
            const player = randomItem(Array.from(game.players.values()));
            const phone = String(player.id).split('@')[0];
            await sendGroup(game, '🤫 @' + phone + ' ' + hint, { mentions: [player.id] });
        } else {
            await sendGroup(game, '🤫 ' + hint);
        }
    } catch (error) {
        console.warn('[TRUTH HUNT AI] Optional hint failed:', error.message);
    }
}

function clearTimer(game, key) {
    if (!game.timers[key]) return;
    clearTimeout(game.timers[key]);
    game.timers[key] = null;
}

function clearTimers(game) {
    for (const key of Object.keys(game.timers)) clearTimer(game, key);
}

function scheduleTimer(game, key, delay, callback) {
    clearTimer(game, key);
    const timer = setTimeout(async () => {
        game.timers[key] = null;
        if (activeGames.get(game.groupId) !== game) return;
        try {
            await callback();
        } catch (error) {
            console.error('[TRUTH HUNT TIMER] Action failed:', error.message);
            if (activeGames.get(game.groupId) === game) {
                await sendGroup(game, '⚠️ Truth Hunt hit a problem and cancelled this round without changing scores.');
                await finishRound(game, true);
            }
        }
    }, Math.max(0, delay));
    if (typeof timer.unref === 'function') timer.unref();
    game.timers[key] = timer;
}

function startTruthHuntLobby(groupId, hostId, hostName) {
    if (!groupId || !String(groupId).endsWith('@g.us')) {
        return '⚠️ Truth Hunt lobbies can only be opened in a group chat.';
    }
    if (activeGames.has(groupId)) {
        return '⚠️ A Truth Hunt lobby or match is already active in this group.';
    }

    const claim = claimGame(groupId, 'truthhunt');
    if (!claim.ok) return '⚠️ A ' + claim.activeGame + ' game is already active in this group.';

    activeGames.set(groupId, {
        groupId,
        hostId,
        hostName: safeName(hostName),
        phase: 'LOBBY',
        players: new Map(),
        roundNumber: 0,
        totalRounds: 0,
        usedFacts: new Set(),
        statements: [],
        correctIndex: -1,
        truthExists: false,
        answers: new Map(),
        generateHint: null,
        timers: {},
        client: null
    });

    return '🧠 *TRUTH HUNT LOBBY OPEN*\n\n' +
        '*' + safeName(hostName) + '* is the host and must join with !jointruth.\n' +
        'Players use !jointruth to register. The host starts with !starttruth or closes with !stoptruth.\n' +
        'Each round mixes claims from three different topics. Read in the group, then answer privately.';
}

function joinTruthHuntLobby(groupId, playerId, playerName) {
    const game = activeGames.get(groupId);
    if (!game || game.phase !== 'LOBBY') return '❌ No Truth Hunt lobby is open here. Start one with !truthhunt.';
    if (game.players.has(playerId)) return '⚠️ You already joined this Truth Hunt lobby.';
    if (game.players.size >= MAX_PLAYERS) return '⚠️ Truth Hunt supports up to ' + MAX_PLAYERS + ' players.';

    for (const other of activeGames.values()) {
        if (other !== game && other.players.has(playerId) && other.phase !== 'ENDED') {
            return '⚠️ You are already registered in another Truth Hunt match.';
        }
    }

    game.players.set(playerId, {
        id: playerId,
        name: safeName(playerName),
        anonymousId: makeAnonymousId(game),
        score: 0
    });
    return '✅ *' + safeName(playerName) + '* joined Truth Hunt (' + game.players.size + ' player(s)).';
}

async function startTruthHuntGame(groupId, senderId, client, generateHint) {
    const game = activeGames.get(groupId);
    if (!game || game.phase !== 'LOBBY') return '❌ No Truth Hunt lobby is waiting to start.';
    if (senderId !== game.hostId) return '❌ Only the host can start Truth Hunt.';
    if (!game.players.has(senderId)) return '❌ The host must join with !jointruth before starting.';
    if (game.players.size < MIN_PLAYERS) return '❌ Truth Hunt needs at least 2 registered players.';

    game.client = client;
    game.generateHint = typeof generateHint === 'function' ? generateHint : null;
    game.totalRounds = Math.max(3, game.players.size + 1);
    await beginRound(game);
    return '';
}

async function beginRound(game) {
    if (activeGames.get(game.groupId) !== game) return;
    game.roundNumber += 1;
    game.phase = 'PREPARING';
    game.statements = [];
    game.truthExists = false;
    game.correctIndex = -1;
    game.answers = new Map();

    const round = buildRoundStatements(game);
    if (!round || round.statements.length !== 3) {
        await sendGroup(game, '⚠️ I could not build a valid set of sourced statements. This round is void; no points change.');
        await finishRound(game, true);
        return;
    }

    game.statements = round.statements;
    game.truthExists = round.truthExists;
    game.correctIndex = game.statements.findIndex(item => item.isTrue);
    game.phase = 'READING';
    const display = game.statements.map((item, index) => (index + 1) + '. ' + item.statement).join('\n');
    await sendGroup(game,
        '🧠 *TRUTH HUNT — ROUND ' + game.roundNumber + '/' + game.totalRounds + '*\n\n' +
        'Most rounds have one true claim. Occasionally, none are true. Decide what you believe for each statement.\n\n' +
        '🧩 *Read the statements carefully*\n' + display + '\n\n' +
        'You have 1 minute. Then DM Truth for +3, False for +1, or No Truth for +5 if correct. If you choose Truth or False, the bot will ask for a statement number.'
    );
    if (game.phase !== 'READING') return;
    scheduleTimer(game, 'reading', READING_TIME_MS, () => startDmPause(game));
    if (game.generateHint) {
        scheduleTimer(game, 'hint', crypto.randomInt(HINT_DELAY_MIN_MS, HINT_DELAY_MAX_MS), () => sendReadingHint(game));
    }
}

function startDmPause(game) {
    if (game.phase !== 'READING') return;
    clearTimer(game, 'reading');
    clearTimer(game, 'hint');
    game.phase = 'DM_PAUSE';
    scheduleTimer(game, 'dmPause', DM_START_PAUSE_MS, () => openAnswerWindow(game));
}

async function openAnswerWindow(game) {
    if (game.phase !== 'DM_PAUSE') return;
    clearTimer(game, 'dmPause');
    game.phase = 'SENDING_DMS';
    game.answers = new Map();

    for (const player of game.players.values()) {
        game.answers.set(player.id, {
            mode: null,
            statementIndex: null,
            stage: 'TYPE',
            complete: false,
            promptedAt: null,
            deadline: null,
            delivered: false
        });
    }

    const tasks = Array.from(game.players.values()).map(async player => {
        const answer = game.answers.get(player.id);
        try {
            await game.client.sendMessage(player.id,
                '🧠 *TRUTH HUNT — ROUND ' + game.roundNumber + '*\n' +
                'Your anonymous tag is *' + player.anonymousId + '* for group results.\n' +
                'Choose your answer type. Reply 1 for Truth (+3), 2 for False (+1), or 3 for No Truth (+5 if correct). If you choose 1 or 2, I will ask for the statement number. You have 30 seconds for both replies.'
            );
            answer.promptedAt = Date.now();
            answer.deadline = answer.promptedAt + ANSWER_TIME_MS;
            answer.delivered = true;
        } catch (error) {
            answer.delivered = false;
            answer.complete = true;
            console.warn('[TRUTH HUNT] Could not send answer DM:', error.message);
        }
    });

    await Promise.all(tasks);
    if (activeGames.get(game.groupId) !== game || game.phase !== 'SENDING_DMS') return;

    const delivered = Array.from(game.answers.values()).filter(answer => answer.delivered);
    if (delivered.length === 0) {
        await sendGroup(game, '⚠️ I could not deliver the private answer prompts. This round is void; no points change.');
        await finishRound(game, true);
        return;
    }

    game.phase = 'ANSWERING';
    await sendGroup(game, '📩 Answer in your DM. Your 30-second window starts when your private prompt arrives and covers both replies.');
    if (game.phase !== 'ANSWERING') return;

    const latestDeadline = Math.max(...delivered.map(answer => answer.deadline));
    scheduleTimer(game, 'answers', Math.max(0, latestDeadline - Date.now()), () => resolveAnswerRound(game));
    await maybeResolveAnsweredRound(game);
}

function findActiveGameForDm(playerId) {
    return Array.from(activeGames.values())
        .filter(game => game.players.has(playerId) && ['READING', 'DM_PAUSE', 'SENDING_DMS', 'ANSWERING'].includes(game.phase))
        .sort((left, right) => {
            const leftAnswer = left.answers.get(playerId);
            const rightAnswer = right.answers.get(playerId);
            return (rightAnswer && rightAnswer.promptedAt || 0) - (leftAnswer && leftAnswer.promptedAt || 0);
        })[0] || null;
}

function formatStatementStarts(statements) {
    return statements.map((item, index) => {
        const start = String(item.statement || '').trim().split(/\s+/).slice(0, 7).join(' ').replace(/[.,;!?]+$/, '');
        return (index + 1) + '. ' + start + ':';
    }).join('\n');
}

async function processTruthHuntDmMessage(senderId, text) {
    const game = findActiveGameForDm(senderId);
    if (!game) return { handled: false };

    const body = String(text || '').trim().toLowerCase();
    const answer = game.answers.get(senderId);
    const choiceNumber = /^[1-3]$/.test(body) ? Number(body) : null;

    if (game.phase === 'READING' || game.phase === 'DM_PAUSE') {
        return choiceNumber
            ? { handled: true, response: '⏳ Wait for the private answer prompt before choosing.' }
            : { handled: false };
    }
    if (!answer) return { handled: false };
    if (game.phase === 'SENDING_DMS' && !answer.delivered) {
        return choiceNumber
            ? { handled: true, response: '⏳ Wait for the private answer prompt before choosing.' }
            : { handled: false };
    }
    if (game.phase === 'ANSWERING' && !answer.delivered) {
        return { handled: true, response: '⚠️ The private answer prompt could not be delivered.' };
    }
    if (!answer.promptedAt) return { handled: false };
    if (answer.deadline && Date.now() > answer.deadline) {
        return { handled: true, response: '⏰ Your 30-second answer window has closed.' };
    }
    if (answer.complete) {
        return { handled: true, response: '🔒 Your answer is locked in.' };
    }

    if (answer.stage === 'TYPE') {
        const mode = ['1', 'truth', 'fact'].includes(body) ? 'TRUTH'
            : ['2', 'false', 'falsehood', 'misconception'].includes(body) ? 'FALSE'
                : ['3', 'no truth', 'none', 'no fact'].includes(body) ? 'NO_TRUTH'
                    : null;
        if (!mode) {
            return { handled: true, response: 'Reply Truth, False, or No Truth. You can also reply 1, 2, or 3.' };
        }

        answer.mode = mode;
        if (mode === 'NO_TRUTH') {
            answer.complete = true;
            if (game.phase === 'ANSWERING') await maybeResolveAnsweredRound(game);
            return { handled: true, response: '✅ No Truth submitted and locked in.' };
        }

        answer.stage = 'STATEMENT';
        return {
            handled: true,
            response: 'Which statement are you labelling ' + (mode === 'TRUTH' ? 'Truth' : 'False') +
                '? Reply with 1, 2, or 3. Your original 30-second window is still running.\n\n' +
                formatStatementStarts(game.statements)
        };
    }

    if (!choiceNumber) return { handled: true, response: 'Reply with the statement number 1, 2, or 3.' };
    answer.statementIndex = choiceNumber - 1;
    answer.complete = true;
    if (game.phase === 'ANSWERING') await maybeResolveAnsweredRound(game);
    return { handled: true, response: '✅ Answer submitted and locked in.' };
}

async function maybeResolveAnsweredRound(game) {
    if (game.phase !== 'ANSWERING') return;
    const eligible = Array.from(game.answers.values()).filter(answer => answer.delivered);
    if (eligible.length > 0 && eligible.every(answer => answer.complete)) {
        await resolveAnswerRound(game);
    }
}

async function resolveAnswerRound(game) {
    if (game.phase !== 'ANSWERING') return;
    clearTimer(game, 'answers');
    game.phase = 'REVEALING';

    const changes = [];
    for (const player of game.players.values()) {
        const answer = game.answers.get(player.id);
        let gained = 0;
        if (answer && answer.delivered && answer.complete) {
            const selected = answer.statementIndex === null ? null : game.statements[answer.statementIndex];
            if (answer.mode === 'TRUTH' && game.truthExists && selected && selected.isTrue) gained = 3;
            else if (answer.mode === 'FALSE' && selected && !selected.isTrue) gained = 1;
            else if (answer.mode === 'NO_TRUTH' && !game.truthExists) gained = 5;
            player.score += gained;
        }
        changes.push('*' + player.anonymousId + '* — ' + (gained > 0 ? '+' + gained : '0') + ' pts');
    }

    await sendGroup(game,
        '*ROUND ' + game.roundNumber + '/' + game.totalRounds + ' RESULTS*\n\n' +
        '*Round points*\n' + changes.join('\n') +
        '\n\n*Scores*\n' + formatScores(game) +
        '\n\nThe statements are revealed in 5 seconds. The next round starts 30 seconds after the reveal.'
    );

    if (activeGames.get(game.groupId) !== game || game.phase !== 'REVEALING') return;
    scheduleTimer(game, 'reveal', REVEAL_DELAY_MS, () => revealAnswerRound(game));
}

async function revealAnswerRound(game) {
    if (game.phase !== 'REVEALING') return;

    const statements = game.statements.map((item, index) => {
        const label = item.isTrue ? 'TRUE' : 'FALSE';
        return (index + 1) + '. ' + label + ' — ' + item.statement + '\n' + item.explanation;
    }).join('\n\n');

    await sendGroup(game, statements);
    if (activeGames.get(game.groupId) !== game || game.phase !== 'REVEALING') return;
    await finishRound(game, false);
}

function formatScores(game, revealNames) {
    return Array.from(game.players.values())
        .sort((left, right) => right.score - left.score || left.anonymousId.localeCompare(right.anonymousId))
        .map((player, index) => {
            const identity = revealNames
                ? '*' + player.name + '* (' + player.anonymousId + ')'
                : '*' + player.anonymousId + '*';
            return (index + 1) + '. ' + identity + ' — ' + player.score + ' pts';
        })
        .join('\n');
}

async function finishRound(game, voided) {
    clearTimer(game, 'reading');
    clearTimer(game, 'dmPause');
    clearTimer(game, 'answers');
    clearTimer(game, 'hint');
    clearTimer(game, 'reveal');
    clearTimer(game, 'break');

    if (activeGames.get(game.groupId) !== game) return;
    if (game.roundNumber >= game.totalRounds) {
        const ranked = Array.from(game.players.values()).sort((left, right) =>
            right.score - left.score || left.name.localeCompare(right.name)
        );
        const best = ranked[0] ? ranked[0].score : 0;
        const winners = ranked.filter(player => player.score === best);
        const winnerText = winners.length === 1
            ? '🏆 *' + winners[0].name + '* wins Truth Hunt!'
            : '🏆 Truth Hunt is tied between ' + winners.map(player => '*' + player.name + '*').join(', ') + '.';
        await sendGroup(game, '🏁 *TRUTH HUNT COMPLETE*\n' + winnerText + '\n\n*Final scores*\n' + formatScores(game, true));
        endGame(game);
        return;
    }

    game.phase = 'BREAK';
    scheduleTimer(game, 'break', ROUND_BREAK_MS, () => beginRound(game));
}

function endGame(game) {
    clearTimers(game);
    game.phase = 'ENDED';
    activeGames.delete(game.groupId);
    releaseGame(game.groupId, 'truthhunt');
}

function stopTruthHuntGame(groupId, senderId) {
    const game = activeGames.get(groupId);
    if (!game) return '❌ There is no Truth Hunt game in this group.';
    if (senderId !== game.hostId) return '❌ Only the host can stop Truth Hunt.';

    const scores = formatScores(game);
    endGame(game);
    return '🛑 *Truth Hunt stopped.*\n\n' + (scores ? '*Scores so far*\n' + scores : 'No scores recorded.');
}

async function handleTruthHuntGroupMessage(groupId, senderId, text) {
    const game = activeGames.get(groupId);
    if (!game) return false;

    const body = String(text || '').trim();
    if (!body || body.startsWith('!')) return false;
    if (['READING', 'DM_PAUSE', 'SENDING_DMS', 'ANSWERING'].includes(game.phase) && /^[1-3]$/.test(body)) {
        await sendGroup(game, '🔒 Your Truth Hunt choice belongs in the private chat with the bot.');
        return true;
    }
    return false;
}

module.exports = {
    hasActiveGames: () => activeGames.size > 0,
    startTruthHuntLobby,
    joinTruthHuntLobby,
    startTruthHuntGame,
    stopTruthHuntGame,
    handleTruthHuntGroupMessage,
    processTruthHuntDmMessage
};
