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



        // 🔄 Reset Channel / Economy Data Command (Owner Only)

        if (lowerText === '!reset' || lowerText === '!clearance' || lowerText === '!wipe') {

            const ownerNumber = '+254111659469';

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



        // 📜 Master Help / Menu Command with Local Animated GIF

        if (lowerText === '!help' || lowerText === '!menu' || lowerText === '!commands' || lowerText === 'menu') {

            try {

                // Load local GIF from your assets folder (make sure menu.gif is in ./src/assets/)

                const media = MessageMedia.fromFilePath('./src/assets/menu.gif');



                await client.sendMessage(chatId, media, {

                    caption: getBotMenu()

                });

            } catch (err) {

                console.warn("Could not load local menu GIF, falling back to text menu:", err);

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

        const xpGained = Math.floor(Math.random() * 16) + 10;

        const { user, leveledUp } = addXP(senderId, xpGained, userName);



        if (leveledUp) {

            await message.reply(`🎉 *LEVEL UP!* ${user.name} reached *Level ${user.level}*! 🚀\n+${user.level * 50} coins awarded! 💰`);

        }



        // 5. General Commands

        if (lowerText === '!ping') {

            await message.reply('🏓 PONG! GAME Bot alive 😈(chriss)');

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

