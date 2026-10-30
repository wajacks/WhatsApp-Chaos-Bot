const fs = require('fs');
const path = require('path');
const { hashSecret, isSecretHash } = require('../utils/credentials');

const dataDir = path.join(__dirname, '../../data');
const dbPath = path.join(dataDir, 'classdb.json');
const legacyBackupPath = path.join(dataDir, 'classdb_backup.json');
const backupsDir = path.join(dataDir, 'classdb_backups');
const BACKUP_RETENTION = 10;

let memoryDb = null;
let dirtyRevision = 0;
let persistedRevision = 0;
let flushPromise = null;
let flushTimer = null;

function makeEmptyDB() {
    return { classes: {}, repCodes: [] };
}

function validateDB(value, sourcePath) {
    if (!value || typeof value !== 'object' || Array.isArray(value) ||
        !value.classes || typeof value.classes !== 'object' || Array.isArray(value.classes)) {
        throw new Error(`Invalid Class Portal database structure in ${sourcePath}`);
    }

    if (!Array.isArray(value.repCodes)) value.repCodes = [];
    return value;
}

function parseDBFile(filePath) {
    return validateDB(JSON.parse(fs.readFileSync(filePath, 'utf8')), filePath);
}

function getBackupCandidates() {
    let versioned = [];
    try {
        versioned = fs.readdirSync(backupsDir)
            .filter(name => /^classdb-.*\.json$/.test(name))
            .map(name => path.join(backupsDir, name))
            .map(filePath => ({ filePath, modifiedAt: fs.statSync(filePath).mtimeMs }))
            .sort((a, b) => b.modifiedAt - a.modifiedAt)
            .map(item => item.filePath);
    } catch (error) {
        if (error.code !== 'ENOENT') console.error('[CLASS DB] Could not list backups:', error.message);
    }

    return [
        ...versioned,
        ...(fs.existsSync(legacyBackupPath) ? [legacyBackupPath] : [])
    ];
}

function loadDBWithRecovery() {
    if (fs.existsSync(dbPath)) {
        try {
            return { db: parseDBFile(dbPath), restored: false };
        } catch (primaryError) {
            for (const backupPath of getBackupCandidates()) {
                try {
                    console.error(`[CLASS DB] Primary database is unreadable (${primaryError.message}); recovering from ${backupPath}.`);
                    return { db: parseDBFile(backupPath), restored: true };
                } catch (backupError) {
                    console.error(`[CLASS DB] Ignoring invalid backup ${backupPath}: ${backupError.message}`);
                }
            }

            throw new Error(`Class Portal database is unreadable and no valid backup exists. Original error: ${primaryError.message}`);
        }
    }

    for (const backupPath of getBackupCandidates()) {
        try {
            console.warn(`[CLASS DB] Primary database is missing; restoring ${backupPath}.`);
            return { db: parseDBFile(backupPath), restored: true };
        } catch (backupError) {
            console.error(`[CLASS DB] Ignoring invalid backup ${backupPath}: ${backupError.message}`);
        }
    }

    return { db: makeEmptyDB(), restored: true };
}

function migrateCredentials(db) {
    let changed = false;
    const hashIfNeeded = value => {
        if (typeof value !== 'string' || isSecretHash(value)) return value;
        changed = true;
        return hashSecret(value);
    };

    db.repCodes = db.repCodes.map(hashIfNeeded);
    for (const classData of Object.values(db.classes)) {
        if (!classData || typeof classData !== 'object') continue;
        if (typeof classData.classPassword === 'string') {
            classData.classPassword = hashIfNeeded(classData.classPassword);
        }

        for (const member of Object.values(classData.members || {})) {
            if (!member || typeof member !== 'object') continue;
            if (typeof member.password === 'string') member.password = hashIfNeeded(member.password);
            if (typeof member.securityAnswer === 'string') member.securityAnswer = hashIfNeeded(member.securityAnswer);
            if (typeof member.resetOtp === 'string') member.resetOtp = hashIfNeeded(member.resetOtp);
        }
    }

    return changed;
}

function sanitizeCredentialBackups() {
    for (const backupPath of getBackupCandidates()) {
        try {
            const backupDB = parseDBFile(backupPath);
            if (migrateCredentials(backupDB)) {
                atomicWriteFileSync(backupPath, `${JSON.stringify(backupDB, null, 2)}\n`);
                console.log(`[CLASS DB] Plaintext credentials removed from backup ${backupPath}.`);
            }
        } catch (error) {
            console.error(`[CLASS DB] Could not sanitize backup ${backupPath}:`, error.message);
        }
    }
}

function atomicWriteFileSync(filePath, contents) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
    const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
    let fd;
    try {
        fd = fs.openSync(tempPath, 'w', 0o600);
        fs.writeFileSync(fd, contents, 'utf8');
        fs.fsyncSync(fd);
        fs.closeSync(fd);
        fd = undefined;
        fs.renameSync(tempPath, filePath);
        try { fs.chmodSync(filePath, 0o600); } catch (_) {}
        try {
            const dirFd = fs.openSync(path.dirname(filePath), 'r');
            try { fs.fsyncSync(dirFd); } finally { fs.closeSync(dirFd); }
        } catch (_) {}
    } catch (error) {
        if (fd !== undefined) {
            try { fs.closeSync(fd); } catch (_) {}
        }
        try { fs.unlinkSync(tempPath); } catch (_) {}
        throw error;
    }
}

async function atomicWriteFile(filePath, contents) {
    await fs.promises.mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
    const tempPath = `${filePath}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`;
    let handle;
    try {
        handle = await fs.promises.open(tempPath, 'wx', 0o600);
        await handle.writeFile(contents, 'utf8');
        await handle.sync();
        await handle.close();
        handle = null;
        await fs.promises.rename(tempPath, filePath);
        try { await fs.promises.chmod(filePath, 0o600); } catch (_) {}
        try {
            const directoryHandle = await fs.promises.open(path.dirname(filePath), 'r');
            try { await directoryHandle.sync(); } finally { await directoryHandle.close(); }
        } catch (_) {}
    } catch (error) {
        if (handle) {
            try { await handle.close(); } catch (_) {}
        }
        try { await fs.promises.unlink(tempPath); } catch (_) {}
        throw error;
    }
}

function scheduleFlush(delay = 0) {
    if (flushTimer) return;
    flushTimer = setTimeout(() => {
        flushTimer = null;
        flushClassDB().catch(() => {});
    }, delay);
    if (typeof flushTimer.unref === 'function') flushTimer.unref();
}

function flushClassDB() {
    if (flushPromise) return flushPromise;
    if (!memoryDb || persistedRevision >= dirtyRevision) return Promise.resolve();

    flushPromise = (async () => {
        while (persistedRevision < dirtyRevision) {
            const revision = dirtyRevision;
            const contents = `${JSON.stringify(memoryDb, null, 2)}\n`;
            await atomicWriteFile(dbPath, contents);
            persistedRevision = revision;
        }
    })().catch(error => {
        console.error('[CLASS DB] Durable save failed; changes remain queued for retry:', error);
        scheduleFlush(5000);
        throw error;
    }).finally(() => {
        flushPromise = null;
        if (persistedRevision < dirtyRevision && !flushTimer) scheduleFlush(0);
    });

    return flushPromise;
}

// Load once, migrate legacy plaintext secrets, and schedule the recovered/migrated
// database for a durable atomic write before returning it to callers.
function readClassDB() {
    if (memoryDb) return memoryDb;

    const { db, restored } = loadDBWithRecovery();
    memoryDb = db;
    const migrated = migrateCredentials(memoryDb);
    sanitizeCredentialBackups();
    if (restored || migrated) {
        dirtyRevision += 1;
        scheduleFlush();
        if (migrated) console.log('[CLASS DB] Legacy credentials migrated to salted scrypt hashes.');
    }
    return memoryDb;
}

function writeClassDB(data) {
    memoryDb = validateDB(data, 'in-memory database');
    dirtyRevision += 1;
    scheduleFlush();
}

async function createClassDBBackup() {
    const db = readClassDB();
    await flushClassDB();
    const snapshot = `${JSON.stringify(db, null, 2)}\n`;
    await atomicWriteFile(legacyBackupPath, snapshot);

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const versionedPath = path.join(backupsDir, `classdb-${timestamp}.json`);
    await atomicWriteFile(versionedPath, snapshot);

    const candidates = getBackupCandidates().filter(filePath => filePath.startsWith(backupsDir));
    for (const stalePath of candidates.slice(BACKUP_RETENTION)) {
        try { await fs.promises.unlink(stalePath); } catch (error) {
            console.error(`[CLASS DB] Could not prune old backup ${stalePath}:`, error.message);
        }
    }
    return versionedPath;
}

function resetClassDB() {
    const initialData = makeEmptyDB();
    const contents = `${JSON.stringify(initialData, null, 2)}\n`;
    atomicWriteFileSync(dbPath, contents);
    memoryDb = initialData;
    dirtyRevision += 1;
    persistedRevision = dirtyRevision;
    if (flushTimer) {
        clearTimeout(flushTimer);
        flushTimer = null;
    }

    try {
        atomicWriteFileSync(legacyBackupPath, contents);
        fs.mkdirSync(backupsDir, { recursive: true, mode: 0o700 });
        for (const name of fs.readdirSync(backupsDir)) {
            if (/^classdb-.*\.json$/.test(name)) fs.unlinkSync(path.join(backupsDir, name));
        }
        atomicWriteFileSync(path.join(backupsDir, `classdb-${new Date().toISOString().replace(/[:.]/g, '-')}.json`), contents);
    } catch (error) {
        console.error('[CLASS DB] Could not refresh backup set during reset:', error.message);
    }
}

function classExists(className) {
    const db = readClassDB();
    return !!db.classes[className];
}

function isUserAlreadyRep(userId) {
    const db = readClassDB();
    for (const className in db.classes) {
        if (db.classes[className].repId === userId) return true;
    }
    return false;
}

// Node's exit event is synchronous. Flush the latest snapshot to a temp file,
// fsync it, then rename so PM2 restarts/shutdowns cannot leave a partial JSON file.
process.on('exit', () => {
    if (!memoryDb || persistedRevision >= dirtyRevision) return;
    try {
        atomicWriteFileSync(dbPath, `${JSON.stringify(memoryDb, null, 2)}\n`);
        persistedRevision = dirtyRevision;
    } catch (error) {
        console.error('[CLASS DB] Final synchronous save failed:', error.message);
    }
});

module.exports = {
    readClassDB,
    writeClassDB,
    classExists,
    resetClassDB,
    isUserAlreadyRep,
    createClassDBBackup,
    flushClassDB
};
