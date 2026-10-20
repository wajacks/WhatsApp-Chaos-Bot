const { MIN_PURCHASE_KSH, COINS_PER_KSH } = require('../../database/coinPurchases');

async function handleCoinPurchaseCommand(context) {
    const { message, text, senderId, userName, client, ownerNumber, createCoinPurchaseRequest } = context;
    const match = text.match(/^!buycoins(?:\s+([\s\S]*))?$/i);
    if (!match) return false;

    const args = (match[1] || '').trim().split(/\s+/).filter(Boolean);
    if (args.length !== 2 || !/^\d+$/.test(args[0])) {
        await message.reply(
            '💳 *Buy game dollars*\n\n' +
            'Pay using the payment details confirmed by the bot owner, then send:\n' +
            '`!buycoins <KSh amount> <M-Pesa transaction code>`\n\n' +
            'Minimum: KSh ' + MIN_PURCHASE_KSH.toLocaleString() + ' = $' +
            (MIN_PURCHASE_KSH * COINS_PER_KSH).toLocaleString() +
            ' game dollars. The owner verifies each payment before crediting it.'
        );
        return true;
    }

    const amountKsh = Number(args[0]);
    const result = createCoinPurchaseRequest({
        userId: senderId,
        userName,
        amountKsh,
        transactionCode: args[1]
    });

    if (!result.success) {
        const messages = {
            invalid_amount: '❌ The minimum purchase is KSh ' + MIN_PURCHASE_KSH.toLocaleString() +
                ', and the amount must be a whole number within the supported range.',
            invalid_reference: '❌ Enter a valid transaction code using 6–32 letters, numbers, or hyphens.',
            duplicate_reference: '❌ That transaction code has already been submitted.'
        };
        await message.reply(messages[result.reason] || '❌ I could not create that purchase request.');
        return true;
    }

    const purchase = result.request;
    const ownerId = String(ownerNumber || '').replace(/\D/g, '');
    let ownerNotified = false;
    if (ownerId) {
        try {
            await client.sendMessage(
                ownerId + '@c.us',
                '💳 *GAME DOLLAR PURCHASE REVIEW*\n\n' +
                '*Request:* ' + purchase.id + '\n' +
                '*Player:* ' + purchase.userName + ' (+' + purchase.userId.replace(/\D/g, '') + ')\n' +
                '*Amount:* KSh ' + purchase.amountKsh.toLocaleString() + '\n' +
                '*Coins:* $' + purchase.coins.toLocaleString() + '\n' +
                '*Transaction code:* ' + purchase.transactionCode + '\n\n' +
                'Verify the payment in your official payment account, then use:\n' +
                '`!owner approvepayment ' + purchase.id + '`\n' +
                'or `!owner rejectpayment ' + purchase.id + ' [reason]`.'
            );
            ownerNotified = true;
        } catch (error) {
            console.error('[COIN PURCHASE] Could not notify the owner:', error.message);
        }
    }

    await message.reply(
        '🕒 Purchase request *' + purchase.id + '* recorded for KSh ' +
        purchase.amountKsh.toLocaleString() + ' → $' + purchase.coins.toLocaleString() +
        ' game dollars. It will be credited after the owner verifies the payment.' +
        (ownerNotified ? ' The owner has been notified.' : ' Contact the owner with this request ID.')
    );
    return true;
}

module.exports = { handleCoinPurchaseCommand };
