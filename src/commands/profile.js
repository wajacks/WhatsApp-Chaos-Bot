const {
    getUser,
    getLeaderboard,
    readDB,
    writeDB
} = require('../database/db');

const { getUserAssets } = require('../database/assets');

function normalizeJid(jid) {
    if (!jid) return null;

    let clean = String(jid).trim();

    if (clean.includes('_')) {
        clean = clean.split('_')[0];
    }

    return clean;
}

function normalizePhoneNumber(number) {
    if (!number) return null;

    const clean = String(number)
        .trim()
        .replace(/[^\d]/g, '');

    return clean || null;
}

function getCanonicalJid(value) {
    if (!value) return null;

    if (typeof value === 'object') {

        if (value.id) {
            const rawId =
                typeof value.id === 'object'
                    ? value.id._serialized
                    : value.id;

            if (
                typeof rawId === 'string' &&
                rawId.endsWith('@c.us')
            ) {
                return rawId;
            }
        }

        if (
            typeof value._serialized === 'string' &&
            value._serialized.endsWith('@c.us')
        ) {
            return value._serialized;
        }

        if (value.number) {
            const number =
                normalizePhoneNumber(value.number);

            if (
                number &&
                !number.startsWith('749') &&
                number.length <= 13
            ) {
                return `${number}@c.us`;
            }
        }

        if (value.id) {
            if (
                typeof value.id === 'object' &&
                value.id._serialized
            ) {
                return getCanonicalJid(
                    value.id._serialized
                );
            }

            return getCanonicalJid(value.id);
        }

        if (value._serialized) {
            return getCanonicalJid(
                value._serialized
            );
        }

        return null;
    }

    let clean = normalizeJid(value);

    if (!clean) return null;

    if (clean.endsWith('@c.us')) {
        const number =
            normalizePhoneNumber(
                clean.split('@')[0]
            );

        return number
            ? `${number}@c.us`
            : clean;
    }

    if (clean.endsWith('@lid')) {
        return clean;
    }

    const number =
        normalizePhoneNumber(clean);

    if (
        number &&
        !number.startsWith('749') &&
        number.length <= 13
    ) {
        return `${number}@c.us`;
    }

    return clean;
}

function getEconomyUserId(message, contact = null) {

    if (contact) {
        const canonical =
            getCanonicalJid(contact);

        if (canonical) {
            return canonical;
        }
    }

    const rawSender =
        message.author || message.from;

    return getCanonicalJid(rawSender);
}

async function handleProfileCommand(message, client) {
    const text = message.body.trim();

    const contact = await message.getContact();

    const senderId =
        getEconomyUserId(message, contact);

    const userName =
        contact?.pushname ||
        contact?.name ||
        'Chaos Warrior';

    // 1. !profile

    if (text.toLowerCase() === '!profile') {
        const user = getUser(senderId, userName);

        const xpNeeded =
            (user.level || 1) * 100;

        const wordleSolved =
            user.wordsSolved || 0;

        // Fetch user's purchased properties and vehicles

        const assets =
            getUserAssets(senderId);

        const response =
`👑 *PLAYER PROFILE* 👑
━━━━━━━━━━━━━━━━━━

👤 *Name:* ${user.name}
📊 *Level:* ${user.level || 1}
⭐ *XP:* ${user.xp || 0} / ${xpNeeded}
💵 *Dollars:* $${(user.coins || 0).toLocaleString()}
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

        const user =
            getUser(senderId, userName);

        const now = Date.now();

        const cooldown =
            24 * 60 * 60 * 1000;

        if (
            user.lastDaily &&
            (now - user.lastDaily < cooldown)
        ) {
            const remainingMs =
                cooldown - (now - user.lastDaily);

            const hoursLeft =
                Math.floor(
                    remainingMs /
                    (1000 * 60 * 60)
                );

            const minsLeft =
                Math.floor(
                    (remainingMs %
                        (1000 * 60 * 60)) /
                    (1000 * 60)
                );

            await message.reply(
                `⏳ You've already claimed your daily reward!\nCome back in *${hoursLeft}h ${minsLeft}m*.`
            );

            return;
        }

        const rewardCoins = 150;

        user.coins =
            (user.coins || 0) +
            rewardCoins;

        user.lastDaily = now;

        db[senderId] = user;

        writeDB(db);

        await message.reply(
            `🎁 *DAILY REWARD CLAIMED!*\nYou received *$${rewardCoins}* 💵\nTotal balance: *$${user.coins.toLocaleString()}*.`
        );

        return;
    }

    // 3. !leaderboard / !lb

    if (
        text.toLowerCase() === '!leaderboard' ||
        text.toLowerCase() === '!lb'
    ) {
        const topPlayers =
            getLeaderboard(5);

        if (topPlayers.length === 0) {
            await message.reply(
                '🏆 Leaderboard is currently empty!'
            );

            return;
        }

        let lbMessage =
            `🏆 *CHAOS BOT LEADERBOARD* 🏆\n━━━━━━━━━━━━━━━━━━\n`;

        const medals = [
            '🥇',
            '🥈',
            '🥉',
            '4️⃣',
            '5️⃣'
        ];

        topPlayers.forEach((p, index) => {
            lbMessage +=
                `${medals[index]} *${p.name}* — Lvl ${p.level || 1} (${p.xp || 0} XP)\n`;
        });

        lbMessage +=
            `━━━━━━━━━━━━━━━━━━`;

        await message.reply(lbMessage);

        return;
    }
}

module.exports = {
    handleProfileCommand,
    getEconomyUserId
};