const { getUserProfile } = require('../database/db');

async function handleBalanceCommand(
    senderId,
    senderName,
    mentionedJid,
    client
) {
    const targetId =
        mentionedJid || senderId;

    let displayName =
        senderName;

    if (mentionedJid && client) {
        try {
            const contact =
                await client.getContactById(
                    mentionedJid
                );

            displayName =
                contact.pushname ||
                contact.name ||
                'Player';
        } catch (e) {
            displayName = 'Player';
        }
    }

    const profile =
        getUserProfile(
            targetId,
            displayName
        );

    const tagFormatted =
        targetId.split('@')[0];

    return `💰 *WALLET BALANCE* 💰\n` +
        `━━━━━━━━━━━━━━━━━━━━━\n` +
        `👤 *User:* @${tagFormatted}\n` +
        `🪙 *Balance:* ${profile.balance.toLocaleString()} coins\n` +
        `⭐ *Level:* ${profile.level} (${profile.xp} XP)\n` +
        `━━━━━━━━━━━━━━━━━━━━━`;
}

module.exports = {
    handleBalanceCommand
};