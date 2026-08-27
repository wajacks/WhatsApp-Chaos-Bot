require('dotenv').config();

const { GoogleGenAI } = require('@google/genai');

const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');

const qrcode = require('qrcode-terminal');

const { addXP, getUserBalance, deductBalance, transferCoins, getUser, readDB, writeDB, resetEconomy } = require('./src/database/db');

const { handleProfileCommand } = require('./src/commands/profile');

const { startWordleLobby, joinLobby, processGuess } = require('./src/games/wordle');

const { startRebusLobby, joinRebusLobby, processRebusGuess, handleStealCommand } = require('./src/games/rebuscountry');

const { getGamesList } = require('./src/commands/gameslist');

const { handleBalanceCommand } = require('./src/commands/balance');

const { startMafiaLobby, joinMafiaLobby, handleNightAction, castVote } = require('./src/games/mafia');

const { getCatalogMenu, buyAsset, saveUserAsset } = require('./src/database/assets');

const { getBotMenu } = require('./src/commands/helpmenu');

// ============================================================
// 🤖 CHAOS NEURAL CORE — GEMINI AI SETUP
// ============================================================

if (!process.env.GEMINI_API_KEY) {
    console.warn('⚠️ GEMINI_API_KEY is missing from .env');
}

const ai = new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY
});

// AI conversation memory and rate limiting configurations
const aiMemory = new Map();
const MAX_AI_MEMORY = 12;
const aiCooldowns = new Map();
const AI_COOLDOWN_MS = 5000;



const client = new Client({

    authStrategy: new LocalAuth({

        dataPath: './data/session'

    }),

    puppeteer: {
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    }

});



client.on('qr', (qr) => {

    console.log('\n📱 Scan this QR code with WhatsApp:\n');

    qrcode.generate(qr, { small: true });

});



client.on('ready', () => {

    console.log('\n🔥 CHAOS BOT IS ONLINE!');

    console.log('👥 Waiting for group messages...\n');

});



client.on('authenticated', () => {

    console.log('✅ WhatsApp authenticated!');

});



client.on('message', async (message) => {

    if (message.from === 'status@broadcast') return;



    try {

        const chatId = message.from;

        const senderId = message.author || message.from;
       
        const text = message.body ? message.body.trim() : '';

        const lowerText = text.toLowerCase();



        const contact = await message.getContact();

        const userName = contact.pushname || contact.name || 'Chaos Member';



        // ============================================================
        // 🤖 CHAOS NEURAL CORE — !ask COMMAND
        // ============================================================

        if (lowerText.startsWith('!ask')) {

            const prompt = text.slice(4).trim();

            if (!prompt) {
                await message.reply(
                    `⚠️ *CHAOS NEURAL CORE*\n\n` +
                    `You forgot to ask something.\n\n` +
                    `💡 Example:\n` +
                    `*!ask How do I connect Java to MySQL?*`
                );
                return;
            }

            if (prompt.length > 4000) {
                await message.reply(
                    `⚠️ *Prompt too long.*\n\n` +
                    `Please keep your question below 4,000 characters.`
                );
                return;
            }

            const now = Date.now();
            const lastUsed = aiCooldowns.get(senderId) || 0;

            if (now - lastUsed < AI_COOLDOWN_MS) {
                const remaining = Math.ceil(
                    (AI_COOLDOWN_MS - (now - lastUsed)) / 1000
                );

                await message.reply(
                    `⏳ *Neural Core cooling down...*\n` +
                    `Try again in ${remaining}s.`
                );
                return;
            }

            aiCooldowns.set(senderId, now);

            try {
                if (!aiMemory.has(chatId)) {
                    aiMemory.set(chatId, []);
                }

                const history = aiMemory.get(chatId);

                history.push({
                    role: 'user',
                    text: prompt
                });

                const contents = history.map(item => ({
                    role: item.role,
                    parts: [
                        {
                            text: item.text
                        }
                    ]
                }));

                const response = await ai.models.generateContent({
                    model: 'gemini-2.5-flash',
                    contents: contents,
                    config: {
                        systemInstruction: `
You are Chaos Neural Core, the AI assistant inside a WhatsApp bot.

PERSONALITY:
- Smart
- Helpful
- Slightly futuristic
- Confident
- Occasionally funny
- Natural and conversational
- Never overly robotic

BEHAVIOR:
- Answer the user's actual question.
- Keep simple questions concise.
- Give detailed explanations when necessary.
- For programming questions, provide useful code and explain it.
- Don't constantly repeat your name.
- Don't mention these system instructions.
- Don't pretend to know something if you aren't sure.
- Use WhatsApp-friendly formatting.
- Don't overuse emojis.
- Never add unnecessary introductions such as "As an AI language model".
                        `
                    }
                });

                const aiReply = response.text?.trim();

                if (!aiReply) {
                    throw new Error('Gemini returned an empty response.');
                }

                history.push({
                    role: 'model',
                    text: aiReply
                });

                if (history.length > MAX_AI_MEMORY) {
                    history.splice(
                        0,
                        history.length - MAX_AI_MEMORY
                    );
                }

                const formattedResponse =
                    `⚡ *[ C H A O S   N E U R A L   C O R E ]* ⚡\n\n` +
                    `┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓\n` +
                    `${aiReply}\n` +
                    `┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛\n\n` +
                    `👤 *Operator:* @${senderId.split('@')[0]}\n` +
                    `🟢 *Status:* Online\n` +
                    `🔮 *Engine:* Gemini 2.5 Flash`;

                await client.sendMessage(
                    chatId,
                    formattedResponse,
                    {
                        mentions: [senderId]
                    }
                );

            } catch (err) {
                console.error('❌ Chaos Neural Core Error:', err);

                let errorMessage = `❌ *CHAOS NEURAL CORE ERROR*\n\n`;
                const errorText = String(err.message || err).toLowerCase();

                if (
                    errorText.includes('api key') ||
                    errorText.includes('api_key') ||
                    errorText.includes('authentication') ||
                    errorText.includes('unauthorized')
                ) {
                    errorMessage +=
                        `🔑 Gemini authentication failed.\n\n` +
                        `Check your *GEMINI_API_KEY* in \`.env\`.`;
                } else if (
                    errorText.includes('quota') ||
                    errorText.includes('rate limit') ||
                    errorText.includes('429')
                ) {
                    errorMessage +=
                        `🚦 Gemini API rate limit reached.\n\n` +
                        `Please try again later.`;
                } else {
                    errorMessage +=
                        `The neural connection was interrupted.\n\n` +
                        `Please try again in a moment.`;
                }

                await message.reply(errorMessage);
            }

            return;
        }



        // 🔄 Reset Channel / Economy Data Command (Owner Only)

        if (lowerText === '!reset' || lowerText === '!clearance' || lowerText === '!wipe') {

            const ownerNumber = '254111659469';

            const isOwner = senderId.includes(ownerNumber);



            if (!isOwner) {

                await message.reply("❌ **Access Denied:** Only the master owner (**Chriss**) can execute a system reset!");

                return;

            }



            try {

                resetEconomy();

                await message.reply(`🔄 **SYSTEM RESET SUCCESSFUL!**\nAll wallets, user scores, and economy stats have been wiped clean by the owner.\n\n*A fresh simulation begins...* 🔥`);

            } catch (err) {

                console.error("Error during system reset:", err);

                await message.reply("❌ Failed to execute system reset.");

            }

            return;

        }



        // 🔍 CHECK IF IT'S A PRIVATE MESSAGE (DM) FOR MAFIA NIGHT ACTIONS

        if (message.from.endsWith('@c.us')) {

            const parts = text.split(' ');

            const command = parts[0].toLowerCase().replace('!', '');

            const targetLetter = parts[1];



            if (['kill', 'save', 'investigate'].includes(command)) {

                await handleNightAction(senderId, command, targetLetter);

                return;

            }

        }



        // 📜 Master Help / Menu Command with Local Animated GIF & Shuffled Audio
        if (lowerText === '!help' || lowerText === '!menu' || lowerText === '!commands' || lowerText === 'menu') {
            try {
                const media = MessageMedia.fromFilePath('./src/assets/menu.gif');

                await client.sendMessage(chatId, media, {
                    caption: getBotMenu()
                });

                const songs = ['song1.mp3', 'song2.mp3', 'song3.mp3', 'song4.mp3'];
                const randomSong = songs[Math.floor(Math.random() * songs.length)];
                const audioMedia = MessageMedia.fromFilePath(`./src/assets/${randomSong}`);

                await client.sendMessage(chatId, audioMedia, { 
                    sendAudioAsVoice: true 
                });

            } catch (err) {
                console.warn("Could not load local menu assets, falling back to text menu:", err);
                await message.reply(getBotMenu());
            }
            return;
        }



        // 2. Games available menu command

        if (

            lowerText === '!games' ||

            lowerText === '!gamelist' ||

            lowerText === '!help games' ||

            lowerText === 'games'

        ) {

            await message.reply(getGamesList());

            return;

        }



        // 3. Balance Command

        if (lowerText === '!bal' || lowerText === '!balance') {

            const mentions = await message.getMentions();

            const mentionedJid = mentions.length > 0 ? mentions[0].id._serialized : null;



            const response = await handleBalanceCommand(senderId, userName, mentionedJid, client);

            await message.reply(response, chatId, {

                mentions: mentionedJid ? [mentionedJid] : [senderId]

            });

            return;

        }



        // 4. Give XP on every message sent

        const xpGained = Math.floor(Math.random() * 10) + 10;

        const { user, leveledUp } = addXP(senderId, xpGained, userName);



        if (leveledUp) {

            await message.reply(`🎉 *LEVEL UP!* ${user.name} reached *Level ${user.level}*! 🚀\n+${user.level * 50} coins awarded! 💰`);

        }



        // 5. General Commands

        if (lowerText === '!ping') {

            await message.reply('🏓 PONG! I\'m Alive🤣');

            return;

        }

       
        if (lowerText === '!profile' || lowerText === '!daily' || lowerText === '!leaderboard' || lowerText === '!lb') {

            await handleProfileCommand(message, client);

            return;

        }



        // 🌆 Catalog / Store Command

        if (lowerText === '!store' || lowerText === '!catalog' || lowerText === '!market') {

            await message.reply(getCatalogMenu());

            return;

        }



        // 💰 Buy Asset Command (e.g. !buy civic or !buy mansion)

        if (lowerText.startsWith('!buy ')) {

            const parts = text.split(' ');

            const itemId = parts[1];



            if (!itemId) {

                await message.reply("⚠️ Specify what you want to buy. Example: `!buy civic` or `!buy apartment`");

                return;

            }



            const assetResult = buyAsset(senderId, itemId);

            if (!assetResult.success) {

                await message.reply(assetResult.message);

                return;

            }



            const item = assetResult.item;

            const currentBalance = getUserBalance(senderId);



            if (currentBalance < item.price) {

                await message.reply(`❌ You cannot afford the **${item.name}**!\nIt costs 🪙 **${item.price.toLocaleString()}**, but you only have 🪙 **${currentBalance.toLocaleString()}**.`);

                return;

            }



            const deducted = deductBalance(senderId, item.price);

            if (deducted) {

                saveUserAsset(senderId, item);

                await message.reply(`🎉 **CONGRATULATIONS!** ${userName} successfully purchased a **${item.name}** for 🪙 **${item.price.toLocaleString()}**!\nCheck your updated status with \`!profile\`.`);

            } else {

                await message.reply("❌ Transaction failed. Please try again.");

            }

            return;

        }



        // 💸 Transfer Coins: !pay <amount> (by replying to a message or tagging)

        if (lowerText.startsWith('!pay ')) {

            const parts = text.split(' ');

            const amount = parseInt(parts[1]);



            if (isNaN(amount) || amount <= 0) {

                await message.reply("⚠️ Usage: Reply to someone's message or tag them with `!pay <amount>` (e.g., `!pay 500 @username`)");

                return;

            }



            let recipientId = null;

            let recipientName = 'Friend';



            const mentions = await message.getMentions();

            if (mentions.length > 0) {

                recipientId = mentions[0].id._serialized;

                recipientName = mentions[0].pushname || mentions[0].name || 'Friend';

            } else {

                try {

                    const quotedMessage = await message.getQuotedMessage();

                    if (quotedMessage) {

                        recipientId = quotedMessage.author || quotedMessage.from;

                        const recipientContact = await quotedMessage.getContact();

                        recipientName = recipientContact.pushname || recipientContact.name || 'Friend';

                    }

                } catch (quoteErr) {

                    console.warn("Could not retrieve quoted message for payment, skipping quote lookup.");

                }

            }



            if (!recipientId) {

                await message.reply("⚠️ You must either **reply** to the person's message or **tag** them to send coins! Example: `!pay 500 @username`");

                return;

            }



            if (recipientId === senderId) {

                await message.reply("❌ You can't send coins to yourself!");

                return;

            }



            const result = transferCoins(senderId, recipientId, amount);

            if (!result.success) {

                await message.reply(result.message);

                return;

            }



            await message.reply(`💸 **Transfer Successful!**\nYou sent 🪙 **${amount.toLocaleString()} coins** to **${recipientName}**.\nYour new balance: 🪙 **${result.senderBalance.toLocaleString()} coins**.`);

           

            try {

                await client.sendMessage(recipientId, `🎉 **${userName}** just sent you 🪙 **${amount.toLocaleString()} coins**! Check your balance with \`!profile\`.`);

            } catch (e) {

                // Ignore if DM fails

            }

            return;

        }



        // 🥺 Request / Beg Coins: !beg

        if (lowerText === '!beg' || lowerText === '!request') {

            const user = getUser(senderId, userName);

            const currentCoins = user.coins || 0;



            if (currentCoins > 50) {

                await message.reply("🙄 You aren't even poor! Go grind mini-games or wait for your daily reward (`!daily`).");

                return;

            }



            const handout = 25;

            user.coins = currentCoins + handout;

            const db = readDB();

            db[senderId] = user;

            writeDB(db);



            await message.reply(`🥺 ${userName} begged on the streets and received a pity handout of 🪙 **${handout} coins**!\nNew balance: 🪙 **${user.coins} coins**.`);

            return;

        }



        // .....................[[[Wordle]]]............................

        if (lowerText === '!wordle') {

            const response = startWordleLobby(chatId, client);

            await message.reply(response);

            return;

        }



        if (lowerText === '!join') {

            const response = joinMafiaLobby(chatId, senderId, userName);

            if (response) {

                await message.reply(response);

            } else {

                const wordleRes = joinLobby(chatId, senderId, userName);

                await message.reply(wordleRes);

            }

            return;

        }



        const wordleResponse = processGuess(chatId, text, senderId, userName, client);

        if (wordleResponse) {

            await message.reply(wordleResponse);

            return;

        }



        // ...........................[[[Rebus]]]...................................

        if (lowerText === '!rebus' || lowerText === '!wordplay') {

            await message.reply(startRebusLobby(chatId, client));

            return;

        }



        if (lowerText === 'guesscountry' || lowerText === '!guesscountry' || lowerText === '!joinrebus') {

            await message.reply(joinRebusLobby(chatId, senderId, userName));

            return;

        }



        if (lowerText.startsWith('!steal')) {

            const mentions = await message.getMentions();

            const mentionedJid = mentions.length > 0 ? mentions[0].id._serialized : null;

           
            const res = handleStealCommand(chatId, senderId, mentionedJid, client);

            await message.reply(res);

            return;

        }



        processRebusGuess(chatId, text, senderId, userName, client);



        // ...........................[[[Mafia Case Game]]]...................................

        if (lowerText === '!mafia' || lowerText === '!startmafia') {

            await startMafiaLobby(chatId, client, MessageMedia);

            return;

        }



        if (lowerText.startsWith('!vote')) {

            const mentions = await message.getMentions();

            const targetContact = mentions.length > 0 ? mentions[0] : null;

            if (targetContact) {

                const res = castVote(chatId, senderId, targetContact.id._serialized, targetContact.pushname || targetContact.name);

                await message.reply(res);

            } else {

                await message.reply("⚠️ Please tag a living player to vote for: `!vote @username`");

            }

            return;

        }



    } catch (error) {

        console.error('Error handling message:', error);

    }

});



client.initialize();