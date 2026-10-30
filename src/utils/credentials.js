const crypto = require('crypto');

const HASH_PREFIX = 'scrypt-v1$';
const KEY_LENGTH = 64;
const SCRYPT_OPTIONS = {
    N: 1 << 14,
    r: 8,
    p: 1,
    maxmem: 64 * 1024 * 1024
};

function isSecretHash(value) {
    return typeof value === 'string' && value.startsWith(HASH_PREFIX);
}

function hashSecret(value) {
    const secret = String(value);
    const salt = crypto.randomBytes(16);
    const derivedKey = crypto.scryptSync(secret, salt, KEY_LENGTH, SCRYPT_OPTIONS);

    return `${HASH_PREFIX}${salt.toString('hex')}$${derivedKey.toString('hex')}`;
}

function verifySecret(candidate, storedValue) {
    if (typeof storedValue !== 'string') return false;

    if (!isSecretHash(storedValue)) {
        const candidateBuffer = Buffer.from(String(candidate));
        const storedBuffer = Buffer.from(storedValue);
        return candidateBuffer.length === storedBuffer.length &&
            crypto.timingSafeEqual(candidateBuffer, storedBuffer);
    }

    const [, saltHex, expectedHex] = storedValue.split('$');
    if (!/^[a-f0-9]{32}$/i.test(saltHex || '') || !/^[a-f0-9]{128}$/i.test(expectedHex || '')) {
        return false;
    }

    const salt = Buffer.from(saltHex, 'hex');
    const expected = Buffer.from(expectedHex, 'hex');
    const actual = crypto.scryptSync(String(candidate), salt, expected.length, SCRYPT_OPTIONS);
    return crypto.timingSafeEqual(actual, expected);
}

function generateAuthorizationCode() {
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = 'REP-';
    for (let i = 0; i < 5; i++) code += alphabet[crypto.randomInt(alphabet.length)];
    return code;
}

function generateNumericOtp() {
    return String(crypto.randomInt(1000, 10000));
}

module.exports = {
    hashSecret,
    isSecretHash,
    verifySecret,
    generateAuthorizationCode,
    generateNumericOtp
};
