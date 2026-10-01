const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mafia-player-links-'));
process.env.MAFIA_DB_PATH = path.join(tempDir, 'mafia-players.json');

const {
    getKnownPlayerLinks,
    rememberPlayerIdentities
} = require('../src/database/mafiadb');

rememberPlayerIdentities('254700000001@c.us', [
    '254700000001@c.us',
    '749000000001@lid',
    '254700000001@c.us_3EB0ABC'
]);

const links = new Map(getKnownPlayerLinks());
assert.equal(links.get('254700000001@c.us'), '254700000001@c.us');
assert.equal(links.get('749000000001@lid'), '254700000001@c.us');
assert.equal(links.get('254700000001@c.us'), '254700000001@c.us');

const { MafiaGame } = require('../src/games/mafia');
const firstGame = new MafiaGame({}, {});
firstGame.registerIdentityAlias('749000000002@lid', '254700000002@c.us');

const restartedGame = new MafiaGame({}, {});
assert.equal(
    restartedGame.canonicalizeIdentity('749000000002@lid'),
    '254700000002@c.us',
    'a DM LID must resolve to the group registration identity after a restart'
);

const stored = JSON.parse(fs.readFileSync(process.env.MAFIA_DB_PATH, 'utf8'));
assert.equal(stored.version, 1);
assert.equal(stored.aliases['749000000001@lid'].canonicalId, '254700000001@c.us');

fs.rmSync(tempDir, { recursive: true, force: true });
console.log('mafia identity registry tests passed');
