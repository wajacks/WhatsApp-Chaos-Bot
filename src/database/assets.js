// src/database/assets.js
const fs = require('fs');
const path = './data/user_assets.json';

// Load or initialize user assets database
function loadAssets() {
    if (!fs.existsSync('./data')) fs.mkdirSync('./data');
    if (!fs.existsSync(path)) fs.writeFileSync(path, JSON.stringify({}));
    return JSON.parse(fs.readFileSync(path, 'utf8'));
}

function saveAssets(data) {
    fs.writeFileSync(path, JSON.stringify(data, null, 2));
}

// Catalog of available luxury assets
const catalog = {
    cars: [
        { id: 'civic', name: '🚗 Honda Civic', price: 5000, type: 'car' },
        { id: 'mustang', name: '🏎️ Ford Mustang', price: 15000, type: 'car' },
        { id: 'lambo', name: '🔥 Lamborghini Aventador', price: 50000, type: 'car' }
    ],
    houses: [
        { id: 'apartment', name: '🏢 Cozy Apartment', price: 10000, type: 'house' },
        { id: 'mansion', name: '🏡 Suburban Mansion', price: 75000, type: 'house' },
        { id: 'penthouse', name: '🏰 Skyline Penthouse', price: 200000, type: 'house' }
    ]
};

function getCatalogMenu() {
    let menu = "🌆 **CHAOS REAL ESTATE & MOTORS** 🌆\n\nFlex your wealth! Buy assets using `!buy <item_id>`:\n\n";
    
    menu += "🚗 **VEHICLES:**\n";
    catalog.cars.forEach(c => {
        menu += `• \`${c.id}\` - ${c.name} — **🪙 ${c.price.toLocaleString()}**\n`;
    });

    menu += "\n🏠 **PROPERTIES:**\n";
    catalog.houses.forEach(h => {
        menu += `• \`${h.id}\` - ${h.name} — **🪙 ${h.price.toLocaleString()}**\n`;
    });

    return menu;
}

function getUserAssets(userId) {
    const data = loadAssets();
    return data[userId] || { car: 'None 🚶‍♂️', house: 'Homeless ⛺' };
}

function buyAsset(userId, itemId) {
    // Find item in catalog
    const allItems = [...catalog.cars, ...catalog.houses];
    const item = allItems.find(i => i.id === itemId.toLowerCase());
    if (!item) return { success: false, message: "❌ Invalid item ID! Type `!store` or `!catalog` to see available cars and houses." };

    return { success: true, item };
}

function saveUserAsset(userId, item) {
    const data = loadAssets();
    if (!data[userId]) data[userId] = { car: 'None 🚶‍♂️', house: 'Homeless ⛺' };

    if (item.type === 'car') data[userId].car = item.name;
    if (item.type === 'house') data[userId].house = item.name;

    saveAssets(data);
}

module.exports = { getCatalogMenu, buyAsset, saveUserAsset, getUserAssets };