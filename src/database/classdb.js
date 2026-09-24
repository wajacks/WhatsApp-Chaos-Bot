const fs = require('fs');
const path = require('path');

const dbPath = path.join(__dirname, '../../data/classdb.json');

// --- RAM CACHING VARIABLES ---
let memoryDb = null;
let needsSaving = false;

// 1. Read from RAM instead of Hard Drive
function readClassDB() {
    if (!memoryDb) {
        if (!fs.existsSync(dbPath)) {
            // Added repCodes array for the authorization system
            const initialData = { classes: {}, repCodes: [] };
            fs.writeFileSync(dbPath, JSON.stringify(initialData, null, 2));
            memoryDb = initialData;
            return memoryDb;
        }
        try {
            memoryDb = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
            // Backwards compatibility for existing databases
            if (!memoryDb.repCodes) memoryDb.repCodes = []; 
        } catch (error) {
            console.error("Error reading classdb.json:", error);
            memoryDb = { classes: {}, repCodes: [] };
        }
    }
    return memoryDb;
}

// 2. Update RAM and flag it for saving (No more main-thread freezing)
function writeClassDB(data) {
    memoryDb = data;
    needsSaving = true;
}

// 3. Background Disk Writer (Runs every 5 seconds, completely off the main thread)
setInterval(() => {
    if (needsSaving && memoryDb) {
        fs.writeFile(dbPath, JSON.stringify(memoryDb, null, 2), (err) => {
            if (err) console.error("Database save failed!", err);
        });
        needsSaving = false;
    }
}, 5000);

// 4. Force immediate wipe and RAM update
function resetClassDB() {
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
    const initialData = { classes: {}, repCodes: [] };
    memoryDb = initialData; // Reset RAM immediately
    needsSaving = true;     // Queue background save
    
    // Fallback sync write just to be absolutely certain on reset
    try { fs.writeFileSync(dbPath, JSON.stringify(initialData, null, 2)); } 
    catch(e) {}
}

function classExists(className) {
    const db = readClassDB();
    return !!db.classes[className];
}

// NEW: Check if a user is already the rep for any existing class
function isUserAlreadyRep(userId) {
    const db = readClassDB();
    for (const className in db.classes) {
        if (db.classes[className].repId === userId) return true;
    }
    return false;
}

module.exports = { 
    readClassDB, 
    writeClassDB, 
    classExists, 
    resetClassDB, 
    isUserAlreadyRep 
};