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


function getWhatsAppId(value) {
    if (!value) return '';
    if (typeof value === 'object') {
        const rawId = value._serialized ||
            (typeof value.id === 'object' && value.id ? value.id._serialized : value.id) ||
            value.pn || value.number;
        return rawId ? getWhatsAppId(rawId) : '';
    }
    return String(value).trim().toLowerCase();
}

function phoneAlias(value) {
    const match = String(value || '').match(/^(\d+)(?:@(?:c\.us|s\.whatsapp\.net))?$/i);
    return match ? 'phone:' + match[1] : '';
}

function getIdentityAliases(value) {
    const id = getWhatsAppId(value);
    const aliases = new Set(id ? ['jid:' + id] : []);
    const phone = phoneAlias(id);
    if (phone) aliases.add(phone);
    return aliases;
}

function aliasesOverlap(left, right) {
    for (const alias of left) {
        if (right.has(alias)) return true;
    }
    return false;
}

async function areSameWhatsAppUser(client, left, right) {
    const leftId = getWhatsAppId(left);
    const rightId = getWhatsAppId(right);
    if (!leftId || !rightId) return false;
    if (leftId === rightId) return true;

    const leftAliases = getIdentityAliases(leftId);
    const rightAliases = getIdentityAliases(rightId);
    if (aliasesOverlap(leftAliases, rightAliases)) return true;

    const lidIds = [...new Set([leftId, rightId].filter(id => id.endsWith('@lid')))];
    if (!lidIds.length || !client || typeof client.getContactLidAndPhone !== 'function') return false;

    try {
        const mappings = await client.getContactLidAndPhone(lidIds);
        for (const mapping of Array.isArray(mappings) ? mappings : []) {
            const mappedAliases = new Set([
                ...getIdentityAliases(mapping && mapping.lid),
                ...getIdentityAliases(mapping && mapping.pn)
            ]);
            if (!mappedAliases.size) continue;
            if (aliasesOverlap(leftAliases, mappedAliases)) {
                mappedAliases.forEach(alias => leftAliases.add(alias));
            }
            if (aliasesOverlap(rightAliases, mappedAliases)) {
                mappedAliases.forEach(alias => rightAliases.add(alias));
            }
        }
    } catch (_) {
        // A failed LID lookup should simply leave this mention unmatched.
    }

    return aliasesOverlap(leftAliases, rightAliases);
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
    areSameWhatsAppUser,
    getSenderContact,
    getSenderJid,
    getContactJid
};
