function registerClientEvents(client, {
    qrcode,
    startDeadlineMonitor,
    startPollMonitor,
    startDailyReminders,
    startTimetableMonitor,
    startClassWeekendBroadcast,
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

    client.on('ready', async () => {
        console.log('\nCHAOS BOT by Chriss IS ONLINE!');
        console.log('Waiting for group and private messages...\n');
        startDeadlineMonitor(client);
        startPollMonitor(client);
        startDailyReminders(client);
        startTimetableMonitor(client);
        startClassWeekendBroadcast(client);
        restoreWordForgeGames(client);
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


    client.on('authenticated', () => {
        console.log('WhatsApp authenticated!');
    });
}

module.exports = { registerClientEvents };
