const fs = require('fs');
const path = require('path');

const dbPath = path.join(__dirname, '../../data/classdb.json');

function readClassDB() {
    if (!fs.existsSync(dbPath)) {
        const initialData = { classes: {} };
        fs.writeFileSync(dbPath, JSON.stringify(initialData, null, 2));
    }
    try {
        return JSON.parse(fs.readFileSync(dbPath, 'utf8'));
    } catch (error) {
        console.error("Error reading classdb.json:", error);
        return { classes: {} };
    }
}

function writeClassDB(data) {
    try {
        fs.writeFileSync(dbPath, JSON.stringify(data, null, 2));
    } catch (error) {
        console.error("Error writing to classdb.json:", error);
    }
}

function classExists(className) {
    const db = readClassDB();
    return !!db.classes[className];
}

module.exports = { readClassDB, writeClassDB, classExists };