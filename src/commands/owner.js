const OWNER_NUMBER = process.env.OWNER_NUMBER;

function isOwner(senderId) {
    if (!senderId || !OWNER_NUMBER) return false;

    // Clean and match the incoming sender ID against the environment variable
    const cleanOwnerNumber = OWNER_NUMBER.replace(/[^\d]/g, '');
    return senderId === `${cleanOwnerNumber}@c.us`;
}

const IMAGE_ACCESS_DENIED_MESSAGE = 'Image Studio is open. Azure features use game dollar balances.';

function canUseImageFeatures() {
    return true;
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

        '💳 *!owner payments*\n' +
        'List pending game dollar purchases (private chat only).\n\n' +

        '✅ *!owner approvepayment <request ID>*\n' +
        'Credit a purchase after verifying it in your payment account.\n\n' +

        '❌ *!owner rejectpayment <request ID> [reason]*\n' +
        'Reject a pending purchase request.\n\n' +

        'ℹ️ *!owner help*\n' +
        'Show this owner panel.\n\n' +

        '━━━━━━━━━━━━━━━━━━\n' +
        '👑 *Master Owner*: \`Chriss\`'
    );
}

module.exports = { OWNER_NUMBER, isOwner, canUseImageFeatures, getOwnerMenu, IMAGE_ACCESS_DENIED_MESSAGE };
