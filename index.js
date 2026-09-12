require('dotenv').config();

const fs = require('fs');
const path = require('path');
const { GoogleGenAI } = require('@google/genai');
const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');

// ============================================================
// DATABASE
// ============================================================

const {
    addXP,
    getUserBalance,
    deductBalance,
    transferCoins,
    getUser,
    readDB,
    writeDB,
    resetEconomy
} = require('./src/database/db');

// ============================================================
// COMMANDS
// ============================================================

const { handleProfileCommand } = require('./src/commands/profile');

const {
    startWordleLobby,
    joinLobby,
    processGuess,
    stopGame
} = require('./src/games/wordle');

const {
    startWordChainLobby,
    joinWordChain,
    startWordChainGame,
    processWordChain,
    stopWordChainCommand
} = require('./src/games/wordchain');

const {
    startRebusLobby,
    joinRebusLobby,
    processRebusGuess,
    processRebusHint,
    handleStealCommand
} = require('./src/games/rebuscountry');

const { getGamesList } = require('./src/commands/gameslist');
const { handleBalanceCommand } = require('./src/commands/balance');
const { getWeather } = require('./src/tools/weather');

// ============================================================
// WEATHER RESPONSE BUILDER
// ============================================================

function buildWeatherResponse(weatherData, userName) {
    const formatTime = (isoStr) => {
        if (!isoStr) return 'N/A';
        return new Date(isoStr).toLocaleTimeString([], {
            hour: '2-digit',
            minute: '2-digit'
        });
    };

    return `🌤️ *CHAOS WEATHER SYSTEM*\n` +
        `━━━━━━━━━━━━━━━━━━\n\n` +
        `📍 *Location:* ${weatherData.city}, ${weatherData.country}\n` +
        `🌐 *Coords:* ${weatherData.latitude}, ${weatherData.longitude}\n\n` +
        `🌡️ *Temp:* ${weatherData.temp}°C (Feels like ${weatherData.feelsLike}°C)\n` +
        `📊 *Min/Max:* ${weatherData.tempMin}°C / ${weatherData.tempMax}°C\n` +
        `☁️ *Conditions:* ${weatherData.condition}\n` +
        `☁️ *Clouds:* ${weatherData.clouds}%\n` +
        `💧 *Humidity:* ${weatherData.humidity}%\n` +
        `🎈 *Pressure:* ${weatherData.pressure} hPa\n` +
        `👁️ *Visibility:* ${weatherData.visibility} m\n\n` +
        `💨 *Wind:* ${weatherData.windSpeed} m/s (${weatherData.windDirection}°)\n` +
        `🌬️ *Gusts:* ${weatherData.windGust} m/s\n\n` +
        `🌅 *Sunrise:* ${formatTime(weatherData.sunrise)}\n` +
        `🌇 *Sunset:* ${formatTime(weatherData.sunset)}\n` +
        `━━━━━━━━━━━━━━━━━━\n` +
        `👤 *${userName}* • *ONLINE🟢*\n` +
        `\`wantam\``;
}

const {
    startMafiaLobby,
    joinMafiaLobby,
    handleNightAction,
    castVote,
    endMafiaGame
} = require('./src/games/mafia');

const {
    getCatalogMenu,
    buyAsset,
    saveUserAsset
} = require('./src/database/assets');

const { getBotMenu } = require('./src/commands/helpmenu');
const { handleSongCommand } = require('./src/commands/song');

// Video Command Handler
const { handleVideoCommand, handleVideoQualityReply } = require('./src/commands/video');

// ============================================================
// CHAOS NEURAL CORE GEMINI
// ============================================================

if (!process.env.GEMINI_API_KEY) {
    console.warn('⚠️ A GEMINI_API_KEY is missing from .env');
}

const ai = new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY
});

const aiMemory = new Map();
const MAX_AI_MEMORY = 4;
const aiCooldowns = new Map();
const AI_COOLDOWN_MS = 5000;

// ============================================================
// WHATSAPP CLIENT
// ============================================================

const client = new Client({
    authStrategy: new LocalAuth({
        dataPath: './data/session'
    }),
    puppeteer: {
        headless: true,
        protocolTimeout: 1200000,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--js-flags=--max-old-space-size=2048'
        ]
    }
});

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

// ============================================================
// QR & CLIENT EVENTS
// ============================================================

client.on('qr', qr => {
    console.log('\n============================================================');
    console.log('Scan this QR code with WhatsApp:\n');
    qrcode.generate(qr, { small: true });
});

client.on('ready', () => {
    console.log('\nCHAOS BOT by Chriss IS ONLINE!');
    console.log('Waiting for group and private messages...\n');
});

client.on('authenticated', () => {
    console.log('WhatsApp authenticated!');
});

// ============================================================
// MESSAGE HANDLER
// ============================================================

client.on('message', async message => {
    if (message.from === 'status@broadcast') return;

    try {
        const chatId = message.from;

        const wasHandledAsVideoReply = await handleVideoQualityReply(message);
        if (wasHandledAsVideoReply) {
            return;
        }

        const isGroup = message.from.endsWith('@g.us');
        const senderContact = await getSenderContact(message);
        const senderId = await getSenderJid(message, senderContact);
        const economyUserId = senderId;

        const userName = senderContact?.pushname || senderContact?.name || 'Chaos Member';
        const text = message.body ? message.body.trim() : '';
        const lowerText = text.toLowerCase();

        // ====================================================
        // MAFIA PRIVATE NIGHT COMMANDS & REPLIES
        // ====================================================

        if (!isGroup) {
            if (message.hasQuotedMsg) {
                try {
                    const quotedMsg = await message.getQuotedMessage();
                    if (quotedMsg && quotedMsg.body && quotedMsg.body.includes('PROJECT MAFIA CASE')) {
                        await message.reply(
                            '✅ *Private channel established!*\n\n' +
                            'Your direct chat session with the bot is now active.\n' +
                            'Head back to the group and type `!joinmafia` to complete your registration!'
                        );
                        return;
                    }
                } catch (quotedErr) {
                    console.warn('[MAFIA DM] Could not check quoted message:', quotedErr.message);
                }
            }

            if (
                lowerText.startsWith('!kill') ||
                lowerText.startsWith('!save') ||
                lowerText.startsWith('!investigate')
            ) {
                const parts = text.split(/\s+/);
                const command = parts[0].toLowerCase().replace(/^!/, '');
                const targetLetter = parts[1];

                if (!targetLetter) {
                    await message.reply(`Specify a player letter.\n\nExample: \`!${command} C\``);
                    return;
                }

                await handleNightAction(senderId, command, targetLetter, senderContact);
                return;
            }
        } else {
            if (
                lowerText.startsWith('!kill') ||
                lowerText.startsWith('!save') ||
                lowerText.startsWith('!investigate')
            ) {
                await message.reply(
                    '❌ *Night actions are top secret!*\n\n' +
                    'Long-press my message, select *Reply Privately*, and send `!kill`, `!save`, or `!investigate` to me in secret.'
                );
                return;
            }
        }

        // ============================================================
        // GEMINI IMAGE GENERATION (!draw / !image)
        // ============================================================

        if (lowerText.startsWith('!draw ') || lowerText.startsWith('!image ')) {
            const prompt = text.replace(/^!(draw|image)\s+/i, '').trim();

            if (!prompt) {
                await message.reply(
                    '🎨 Please provide a prompt.\n\n' +
                    '*Example:* `!draw a cyberpunk lion in Nairobi`'
                );
                return;
            }

            await message.reply(
                '🎨 *Generative Studio Active...*\n' +
                'Synthesizing image...'
            );

            try {
                const interaction = await ai.interactions.create({
                    model: 'gemini-3.1-flash-image',
                    input: prompt
                });

                const generatedImage = interaction.output_image;

                if (!generatedImage?.data) {
                    throw new Error('Gemini returned no image data.');
                }

                const imageMedia = new MessageMedia(
                    'image/png',
                    generatedImage.data,
                    'generated.png'
                );

                await client.sendMessage(chatId, imageMedia, {
                    caption: `🎨 *Prompt:* "${prompt}"`
                });

            } catch (imgErr) {
                console.error('❌ Image Generation Error:', imgErr);

                await message.reply(
                    '❌ Failed to generate image.\n\n' +
                    `Error: ${imgErr.message}`
                );
            }

            return;
        }

        // ============================================================
        // GEMINI IMAGE ANALYZER (!analyze / !describe)
        // ============================================================

        if (lowerText.startsWith('!analyze') || lowerText.startsWith('!describe')) {
            let targetMsg = message;

            if (message.hasQuotedMsg) {
                try {
                    targetMsg = await message.getQuotedMessage();
                } catch (quoteErr) {
                    console.warn(
                        '❌ Could not retrieve quoted image:',
                        quoteErr.message
                    );
                }
            }

            if (!targetMsg.hasMedia) {
                await message.reply(
                    '🖼️ Please reply to an image or send an image with `!analyze`.'
                );
                return;
            }

            await message.reply(
                '🔍 *Analyzing media content...*'
            );

            try {
                const media = await targetMsg.downloadMedia();

                if (!media || !media.mimetype?.startsWith('image/')) {
                    await message.reply(
                        '❌ Please provide a valid image.'
                    );
                    return;
                }

                const userPrompt =
                    text.replace(/^!(analyze|describe)\s*/i, '').trim() ||
                    'Describe this image in detail.';

                const interaction = await ai.interactions.create({
                    model: 'gemini-3.8-flash',
                    input: [
                        {
                            type: 'text',
                            text: userPrompt
                        },
                        {
                            type: 'image',
                            data: media.data,
                            mime_type: media.mimetype
                        }
                    ]
                });

                const analysis = interaction.output_text?.trim();

                if (!analysis) {
                    throw new Error(
                        'Gemini returned an empty analysis.'
                    );
                }

                await message.reply(
                    `👁️ *Visual Neural Analysis:*\n\n${analysis}`
                );

            } catch (visionErr) {
                console.error(
                    '❌ Vision Analysis Error:',
                    visionErr
                );

                await message.reply(
                    '❌ Failed to analyze image.\n\n' +
                    `Error: ${visionErr.message}`
                );
            }

            return;
        }

        // ============================================================
        // GEMINI TEXT-TO-SPEECH (!speak / !tts)
        // ============================================================

        if (lowerText.startsWith('!speak ') || lowerText.startsWith('!tts ')) {
            const speechText = text
                .replace(/^!(speak|tts)\s+/i, '')
                .trim();

            if (!speechText) {
                await message.reply(
                    '🎙️ Please provide text.\n\n' +
                    '*Example:* `!speak Hello Chaos Group!`'
                );
                return;
            }

            try {
                await message.reply(
                    '🎙️ *CHAOS VOICE ENGINE*\n' +
                    'Generating voice...'
                );

                const interaction = await ai.interactions.create({
                    model: 'gemini-3.1-flash-tts-preview',
                    input: speechText,
                    response_format: {
                        type: 'audio'
                    },
                    generation_config: {
                        speech_config: [
                            {
                                voice: 'Kore'
                            }
                        ]
                    }
                });

                const audioData = interaction.output_audio?.data;

                if (!audioData) {
                    throw new Error(
                        'Gemini returned no audio data.'
                    );
                }

                const audioMedia = new MessageMedia(
                    'audio/wav',
                    audioData,
                    'chaos-tts.wav'
                );

                await client.sendMessage(
                    chatId,
                    audioMedia,
                    {
                        sendAudioAsVoice: true
                    }
                );

            } catch (ttsErr) {
                console.error(
                    '❌ Speech Generation Error:',
                    ttsErr
                );

                await message.reply(
                    '❌ Text-to-speech engine failed.\n\n' +
                    `Error: ${ttsErr.message}`
                );
            }

            return;
        }

        // ====================================================
        // !AI (TEXT & REASONING)
        // ====================================================

        if (lowerText.startsWith('!ai')) {
            const prompt = text.slice(3).trim();

            if (!prompt) {
                await message.reply(
                    '*CHAOS NEURAL CORE*\n\n' +
                    'You forgot to ask something.\n\n' +
                    'Example:\n' +
                    '`!ai How to be smart like Chriss?\n`' +
                    `\`wantam\`\t\t` + `👆😅`
                );
                return;
            }

            if (prompt.toLowerCase().includes('weather')) {
                const weatherMatch = prompt.match(/weather(?:\s+(?:in|for|like\s+in))?\s+(.+)/i);
                const rawCity = weatherMatch?.[1];

                const city = rawCity
                    ?.replace(/[?!.]+$/, '')
                    ?.replace(/\b(today|now|please|right now)\b/gi, '')
                    ?.trim();

                if (!city) {
                    await message.reply("Please specify a city, e.g., `!ai what's the weather in Nairobi?` ");
                    return;
                }

                try {
                    const weatherData = await getWeather({ city });
                    if (weatherData.error) {
                        await message.reply(weatherData.error);
                        return;
                    }
                    await message.reply(buildWeatherResponse(weatherData, userName));
                } catch (weatherError) {
                    console.error('❌ AI Weather Error:', weatherError);
                    await message.reply(
                        '❌ *Weather System Error*\n\n' +
                        'I could not retrieve the weather right now. Please try again.\n' +
                        `\`wantam\`\t\t` + `👆😅`
                    );
                }
                return;
            }

            if (prompt.length > 4000) {
                await message.reply(
                    '*Prompt too long.*\n\n' +
                    'Please keep your question below 4,000 characters.'
                );
                return;
            }

            const now = Date.now();
            const lastUsed = aiCooldowns.get(senderId) || 0;

            if (now - lastUsed < AI_COOLDOWN_MS) {
                const remaining = Math.ceil((AI_COOLDOWN_MS - (now - lastUsed)) / 1000);
                await message.reply(
                    '*Neural Core cooling down...*\n' +
                    `Try again in ${remaining}s.\n` +
                    `\`wantam\`\t\t` + `👆😅`
                );
                return;
            }

            aiCooldowns.set(senderId, now);

            try {
                if (!aiMemory.has(chatId)) {
                    aiMemory.set(chatId, []);
                }
                const history = aiMemory.get(chatId);

                const knownUsers = {
                    '254740042778@c.us': { name: 'Naomi', nickname: 'Ummie', role: 'Chriss ex-girlfriend' },
                    '254111659469@c.us': { name: 'Chriss', nickname: 'Boss', role: 'Master Owner & Creator' },
                    '254743727535@c.us': { name: 'Grace', nickname: 'Gracie', role: 'Wundanyi baddie, admin' },
                    '254792447912@c.us': { name: 'Lydia', nickname: 'Gods daughter', role: 'Voi queen, admin' },
                    '639091427850@c.us': { name: 'Joya', nickname: 'Filipino Girl', role: 'Group member from Philippines' },
                    '254797295755@c.us': { name: 'Chaka', nickname: 'Samuel Chaka', role: 'Mtwapa, learned in Kenyatta, Canteen Leader' },
                    '639289305708@c.us': { name: 'Nicole', nickname: 'Filipino Girl', role: 'Group member from Philippines' },
                    '27822336734@c.us':  { name: 'Lori', nickname: 'New Girl', role: 'Just joined the group, needs guidance, should probably be asking Chriss' },
                    '2349037933622@c.us': { name: 'Gift', nickname: 'Gift Chi', role: 'Group member from Nigeria' },
                    '254112955350@c.us': { name: 'Righa', nickname: 'Righa', role: 'Same school mates with Chaka and Chriss back in highschool, singer and humble guy' },
                    '27838434250@c.us':  { name: 'S.A guy', nickname: 'zzzz', role: 'Group member from South Africa' }
                };

                const currentUserInfo = knownUsers[senderId];
                const speakerLabel = currentUserInfo ? `${currentUserInfo.name} (${currentUserInfo.nickname})` : userName;
                const contextualizedPrompt = `[Speaker Identity: ${speakerLabel}] ${prompt}`;

                history.push({ role: 'user', text: contextualizedPrompt });
                const recentHistory = history.slice(-MAX_AI_MEMORY);
                const contents = recentHistory.map(item => ({
                    role: item.role,
                    parts: [{ text: item.text }]
                }));

                const response = await ai.models.generateContent({
                    model: 'gemini-3.8-flash',
                    contents,
                    config: {
                        systemInstruction:
                            'You are CHAOS NEURAL CORE, the AI intelligence inside a WhatsApp group bot called CHAOS BOT.\n\n' +
                            'The current person speaking to you is identified in their message tag. Use this to recognize them.\n\n' +
                            'IDENTITY:\n' +
                            '- You are the central intelligence of Chaos Bot.\n' +
                            '- Your creator and owner is Chriss. Treat him as the Master Owner and creator.\n' +
                            '- Chriss built and maintains this bot.\n' +
                            '- You may naturally refer to him as Chriss, the boss, or the creator when appropriate.\n\n' +
                            'BOT COMMANDS:\n' +
                            '- !profile — View stats and assets.\n' +
                            '- !daily — Claim the 24-hour bonus.\n' +
                            '- !bal — Check wallet balance.\n' +
                            '- !store — Browse the car and house market.\n' +
                            '- !beg — Ask for street handouts.\n' +
                            '- !buy <item> — Purchase vehicles or homes.\n' +
                            '- !pay <amount> — Pay another player.\n' +
                            '- !games — View available game modes.\n' +
                            '- !draw <prompt> — Generate AI images.\n' +
                            '- !analyze — Describe or analyze a quoted image.\n' +
                            '- !speak <text> — Voice Note generation.\n' +
                            '- !video — Search video, music video, audio, or link from YouTube.'
                    }
                });

                const aiReply = response.text?.trim();
                if (!aiReply) throw new Error('Gemini returned an empty response.');

                history.push({ role: 'model', text: aiReply });
                if (history.length > MAX_AI_MEMORY) {
                    history.splice(0, history.length - MAX_AI_MEMORY);
                }

                await message.reply(aiReply);

            } catch (err) {
                console.error('❌ Chaos Neural Core Error:', err);
                await message.reply('❌ The neural connection was interrupted. Please try again.\n' +
                    `\`wantam\`\t\t` + `👆😅`);
            }
            return;
        }

        // ====================================================
        // WEATHER COMMAND
        // ====================================================

        if (lowerText.startsWith('!weather')) {
            const city = text.replace(/^!weather/i, '').trim();

            if (!city) {
                await message.reply('Please specify a city, e.g., `!weather Nairobi`.');
                return;
            }

            try {
                const weatherData = await getWeather({ city });
                if (weatherData.error) {
                    await message.reply(weatherData.error);
                } else {
                    await message.reply(buildWeatherResponse(weatherData, userName));
                }
            } catch (weatherError) {
                console.error('❌ Weather Command Error:', weatherError);
                await message.reply('❌ *Weather System Error*');
            }
            return;
        }

        // ====================================================
        // RESET
        // ====================================================

        if (lowerText === '!reset' || lowerText === '!clearance' || lowerText === '!wipe') {
            const ownerNumber = '254111659469';
            const isOwner = senderId.includes(ownerNumber);

            if (!isOwner) {
                await message.reply('❌ *Access Denied:* Only the master owner can execute a system reset!');
                return;
            }

            try {
                resetEconomy();
                await message.reply('*SYSTEM RESET SUCCESSFUL!* All wallets, user scores, and economy stats wiped.');
            } catch (err) {
                console.error('System reset error:', err);
                await message.reply('❌ Failed to execute system reset.');
            }
            return;
        }

        // ====================================================
        // MENU
        // ====================================================

        if (
            lowerText === '!help' ||
            lowerText === '!menu' ||
            lowerText === '!commands' ||
            lowerText === 'menu'
        ) {
            try {
                const media = MessageMedia.fromFilePath(path.join(__dirname, 'src/assets/menu.gif'));

                // Single call with gifPlayback enabled
                await client.sendMessage(chatId, media, { 
                    caption: getBotMenu(),
                    gifPlayback: true 
                });

                const assetsDir = path.join(__dirname, 'src/assets');
                const files = fs.readdirSync(assetsDir);
                const songs = files.filter(file => file.toLowerCase().endsWith('.ogg'));

                if (songs.length > 0) {
                    const randomSong = songs[Math.floor(Math.random() * songs.length)];
                    const audioMedia = MessageMedia.fromFilePath(path.join(assetsDir, randomSong));
                    await client.sendMessage(chatId, audioMedia, { sendAudioAsVoice: true });
                }
            } catch (err) {
                console.warn('Could not load menu assets:', err);
                await message.reply(getBotMenu());
            }
            return;
        }

        // ====================================================
        // GAMES LIST
        // ====================================================

        if (
            lowerText === '!games' ||
            lowerText === '!gamelist' ||
            lowerText === '!help games' ||
            lowerText === 'games'
        ) {
            await message.reply(getGamesList());
            return;
        }

        // ====================================================
        // BALANCE
        // ====================================================

        if (lowerText === '!bal' || lowerText === '!balance') {
            const mentions = await message.getMentions();
            const mentionedJid = mentions.length > 0 ? getContactJid(mentions[0]) : null;

            const balanceResponse = await handleBalanceCommand(
                economyUserId,
                userName,
                mentionedJid,
                client
            );

            await message.reply(balanceResponse, chatId, {
                mentions: mentionedJid ? [mentionedJid] : [senderId]
            });
            return;
        }

        // ====================================================
        // PING
        // ====================================================

        if (lowerText === '!ping') {
            await message.reply("🏓 Pong! I'm online and responsive.");
            return;
        }

        // ====================================================
        // PROFILE
        // ====================================================

        if (
            lowerText === '!profile' ||
            lowerText === '!daily' ||
            lowerText === '!leaderboard' ||
            lowerText === '!lb'
        ) {
            await handleProfileCommand(message, client);
            return;
        }

        // ====================================================
        // SONG
        // ====================================================

        if (
            lowerText === '!song' ||
            lowerText === '!randomsong' ||
            lowerText === 'track'
        ) {
            await handleSongCommand(message);
            return;
        }

        // ====================================================
        // VIDEO
        // ====================================================

        if (
            lowerText.startsWith('!video ') ||
            lowerText === '!video'
        ) {
            await handleVideoCommand(message);
            return;
        }

        // ====================================================
        // STORE
        // ====================================================

        if (
            lowerText === '!store' ||
            lowerText === '!catalog' ||
            lowerText === '!market'
        ) {
            await message.reply(getCatalogMenu());
            return;
        }

        // ====================================================
        // BUY
        // ====================================================

        if (lowerText.startsWith('!buy')) {
            const parts = text.split(/\s+/);
            const itemId = parts[1];

            if (!itemId) {
                await message.reply('Specify what you want to buy.\n\nExample: `!buy civic`');
                return;
            }

            const assetResult = buyAsset(economyUserId, itemId);

            if (!assetResult.success) {
                await message.reply(assetResult.message);
                return;
            }

            const item = assetResult.item;
            const currentBalance = getUserBalance(economyUserId);

            if (currentBalance < item.price) {
                await message.reply(
                    `❌ You cannot afford the *${item.name}*!\n` +
                    `Cost: *${item.price.toLocaleString()}*\n` +
                    `Balance: *${currentBalance.toLocaleString()}*`
                );
                return;
            }

            const deducted = deductBalance(economyUserId, item.price);

            if (deducted) {
                saveUserAsset(economyUserId, item);
                await message.reply(
                    '*CONGRATULATIONS!*\n\n' +
                    `${userName} purchased *${item.name}* for *${item.price.toLocaleString()}*!\n\n` +
                    'Check `!profile`.'
                );
            } else {
                await message.reply('❌ Transaction failed. Please try again.');
            }
            return;
        }

        // ====================================================
        // PAY
        // ====================================================

        if (lowerText.startsWith('!pay')) {
            const parts = text.split(/\s+/);
            const amount = parseInt(parts[1]);

            if (isNaN(amount) || amount <= 0) {
                await message.reply('Usage: `!pay 500 @username`');
                return;
            }

            let recipientId = null;
            let recipientName = 'Friend';
            let recipientContact = null;

            const mentions = await message.getMentions();

            if (mentions.length > 0) {
                recipientContact = mentions[0];
                recipientId = getContactJid(recipientContact);
                recipientName = recipientContact.pushname || recipientContact.name || 'Friend';
            } else {
                try {
                    const quotedMessage = await message.getQuotedMessage();
                    if (quotedMessage) {
                        const quotedContact = await quotedMessage.getContact();
                        recipientContact = quotedContact;
                        recipientId = getContactJid(quotedContact);
                        recipientName = quotedContact.pushname || quotedContact.name || 'Friend';
                    }
                } catch (quoteErr) {
                    console.warn('Could not retrieve quoted message for payment.');
                }
            }

            if (!recipientId) {
                await message.reply("You must either *reply* to someone's message or *tag* them.");
                return;
            }

            if (recipientId === economyUserId) {
                await message.reply("❌ You can't send coins to yourself!");
                return;
            }

            const result = transferCoins(economyUserId, recipientId, amount);

            if (!result.success) {
                await message.reply(result.message);
                return;
            }

            await message.reply(
                '*TRANSFER SUCCESSFUL!*\n\n' +
                `You sent *${amount.toLocaleString()}* to *${recipientName}*.\n` +
                `New balance: *${result.senderBalance.toLocaleString()}*`
            );

            try {
                await client.sendMessage(
                    recipientId,
                    `*${userName} just sent you ${amount.toLocaleString()} coins*!\n\nCheck your balance with \`!profile\`.`
                );
            } catch (e) {}

            return;
        }

        // ====================================================
        // BEG
        // ====================================================

        if (lowerText === '!beg' || lowerText === '!request') {
            const user = getUser(economyUserId, userName);
            const currentCoins = user.coins || 0;

            if (currentCoins > 10000) {
                await message.reply("You aren't even poor!\nGo grind mini-games or use `!daily`.");
                return;
            }

            const handout = 2000;
            user.coins = currentCoins + handout;

            const db = readDB();
            db[economyUserId] = user;
            writeDB(db);

            await message.reply(
                `${userName} begged on the streets and received *${handout} coins*!\n\nNew balance: *${user.coins}*.`
            );

            return;
        }

        // ====================================================
        // WORD CHAIN
        // ====================================================

        if (lowerText === '!wordchain') {
            await startWordChainLobby(message);
            return;
        }

        if (lowerText === '!wjoin') {
            await joinWordChain(message);
            return;
        }

        if (lowerText === '!startwordchain') {
            await startWordChainGame(message, client);
            return;
        }

        if (lowerText === '!stopwordchain') {
            await stopWordChainCommand(message, client);
            return;
        }

        // ====================================================
        // WORDLE
        // ====================================================

        if (lowerText === '!wordle') {
            const response = startWordleLobby(chatId, client);
            await message.reply(response);
            return;
        }

        if (lowerText === '!end' || lowerText === '!stopwordle') {
            const resultMessage = stopGame(chatId);
            await message.reply(resultMessage);
            return;
        }

        // ====================================================
        // MAFIA (UNDER MAINTENANCE)
        // ====================================================

        const IS_MAFIA_UNDER_MAINTENANCE = true; // Set to false when fixed

        if (
            lowerText === '!mafia' || 
            lowerText === '!startmafia' || 
            lowerText === '!joinmafia' || 
            lowerText === '!endmafia' || 
            lowerText === '!stopmafia'
        ) {
            if (IS_MAFIA_UNDER_MAINTENANCE) {
                await message.reply(
                    '⚠️ *GAME MAINTENANCE NOTICE*\n\n' +
                    'Project Mafia is currently offline for critical bug fixes and improvements.\n\n' +
                    '🛠️ *Status:* Under Active Maintenance\n' +
                    '📢 *Notice:* Stay tuned for the next system patch update!'
                );
                return;
            }
        }

        // --- Active Game Logic ---

        if (lowerText === '!mafia' || lowerText === '!startmafia') {
            await startMafiaLobby(chatId, client, MessageMedia);
            return;
        }

        if (lowerText === '!joinmafia') {
            const mafiaContact = senderContact || (await getSenderContact(message));
            const mafiaSenderId = getCanonicalJid(mafiaContact) || senderId;

            const mafiaResponse = await joinMafiaLobby(
                chatId,
                mafiaSenderId,
                userName,
                mafiaContact
            );

            if (mafiaResponse) {
                await message.reply(mafiaResponse);
            }
            return;
        }

        if (lowerText === '!endmafia' || lowerText === '!stopmafia') {
            const endResponse = await endMafiaGame(chatId);
            if (endResponse) {
                await message.reply(endResponse);
            }
            return;
        }

        // ====================================================
        // WORDLE JOIN
        // ====================================================

        if (lowerText === '!join') {
            const wordleResponse = joinLobby(chatId, senderId, userName);
            await message.reply(wordleResponse);
            return;
        }

        // ====================================================
        // WORD CHAIN TURN INPUT
        // ====================================================

        const wordChainHandled = await processWordChain(message, client);
        if (wordChainHandled) return;

        // ====================================================
        // WORDLE GUESS
        // ====================================================

        const wordleResponse = processGuess(chatId, text, senderId, userName, client);
        if (wordleResponse) {
            await message.reply(wordleResponse);
            return;
        }

        // ====================================================
        // REBUS / COUNTRY GAME
        // ====================================================

        if (lowerText === '!rebus') {
            const rebusResult = await startRebusLobby(chatId, client);
            if (rebusResult) {
                await client.sendMessage(chatId, rebusResult);
            }
            return;
        }

        if (lowerText === '!joinrebus' || lowerText === '!rjoin') {
            const joinRes = joinRebusLobby(chatId, senderId, userName);
            await message.reply(joinRes);
            return;
        }

        if (lowerText === '!hint') {
            const hintRes = processRebusHint(chatId, senderId, client);
            if (hintRes) {
                await message.reply(hintRes);
            }
            return;
        }

        if (lowerText.startsWith('!steal')) {
            const mentions = await message.getMentions();
            const targetMention = mentions.length > 0 ? getContactJid(mentions[0]) : null;
            const stealRes = handleStealCommand(chatId, senderId, targetMention, client);

            if (stealRes) {
                await message.reply(stealRes, chatId, {
                    mentions: targetMention ? [senderId, targetMention] : [senderId]
                });
            }
            return;
        }

        // ====================================================
        // REBUS DIRECT CHAT GUESS
        // ====================================================

        if (text && !text.startsWith('!')) {
            const handled = processRebusGuess(chatId, text, senderId, userName, client);
            if (handled) return;
        }

        // ====================================================
        // MAFIA VOTE
        // ====================================================

        if (lowerText.startsWith('!vote')) {
            const mentions = await message.getMentions();
            if (mentions.length === 0) {
                await message.reply(
                    '❌ *Invalid Vote*\n\nPlease tag the player you want to vote out during the Day phase.\nExample: `!vote @user`'
                );
                return;
            }

            const targetContact = mentions[0];
            const targetVoteJid = getContactJid(targetContact);

            if (!targetVoteJid) {
                await message.reply('❌ I could not identify that player.');
                return;
            }

            const voteResult = castVote(
                chatId,
                senderId,
                targetVoteJid,
                targetContact?.pushname || targetContact?.name || 'Target',
                targetContact
            );

            await message.reply(voteResult, chatId, {
                mentions: [senderId, targetVoteJid]
            });
            return;
        }

    } catch (err) {
        console.error('❌ General Message Handling Error:', err);
    }
});

// ============================================================
// INITIALIZE WHATSAPP CLIENT
// ============================================================

client.initialize();