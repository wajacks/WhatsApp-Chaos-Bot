const { hasImageAccess } = require('../database/imageAccess');

const OWNER_NUMBER = process.env.OWNER_NUMBER;

function isOwner(senderId) {
    if (!senderId || !OWNER_NUMBER) return false;

    // Clean and match the incoming sender ID against the environment variable
    const cleanOwnerNumber = OWNER_NUMBER.replace(/[^\d]/g, '');
    return senderId === `${cleanOwnerNumber}@c.us`;
}

const IMAGE_ACCESS_DENIED_MESSAGE = '🔒 Image generation and analysis are owner-only. Ask the bot owner for temporary access.';

function canUseImageFeatures(senderId) {
    if (isOwner(senderId)) return true;
    try {
        return hasImageAccess(senderId);
    } catch (error) {
        console.error('[IMAGE ACCESS] Grant data could not be read; access denied:', error.message);
        return false;
    }
}

function getOwnerMenu() {
    return (
        '👑 *CHAOS OWNER CONTROL*\n' +
        '━━━━━━━━━━━━━━━━━━\n\n' +

        '📊 *!owner stats*\n' +
        'View live bot and VPS statistics.\n\n' +

        '💥 *!owner reset*\n' +
        'Reset the entire economy.\n\n' +

        '🏫 *!owner classreset*\n' +
        'Wipe and reset class portals and student records.\n\n' +

        '🔄 *!owner restart*\n' +
        'Restart Chaos Bot through PM2.\n\n' +

        '📥 *!owner update*\n' +
        'Pulls the latest code from GitHub and restart Chaos Bot automatically.\n\n' +

        '📢 *!owner announce <message>*\n' +
        'Announce something in the current chat.\n\n' +

        '📡 *!owner broadcast <message>*\n' +
        'Broadcast an announcement to all groups.\n\n' +

        '🖼️ *!owner allow <WhatsApp number> <duration>*\n' +
        'Temporarily allow image generation and analysis; duration: 1m–365d.\n\n' +

        '🚫 *!owner revoke <WhatsApp number>*\n' +
        'Remove someone’s image access immediately.\n\n' +

        '📋 *!owner allowed*\n' +
        'List active temporary image access grants.\n\n' +

        'ℹ️ *!owner help*\n' +
        'Show this owner panel.\n\n' +

        '━━━━━━━━━━━━━━━━━━\n' +
        '👑 *Master Owner*: \`Chriss\`'
    );
}

module.exports = { isOwner, canUseImageFeatures, getOwnerMenu, IMAGE_ACCESS_DENIED_MESSAGE };
