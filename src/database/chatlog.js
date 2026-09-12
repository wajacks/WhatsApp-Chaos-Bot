const fs = require('fs');
const path = require('path');

const LOG_FILE = path.join(__dirname, '../../data/chat_logs.json');

function loadLogs() {
    if (!fs.existsSync(LOG_FILE)) return {};
    try {
        return JSON.parse(fs.readFileSync(LOG_FILE, 'utf8'));
    } catch {
        return {};
    }
}

function saveLogs(logs) {
    fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });
    fs.writeFileSync(LOG_FILE, JSON.stringify(logs, null, 2));
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

    saveLogs(logs);
}

function getChatHistory(chatId) {
    const logs = loadLogs();
    return logs[chatId] || [];
}

module.exports = { logMessage, getChatHistory };