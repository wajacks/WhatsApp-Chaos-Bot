const fs = require('fs');
const path = require('path');

const LOG_FILE = path.join(__dirname, '../../data/chat_logs.json');
const TEMP_FILE = `${LOG_FILE}.${process.pid}.tmp`;

let cachedLogs = null;
let writeScheduled = false;
let writeInProgress = false;
let dirty = false;
let retryTimer = null;

function loadLogs() {
    if (cachedLogs) return cachedLogs;

    if (!fs.existsSync(LOG_FILE)) {
        cachedLogs = {};
        return cachedLogs;
    }

    try {
        cachedLogs = JSON.parse(fs.readFileSync(LOG_FILE, 'utf8'));
        if (!cachedLogs || typeof cachedLogs !== 'object' || Array.isArray(cachedLogs)) {
            cachedLogs = {};
        }
    } catch {
        cachedLogs = {};
    }

    return cachedLogs;
}

async function writeSnapshot(snapshot) {
    await fs.promises.mkdir(path.dirname(LOG_FILE), { recursive: true });
    await fs.promises.writeFile(TEMP_FILE, snapshot, 'utf8');
    await fs.promises.rename(TEMP_FILE, LOG_FILE);
}

async function flushQueuedWrites() {
    if (writeInProgress) return;
    writeInProgress = true;

    try {
        while (dirty) {
            dirty = false;
            const snapshot = JSON.stringify(cachedLogs || {}, null, 2);
            await writeSnapshot(snapshot);
        }
    } catch (error) {
        dirty = true;
        console.error('[CHAT LOG] Could not save chat history:', error.message);

        if (!retryTimer) {
            retryTimer = setTimeout(() => {
                retryTimer = null;
                scheduleWrite();
            }, 1000);
            if (retryTimer.unref) retryTimer.unref();
        }
    } finally {
        writeInProgress = false;
        if (dirty && !retryTimer) scheduleWrite();
    }
}

function scheduleWrite() {
    dirty = true;
    if (writeScheduled || writeInProgress) return;

    writeScheduled = true;
    setImmediate(() => {
        writeScheduled = false;
        void flushQueuedWrites();
    });
}

function logMessage(chatId, senderName, text) {
    if (!text || text.startsWith('!')) return; // Ignore bot commands

    const logs = loadLogs();
    if (!logs[chatId]) logs[chatId] = [];

    logs[chatId].push({ sender: senderName, text, time: Date.now() });

    // Keep only the last 50 messages
    if (logs[chatId].length > 50) {
        logs[chatId].shift();
    }

    // Batch and persist writes asynchronously so ordinary messages do not block the bot.
    scheduleWrite();
}

function getChatHistory(chatId) {
    const logs = loadLogs();
    return logs[chatId] || [];
}

module.exports = { logMessage, getChatHistory };
