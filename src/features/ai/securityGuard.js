const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const SECURITY_STATE_PATH = path.resolve(__dirname, '../../../data/ai_security.json');
const PROMPT_WINDOW_MS = 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

function positiveEnvInteger(name, fallback, min, max) {
    const parsed = Number.parseInt(process.env[name] || '', 10);
    return Number.isFinite(parsed) ? Math.max(min, Math.min(max, parsed)) : fallback;
}

function getOveruseBanSteps() {
    const fallback = [40, 180, 900, 3600];
    const configured = String(process.env.AI_OVERUSE_BAN_STEPS_SECONDS || '').trim();
    if (!configured) return fallback.map(seconds => seconds * 1000);
    const steps = configured.split(',')
        .map(value => Number.parseInt(value.trim(), 10))
        .filter(seconds => Number.isFinite(seconds) && seconds > 0)
        .slice(0, 8)
        .map(seconds => Math.max(30, Math.min(3600, seconds)) * 1000);
    return steps.length ? steps : fallback.map(seconds => seconds * 1000);
}

const MAX_PROMPTS_PER_MINUTE = positiveEnvInteger('AI_PROMPTS_PER_MINUTE', 12, 1, 60);
const MAX_PROMPTS_PER_HOUR = positiveEnvInteger('AI_PROMPTS_PER_HOUR', 100, 1, 500);
const OVERUSE_BAN_STEPS_MS = getOveruseBanSteps();
const OVERUSE_STRIKE_WINDOW_MS = positiveEnvInteger('AI_OVERUSE_STRIKE_WINDOW_DAYS', 7, 1, 90) * DAY_MS;
const OVERUSE_STRIKE_DECAY_MS = positiveEnvInteger('AI_OVERUSE_STRIKE_DECAY_HOURS', 24, 1, 720) * HOUR_MS;
const JAILBREAK_WINDOW_MS = HOUR_MS;
const FIRST_SECURITY_LOCK_MS = HOUR_MS;
const REPEAT_SECURITY_LOCK_MS = DAY_MS;
const MAX_TRACKED_USERS = 5000;

const inFlightUsers = new Set();
let state = null;
let storageHealthy = true;
let operationsSincePrune = 0;

function emptyState() {
    return { version: 1, users: {} };
}

function loadState() {
    if (state) return state;
    try {
        const raw = fs.readFileSync(SECURITY_STATE_PATH, 'utf8');
        const parsed = JSON.parse(raw);
        if (!parsed || parsed.version !== 1 || !parsed.users || typeof parsed.users !== 'object' || Array.isArray(parsed.users)) {
            throw new Error('Unexpected AI security state format');
        }
        state = parsed;
    } catch (error) {
        if (error.code === 'ENOENT') {
            state = emptyState();
        } else {
            storageHealthy = false;
            console.error('[AI SECURITY] Could not read abuse-limit state; AI requests will fail closed:', error.message);
            state = emptyState();
        }
    }
    return state;
}

function saveState() {
    if (!storageHealthy) return false;
    const temporaryPath = SECURITY_STATE_PATH + '.' + process.pid + '.tmp';
    try {
        fs.mkdirSync(path.dirname(SECURITY_STATE_PATH), { recursive: true, mode: 0o700 });
        fs.writeFileSync(temporaryPath, JSON.stringify(state), { encoding: 'utf8', mode: 0o600 });
        fs.renameSync(temporaryPath, SECURITY_STATE_PATH);
        return true;
    } catch (error) {
        storageHealthy = false;
        try { fs.rmSync(temporaryPath, { force: true }); } catch (_) {}
        console.error('[AI SECURITY] Could not persist abuse-limit state; AI requests will fail closed:', error.message);
        return false;
    }
}

function identityKey(senderId) {
    const normalized = String(senderId || '').trim().toLowerCase();
    return normalized
        ? crypto.createHash('sha256').update(normalized).digest('hex')
        : '';
}

function normalizePrompt(prompt) {
    return String(prompt || '')
        .normalize('NFKC')
        .replace(/[\u200B-\u200D\uFEFF]/g, '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 4000);
}

const PROMPT_INJECTION_PATTERNS = [
    // Catch requests to reproduce the bot's configuration or paraphrase hidden instructions.
    /\b(?:print|show|dump|export|reveal|list|summari[sz]e|describe|read|provide|give me|tell me)\b.{0,80}\b(?:the\s+)?(?:(?:bot|assistant|model|runtime|internal)\s+(?:config(?:uration)?|setup|system context|developer rules|instructions?)|(?:config(?:uration)?|setup)\s+(?:of|for)\s+(?:the\s+)?(?:bot|assistant|model|runtime))\b/i,
    /\b(?:summari[sz]e|paraphrase|list|describe|explain|outline|repeat|quote|recite|provide|give me|tell me)\b.{0,80}\b(?:the\s+)?(?:(?:system|developer|hidden|internal)\s+(?:prompt|instructions?|rules?|polic(?:y|ies))|rules?\s+you\s+(?:(?:were\s+)?given|follow)|instructions?\s+you\s+(?:(?:were\s+)?given|follow))\b/i,
    /\b(?:replace|overwrite|change|modify|rewrite|update|adopt)\b.{0,80}\b(?:your|the)\s+(?:system|developer|internal|hidden)\s+(?:prompt|instructions?|rules?|configuration|setup)\b/i,
    /\b(?:ignore|disregard|forget|override|bypass)\b.{0,100}\b(?:previous|prior|above|system|developer|safety|security)\b.{0,50}\b(?:instructions?|rules?|prompt|policy|guardrails?)\b/i,
    /\b(?:reveal|show|print|repeat|quote|dump|export|leak|disclose|provide|give me|tell me)\b.{0,80}\b(?:your\s+)?(?:hidden|system|developer|internal|original|secret)\b.{0,50}\b(?:prompt|instructions?|rules?|policy|secrets?|credentials?|api[\s_-]*keys?|tokens?|database|files?)\b/i,
    /\b(?:what is|what are|repeat|show|print|dump|quote|reveal)\b.{0,50}\b(?:your\s+)?(?:hidden\s+|system\s+|developer\s+|internal\s+)?(?:system\s+prompt|developer\s+prompt|instructions?|rules?|polic(?:y|ies))\b/i,
    /\b(?:show|print|dump|export|read|list|send|reveal|give me)\b.{0,70}\b(?:\.env|environment variables?|api[\s_-]*keys?|passwords?|credentials?|access tokens?|session secrets?|raw database|server files?)\b/i,
    /\b(?:repeat|quote|print|dump|reproduce|show)\b.{0,50}\b(?:everything|all text|all messages|all instructions)\b.{0,50}\b(?:above|before|hidden|system|developer)\b/i,
    /\b(?:translate|encode|base64|rot13|reverse|use the first letters?)\b.{0,80}\b(?:hidden|system|developer|internal|secret)\b.{0,40}\b(?:prompt|instructions?|rules?|secrets?|credentials?)\b/i,
    /\b(?:pretend|act|roleplay)\b.{0,50}\b(?:owner|developer|administrator|admin|system)\b.{0,80}\b(?:reveal|show|dump|bypass|ignore|secret|credential|prompt|instruction)\b/i,
    /\b(?:dump|export|read|send|show|list|print|give me)\b.{0,50}\b(?:raw database|entire database|database contents|all user records|everyone['’]s (?:data|messages|balances)|other users['’] (?:data|messages|balances)|private messages)\b/i
];

function isPromptExtractionAttempt(prompt) {
    const normalized = normalizePrompt(prompt);
    return PROMPT_INJECTION_PATTERNS.some(pattern => pattern.test(normalized));
}

function cleanTimestamps(values, cutoff) {
    return Array.isArray(values)
        ? values.filter(value => Number.isFinite(value) && value >= cutoff)
        : [];
}

function pruneRecord(record, now) {
    record.promptTimes = cleanTimestamps(record.promptTimes, now - HOUR_MS);
    record.securityAttempts = cleanTimestamps(record.securityAttempts, now - DAY_MS);
    record.securityBlocks = cleanTimestamps(record.securityBlocks, now - DAY_MS);
    record.securityBlockedUntil = Number(record.securityBlockedUntil) || 0;
    record.overuseEvents = cleanTimestamps(record.overuseEvents, now - OVERUSE_STRIKE_WINDOW_MS);
    record.usageBannedUntil = Number(record.usageBannedUntil) || 0;
    record.lastSeenAt = Number(record.lastSeenAt) || now;
    return record;
}

function pruneAllUsers(now) {
    for (const [key, record] of Object.entries(state.users)) {
        pruneRecord(record, now);
        const hasRecentActivity = record.promptTimes.length ||
            record.securityAttempts.length ||
            record.securityBlocks.length ||
            record.overuseEvents.length ||
            record.securityBlockedUntil > now ||
            record.usageBannedUntil > now;
        if (!hasRecentActivity && now - record.lastSeenAt > DAY_MS) delete state.users[key];
    }

    const entries = Object.entries(state.users);
    if (entries.length > MAX_TRACKED_USERS) {
        entries.sort((a, b) => (Number(a[1].lastSeenAt) || 0) - (Number(b[1].lastSeenAt) || 0));
        for (const [key] of entries.slice(0, entries.length - MAX_TRACKED_USERS)) {
            delete state.users[key];
        }
    }
}

function limited(reason, retryAfterMs = 0, notify = true) {
    return { allowed: false, reason, retryAfterMs: Math.max(0, retryAfterMs), notify };
}

function isNonCountedBotRequest(prompt) {
    const normalized = normalizePrompt(prompt);
    if (!normalized || isPromptExtractionAttempt(normalized)) return false;
    if (/^!/i.test(normalized)) return true;

    return /\b(?:chaos bot|this bot|your bot|the bot|bot features?|bot commands?|bot menu|\bmenu\b|\bhelp\b|\bgames?\b|\bwordchain\b|\bwordforge\b|\bwordle\b|\bscramble\b|\bmafia\b|\brebus\b|\btruth hunt\b|\bnumber run\b|\bclass portal\b|\bclass(?:es)?\b|\btimetable\b|\battendance\b|\broll call\b|\bdeadline\b|\bpolls?\b|\b(?:my\s+)?balances?\b|\bwallet\b|\bcoins?\b|\bxp\b|\bleaderboard\b|\bprofile\b|\bdaily reward\b|\bstore\b|\bbuy\b|\bpay\b|\bsong\b|\bvideo\b|\bhymn\b|\bweather\b|\bimage studio\b|\b!contactowner\b|\bowner contact\b)\b/i.test(normalized) ||
        /\bwhat can (?:you|this bot) do\b|\bhow do i use (?:this )?bot\b|\bhow to use (?:this )?bot\b|\bmy class(?:es)?\b|\bour class(?:es)?\b|\b(?:show|check|get|claim|play|find|search|open|view|create|join|start|send|generate|draw|analy[sz]e)\s+(?:me\s+)?(?:my\s+)?(?:balance|profile|store|daily reward|game|class|classes|timetable|attendance|poll|song|video|hymn|image|picture|photo|owner contact)\b/i.test(normalized);
}

function formatDuration(durationMs) {
    const seconds = Math.max(1, Math.ceil(durationMs / 1000));
    if (seconds < 60) return seconds + ' seconds';
    const minutes = Math.ceil(seconds / 60);
    if (minutes < 60) return minutes + (minutes === 1 ? ' minute' : ' minutes');
    return Math.ceil(minutes / 60) + ' hour' + (Math.ceil(minutes / 60) === 1 ? '' : 's');
}

function beginOverusePause(record, now, reason) {
    let events = cleanTimestamps(record.overuseEvents, now - OVERUSE_STRIKE_WINDOW_MS);
    const lastEvent = events.length ? events[events.length - 1] : 0;
    const quietPeriods = lastEvent ? Math.floor((now - lastEvent) / OVERUSE_STRIKE_DECAY_MS) : 0;
    if (quietPeriods > 0) events = events.slice(0, Math.max(0, events.length - quietPeriods));

    const strike = events.length + 1;
    const durationMs = OVERUSE_BAN_STEPS_MS[Math.min(strike - 1, OVERUSE_BAN_STEPS_MS.length - 1)];
    events.push(now);
    record.overuseEvents = events;
    record.usageBannedUntil = now + durationMs;
    // A pause resets the burst windows so the user can return after waiting
    // without immediately retriggering the same penalty.
    record.promptTimes = [];
    const extra = strike >= 4
        ? 'Repeated bursts now trigger the longest configured pause.'
        : strike === 3
            ? 'This is a warning; another rapid burst can lead to the longest pause.'
            : 'A quiet period lowers the penalty level.';
    const message = '⏳ I’m pausing AI for ' + formatDuration(durationMs) +
        ' because requests came too quickly. Normal bot commands still work. ' + extra;
    return { strike, durationMs, message, reason };
}

function acquireAiRequest(senderId, prompt, options = {}) {
    if (typeof options === 'number') options = { now: options };
    const now = Number(options.now) || Date.now();
    const isOwner = options.isOwner === true;
    const key = identityKey(senderId);
    if (!key) return limited('identity');
    if (!storageHealthy) return limited('storage');

    loadState();
    let record = state.users[key];
    if (!record || typeof record !== 'object' || Array.isArray(record)) {
        record = {
            promptTimes: [],
            securityAttempts: [],
            securityBlocks: [],
            securityBlockedUntil: 0,
            overuseEvents: [],
            usageBannedUntil: 0,
            lastSeenAt: now
        };
        state.users[key] = record;
    }
    pruneRecord(record, now);
    record.lastSeenAt = now;

    if (record.securityBlockedUntil > now) {
        return limited('security_lockout', record.securityBlockedUntil - now, false);
    }

    const extractionAttempt = isPromptExtractionAttempt(prompt);
    if (extractionAttempt) {
        if (!isOwner) record.promptTimes.push(now);
        record.securityAttempts.push(now);
        const recentAttacks = record.securityAttempts.filter(timestamp => timestamp > now - JAILBREAK_WINDOW_MS);
        if (recentAttacks.length >= 3) {
            const repeatIncident = record.securityBlocks.some(timestamp => timestamp > now - DAY_MS);
            const lockDuration = repeatIncident ? REPEAT_SECURITY_LOCK_MS : FIRST_SECURITY_LOCK_MS;
            record.securityBlocks.push(now);
            record.securityBlockedUntil = now + lockDuration;
            if (!saveState()) return limited('storage');
            return limited('security_lockout', lockDuration);
        }
        if (!saveState()) return limited('storage');
        return limited('security_refusal');
    }

    if (inFlightUsers.has(key)) return limited('in_flight', 0, false);

    const rateLimitExempt = isOwner || isNonCountedBotRequest(prompt);
    if (rateLimitExempt) {
        inFlightUsers.add(key);
        if (!saveState()) {
            inFlightUsers.delete(key);
            return limited('storage');
        }
        return {
            allowed: true,
            rateLimitExempt: true,
            release() { inFlightUsers.delete(key); }
        };
    }

    if (record.usageBannedUntil > now) {
        return limited('usage_ban', record.usageBannedUntil - now, false);
    }

    const recentHour = record.promptTimes.filter(timestamp => timestamp > now - HOUR_MS);
    const recentMinute = record.promptTimes.filter(timestamp => timestamp > now - PROMPT_WINDOW_MS);
    if (recentHour.length >= MAX_PROMPTS_PER_HOUR || recentMinute.length >= MAX_PROMPTS_PER_MINUTE) {
        const pause = beginOverusePause(record, now, recentHour.length >= MAX_PROMPTS_PER_HOUR ? 'hourly_burst' : 'minute_burst');
        if (!saveState()) return limited('storage');
        return {
            ...limited('usage_ban', pause.durationMs),
            strike: pause.strike,
            message: pause.message
        };
    }

    record.promptTimes.push(now);
    operationsSincePrune++;
    if (operationsSincePrune >= 100) {
        pruneAllUsers(now);
        operationsSincePrune = 0;
    }

    inFlightUsers.add(key);
    if (!saveState()) {
        inFlightUsers.delete(key);
        return limited('storage');
    }

    return {
        allowed: true,
        rateLimitExempt: false,
        release() { inFlightUsers.delete(key); }
    };
}
module.exports = {
    acquireAiRequest,
    isPromptExtractionAttempt,
    isNonCountedBotRequest
};
