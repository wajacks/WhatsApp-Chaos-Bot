const fs = require('fs');
const path = require('path');

const DB_PATH = process.env.MAFIA_DB_PATH || path.join(__dirname, '../../data/mafia-players.json');
const MAX_ALIASES = 5000;

function readMafiaDB() {
    try {
        if (!fs.existsSync(DB_PATH)) {
            return { version: 1, aliases: {} };
        }

        const data = JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
        return {
            version: 1,
            aliases: data.aliases && typeof data.aliases === 'object' ? data.aliases : {}
        };
    } catch (error) {
        console.error('[MAFIA DB] Failed to read player links:', error.message);
        return { version: 1, aliases: {} };
    }
}

function writeMafiaDB(data) {
    const directory = path.dirname(DB_PATH);
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2));
}

function normalizeIdentity(identity) {
    if (!identity) return null;
    const normalized = String(identity).trim().split('_')[0];
    return normalized || null;
}

function rememberPlayerIdentities(canonicalId, identities) {
    const canonical = normalizeIdentity(canonicalId);
    if (!canonical) return;

    const db = readMafiaDB();
    const now = new Date().toISOString();
    const values = new Set([canonical, ...(identities || [])]);

    for (const identity of values) {
        const alias = normalizeIdentity(identity);
        if (alias) {
            db.aliases[alias] = { canonicalId: canonical, updatedAt: now };
        }
    }

    const aliases = Object.entries(db.aliases)
        .sort(([, a], [, b]) => String(b.updatedAt).localeCompare(String(a.updatedAt)))
        .slice(0, MAX_ALIASES);
    db.aliases = Object.fromEntries(aliases);
    writeMafiaDB(db);
}

function getKnownPlayerLinks() {
    return Object.entries(readMafiaDB().aliases)
        .map(([alias, record]) => [alias, normalizeIdentity(record?.canonicalId)])
        .filter(([, canonicalId]) => canonicalId);
}

module.exports = {
    getKnownPlayerLinks,
    rememberPlayerIdentities
};
