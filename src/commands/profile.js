const { getUser, getLeaderboard, readDB, writeDB } = require('../database/db');
const { getUserAssets } = require('../database/assets');

async function handleProfileCommand(message, client) {
    const text = message.body.trim();
    const senderId = message.author || message.from;
    const contact = await message.getContact();
    const userName = contact.pushname || contact.name || 'Chaos Warrior';

    // 1. !profile
    if (text.toLowerCase() === '!profile') {
        const user = getUser(senderId, userName);
        const xpNeeded = (user.level || 1) * 100;
        const wordleSolved = user.wordsSolved || 0;
        
        // Fetch user's purchased properties and vehicles
        const assets = getUserAssets(senderId);

        const response = 
`👑 *PLAYER PROFILE* 👑
━━━━━━━━━━━━━━━━━━
👤 *Name:* ${user.name}
📊 *Level:* ${user.level || 1}
⭐ *XP:* ${user.xp || 0} / ${xpNeeded}
💰 *Coins:* ${user.coins || 0}
⚔️ *Wins/Losses:* ${user.wins || 0}W - ${user.losses || 0}L
🔤 *Wordle Solves:* ${wordleSolved}

🚘 *Vehicle:* ${assets.car}
🏠 *Residence:* ${assets.house}
━━━━━━━━━━━━━━━━━━`;

        await message.reply(response);
        return;
    }

    // 2. !daily
    if (text.toLowerCase() === '!daily') {
        const db = readDB();
        const user = getUser(senderId, userName);
        const now = Date.now();
        const cooldown = 24 * 60 * 60 * 1000; // 24 hours

        if (user.lastDaily && (now - user.lastDaily < cooldown)) {
            const remainingMs = cooldown - (now - user.lastDaily);
            const hoursLeft = Math.floor(remainingMs / (1000 * 60 * 60));
            const minsLeft = Math.floor((remainingMs % (1000 * 60 * 60)) / (1000 * 60));
            
            await message.reply(`⏳ You've already claimed your daily reward!\nCome back in *${hoursLeft}h ${minsLeft}m*.`);
            return;
        }

        const rewardCoins = 150;
        user.coins = (user.coins || 0) + rewardCoins;
        user.lastDaily = now;
        db[senderId] = user;
        writeDB(db);

        await message.reply(`🎁 *DAILY REWARD CLAIMED!*\nYou received *${rewardCoins} coins* 💰\nTotal balance: *${user.coins} coins*.`);
        return;
    }

    // 3. !leaderboard / !lb
    if (text.toLowerCase() === '!leaderboard' || text.toLowerCase() === '!lb') {
        const topPlayers = getLeaderboard(5);
        if (topPlayers.length === 0) {
            await message.reply('🏆 Leaderboard is currently empty!');
            return;
        }

        let lbMessage = `🏆 *CHAOS BOT LEADERBOARD* 🏆\n━━━━━━━━━━━━━━━━━━\n`;
        const medals = ['🥇', '🥈', '🥉', '4️⃣', '5️⃣'];

        topPlayers.forEach((p, index) => {
            lbMessage += `${medals[index]} *${p.name}* — Lvl ${p.level || 1} (${p.xp || 0} XP)\n`;
        });

        lbMessage += `━━━━━━━━━━━━━━━━━━`;
        await message.reply(lbMessage);
        return;
    }
}

module.exports = { handleProfileCommand };