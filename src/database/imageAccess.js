'use strict';

const fs = require('fs');
const path = require('path');

const MAX_GRANT_DURATION_MS = 365 * 24 * 60 * 60 * 1000;
const DEFAULT_ACCESS_FILE = path.join(__dirname, '../../data/image-access.json');

function normalizeWhatsAppNumber(value) {
    if (typeof value !== 'string') return null;

    let number = value.trim();
    if (/@c\.us$/i.test(number)) {
        number = number.replace(/@c\.us$/i, '');
    }
    if (!/^\+?[\d\s().-]+$/.test(number)) return null;

    const digits = number.replace(/\D/g, '');
    if (digits.length < 7 || digits.length > 15) return null;
    return digits + '@c.us';
}

function parseDuration(value) {
    if (typeof value !== 'string') return null;
    const match = value.trim().match(/^(\d+)(m|h|d)$/i);
    if (!match) return null;

    const amount = Number(match[1]);
    if (!Number.isSafeInteger(amount) || amount <= 0) return null;

    const unitMs = { m: 60 * 1000, h: 60 * 60 * 1000, d: 24 * 60 * 60 * 1000 }[match[2].toLowerCase()];
    const durationMs = amount * unitMs;
    if (!Number.isSafeInteger(durationMs) || durationMs > MAX_GRANT_DURATION_MS) return null;
    return durationMs;
}

function createImageAccessStore(filePath = DEFAULT_ACCESS_FILE) {
    function readState() {
        let raw;
        try {
            raw = fs.readFileSync(filePath, 'utf8');
        } catch (error) {
            if (error.code === 'ENOENT') return { version: 1, grants: {} };
            throw error;
        }

        const state = JSON.parse(raw);
        if (!state || state.version !== 1 || !state.grants ||
            typeof state.grants !== 'object' || Array.isArray(state.grants)) {
            throw new Error('Image access data has an invalid structure.');
        }
        return state;
    }

    function writeState(state) {
        const directory = path.dirname(filePath);
        fs.mkdirSync(directory, { recursive: true });
        const tempPath = filePath + '.' + process.pid + '.' + Date.now() + '.tmp';
        try {
            fs.writeFileSync(tempPath, JSON.stringify(state, null, 2) + '\n', { encoding: 'utf8', mode: 0o600 });
            fs.renameSync(tempPath, filePath);
        } catch (error) {
            try {
                if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
            } catch (_) {
                // Keep the original write error.
            }
            throw error;
        }
    }

    function removeExpired(state, now) {
        let changed = false;
        for (const [digits, grant] of Object.entries(state.grants)) {
            if (!grant || !Number.isFinite(grant.expiresAt) || grant.expiresAt <= now) {
                delete state.grants[digits];
                changed = true;
            }
        }
        return changed;
    }

    function grant(number, durationMs, grantedBy, now = Date.now()) {
        const jid = normalizeWhatsAppNumber(number);
        if (!jid) throw new TypeError('A valid WhatsApp number is required.');
        if (!Number.isSafeInteger(durationMs) || durationMs <= 0 || durationMs > MAX_GRANT_DURATION_MS) {
            throw new TypeError('A valid grant duration is required.');
        }

        const state = readState();
        removeExpired(state, now);
        const digits = jid.slice(0, -'@c.us'.length);
        const record = {
            expiresAt: now + durationMs,
            grantedAt: now,
            grantedBy: typeof grantedBy === 'string' ? grantedBy : null
        };
        state.grants[digits] = record;
        writeState(state);
        return { number: jid, ...record };
    }

    function revoke(number) {
        const jid = normalizeWhatsAppNumber(number);
        if (!jid) throw new TypeError('A valid WhatsApp number is required.');

        const state = readState();
        const digits = jid.slice(0, -'@c.us'.length);
        if (!Object.prototype.hasOwnProperty.call(state.grants, digits)) return false;
        delete state.grants[digits];
        writeState(state);
        return true;
    }

    function hasAccess(identity, now = Date.now()) {
        const jid = normalizeWhatsAppNumber(identity);
        if (!jid) return false;

        const state = readState();
        if (removeExpired(state, now)) writeState(state);
        const digits = jid.slice(0, -'@c.us'.length);
        const grant = state.grants[digits];
        return Boolean(grant && Number.isFinite(grant.expiresAt) && grant.expiresAt > now);
    }

    function list(now = Date.now()) {
        const state = readState();
        if (removeExpired(state, now)) writeState(state);
        return Object.entries(state.grants)
            .filter(([, grant]) => grant && Number.isFinite(grant.expiresAt) && grant.expiresAt > now)
            .map(([digits, grant]) => ({ number: digits + '@c.us', ...grant }))
            .sort((left, right) => left.expiresAt - right.expiresAt);
    }

    return { grant, revoke, hasAccess, list };
}

const defaultStore = createImageAccessStore();

module.exports = {
    MAX_GRANT_DURATION_MS,
    normalizeWhatsAppNumber,
    parseDuration,
    createImageAccessStore,
    grantImageAccess: defaultStore.grant,
    revokeImageAccess: defaultStore.revoke,
    hasImageAccess: defaultStore.hasAccess,
    listImageAccess: defaultStore.list
};
