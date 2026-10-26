const crypto = require('crypto');
const { claimGame, releaseGame } = require('./gameRegistry');
const FACT_BANK = require('../data/truthHuntFacts.json');

const activeGames = new Map();
const MIN_PLAYERS = 2;
const MAX_PLAYERS = 10;
const READING_TIME_MS = 60 * 1000;
const ANSWER_TIME_MS = 15 * 1000;
const ROUND_BREAK_MS = 2500;

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
    const truthTopic = randomItem(selectedTopics);
    const falseTopics = selectedTopics.filter(topic => topic.id !== truthTopic.id);
    const truth = selectClaim(game, truthTopic, 'truths', true);
    const misconceptions = falseTopics.map(topic => selectClaim(game, topic, 'misconceptions', false));
    if (!truth || misconceptions.some(item => !item)) return null;
    return shuffle([truth, ...misconceptions]);
}

function sendGroup(game, message) {
    if (!game.client || !message) return Promise.resolve(false);
    return game.client.sendMessage(game.groupId, message)
        .then(() => true)
        .catch(error => {
            console.warn('[TRUTH HUNT] Group message failed:', error.message);
            return false;
        });
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
        answers: new Map(),
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
        score: 0,
        streak: 0
    });
    return '✅ *' + safeName(playerName) + '* joined Truth Hunt (' + game.players.size + ' player(s)).';
}

async function startTruthHuntGame(groupId, senderId, client) {
    const game = activeGames.get(groupId);
    if (!game || game.phase !== 'LOBBY') return '❌ No Truth Hunt lobby is waiting to start.';
    if (senderId !== game.hostId) return '❌ Only the host can start Truth Hunt.';
    if (!game.players.has(senderId)) return '❌ The host must join with !jointruth before starting.';
    if (game.players.size < MIN_PLAYERS) return '❌ Truth Hunt needs at least 2 registered players.';

    game.client = client;
    game.totalRounds = Math.min(7, Math.max(3, game.players.size + 1));
    await beginRound(game);
    return '';
}

async function beginRound(game) {
    if (activeGames.get(game.groupId) !== game) return;
    game.roundNumber += 1;
    game.phase = 'PREPARING';
    game.statements = [];
    game.correctIndex = -1;
    game.answers = new Map();

    const statements = buildRoundStatements(game);
    if (!statements || statements.filter(item => item.isTrue).length !== 1) {
        await sendGroup(game, '⚠️ I could not build a valid set of sourced statements. This round is void; no points change.');
        await finishRound(game, true);
        return;
    }

    game.statements = statements;
    game.correctIndex = statements.findIndex(item => item.isTrue);
    game.phase = 'READING';
    const display = statements.map((item, index) => (index + 1) + '. ' + item.statement).join('\n');
    await sendGroup(game,
        '🧠 *TRUTH HUNT — ROUND ' + game.roundNumber + '/' + game.totalRounds + '*\n\n' +
        'One statement is true. The other two are misconceptions from different topics.\n\n' +
        '🧩 *Which statement is true?*\n' + display + '\n\n' +
        'You have 1 minute to read. Please keep answers out of the group chat.'
    );
    if (game.phase !== 'READING') return;
    scheduleTimer(game, 'reading', READING_TIME_MS, () => openAnswerWindow(game));
}

async function openAnswerWindow(game) {
    if (game.phase !== 'READING') return;
    clearTimer(game, 'reading');
    game.phase = 'SENDING_DMS';
    game.answers = new Map();

    for (const player of game.players.values()) {
        game.answers.set(player.id, {
            answer: null,
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
                'Which group statement is true? Reply with 1, 2, or 3 within 15 seconds of this message. Your choice is private.'
            );
            answer.promptedAt = Date.now();
            answer.deadline = answer.promptedAt + ANSWER_TIME_MS;
            answer.delivered = true;
        } catch (error) {
            answer.delivered = false;
            answer.deadline = null;
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
    await sendGroup(game, '📩 Private prompts sent. Each player has 15 seconds from their own DM to reply with 1, 2, or 3.');
    if (game.phase !== 'ANSWERING') return;

    const latestDeadline = Math.max(...delivered.map(answer => answer.deadline));
    scheduleTimer(game, 'answers', Math.max(0, latestDeadline - Date.now()), () => resolveAnswerRound(game));
    await maybeResolveAnsweredRound(game);
}

function findActiveGameForDm(playerId) {
    return Array.from(activeGames.values())
        .filter(game => game.players.has(playerId) && ['READING', 'SENDING_DMS', 'ANSWERING'].includes(game.phase))
        .sort((left, right) => {
            const leftAnswer = left.answers.get(playerId);
            const rightAnswer = right.answers.get(playerId);
            return (rightAnswer && rightAnswer.promptedAt || 0) - (leftAnswer && leftAnswer.promptedAt || 0);
        })[0] || null;
}

async function processTruthHuntDmMessage(senderId, text) {
    const game = findActiveGameForDm(senderId);
    if (!game) return { handled: false };

    const body = String(text || '').trim();
    const answer = game.answers.get(senderId);
    const isChoice = /^[1-3]$/.test(body);

    if (game.phase === 'READING') {
        return isChoice
            ? { handled: true, response: '⏳ Wait for the private answer prompt before choosing.' }
            : { handled: false };
    }

    if (!answer) return { handled: false };
    if (game.phase === 'SENDING_DMS' && !answer.delivered) {
        return isChoice
            ? { handled: true, response: '⏳ Wait for the private answer prompt before choosing.' }
            : { handled: false };
    }
    if (game.phase === 'ANSWERING' && !answer.delivered) {
        return { handled: true, response: '⚠️ The answer prompt could not be delivered, so your response cannot be recorded.' };
    }
    if (!answer.promptedAt) return { handled: false };
    if (answer.deadline && Date.now() > answer.deadline) {
        return { handled: true, response: '⏰ Your 15-second answer window has closed.' };
    }
    if (answer.answer !== null) {
        return { handled: true, response: '🔒 Your answer is locked in.' };
    }
    if (!isChoice) {
        return { handled: true, response: 'Reply with 1, 2, or 3.' };
    }

    answer.answer = Number(body) - 1;
    if (game.phase === 'ANSWERING') await maybeResolveAnsweredRound(game);
    return { handled: true, response: '✅ Your answer is locked in. I’ll reveal it when the round closes.' };
}

async function maybeResolveAnsweredRound(game) {
    if (game.phase !== 'ANSWERING') return;
    const eligible = Array.from(game.answers.values()).filter(answer => answer.delivered);
    if (eligible.length > 0 && eligible.every(answer => answer.answer !== null)) {
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
        let detail = 'no answer';
        if (answer && answer.delivered && answer.answer !== null) {
            if (answer.answer === game.correctIndex) {
                player.streak += 1;
                gained = 2;
                if (player.streak % 3 === 0) gained += 1;
                player.score += gained;
                detail = 'correct +' + gained;
            } else {
                player.streak = 0;
                detail = 'not correct';
            }
        } else if (answer && answer.delivered) {
            player.streak = 0;
        }
        changes.push('*' + player.name + '* — ' + detail);
    }

    const correct = game.statements[game.correctIndex];
    const statements = game.statements.map((item, index) => {
        const label = index + 1;
        const kind = item.isTrue ? 'TRUE' : 'MISCONCEPTION';
        return label + '. ' + kind + ' — ' + item.topicName + '\n' + item.explanation +
            '\nSource — ' + item.sourceTitle + '\n' + item.sourceUrl;
    }).join('\n\n');

    await sendGroup(game,
        '✅ *The true statement was ' + (game.correctIndex + 1) + '* — ' + correct.topicName + '\n' +
        correct.explanation + '\nSource — ' + correct.sourceTitle + '\n' + correct.sourceUrl +
        '\n\n*Fact check*\n' + statements +
        '\n\n*Round points*\n' + changes.join('\n') +
        '\n\n*Scores*\n' + formatScores(game)
    );

    await finishRound(game, false);
}

function formatScores(game) {
    return Array.from(game.players.values())
        .sort((left, right) => right.score - left.score || left.name.localeCompare(right.name))
        .map((player, index) => (index + 1) + '. *' + player.name + '* — ' + player.score + ' pts')
        .join('\n');
}

async function finishRound(game, voided) {
    clearTimer(game, 'reading');
    clearTimer(game, 'answers');

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
        await sendGroup(game, '🏁 *TRUTH HUNT COMPLETE*\n' + winnerText + '\n\n*Final scores*\n' + formatScores(game));
        endGame(game);
        return;
    }

    game.phase = 'BREAK';
    if (!voided) {
        await sendGroup(game, 'Next round begins in a moment. The topics and statements will be shuffled again.');
    }
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
    if (['READING', 'SENDING_DMS', 'ANSWERING'].includes(game.phase) && /^[1-3]$/.test(body)) {
        await sendGroup(game, '🔒 Send your 1, 2, or 3 choice in the private chat with the bot.');
        return true;
    }
    return false;
}

module.exports = {
    startTruthHuntLobby,
    joinTruthHuntLobby,
    startTruthHuntGame,
    stopTruthHuntGame,
    handleTruthHuntGroupMessage,
    processTruthHuntDmMessage
};
