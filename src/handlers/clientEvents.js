const { startScheduledRestart } = require('../tools/scheduledRestart');

function registerClientEvents(client, {
    qrcode,
    startDeadlineMonitor,
    startPollMonitor,
    startDailyReminders,
    startTimetableMonitor,
    startClassWeekendBroadcast,
    startSystemMaintenance,
    restoreWordForgeGames
}) {
    client.on('code', (code) => {
        console.log('\n============================================================');
        console.log('🔑 PHONE PAIRING CODE:', code);
        console.log('Type this code into WhatsApp on your phone under Linked Devices.\n');
    });

    client.on('qr', qr => {
        console.log('\n============================================================');
        console.log('Scan this QR code with WhatsApp:\n');
        qrcode.generate(qr, { small: true });
    });

    client.on('change_state', state => {
        console.log(`[WHATSAPP STATE] ${new Date().toISOString()} state=${state}`);
    });

    client.on('disconnected', reason => {
        console.error(`[WHATSAPP DISCONNECTED] ${new Date().toISOString()} reason=${reason}`);
    });

    client.on('ready', async () => {
        console.log('\nCHAOS BOT by Chriss IS ONLINE!');
        console.log('Waiting for group and private messages...\n');
        startDeadlineMonitor(client);
        startPollMonitor(client);
        startDailyReminders(client);
        startTimetableMonitor(client);
        startClassWeekendBroadcast(client);
        startSystemMaintenance(client);
        restoreWordForgeGames(client);
        startScheduledRestart();
    });

        // ====================================================
    // 🔄 RECOVERY & SYSTEM FALLBACK MONITOR (PM2 / Ubuntu)
    // ====================================================
    client.on('message_create', async (msg) => {
        // Only monitor group system announcements ('gp2' or template notifications)
        if (!msg.isGroup || (msg.type !== 'gp2' && msg.type !== 'notification_template')) return;

        try {
            const chat = await msg.getChat();
            
            // 1. FALLBACK FOR AUTO-WELCOME
            if (msg.body.includes('added') || msg.body.includes('joined')) {
                const contactId = msg.mentionedIds?.[0] || msg.recipientIds?.[0];
                const cleanUser = contactId ? `@${contactId.split('@')[0]}` : 'New Member';

                await chat.sendMessage(
                    `👋 Welcome to *${chat.name}*, ${cleanUser}!\n\n` +
                    `I am **Chaos Bot** 🤖. Type \`!menu\` to see games, economy, and tools, or type \`!class\` to open your student portal.\n\n` +
                    `📢 *Stay updated:* Join our official WhatsApp channel:\n` +
                    `https://whatsapp.com`,
                    { mentions: contactId ? [contactId] : [] }
                );
                console.log(`[FALLBACK JOIN] Welcome sent in: ${chat.name}`);
            }

            // 2. FALLBACK FOR LEAVE TRACKER
            if (msg.body.includes('left') || msg.body.includes('removed')) {
                const contactId = msg.mentionedIds?.[0] || msg.id.participant;
                const cleanUser = contactId ? `@${contactId.split('@')[0]}` : 'A member';

                await chat.sendMessage(
                    `🚪 ${cleanUser} has left the group. Goodbye! 👋`,
                    { mentions: contactId ? [contactId] : [] }
                );
                console.log(`[FALLBACK LEAVE] Departure notice sent in: ${chat.name}`);
            }

            // 3. FALLBACK FOR ADMIN UPDATES
            if (msg.body.includes('admin')) {
                const isPromoted = msg.body.includes('now an admin') || msg.body.includes('promoted');
                const action = isPromoted ? 'promoted to *Admin* 👑' : 'demoted from *Admin* 🔻';
                const contactId = msg.mentionedIds?.[0] || msg.id.participant;
                const cleanUser = contactId ? `@${contactId.split('@')[0]}` : 'A user';

                await chat.sendMessage(
                    `📢 *Admin Update:* ${cleanUser} has been ${action} in *${chat.name}*.`,
                    { mentions: contactId ? [contactId] : [] }
                );
                console.log(`[FALLBACK ADMIN] Status tracking posted in: ${chat.name}`);
            }

        } catch (err) {
            console.error('[FALLBACK MONITOR ERROR]:', err.message);
        }
    });


    // Reject direct incoming voice/video calls and ask callers to message instead.
    client.on('call', async (call) => {
        const callFrom = call?.from;
        if (!callFrom || call.fromMe || call.isGroup || callFrom.endsWith('@g.us')) return;

        const callType = call.isVideo ? 'video' : 'voice';
        let callerNumber = callFrom.split('@')[0];
        let replyTo = callFrom;

        console.log(`[CALL] Detected incoming ${callType} call from ${callerNumber}`);

        // Reject before contact/LID lookups so WhatsApp receives the action promptly.
        try {
            await call.reject();
            console.log(`[CALL] Rejected ${callType} call from ${callerNumber}`);
        } catch (err) {
            console.error('[CALL] Could not reject call:', err.message);
        }

        try {
            const contact = await client.getContactById(callFrom);
            callerNumber = contact?.number || callerNumber;
        } catch (err) {
            console.warn('[CALL] Could not load caller contact:', err.message);
        }

        if (callFrom.endsWith('@lid')) {
            try {
                const mappings = await client.getContactLidAndPhone([callFrom]);
                const resolved = Array.isArray(mappings)
                    ? mappings.find((mapping) => mapping.lid === callFrom)
                    : null;
                const phoneJid = resolved?.pn;

                callerNumber = phoneJid?.split('@')[0] || callerNumber;
                replyTo = phoneJid || callFrom;
            } catch (err) {
                console.warn('[CALL] Could not resolve caller LID:', err.message);
            }
        }

        try {
            await client.sendMessage(
                replyTo,
                "I don't accept calls on WhatsApp. Please send me a message instead."
            );
        } catch (err) {
            console.error('[CALL] Could not send caller reply:', err.message);
        }
    });


    client.on('authenticated', () => {
        console.log('WhatsApp authenticated!');
    });
}

module.exports = { registerClientEvents };
