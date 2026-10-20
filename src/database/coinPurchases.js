const fs = require('fs');
const path = require('path');
const { randomBytes } = require('crypto');

const DATA_DIR = path.join(__dirname, '../../data');
const PURCHASES_PATH = path.join(DATA_DIR, 'coin-purchases.json');
const USERS_PATH = path.join(DATA_DIR, 'users.json');
const MIN_PURCHASE_KSH = 10;
const COINS_PER_KSH = 2000;

function readJson(filePath, fallback) {
    try {
        return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch (error) {
        if (error.code === 'ENOENT') return fallback;
        throw error;
    }
}

function writeJsonAtomic(filePath, value) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const tempPath = filePath + '.' + process.pid + '.' + Date.now() + '.tmp';
    try {
        fs.writeFileSync(tempPath, JSON.stringify(value, null, 2) + '\n', {
            encoding: 'utf8',
            mode: 0o600
        });
        fs.renameSync(tempPath, filePath);
    } catch (error) {
        try {
            if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
        } catch (_) {
            // Preserve the original write error.
        }
        throw error;
    }
}

function readLedger() {
    const ledger = readJson(PURCHASES_PATH, { version: 1, requests: {} });
    if (!ledger || ledger.version !== 1 || !ledger.requests ||
        typeof ledger.requests !== 'object' || Array.isArray(ledger.requests)) {
        throw new Error('Coin purchase ledger has an invalid structure.');
    }
    return ledger;
}

function createCoinPurchaseRequest({ userId, userName, amountKsh, transactionCode }) {
    if (typeof userId !== 'string' || !userId.trim()) {
        return { success: false, reason: 'invalid_user' };
    }
    if (!Number.isSafeInteger(amountKsh) || amountKsh < MIN_PURCHASE_KSH) {
        return { success: false, reason: 'invalid_amount' };
    }

    const coins = amountKsh * COINS_PER_KSH;
    if (!Number.isSafeInteger(coins)) {
        return { success: false, reason: 'invalid_amount' };
    }

    const normalizedCode = typeof transactionCode === 'string'
        ? transactionCode.trim().toUpperCase()
        : '';
    if (!/^[A-Z0-9-]{6,32}$/.test(normalizedCode)) {
        return { success: false, reason: 'invalid_reference' };
    }

    const ledger = readLedger();
    const alreadyUsed = Object.values(ledger.requests).some(
        request => request && request.transactionCode === normalizedCode
    );
    if (alreadyUsed) {
        return { success: false, reason: 'duplicate_reference' };
    }

    let id;
    do {
        id = 'CP' + Date.now().toString(36).toUpperCase() + randomBytes(3).toString('hex').toUpperCase();
    } while (ledger.requests[id]);

    const request = {
        id,
        userId: userId.trim(),
        userName: typeof userName === 'string' && userName.trim() ? userName.trim() : 'Chaos Member',
        amountKsh,
        coins,
        transactionCode: normalizedCode,
        status: 'pending',
        createdAt: Date.now()
    };

    ledger.requests[id] = request;
    writeJsonAtomic(PURCHASES_PATH, ledger);
    return { success: true, request };
}

function listPendingCoinPurchases() {
    return Object.values(readLedger().requests)
        .filter(request => request && request.status === 'pending')
        .sort((left, right) => left.createdAt - right.createdAt);
}

function resolvePurchase(requestId, status, reviewerId, reason = '') {
    const id = typeof requestId === 'string' ? requestId.trim().toUpperCase() : '';
    if (!/^CP[A-Z0-9]+$/.test(id)) return { success: false, reason: 'invalid_id' };

    const ledger = readLedger();
    const request = ledger.requests[id];
    if (!request) return { success: false, reason: 'not_found' };
    if (request.status !== 'pending') return { success: false, reason: 'already_resolved', request };

    if (status === 'approved') {
        const users = readJson(USERS_PATH, {});
        if (!users || typeof users !== 'object' || Array.isArray(users)) {
            throw new Error('User balance database has an invalid structure.');
        }

        const user = users[request.userId] || {
            id: request.userId,
            name: request.userName || 'Chaos Member',
            xp: 0,
            level: 1,
            coins: 100,
            wins: 0,
            losses: 0,
            wordsSolved: 0,
            wordsAttempted: 0,
            totalStolen: 0,
            lastDaily: 0
        };
        const creditedIds = Array.isArray(user.creditedCoinPurchaseIds)
            ? user.creditedCoinPurchaseIds
            : [];

        if (!creditedIds.includes(id)) {
            const currentBalance = Number.isSafeInteger(user.coins) && user.coins >= 0 ? user.coins : 0;
            const nextBalance = currentBalance + request.coins;
            if (!Number.isSafeInteger(nextBalance)) {
                throw new Error('The resulting user balance would exceed the supported range.');
            }
            user.coins = nextBalance;
            user.creditedCoinPurchaseIds = [...creditedIds, id];
            users[request.userId] = user;
            writeJsonAtomic(USERS_PATH, users);
        }

        request.balanceAfter = users[request.userId]?.coins;
    }

    request.status = status;
    request.reviewedAt = Date.now();
    request.reviewedBy = typeof reviewerId === 'string' ? reviewerId : null;
    if (status === 'rejected' && reason) request.rejectionReason = String(reason).slice(0, 200);
    writeJsonAtomic(PURCHASES_PATH, ledger);
    return { success: true, request };
}

function approveCoinPurchase(requestId, reviewerId) {
    return resolvePurchase(requestId, 'approved', reviewerId);
}

function rejectCoinPurchase(requestId, reviewerId, reason) {
    return resolvePurchase(requestId, 'rejected', reviewerId, reason);
}

module.exports = {
    MIN_PURCHASE_KSH,
    COINS_PER_KSH,
    createCoinPurchaseRequest,
    listPendingCoinPurchases,
    approveCoinPurchase,
    rejectCoinPurchase
};
