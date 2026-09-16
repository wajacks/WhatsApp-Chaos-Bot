const fs = require('fs');
const path = require('path');

const dbPath = path.join(__dirname, '../../data/classdb.json');

function readClassDB() {
    if (!fs.existsSync(dbPath)) {
        // Added repCodes array for the authorization system
        const initialData = { classes: {}, repCodes: [] };
        fs.writeFileSync(dbPath, JSON.stringify(initialData, null, 2));
    }
    try {
        const db = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
        // Backwards compatibility for existing databases
        if (!db.repCodes) db.repCodes = []; 
        return db;
    } catch (error) {
        console.error("Error reading classdb.json:", error);
        return { classes: {}, repCodes: [] };
    }
}

function writeClassDB(data) {
    try {
        fs.writeFileSync(dbPath, JSON.stringify(data, null, 2));
    } catch (error) {
        console.error("Error writing to classdb.json:", error);
    }
}

function resetClassDB() {
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
  }
  const initialData = { classes: {}, repCodes: [] };
  fs.writeFileSync(dbPath, JSON.stringify(initialData, null, 2));
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