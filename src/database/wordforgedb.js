const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '../../data');
const DB_PATH = process.env.WORDFORGE_DB_PATH || path.join(DATA_DIR, 'wordforge.json');
const HISTORY_LIMIT = 25;

function emptyStore() {
    return {
        version: 1,
        activeMatches: {},
        history: [],
        pendingSteals: {}
    };
}

function readStore() {
    if (!fs.existsSync(DB_PATH)) return emptyStore();

    try {
        const parsed = JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
        return {
            version: 1,
            activeMatches: parsed && parsed.activeMatches && typeof parsed.activeMatches === 'object'
                ? parsed.activeMatches
                : {},
            history: Array.isArray(parsed && parsed.history) ? parsed.history : [],
            pendingSteals: parsed && parsed.pendingSteals && typeof parsed.pendingSteals === 'object'
                ? parsed.pendingSteals
                : {}
        };
    } catch (error) {
        console.error('[WORD FORGE DB] Could not read the match database:', error.message);
        return emptyStore();
    }
}

function writeStore(store) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const temporaryPath = DB_PATH + '.tmp';

    try {
        fs.writeFileSync(temporaryPath, JSON.stringify(store, null, 2), 'utf8');
        fs.renameSync(temporaryPath, DB_PATH);
    } catch (error) {
        try {
            if (fs.existsSync(temporaryPath)) fs.unlinkSync(temporaryPath);
        } catch (_) {}
        throw error;
    }
}

function loadActiveMatches() {
    return Object.values(readStore().activeMatches);
}

function getMatch(groupId) {
    return readStore().activeMatches[groupId] || null;
}

function saveMatch(groupId, match) {
    if (!groupId || !match || typeof match !== 'object') {
        throw new TypeError('A group ID and match object are required.');
    }

    const store = readStore();
    store.activeMatches[groupId] = match;
    writeStore(store);
}

function removeMatch(groupId) {
    const store = readStore();
    delete store.activeMatches[groupId];
    writeStore(store);
}

function archiveMatch(groupId, match) {
    const store = readStore();
    delete store.activeMatches[groupId];

    if (match && typeof match === 'object') {
        store.history.unshift(match);
        store.history = store.history.slice(0, HISTORY_LIMIT);
    }

    writeStore(store);
}

function loadPendingSteals() {
    return readStore().pendingSteals;
}

function getPendingSteal(winnerId) {
    return readStore().pendingSteals[winnerId] || null;
}

function savePendingSteal(winnerId, steal) {
    if (!winnerId || !steal || typeof steal !== 'object') {
        throw new TypeError('A winner ID and steal record are required.');
    }

    const store = readStore();
    store.pendingSteals[winnerId] = steal;
    writeStore(store);
}

function removePendingSteal(winnerId) {
    const store = readStore();
    delete store.pendingSteals[winnerId];
    writeStore(store);
}

module.exports = {
    loadActiveMatches,
    getMatch,
    saveMatch,
    removeMatch,
    archiveMatch,
    loadPendingSteals,
    getPendingSteal,
    savePendingSteal,
    removePendingSteal
};
