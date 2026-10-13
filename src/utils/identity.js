// ============================================================
// JID / ID NORMALIZATION
// ============================================================

function normalizeJid(jid) {
    if (!jid) return null;
    let clean = String(jid).trim();
    if (clean.includes('_')) {
        clean = clean.split('_')[0];
    }
    return clean;
}

// ============================================================
// PHONE NUMBER NORMALIZATION
// ============================================================

function normalizePhoneNumber(number) {
    if (!number) return null;
    const clean = String(number).trim().replace(/[^\d]/g, '');
    return clean || null;
}

// ============================================================
// CANONICAL CONTACT IDENTITY
// ============================================================

function getCanonicalJid(value) {
    if (!value) return null;

    if (typeof value === 'object') {
        if (value.id) {
            const rawId = typeof value.id === 'object' ? value.id._serialized : value.id;
            if (typeof rawId === 'string' && rawId.endsWith('@c.us')) {
                return rawId;
            }
        }

        if (typeof value._serialized === 'string' && value._serialized.endsWith('@c.us')) {
            return value._serialized;
        }

        if (value.number) {
            const number = normalizePhoneNumber(value.number);
            if (number && !number.startsWith('749') && number.length <= 13) {
                return `${number}@c.us`;
            }
        }

        if (value.id) {
            if (typeof value.id === 'object' && value.id._serialized) {
                return getCanonicalJid(value.id._serialized);
            }
            return getCanonicalJid(value.id);
        }

        if (value._serialized) {
            return getCanonicalJid(value._serialized);
        }

        return null;
    }

    let clean = normalizeJid(value);
    if (!clean) return null;

    if (clean.endsWith('@c.us')) {
        const number = normalizePhoneNumber(clean.split('@')[0]);
        return number ? `${number}@c.us` : clean;
    }

    if (clean.endsWith('@lid')) {
        return clean;
    }

    const number = normalizePhoneNumber(clean);
    if (number && !number.startsWith('749') && number.length <= 13) {
        return `${number}@c.us`;
    }

    return clean;
}

async function getSenderContact(message) {
    try {
        return await message.getContact();
    } catch (error) {
        console.warn('[IDENTITY] Could not retrieve sender contact:', error.message);
        return null;
    }
}

async function getSenderJid(message, contact = null) {
    if (contact) {
        const canonical = getCanonicalJid(contact);
        if (canonical) return canonical;
    }
    const rawSender = message.author || message.from;
    return getCanonicalJid(rawSender);
}

function getContactJid(contact) {
    if (!contact) return null;
    return getCanonicalJid(contact);
}

module.exports = {
    normalizeJid,
    normalizePhoneNumber,
    getCanonicalJid,
    getSenderContact,
    getSenderJid,
    getContactJid
};
