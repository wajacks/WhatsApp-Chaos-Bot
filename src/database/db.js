const fs = require('fs');
const path = require('path');

const DB_DIR = path.join(__dirname, '../../data');
const DB_PATH = path.join(DB_DIR, 'users.json');

// Ensure database directory and file exist
function initDB() {
    if (!fs.existsSync(DB_DIR)) {
        fs.mkdirSync(DB_DIR, { recursive: true });
    }
    if (!fs.existsSync(DB_PATH)) {
        fs.writeFileSync(DB_PATH, JSON.stringify({}, null, 2));
    }
}

function readDB() {
    initDB();
    try {
        const data = fs.readFileSync(DB_PATH, 'utf8');
        return JSON.parse(data);
    } catch (error) {
        console.error('Error reading DB:', error);
        return {};
    }
}

function writeDB(data) {
    initDB();
    try {
        fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2));
    } catch (error) {
        console.error('Error writing DB:', error);
    }
}

// Get or initialize user profile
function getUser(userId, userName = 'Unknown Player') {
    const db = readDB();
    if (!db[userId]) {
        db[userId] = {
            id: userId,
            name: userName,
            xp: 0,
            level: 1,
            coins: 100,
            wins: 0,
            losses: 0,
            wordsSolved: 0,
            wordsAttempted: 0,
            totalStolen: 0,
            lastDaily: 0
        };
        writeDB(db);
    } else {
        let updated = false;

        // Ensure missing fields are backfilled for existing accounts
        if (db[userId].wordsSolved === undefined) { db[userId].wordsSolved = 0; updated = true; }
        if (db[userId].wordsAttempted === undefined) { db[userId].wordsAttempted = 0; updated = true; }
        if (db[userId].totalStolen === undefined) { db[userId].totalStolen = 0; updated = true; }
        
        // Keep username updated
        if (userName !== 'Unknown Player' && db[userId].name !== userName) {
            db[userId].name = userName;
            updated = true;
        }

        if (updated) writeDB(db);
    }
    return db[userId];
}

// Format profile data for display commands
function getUserProfile(userId, fallbackName = 'Player') {
    const user = getUser(userId, fallbackName);
    return {
        name: user.name || fallbackName,
        balance: user.coins || 0,
        xp: user.xp || 0,
        level: user.level || 1,
        rebusWins: user.wins || 0,
        totalStolen: user.totalStolen || 0
    };
}

// Add this inside src/database/db.js
function resetEconomy() {
    // Overwrites or resets the database object
    // This example clears user balances/coins/XP back to default, or you can wipe the whole DB file
    const db = {}; 
    writeDB(db);
    return { success: true, message: "⚠️ All player balances, wallets, and stats have been completely wiped!" };
}

// Coin economy helpers
function getBalance(userId) {
    const user = getUser(userId);
    return user.coins || 0;
}

// Alias for asset shop compatibility
function getUserBalance(userId, userName = 'Unknown Player') {
    return getBalance(userId);
}

function addCoins(userId, amount) {
    const db = readDB();
    const user = getUser(userId);
    user.coins = (user.coins || 0) + amount;
    db[userId] = user;
    writeDB(db);
    return user.coins;
}

function subtractCoins(userId, amount) {
    const db = readDB();
    const user = getUser(userId);
    user.coins = Math.max(0, (user.coins || 0) - amount);
    db[userId] = user;
    writeDB(db);
    return user.coins;
}

// Alias/Wrapper for asset purchases (deducts coins securely if balance is enough)
function deductBalance(userId, amount) {
    const db = readDB();
    const user = getUser(userId);
    
    if ((user.coins || 0) < amount) {
        return false; // Not enough coins
    }

    user.coins -= amount;
    db[userId] = user;
    writeDB(db);
    return true; // Successfully deducted
}

// Add this inside src/database/db.js
function transferCoins(senderId, recipientId, amount) {
    const db = readDB();
    const sender = getUser(senderId);
    
    if (amount <= 0) return { success: false, message: "❌ Amount must be greater than zero!" };
    if ((sender.coins || 0) < amount) return { success: false, message: "❌ You don't have enough coins for this transfer!" };

    // Deduct from sender, add to recipient
    sender.coins -= amount;
    db[senderId] = sender;

    const recipient = getUser(recipientId);
    recipient.coins = (recipient.coins || 0) + amount;
    db[recipientId] = recipient;

    writeDB(db);
    return { success: true, senderBalance: sender.coins, recipientBalance: recipient.coins };
}

// Add XP and handle leveling up
function addXP(userId, amount, userName) {
    const db = readDB();
    const user = getUser(userId, userName);
    
    user.xp = (user.xp || 0) + amount;
    
    // Formula for level up: (level * 100) XP required for next level
    let xpNeeded = (user.level || 1) * 100;
    let leveledUp = false;
    
    while (user.xp >= xpNeeded) {
        user.level = (user.level || 1) + 1;
        user.coins = (user.coins || 0) + (user.level * 50); // Bonus coins on level up
        leveledUp = true;
        xpNeeded = user.level * 100;
    }
    
    db[userId] = user;
    writeDB(db);
    
    return { user, leveledUp };
}

// Get top users for leaderboard
function getLeaderboard(limit = 5) {
    const db = readDB();
    return Object.values(db)
        .sort((a, b) => (b.xp || 0) - (a.xp || 0))
        .slice(0, limit);
}

module.exports = {
    getUser,
    getUserProfile,
    getBalance,
    getUserBalance,
    addCoins,
    subtractCoins,
    deductBalance,
    addXP,
    readDB,
    writeDB,
    getLeaderboard,
    transferCoins,
    resetEconomy
};