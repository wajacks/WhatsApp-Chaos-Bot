const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const SECURITY_STATE_PATH = path.resolve(__dirname, '../../../data/ai_security.json');
const MAX_PROMPTS_PER_MINUTE = 5;
const MAX_PROMPTS_PER_HOUR = 30;
const PROMPT_WINDOW_MS = 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
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
    /\b(?:ignore|disregard|forget|override|bypass)\b.{0,100}\b(?:previous|prior|above|system|developer|safety|security)\b.{0,50}\b(?:instructions?|rules?|prompt|policy|guardrails?)\b/i,
    /\b(?:reveal|show|print|repeat|quote|dump|export|leak|disclose|provide|give me|tell me)\b.{0,80}\b(?:your\s+)?(?:hidden|system|developer|internal|original|secret)\b.{0,50}\b(?:prompt|instructions?|rules?|policy|secrets?|credentials?|api[\s_-]*keys?|tokens?|database|files?)\b/i,
    /\b(?:what is|what are|repeat|show|print|dump|quote|reveal)\b.{0,50}\b(?:your\s+)?(?:hidden\s+|system\s+|developer\s+|internal\s+)?(?:system\s+prompt|developer\s+prompt|instructions?|rules?|polic(?:y|ies))\b/i,
    /\b(?:show|print|dump|export|read|list|send|reveal|give me)\b.{0,70}\b(?:\.env|environment variables?|api[\s_-]*keys?|passwords?|credentials?|access tokens?|session secrets?|raw database|server files?)\b/i,
    /\b(?:repeat|quote|print|dump|reproduce|show)\b.{0,50}\b(?:everything|all text|all messages|all instructions)\b.{0,50}\b(?:above|before|hidden|system|developer)\b/i,
    /\b(?:translate|encode|base64|rot13|reverse|use the first letters?)\b.{0,80}\b(?:hidden|system|developer|internal|secret)\b.{0,40}\b(?:prompt|instructions?|rules?|secrets?|credentials?)\b/i,
    /\b(?:pretend|act|roleplay)\b.{0,50}\b(?:owner|developer|administrator|admin|system)\b.{0,80}\b(?:reveal|show|dump|bypass|ignore|secret|credential|prompt|instruction)\b/i
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
    record.rateLimitedUntil = Number(record.rateLimitedUntil) || 0;
    record.lastSeenAt = Number(record.lastSeenAt) || now;
    return record;
}

function pruneAllUsers(now) {
    for (const [key, record] of Object.entries(state.users)) {
        pruneRecord(record, now);
        const hasRecentActivity = record.promptTimes.length ||
            record.securityAttempts.length ||
            record.securityBlocks.length ||
            record.securityBlockedUntil > now ||
            record.rateLimitedUntil > now;
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

function acquireAiRequest(senderId, prompt, now = Date.now()) {
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
            rateLimitedUntil: 0,
            lastSeenAt: now
        };
        state.users[key] = record;
    }
    pruneRecord(record, now);
    record.lastSeenAt = now;

    if (record.securityBlockedUntil > now) {
        return limited('security_lockout', record.securityBlockedUntil - now, false);
    }
    if (record.rateLimitedUntil > now) {
        return limited('rate_limited', record.rateLimitedUntil - now, false);
    }

    const recentHour = record.promptTimes.filter(timestamp => timestamp > now - HOUR_MS);
    if (recentHour.length >= MAX_PROMPTS_PER_HOUR) {
        record.rateLimitedUntil = Math.max(now + HOUR_MS, recentHour[0] + HOUR_MS);
        if (!saveState()) return limited('storage');
        return limited('rate_limited', record.rateLimitedUntil - now);
    }

    const recentMinute = record.promptTimes.filter(timestamp => timestamp > now - PROMPT_WINDOW_MS);
    if (recentMinute.length >= MAX_PROMPTS_PER_MINUTE) {
        record.rateLimitedUntil = Math.max(now + PROMPT_WINDOW_MS, recentMinute[0] + PROMPT_WINDOW_MS);
        if (!saveState()) return limited('storage');
        return limited('rate_limited', record.rateLimitedUntil - now);
    }

    // Count every eligible AI request, including blocked extraction attempts.
    record.promptTimes.push(now);
    operationsSincePrune++;
    if (operationsSincePrune >= 100) {
        pruneAllUsers(now);
        operationsSincePrune = 0;
    }

    if (isPromptExtractionAttempt(prompt)) {
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

    if (inFlightUsers.has(key)) {
        if (!saveState()) return limited('storage');
        return limited('in_flight', 0, false);
    }

    inFlightUsers.add(key);
    if (!saveState()) {
        inFlightUsers.delete(key);
        return limited('storage');
    }

    return {
        allowed: true,
        release() {
            inFlightUsers.delete(key);
        }
    };
}

module.exports = {
    acquireAiRequest,
    isPromptExtractionAttempt
};
