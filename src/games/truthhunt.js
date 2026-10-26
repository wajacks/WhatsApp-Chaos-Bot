const crypto = require('crypto');
const { claimGame, releaseGame } = require('./gameRegistry');
const { sanitizeTopic } = require('../features/truthHuntTrivia');

const activeGames = new Map();
const MIN_PLAYERS = 2;
const MAX_PLAYERS = 10;
const SUGGESTION_TIME_MS = 30 * 1000;
const TOPIC_VOTE_TIME_MS = 30 * 1000;
const READING_TIME_MS = 30 * 1000;
const ANSWER_TIME_MS = 10 * 1000;
const ROUND_BREAK_MS = 2500;
const SAFE_FALLBACK_TOPICS = ['Animals', 'Football', 'Space'];

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
        suggestions: new Map(),
        topics: [],
        votes: new Map(),
        statements: [],
        correctIndex: -1,
        answers: new Map(),
        timers: {},
        client: null,
        generateTrivia: null
    });

    return '🧠 *TRUTH HUNT LOBBY OPEN*\n\n' +
        '*' + safeName(hostName) + '* is the host and must join with !jointruth.\n' +
        'Players use !jointruth to register. The host starts with !starttruth or closes with !stoptruth.\n' +
        'Each round starts with player topic suggestions and a group vote. Answers are sent privately.';
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

async function startTruthHuntGame(groupId, senderId, client, generateTrivia) {
    const game = activeGames.get(groupId);
    if (!game || game.phase !== 'LOBBY') return '❌ No Truth Hunt lobby is waiting to start.';
    if (senderId !== game.hostId) return '❌ Only the host can start Truth Hunt.';
    if (!game.players.has(senderId)) return '❌ The host must join with !jointruth before starting.';
    if (game.players.size < MIN_PLAYERS) return '❌ Truth Hunt needs at least 2 registered players.';
    if (typeof generateTrivia !== 'function' || generateTrivia.available === false) return '❌ Search-grounded trivia is unavailable. Check Azure OpenAI credentials, endpoint, and deployment; Gemini is an optional fallback.';

    game.client = client;
    game.generateTrivia = generateTrivia;
    game.totalRounds = Math.min(7, Math.max(3, game.players.size + 1));
    await beginRound(game);
    return '';
}

async function beginRound(game) {
    if (activeGames.get(game.groupId) !== game) return;
    game.roundNumber += 1;
    game.phase = 'SUGGESTIONS';
    game.suggestions = new Map();
    game.topics = [];
    game.votes = new Map();
    game.statements = [];
    game.correctIndex = -1;
    game.answers = new Map();

    await sendGroup(game,
        '🧠 *TRUTH HUNT — ROUND ' + game.roundNumber + '/' + game.totalRounds + '*\n\n' +
        'Each registered player, send one short topic suggestion in this group.\n' +
        'Suggestions close in 30 seconds or when everyone has sent one.'
    );
    if (game.phase !== 'SUGGESTIONS') return;

    scheduleTimer(game, 'suggestions', SUGGESTION_TIME_MS, () => openTopicPoll(game));
}

async function openTopicPoll(game) {
    if (game.phase !== 'SUGGESTIONS') return;
    clearTimer(game, 'suggestions');

    const unique = [];
    const seen = new Set();
    for (const topic of game.suggestions.values()) {
        const key = topic.toLowerCase();
        if (!seen.has(key)) {
            seen.add(key);
            unique.push(topic);
        }
    }

    if (unique.length < 2) {
        for (const fallback of shuffle(SAFE_FALLBACK_TOPICS)) {
            const key = fallback.toLowerCase();
            if (!seen.has(key)) {
                seen.add(key);
                unique.push(fallback);
            }
            if (unique.length >= 3) break;
        }
    }
    game.topics = unique;
    game.votes = new Map();
    game.phase = 'TOPIC_VOTE';

    const options = game.topics.map((topic, index) => (index + 1) + '. ' + topic).join('\n');
    await sendGroup(game,
        '🗳️ *Choose this round’s topic*\n' + options + '\n\n' +
        'Registered players, vote by sending the option number here. The poll closes in 30 seconds or when everyone votes.'
    );
    if (game.phase !== 'TOPIC_VOTE') return;

    scheduleTimer(game, 'topicVote', TOPIC_VOTE_TIME_MS, () => closeTopicPoll(game));
}

async function closeTopicPoll(game) {
    if (game.phase !== 'TOPIC_VOTE') return;
    clearTimer(game, 'topicVote');

    const counts = game.topics.map((_, index) => ({
        index,
        votes: Array.from(game.votes.values()).filter(vote => vote === index).length
    }));
    const highest = Math.max(0, ...counts.map(item => item.votes));
    const tied = counts.filter(item => item.votes === highest);
    const winner = randomItem(tied.length > 0 ? tied : counts);
    const topic = game.topics[winner.index];

    game.phase = 'GENERATING';
    await sendGroup(game, '📚 The topic is *' + topic + '*. I’m checking sources and preparing three statements.');
    if (activeGames.get(game.groupId) !== game || game.phase !== 'GENERATING') return;

    let trivia = await game.generateTrivia(topic);
    if (!trivia && activeGames.get(game.groupId) === game && game.phase === 'GENERATING') {
        trivia = await game.generateTrivia(topic);
    }
    if (activeGames.get(game.groupId) !== game || game.phase !== 'GENERATING') return;

    if (!trivia || !Array.isArray(trivia.statements) || trivia.statements.length !== 3) {
        await sendGroup(game, '⚠️ I couldn’t verify a safe set with exactly one true statement. This round is void; no points change.');
        await finishRound(game, true);
        return;
    }

    const statements = shuffle(trivia.statements);
    game.statements = statements;
    game.correctIndex = statements.findIndex(item => item.isTrue === true);
    if (game.correctIndex < 0 || statements.filter(item => item.isTrue === true).length !== 1) {
        await sendGroup(game, '⚠️ The fact check did not produce exactly one true statement. This round is void; no points change.');
        await finishRound(game, true);
        return;
    }

    game.phase = 'READING';
    const display = statements.map((item, index) => (index + 1) + '. ' + item.statement).join('\n');
    await sendGroup(game,
        '🧩 *Which statement is true?*\n\n' + display + '\n\n' +
        'Read the statements in the group. You have 30 seconds before private answers open. Please don’t post your answer here.'
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
                'Which group statement is true? Reply with 1, 2, or 3 within 10 seconds of this message. Your choice is private.'
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
        await sendGroup(game, '⚠️ I couldn’t deliver the private answer prompts. This round is void; no points change.');
        await finishRound(game, true);
        return;
    }

    game.phase = 'ANSWERING';
    await sendGroup(game, '📩 Private prompts sent. Each player has 10 seconds from their own DM to reply with 1, 2, or 3.');
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
        return { handled: true, response: '⏰ Your 10-second answer window has closed.' };
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
        return label + '. ' + kind + ' — ' + item.explanation +
            '\nSource: ' + item.sourceTitle + ' ' + item.sourceUrl +
            (item.verificationSourceUrl && item.verificationSourceUrl !== item.sourceUrl
                ? '\nCross-check: ' + item.verificationSourceUrl
                : '');
    }).join('\n\n');

    await sendGroup(game,
        '✅ *The true statement was ' + (game.correctIndex + 1) + '*\n' +
        correct.explanation + '\nSource: ' + correct.sourceTitle + ' ' + correct.sourceUrl +
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
    clearTimer(game, 'suggestions');
    clearTimer(game, 'topicVote');
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
        await sendGroup(game, 'Next round begins in a moment. Topic suggestions will open shortly.');
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
    if (!['SUGGESTIONS', 'TOPIC_VOTE'].includes(game.phase)) return false;
    const player = game.players.get(senderId);
    if (!player) return false;

    if (game.phase === 'SUGGESTIONS') {
        const topic = sanitizeTopic(body);
        if (!topic) {
            await sendGroup(game, '⚠️ Send one short, safe topic phrase without a link or command.');
            return true;
        }
        if (game.suggestions.has(senderId)) {
            await sendGroup(game, '*' + player.name + '*, your topic suggestion is already recorded for this round.');
            return true;
        }
        game.suggestions.set(senderId, topic);
        await sendGroup(game, '✅ Topic suggestion received from *' + player.name + '*.');
        if (game.phase === 'SUGGESTIONS' && game.suggestions.size >= game.players.size) {
            await openTopicPoll(game);
        }
        return true;
    }

    if (!/^\d+$/.test(body)) return false;
    const choice = Number(body) - 1;
    if (!Number.isInteger(choice) || choice < 0 || choice >= game.topics.length) {
        await sendGroup(game, '⚠️ Choose a topic option from 1 to ' + game.topics.length + '.');
        return true;
    }
    game.votes.set(senderId, choice);
    await sendGroup(game, '✅ Vote recorded for *' + game.topics[choice] + '*.');
    if (game.phase === 'TOPIC_VOTE' && game.votes.size >= game.players.size) {
        await closeTopicPoll(game);
    }
    return true;
}

module.exports = {
    startTruthHuntLobby,
    joinTruthHuntLobby,
    startTruthHuntGame,
    stopTruthHuntGame,
    handleTruthHuntGroupMessage,
    processTruthHuntDmMessage
};