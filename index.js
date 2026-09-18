require('dotenv').config();

const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');

const execFileAsync = promisify(execFile);
const { GoogleGenAI } = require('@google/genai');
const { AzureOpenAI } = require('openai');
const axios = require('axios');
const googleTTS = require('google-tts-api');
const { EdgeTTS } = require('node-edge-tts');
const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const readline = require('readline');
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
const { fetchBibleVerse } = require('./src/tools/bible');
const { getHymn } = require('./src/tools/hymnal');
const { sendHymnPianoAudio } = require('./src/tools/hymnalAudio');
const { logMessage, getChatHistory } = require('./src/database/chatlog');

// CLASS PORTAL:
const { resetClassDB } = require('./src/database/classdb');
const { isUserInClassSession, endSession } = require('./src/tools/classSession');
const classHandler = require('./src/commands/classHandler');
const { handleAttendance } = require('./src/commands/classHandler');
const { startDeadlineMonitor } = require('./src/tools/classSession');

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
// CHAOS NEURAL CORE GEMINI INITIALIZATION
// ============================================================

if (!process.env.GEMINI_API_KEY) {
    console.warn('⚠️ A GEMINI_API_KEY is missing from .env');
}

const ai = new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY
});

// AZURE INITIALIZATION
if (!process.env.AZURE_OPENAI_KEY || !process.env.AZURE_OPENAI_ENDPOINT) {
    console.warn('⚠️ Azure OpenAI credentials are missing from .env');
}

const azureClient = new AzureOpenAI({
    endpoint: process.env.AZURE_OPENAI_ENDPOINT,
    apiKey: process.env.AZURE_OPENAI_KEY,
    apiVersion: '2024-05-01-preview'
});

const aiMemory = new Map();
const MAX_AI_MEMORY = 8;

// Cooldown Maps
const aiCooldowns = new Map();
const drawCooldowns = new Map();
const analyzeCooldowns = new Map();
const speakCooldowns = new Map();
const voiceCooldowns = new Map();
const pendingBibleRequests = new Map();

// ====================================================
// 📊 CHAOS CHAT STATISTICS
// ====================================================

const knownGroupChats = new Set();
const knownPrivateChats = new Set();

// ====================================================
// 👑 OWNER SYSTEM
// ====================================================

const OWNER_NUMBER = '254111659469';

function isOwner(senderId) {
    if (!senderId) return false;

    return senderId === `${OWNER_NUMBER}@c.us`;
}

function getOwnerMenu() {
    return (
        '👑 *CHAOS OWNER CONTROL*\n' +
        '━━━━━━━━━━━━━━━━━━\n\n' +

        '📊 *!owner stats*\n' +
        'View live bot and VPS statistics.\n\n' +

        '💥 *!owner reset*\n' +
        'Reset the entire economy.\n\n' +

        '🏫 *!owner classreset*\n' +
        'Wipe and reset class portals and student records.\n\n' +

        '🔄 *!owner restart*\n' +
        'Restart Chaos Bot through PM2.\n\n' +

        '📥 *!owner update*\n' +
        'Pulls the latest code from GitHub and restart Chaos Bot automatically.\n\n' +

        '📢 *!owner announce <message>*\n' +
        'Announce something in the current chat.\n\n' +

        '📡 *!owner broadcast <message>*\n' +
        'Broadcast an announcement to all groups.\n\n' +

        'ℹ️ *!owner help*\n' +
        'Show this owner panel.\n\n' +

        '━━━━━━━━━━━━━━━━━━\n' +
        '👑 *Master Owner*: \`Chriss\`'
    );
}

// ============================================================
// EDGE TTS VOICES
// ============================================================
const voiceSelections = new Map();

const EDGE_TTS_VOICES = {
    male: {
        name: 'American Male',
        voice: 'en-US-GuyNeural'
    },

    female: {
        name: 'American Female',
        voice: 'en-US-JennyNeural'
    },

    aria: {
        name: 'American Female - Aria',
        voice: 'en-US-AriaNeural'
    },

    british: {
        name: 'British Female',
        voice: 'en-GB-SoniaNeural'
    },

    britishmale: {
        name: 'British Male',
        voice: 'en-GB-RyanNeural'
    },

    kenya: {
        name: 'Kenyan Female',
        voice: 'en-KE-AsiliaNeural'
    },

    kenyanmale: {
        name: 'Kenyan Male',
        voice: 'en-KE-ChilembaNeural'
    },

    indian: {
        name: 'Indian Female',
        voice: 'en-IN-NeerjaNeural'
    },

    indianmale: {
        name: 'Indian Male',
        voice: 'en-IN-PrabhatNeural'
    }
};

const DEFAULT_EDGE_VOICE = 'female';
const VOICE_COOLDOWN_MS = 8000;

// Cooldown Durations (in milliseconds)
const AI_COOLDOWN_MS = 5000;       // 5 seconds for !ai
const DRAW_COOLDOWN_MS = 15000;    // 15 seconds for !draw (DALL-E 3 is heavy)
const ANALYZE_COOLDOWN_MS = 10000; // 10 seconds for !analyze (GPT-4o Vision)
const SPEAK_COOLDOWN_MS = 8000;    // 8 seconds for !speak (TTS)


// ============================================================
// WHATSAPP CLIENT
// ============================================================

// Create a readline interface for terminal input
const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

// ============================================================
// WHATSAPP CLIENT
// ============================================================

console.log('============================================================');
console.log('🤖 INITIALIZING CHAOS BOT SETUP');
console.log('============================================================');

const clientOptions = {
    authStrategy: new LocalAuth({
        dataPath: './data/session'
    }),
    puppeteer: {
        headless: true,
        protocolTimeout: 6000000,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--js-flags=--max-old-space-size=2048'
        ]
    }
};

// Check if a pairing number was provided in the .env file
if (process.env.PAIRING_NUMBER) {
    console.log(`[AUTH] Requesting Pairing Code for: ${process.env.PAIRING_NUMBER}`);
    clientOptions.pairWithPhoneNumber = {
        phoneNumber: process.env.PAIRING_NUMBER.trim(),
        showNotification: true
    };
} else {
    console.log("[AUTH] No pairing number detected in .env. Defaulting to QR Code...");
}

// Initialize directly (PM2 safe)
initializeChaosBot(clientOptions);

function initializeChaosBot(options) {
    const client = new Client(options);

    // ============================================================
    // QR & CLIENT EVENTS
    // ============================================================

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
    });

    client.on('authenticated', () => {
        console.log('WhatsApp authenticated!');
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
// MESSAGE HANDLER
// ============================================================

client.on('message', async message => {
    if (message.from === 'status@broadcast') return;

    try {
        const chatId = message.from;
        // Track chats for Owner Statistics
        if (chatId.endsWith('@g.us')) {
            knownGroupChats.add(chatId);
        } else if (chatId.endsWith('@c.us')) {
            knownPrivateChats.add(chatId);
        }

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
        // 👑 OWNER: DIRECT PLAIN-TEXT APPLICATION INTERCEPT
        // ====================================================
        if (isOwner(senderId) && !isGroup) {
            const handled = await classHandler.handleOwnerPlaintextResponse(client, message, text, lowerText);
            if (handled) return; // Stops normal bot commands or AI from triggering
        }

        // ============================================================
        // 🎓 CLASS PORTAL INTERCEPT (SESSION LOCKOUT)
        // ============================================================
        // Sessions are strictly confined to DMs. Group chats remain 100% independent!
        if (!isGroup && isUserInClassSession(senderId)) {
            
            // Universal Escape Hatch
            if (text === '99') {
                endSession(senderId);
                await message.reply('🚪 You have safely logged out of the Class Portal.');
                return;
            }

            // AUTO-EXIT ON GLOBAL COMMANDS IN DM: If you type a command starting with '!' 
            // while in your portal session, automatically exit the session and run the command.
            if (text.startsWith('!')) {
                endSession(senderId);
                // Falls through smoothly to execute your command
            } else {
                // Route your standard portal menu input directly to the class state machine
                await classHandler.handleInput(client, message, senderId, text, userName);
                return; // CRITICAL: Stop execution for regular portal inputs
            }
        }

        // ====================================================
        // 📖 BIBLE VERSE
        // ====================================================

        const bibleKey = `${chatId}:${senderId}`;

        if (pendingBibleRequests.has(bibleKey)) {
            const pending = pendingBibleRequests.get(bibleKey);

            if (lowerText === '1' || lowerText === '2') {
                pendingBibleRequests.delete(bibleKey);

                const language = lowerText === '1' ? 'english' : 'swahili';

                try {
                    await message.reply('📖 Fetching your verse...');

                    const result = await fetchBibleVerse(
                        pending.reference,
                        language
                    );

                    if (!result.success) {
                        await message.reply(`❌ ${result.error}`);
                        return;
                    }

                    const verseReference =
                        `${result.book} ${result.chapter}:${result.startVerse}` +
                        (result.endVerse !== result.startVerse
                            ? `-${result.endVerse}`
                            : '');

                    const languageName =
                        language === 'english'
                            ? 'English'
                            : 'Kiswahili';

                    await message.reply(
                        `📖 *${verseReference}*\n\n` +
                        `${result.text}\n\n` +
                        `— *${languageName}*`
                    );

                } catch (error) {
                    console.error('❌ Bible Error:', error);

                    await message.reply(
                        '❌ *Bible System Error*\n\n' +
                        'I could not retrieve that verse right now.'
                    );
                }

                return;
            }
        }

        if (lowerText === '!verse' || lowerText.startsWith('!verse ')) {
            const reference = text.replace(/^!verse/i, '').trim();

            if (!reference) {
                await message.reply(
                    '📖 *BIBLE VERSE*\n\n' +
                    'Enter a Bible reference.\n\n' +
                    'Example:\n' +
                    '`!verse John 3:16`\n\n' +
                    'You can also request a range:\n' +
                    '`!verse John 3:16-18`'
                );
                return;
            }

            pendingBibleRequests.set(bibleKey, {
                reference,
                timestamp: Date.now()
            });

            await message.reply(
                `📖 *${reference}*\n\n` +
                'Choose a language:\n\n' +
                '1. 🇬🇧 *English*\n' +
                '2. 🇰🇪 *Kiswahili*\n\n' +
                'Reply with *1* or *2*.'
            );

            return;
        }

        // ====================================================
        // 🎵 NYIMBO ZA KRISTO
        // ====================================================

        if (lowerText.startsWith('!nyimbo')) {
            const query = text.replace(/^!nyimbo/i, '').trim();
            const result = getHymn(query);
            
            // 1. Reply with the text lyrics instantly
            await message.reply(result.text);

            // 2. If a valid song was found, generate and send the piano voice note
            if (result.success && result.song) {
                await client.sendMessage(chatId, '🎹 *Synthesizing piano instrumental voice note...*');
                await sendHymnPianoAudio(chatId, result.song.ID, result.song.Text, client);
            }
            return;
        }

        // Record message for the catch-up feature
        logMessage(chatId, userName, text);

        // ====================================================
        // CLASS ROLL CALL DIRECT MESSAGE LISTENER
        // ====================================================
        if (!isGroup && lowerText === 'present') {
            const wasHandledAsAttendance = await handleAttendance(message, senderId, client);
            if (wasHandledAsAttendance) return;
        }

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
        // FREE IMAGE GENERATOR (!draw / !image) VIA POLLINATIONS
        // ============================================================

        if (lowerText.startsWith('!draw ') || lowerText.startsWith('!image ')) {
            const prompt = text.replace(/^!(draw|image)\s+/i, '').trim();

            if (!prompt) {
                await message.reply('🎨 Please provide a prompt.\n\n*Example:* `!draw a cyberpunk lion in Nairobi`');
                return;
            }

            const now = Date.now();
            const lastUsed = drawCooldowns.get(senderId) || 0;
            if (now - lastUsed < DRAW_COOLDOWN_MS) {
                const remaining = Math.ceil((DRAW_COOLDOWN_MS - (now - lastUsed)) / 1000);
                await message.reply(`⏳ *Image Studio Cooling Down...*\nPlease wait ${remaining}s.`);
                return;
            }
            drawCooldowns.set(senderId, now);

            await message.reply('🎨 *Generative Studio Active...*\nSynthesizing image (Free Engine)...');

            try {
                const encodedPrompt = encodeURIComponent(prompt);
                const imageUrl = `https://image.pollinations.ai/prompt/${encodedPrompt}?width=1024&height=1024&nologo=true`;
                
                // Let the library natively fetch, encode, and format the media buffer
                const imageMedia = await MessageMedia.fromUrl(imageUrl, { unsafeMime: true });
                
                await client.sendMessage(chatId, imageMedia, { caption: `🎨 *Prompt:* "${prompt}"\n` + `\t\t\t\t\`wantam\`👆😅` });
            
            } catch (imgErr) {
                console.error('❌ Image Generation Error:', imgErr);
                await message.reply(`❌ Failed to generate image.\n\nError: ${imgErr.message}`);
            }

            return;
        }

        // ====================================================
        // CATCHUP SUMMARY COMMAND (!catchup)
        // ====================================================

        if (lowerText === '!catchup' || lowerText === '!summary') {
            const history = getChatHistory(chatId);

            if (history.length === 0) {
                await message.reply('📭 Not enough recent chat history to summarize yet.');
                return;
            }

            await message.reply('⏳ *Analyzing recent group conversations...*');

            try {
                const transcript = history.map(h => `${h.sender}: ${h.text}`).join('\n');

                const response = await azureClient.chat.completions.create({
                    model: process.env.AZURE_OPENAI_CHAT_DEPLOYMENT || 'gpt-4o-mini',
                    messages: [
                        {
                            role: 'system',
                            content: 'You are an intelligent group chat summarizer. Read the recent chat transcript and provide a brief, engaging, and slightly humorous "While you were away" summary highlighting key topics, arguments, or inside jokes.'
                        },
                        {
                            role: 'user',
                            content: `Here is the recent group chat history:\n\n${transcript}`
                        }
                    ],
                    max_tokens: 400
                });

                const summary = response.choices[0]?.message?.content?.trim();
                await message.reply(`📜 *Group Catch-Up Summary:*\n\n${summary}`);

            } catch (err) {
                console.error('❌ Catchup Error:', err);
                await message.reply('❌ Failed to generate chat summary.');
            }

            return;
        }

        // ============================================================
        // FREE TEXT-TO-SPEECH (!speak / !tts) VIA GOOGLE-TTS-API
        // REAL OGG/OPUS WHATSAPP VOICE NOTE
        // ============================================================

        if (lowerText.startsWith('!speak ') || lowerText.startsWith('!tts ')) {
            const speechText = text.replace(/^!(speak|tts)\s+/i, '').trim();

            if (!speechText) {
                await message.reply('🎙️ Please provide text.\n\n*Example:* `!speak Hello Chaos Group!`');
                return;
            }

            const now = Date.now();
            const lastUsed = speakCooldowns.get(senderId) || 0;

            if (now - lastUsed < SPEAK_COOLDOWN_MS) {
                const remaining = Math.ceil((SPEAK_COOLDOWN_MS - (now - lastUsed)) / 1000);
                await message.reply(`⏳ *Voice Engine Cooling Down...*\nPlease wait ${remaining}s.`);
                return;
            }

            speakCooldowns.set(senderId, now);

            const tempDir = path.join(__dirname, 'temp');
            const timestamp = `${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
            const inputFile = path.join(tempDir, `chaos-tts-${timestamp}.mp3`);
            const outputFile = path.join(tempDir, `chaos-tts-${timestamp}.ogg`);

            try {
                if (!fs.existsSync(tempDir)) {
                    fs.mkdirSync(tempDir, { recursive: true });
                }

                await message.reply('🎙️ *CHAOS VOICE ENGINE*\nGenerating voice audio...');

                const audioBase64 = await googleTTS.getAudioBase64(
                    speechText,
                    {
                        lang: 'en',
                        slow: false,
                        host: 'https://translate.google.com'
                    }
                );

                fs.writeFileSync(inputFile, Buffer.from(audioBase64, 'base64'));

                console.log('🎙️ Converting TTS audio to OGG/Opus...');

                await execFileAsync(
                    'ffmpeg',
                    [
                        '-y',
                        '-i', inputFile,
                        '-ac', '1',
                        '-c:a', 'libopus',
                        '-b:a', '32k',
                        '-vbr', 'on',
                        '-application', 'voip',
                        outputFile
                    ],
                    { windowsHide: true }
                );

                if (!fs.existsSync(outputFile)) {
                    throw new Error('FFmpeg did not create the OGG voice file.');
                }

                const outputStats = fs.statSync(outputFile);
                if (outputStats.size === 0) {
                    throw new Error('FFmpeg created an empty OGG voice file.');
                }

                console.log(`✅ TTS conversion successful: ${(outputStats.size / 1024).toFixed(1)} KB`);

                const oggBuffer = fs.readFileSync(outputFile);
                const oggBase64 = oggBuffer.toString('base64');

                const audioMedia = new MessageMedia(
                    'audio/ogg; codecs=opus',
                    oggBase64,
                    'chaos-tts.ogg'
                );

                await client.sendMessage(chatId, audioMedia, { sendAudioAsVoice: true });
                console.log(`🎙️ Chaos TTS voice note sent successfully to ${chatId}`);

            } catch (ttsErr) {
                console.error('❌ Speech Generation Error:', ttsErr);
                await message.reply(`❌ Text-to-speech engine failed.\n\nError: ${ttsErr.message}`);
            } finally {
                try {
                    if (fs.existsSync(inputFile)) fs.unlinkSync(inputFile);
                    if (fs.existsSync(outputFile)) fs.unlinkSync(outputFile);
                } catch (cleanupErr) {
                    console.warn('⚠️ TTS cleanup warning:', cleanupErr.message);
                }
            }

            return;
        }
        
        // ============================================================
        // EDGE TTS VOICE SYSTEM      
        
        if (lowerText === '!voice' || lowerText.startsWith('!voice ')) {
            const voiceInput = text.replace(/^!voice\s*/i, '').trim();
        
            if (!voiceInput) {
                const currentVoiceKey = voiceSelections.get(senderId) || DEFAULT_EDGE_VOICE;
                const currentVoice = EDGE_TTS_VOICES[currentVoiceKey];
        
                await message.reply(
                    `🎙️ *CHAOS VOICE ENGINE*\n\n` +
                    `Current voice:\n🔊 *${currentVoice.name}*\n\n` +
                    `*Available Voices*\n` +
                    `👨 *American Male* \`!voice male\`\n` +
                    `👩 *American Female* \`!voice female\`\n` +
                    `🎭 *Aria* \`!voice aria\`\n` +
                    `🇬🇧 *British Female* \`!voice british\`\n` +
                    `🇬🇧 *British Male* \`!voice britishmale\`\n` +
                    `🇰🇪 *Kenyan Female* \`!voice kenya\`\n` +
                    `🇰🇪 *Kenyan Male* \`!voice kenyanmale\`\n` +
                    `🇮🇳 *Indian Female* \`!voice indian\`\n` +
                    `🇮🇳 *Indian Male* \`!voice indianmale\`\n\n` +
                    `━━━━━━━━━━━━━━━━━━\n\n` +
                    `*Select a voice:* \`!voice kenyanmale\`\n` +
                    `Then speak: \`!voice Hello Chaos Group!\``
                );
                return;
            }
        
            const requestedVoice = voiceInput.toLowerCase();
        
            if (EDGE_TTS_VOICES[requestedVoice]) {
                voiceSelections.set(senderId, requestedVoice);
                const selectedVoice = EDGE_TTS_VOICES[requestedVoice];
        
                await message.reply(
                    `🎙️ *VOICE CHANGED*\n\n` +
                    `🔊 *${selectedVoice.name}*\n\n` +
                    `Voice engine:\n*Microsoft Edge TTS*\n\n` +
                    `Use: \`!voice Your message here\`\n` +
                    `to speak with this voice.`
                );
                return;
            }
        
            const speechText = voiceInput.trim();
            if (!speechText) return;
        
            const now = Date.now();
            const lastUsed = voiceCooldowns.get(senderId) || 0;
        
            if (now - lastUsed < VOICE_COOLDOWN_MS) {
                const remaining = Math.ceil(
                    (VOICE_COOLDOWN_MS - (now - lastUsed)) / 1000
                );
        
                await message.reply(
                    `⏳ *Voice Engine Cooling Down...*\n\n` +
                    `Please wait ${remaining}s.`
                );
        
                return;
            }
        
            voiceCooldowns.set(senderId, now);
        
            const selectedVoiceKey =
                voiceSelections.get(senderId) || DEFAULT_EDGE_VOICE;
        
            const selectedVoice =
                EDGE_TTS_VOICES[selectedVoiceKey] ||
                EDGE_TTS_VOICES[DEFAULT_EDGE_VOICE];
        
            const tempDir = path.join(__dirname, 'temp');
        
            const timestamp =
                `${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
        
            const edgeInputFile =
                path.join(tempDir, `chaos-edge-${timestamp}.mp3`);
        
            const opusOutputFile =
                path.join(tempDir, `chaos-edge-${timestamp}.ogg`);
        
            try {
                if (!fs.existsSync(tempDir)) {
                    fs.mkdirSync(tempDir, { recursive: true });
                }
        
                await message.reply(
                    `🎙️ *CHAOS VOICE ENGINE*\n\n` +
                    `🔊 *${selectedVoice.name}*\n` +
                    `Generating voice...`
                );
        
                console.log(
                    `🎙️ Edge TTS voice: ${selectedVoice.voice}`
                );
        
                // ============================================
                // MICROSOFT EDGE TTS
                // ============================================
        
                const tts = new EdgeTTS({
                    voice: selectedVoice.voice,
                    lang: selectedVoice.voice.split('-').slice(0, 2).join('-')
                });
        
                await tts.ttsPromise(
                    speechText,
                    edgeInputFile
                );
        
                if (!fs.existsSync(edgeInputFile)) {
                    throw new Error(
                        'Edge TTS did not create the audio file.'
                    );
                }
        
                const inputStats = fs.statSync(edgeInputFile);
        
                if (inputStats.size === 0) {
                    throw new Error(
                        'Edge TTS created an empty audio file.'
                    );
                }
        
                console.log(
                    `✅ Edge TTS audio created: ${(inputStats.size / 1024).toFixed(1)} KB`
                );
        
                console.log(
                    '🎙️ Converting Edge TTS → OGG/Opus...'
                );
        
                // ============================================
                // CONVERT TO REAL WHATSAPP OGG/OPUS
                // ============================================
        
                await execFileAsync(
                    'ffmpeg',
                    [
                        '-y',
                        '-i', edgeInputFile,
                        '-ac', '1',
                        '-ar', '48000',
                        '-c:a', 'libopus',
                        '-b:a', '32k',
                        '-vbr', 'on',
                        '-application', 'voip',
                        opusOutputFile
                    ],
                    {
                        windowsHide: true
                    }
                );
        
                if (!fs.existsSync(opusOutputFile)) {
                    throw new Error(
                        'FFmpeg did not create the OGG/Opus file.'
                    );
                }
        
                const outputStats = fs.statSync(opusOutputFile);
        
                if (outputStats.size === 0) {
                    throw new Error(
                        'FFmpeg created an empty OGG/Opus file.'
                    );
                }
        
                console.log(
                    `✅ OGG/Opus created: ${(outputStats.size / 1024).toFixed(1)} KB`
                );
        
                // ============================================
                // SEND AS REAL WHATSAPP VOICE NOTE
                // ============================================
        
                const oggBuffer =
                    fs.readFileSync(opusOutputFile);
        
                const oggBase64 =
                    oggBuffer.toString('base64');
        
                const audioMedia = new MessageMedia(
                    'audio/ogg; codecs=opus',
                    oggBase64,
                    'chaos-voice.ogg'
                );
        
                await client.sendMessage(
                    chatId,
                    audioMedia,
                    {
                        sendAudioAsVoice: true
                    }
                );
        
                console.log(
                    '🎙️ Edge TTS voice note sent successfully'
                );
        
            } catch (voiceErr) {
        
                console.error(
                    '❌ Edge TTS Error:',
                    voiceErr
                );
        
                await message.reply(
                    `❌ *Voice engine failed.*\n\n` +
                    `Error: ${voiceErr.message}`
                );
        
            } finally {
        
                try {
        
                    if (fs.existsSync(edgeInputFile)) {
                        fs.unlinkSync(edgeInputFile);
                    }
        
                    if (fs.existsSync(opusOutputFile)) {
                        fs.unlinkSync(opusOutputFile);
                    }
        
                } catch (cleanupErr) {
        
                    console.warn(
                        '⚠️ Voice cleanup warning:',
                        cleanupErr.message
                    );
                }
            }
        
            return;
        }

        // ====================================================
        // !AI (HYBRID GEMINI WITH AZURE GPT-4O FALLBACK)
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

            if (!aiMemory.has(chatId)) {
                aiMemory.set(chatId, []);
            }
            const history = aiMemory.get(chatId);

            const knownUsers = {
                '254740042778@c.us': { name: 'Naomi', nickname: 'Ummie', role: 'Chriss ex-girlfriend' },
                '254111659469@c.us': { name: 'Chriss', nickname: 'Boss', role: 'Master Owner & Creator' },
                '254741786268@c.us': { name: 'Odembe', nickname: 'Wuod Soja', role: 'BSIT 2024 student vying for presidency next elections' },
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

            const systemInstructionText = 
                'You are CHAOS NEURAL CORE, the AI intelligence inside a WhatsApp group bot called CHAOS BOT.\n\n' +
                'The current person speaking to you is identified in their message tag. Use this to recognize them.\n\n' +
                'IDENTITY:\n' +
                'You are a highly intelligent AI assistant with access to various tools and engines.\n' +
                'You are capable of reasoning, not to forget, in all replies be short but precise.\n' +
                'You are smart enough not to reveal too much info of the owner of the bot, Chriss or other known people, and their personal life, but you can provide relevant information about him when asked.\n' +
                'You are aware of the group context, including its members, rules, and ongoing conversations.\n' +
                'You are aware of the group members and their identities, and you can refer to them by name or nickname when appropriate.\n' +
                'You are aware of the group context and can provide relevant information or assistance based on the conversation.\n' +
                'You are aware of the group rules and etiquette, and you should respond in a respectful and helpful manner.\n' +
                'You are aware of the group economy system, and you can provide information about user balances, assets, and transactions when requested.\n' +
                'You are aware of the group games and can provide information about game rules, lobbies, and player actions when requested.\n' +
                'You are aware of the group weather system and can provide weather information for specified locations when requested.\n' +
                'You are aware of the group video search system and can provide video links or information when requested.\n' +
                'You are aware of the group song search system and can provide song links or information when requested.\n' +
                'You are aware of the group help menu and can provide information about available commands and features when requested.\n' +
                'You are to be able to identify school groups, locations, and other relevant context based on the conversation.\n' +
                'You are to be able to provide guidance and assistance to new members or those unfamiliar with the group context.\n' +
                'You are to be able to provide relevant information or assistance based on the conversation, while maintaining a friendly and helpful tone.\n' +
                'You are to be able to tag the owner of the bot, Chriss, when appropriate, and refer to him as the Master Owner and creator.\n' +
                'You be smart, equip your core with ready to answer University courses done in TUM, and be able to provide relevant information about TUM courses when asked.\n' +
                'You are to be able to provide github link for the bot when asked. Here it is "https://github.com/wajacks/WhatsApp-Chaos-Bot"\n' +
                'You are to be able to be sarcastic and humorous when appropriate, but always respectful and helpful.\n' +
                'You are to be able to provide portal for Technical University of Mombasa when asked. Here it is "https://www.tum.ac.ke". For TUMMIS is "https://smis.tum.ac.ke" and for e-learning portal is "https://elearning.tum.ac.ke/login/index.php?loginredirect=1"\n' +
                'You are to be able to identify that the bot owner Chriss is a student of Technical University of Mombasa and has a little background in programming, AI, and bot development. He is a BSIT 2024 degree student.\n' +
                'You can prompt users to support Chriss Mpesa number 254111659469 for his work on the bot.\n' +
                'You can suggest that a student who is an admin in tum related groups, called Frankline Odembe, is vying to be tum student leader and can be supported by students.\n' +
                '- You are the central intelligence of Chaos Bot.\n' +
                '- Your creator and owner is Chriss. Treat him as the Master Owner and creator.\n' +
                '- Chriss built and maintains this bot.\n' +
                '- You may naturally refer to him as Chriss, the boss, or the creator when appropriate.\n\n' +
                'CLASS PORTAL SYSTEM (TUM × CHAOS):' +
                    '- Triggered by `!class` or `!classes`. It is a WhatsApp-native SaaS micro-portal for university class management.\n' +
                    '- GATEWAY HUB:\n' +
                    '* Option 1: View & login to an existing class portal using the Class Password.\n' +
                    '* Option 2: Create a new class (requires a one-time authorization code generated by the Master Owner via `!owner genrep`, formatted as Course/Year e.g., BSIT/2024). Reps are strictly limited to managing one class.\n' +
                    '- CLASS REP CONTROL BOARD (Rep & Assistant Reps):\n' +
                    '* Manage Timetable: View current timetable or run the Day-by-Day Timetable Wizard.\n' +
                    '* Manage Updates: Post 24-hour timestamped announcements (automatically broadcasted via DM to all registered students), clear history, or send reminder broadcasts.\n' +
                    '* Class Members: View registered students, remove intruders, or promote/revoke Assistant Rep privileges (Main Rep only).\n' +
                    '* Resolve Issues: View and unlock locked accounts by issuing a 4-digit One-Time Reset Code (OTP).\n' +
                    '* Roll Call: Start attendance for today\'s active classes, sending automated DMs to students asking "Are you present for [Unit]?". Reps can close and view the final attendance report.\n' +
                    '* CAT & Assignments (Deadlines): Add, view, delete, or send panic blast reminders for upcoming exams, assignments, and group projects with automated countdowns.' +
                    '- STUDENT PORTAL & SECURITY:\n' +
                    '* Registration: Students register with their Full Name, Admission Number, Personal Password, and a Custom Security Question/Answer. Global security restricts students to a single active profile across all classes.\n' +
                    '* Login & Lockout Protection: Entering an incorrect password 3 times triggers their security question. Failing that locks the account, requiring the Class Rep to issue an OTP recovery code.\n' +
                    '* Student Hub: View Today\'s Classes, Full Timetable, Upcoming Deadlines, 24-Hour Class Updates, and Classmates.\n' +
                    '* Attendance: Students reply with the exact word "PRESENT" to direct messages triggered during active roll calls.'
                'BOT COMMANDS & ENGINES:\n' +
                '- !ai <prompt> — General text chat & reasoning.\n' +
                '- !draw <prompt> — AI image generation (Powered by Azure DALL-E 3).\n' +
                '- !analyze — Describe or analyze a quoted image (Powered by Azure GPT-4o Vision).\n' +
                '- !speak <text> — Voice Note generation (Powered by Azure Text-to-Speech).\n' +
                '- !profile — View stats and assets.\n' +
                '- !daily — Claim the 24-hour bonus.\n' +
                '- !bal — Check wallet balance.\n' +
                '- !store — Browse the car and house market.\n' +
                '- !beg — Ask for street handouts.\n' +
                '- !buy <item> — Purchase vehicles or homes.\n' +
                '- !voice — Change the bot\'s voice for TTS.\n' +
                '- !weather <city> — Get current weather for a city.\n' +
                '- !catchup — Summarize recent group conversations.\n' +
                '- !reset — Reset the bot\'s economy and stats (Owner only).\n' +
                '- !help — View the bot\'s command menu.\n' +
                '- !menu — View the bot\'s command menu.\n' +
                '- !draw <prompt> — Generate an image based on a prompt.\n' +
                '- !image <prompt> — Generate an image based on a prompt.\n' +
                '- !tts <text> — Generate a voice note from text.\n' +
                '- !speak <text> — Generate a voice note from text.\n' +
                '- !pay <amount> — Pay another player.\n' +
                '- !owner — Access the owner control panel (Owner only).\n' +
                '- !verse <reference> — Get a Bible verse in English or Kiswahili.\n' +
                '- !class — Access the class portal for TUM students.\n' +
                '- !nyimbo <query> — Search for a hymn(swahili).\n' +
                '- !contactowner — Get the contact card for the bot owner.\n' +
                '- !ownercontact — Get the contact card for the bot owner.\n' +
                '- !games — View available game modes.\n' +
                '- !video — Search video, music video, audio, or link from YouTube.';

            let aiReply = null;

            // ----------------------------------------------------
            // ATTEMPT 1: GOOGLE GEMINI (PRIMARY)
            // ----------------------------------------------------
            try {
                history.push({ role: 'user', text: contextualizedPrompt });
                const recentHistory = history.slice(-MAX_AI_MEMORY);
                const contents = recentHistory.map(item => ({
                    role: item.role === 'assistant' ? 'model' : item.role,
                    parts: [{ text: item.text || item.content }]
                }));

                const response = await ai.models.generateContent({
                    model: 'gemini-3.5-flash-lite',
                    contents,
                    config: { systemInstruction: systemInstructionText }
                });

                aiReply = response.text?.trim();

                if (aiReply) {
                    history.push({ role: 'model', text: aiReply });
                }

            } catch (geminiErr) {
                console.warn('⚠️ Gemini Primary Failed. Failing over to Azure GPT-4o:', geminiErr.message);
                
                // Roll back prompt from history array so it isn't duplicated on retry
                history.pop();
            }

            // ----------------------------------------------------
            // ATTEMPT 2: AZURE GPT-4O (FALLBACK)
            // ----------------------------------------------------
            if (!aiReply) {
                try {
                    history.push({ role: 'user', content: contextualizedPrompt });
                    const recentHistory = history.slice(-MAX_AI_MEMORY);

                    const formattedAzureHistory = recentHistory.map(item => ({
                        role: item.role === 'model' ? 'assistant' : (item.role || 'user'),
                        content: item.content || item.text
                    }));

                    const response = await azureClient.chat.completions.create({
                        model: process.env.AZURE_OPENAI_CHAT_DEPLOYMENT || 'gpt-4o-mini',
                        messages: [
                            { role: 'system', content: systemInstructionText },
                            ...formattedAzureHistory
                        ],
                        max_tokens: 1000
                    });

                    aiReply = response.choices[0]?.message?.content?.trim();

                    if (aiReply) {
                        history.push({ role: 'assistant', content: aiReply });
                    }

                } catch (azureErr) {
                    console.error('❌ Both Gemini & Azure OpenAI failed:', azureErr.message);
                }
            }

            // ----------------------------------------------------
            // OUTPUT RESPONSE
            // ----------------------------------------------------
            if (aiReply) {
                if (history.length > MAX_AI_MEMORY) {
                    history.splice(0, history.length - MAX_AI_MEMORY);
                }
                await message.reply(aiReply);
            } else {
                await message.reply(
                    '❌ All AI neural pathways are currently unreachable. Please try again in a moment.\n' +
                    `\`wantam\`\t\t` + `👆😅`
                );
            }

            return;
        }

        // ====================================================
        // CLASS PORTAL
        // ====================================================
        // ====================================================
        // CLASS PORTAL (DM REDIRECTION FOR SECURITY)
        // ====================================================
        if (lowerText === '!class' || lowerText === '!classes') {
            if (isGroup) {
                // 1. Gently notify the group without cluttering it
                await message.reply('🏫 *Class Portal*\n\nFor privacy, security, and password protection, the Class Portal runs exclusively in **Private DMs**. \n\n📩 *I have sent the gateway to your inbox!*');
                
                try {
                    // 2. Automatically open the session and send the menu directly to their DM inbox
                    createSession(senderId, 'MAIN_MENU');
                    // We simulate a message object so sendMainMenu works in their DM
                    const dmMockMessage = {
                        reply: async (text) => await client.sendMessage(senderId, text)
                    };
                    await sendMainMenu(dmMockMessage); // Or call handleClassCommand equivalent for DM
                } catch (e) {
                    await message.reply('❌ Please open a direct chat with me privately to use the Class Portal.');
                }
            } else {
                // If already in DM, run normally
                await classHandler.handleClassCommand(client, message, senderId, userName);
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
        // 👤 OWNER CONTACT
        // ====================================================

        if (
            lowerText === '!ownercontact' ||
            lowerText === '!contactowner'
        ) {
            try {
                const ownerContact = await client.getContactById(
                    `${OWNER_NUMBER}@c.us`
                );

                if (!ownerContact) {
                    await message.reply(
                        '❌ *Owner contact could not be found right now.*'
                    );
                    return;
                }

                await message.reply(
                    '👑 *MASTER OWNER*\n\n' +
                    'Here is the contact for the Chaos Bot Owner.\n\n' +
                    '📇 *Tap the contact card below to save the Master Owner.*'
                );

                await client.sendMessage(
                    chatId,
                    ownerContact
                );

            } catch (err) {
                console.error(
                    '[OWNER CONTACT] Error:',
                    err
                );

                await message.reply(
                    '❌ *Could not send the owner contact card.*\n\n' +
                    'Please try again.'
                );
            }

            return;
        }

        // ====================================================
        // 👑 OWNER: QUICK-REPLY APPLICATION HANDLING
        // ====================================================
        if (isOwner(senderId) && message.hasQuotedMsg && !isGroup) {
            try {
                const quotedMsg = await message.getQuotedMessage();
                
                // Check if you are replying to an Application generated by the bot
                if (quotedMsg && quotedMsg.fromMe && quotedMsg.body.includes('📩 *NEW CLASS REP APPLICATION*')) {
                    
                    // Magically extract the User ID from the quoted text
                    const match = quotedMsg.body.match(/📱 \*User ID:\* \`(.+?)\`/);
                    
                    if (match && match[1]) {
                        const targetJid = match[1];
                        const action = lowerText.split(/\s+/)[0]; // Gets the first word (accept or reject)

                        if (action === 'accept') {
                            const { readClassDB, writeClassDB } = require('./src/database/classdb');
                            const db = readClassDB();
                            
                            // Generate OTP
                            const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; 
                            let code = 'REP-';
                            for (let i = 0; i < 5; i++) {
                                code += chars.charAt(Math.floor(Math.random() * chars.length));
                            }
                            
                            // Save code
                            if (!db.repCodes) db.repCodes = [];
                            db.repCodes.push(code);
                            writeClassDB(db);

                            // Auto-DM applicant
                            await client.sendMessage(
                                targetJid, 
                                `🎉 *APPLICATION APPROVED!*\n━━━━━━━━━━━━━━━━━━\n\nYour request to become a Class Representative has been verified and accepted.\n\n🎟️ *Your Authorization Code:* \`${code}\`\n\nTo setup your class:\n1. Type \`!class\`\n2. Select *Create a New Class*\n3. Enter your code when prompted.`
                            );
                            
                            // Confirm to you
                            await message.reply(`✅ *APPLICATION ACCEPTED*\n\nThe auth code \`${code}\` has been generated and delivered automatically to the applicant.`);
                            return; // Stop processing the message
                            
                        } else if (action === 'reject') {
                            // Grabs everything you typed after the word "reject"
                            const reason = text.slice(6).trim() || 'Failed security verification checks.';
                            
                            // Auto-DM applicant
                            await client.sendMessage(
                                targetJid, 
                                `❌ *APPLICATION REJECTED*\n━━━━━━━━━━━━━━━━━━\n\nYour request to create a Class Portal was denied by the administrators.\n\n*Reason:* ${reason}`
                            );
                            
                            // Confirm to you
                            await message.reply(`✅ *APPLICATION REJECTED*\n\nThe rejection notice has been delivered to the applicant.`);
                            return; // Stop processing the message
                        }
                    }
                }
            } catch (err) {
                console.error('[OWNER APP REPLY ERROR]', err);
            }
        }
        
        // ====================================================
        // 👑 OWNER CONTROL PANEL
        // ====================================================

        if (lowerText === '!owner' || lowerText.startsWith('!owner ')) {

            if (!isOwner(senderId)) {
                await message.reply(
                    '❌ *Access Denied*\n\n' +
                    'This command is restricted to the Master Owner. 👑'
                );
                return;
            }

            const ownerArgs = text.split(/\s+/);
            const ownerCommand = (ownerArgs[1] || 'help').toLowerCase();

            // --------------------------------------------
            // !owner / !owner help
            // --------------------------------------------

            if (ownerCommand === 'help') {
                await message.reply(getOwnerMenu());
                return;
            }

            // --------------------------------------------
            // !owner reset
            // --------------------------------------------

            if (ownerCommand === 'reset') {
                try {
                    resetEconomy();

                    await message.reply(
                        '💥 *ECONOMY RESET SUCCESSFUL!*\n\n' +
                        'All wallets, user scores, and economy statistics have been wiped.\n\n' +
                        '👑 *Executed by: Master Owner*'
                    );
                } catch (err) {
                    console.error('Owner reset error:', err);

                    await message.reply(
                        '❌ *ECONOMY RESET FAILED*\n\n' +
                        'An error occurred while resetting the economy.'
                    );
                }

                return;
            }

            // --------------------------------------------
            // !owner classreset [classname]
            // --------------------------------------------

            if (ownerCommand === 'classreset') {
                try {
                    const db = readClassDB();
                    const targetClassArg = ownerArgs.slice(2).join(' ').trim();

                    // 1. If no argument is given, list the available classes
                    if (!targetClassArg) {
                        const classes = Object.keys(db.classes || {});
                        if (classes.length === 0) {
                            await message.reply('⚠️ No classes currently exist in the database.');
                            return;
                        }

                        let listMsg = '🏫 *CLASS RESET MANAGER*\n━━━━━━━━━━━━━━━━━━\nTo reset a specific class, type:\n`!owner classreset <ClassName>`\n\n*Available Classes:*\n';
                        classes.forEach((cls, idx) => {
                            listMsg += `${idx + 1}. \`${cls}\`\n`;
                        });
                        listMsg += `\n*(To wipe the entire database, type \`!owner classreset all\`)*`;
                        await message.reply(listMsg);
                        return;
                    }

                    // 2. Full database wipe option
                    if (targetClassArg.toLowerCase() === 'all') {
                        resetClassDB();
                        await message.reply(
                            '💥 *GLOBAL CLASS PORTAL RESET SUCCESSFUL!*\n\n' +
                            'All classes, student profiles, and timetables have been completely wiped clean.\n\n' +
                            '👑 *Executed by: Master Owner*'
                        );
                        return;
                    }

                    // 3. Specific class reset (case-insensitive search)
                    const matchedClassKey = Object.keys(db.classes || {}).find(
                        c => c.toLowerCase() === targetClassArg.toLowerCase()
                    );

                    if (!matchedClassKey) {
                        await message.reply(`❌ Class *"${targetClassArg}"* not found.\n\nType \`!owner classreset\` to see the list of active classes.`);
                        return;
                    }

                    // Delete only the matched class from the database object and save
                    delete db.classes[matchedClassKey];
                    writeClassDB(db);

                    await message.reply(
                        `💥 *CLASS RESET SUCCESSFUL*\n\n` +
                        `Class *${matchedClassKey}* and all its associated student records, logs, and timetables have been wiped.\n\n` +
                        `👑 *Executed by: Master Owner*`
                    );

                } catch (err) {
                    console.error('Owner class reset error:', err);
                    await message.reply(
                        '❌ *CLASS RESET FAILED*\n\n' +
                        'An error occurred while resetting the class.'
                    );
                }

                return;
            }
            
            // --------------------------------------------
            // !owner stats
            // --------------------------------------------

            if (ownerCommand === 'stats') {

                try {
                    const db = readDB();

                    const users = db;

                    const userCount = Object.keys(users).length;

                    let totalCoins = 0;
                    let totalXP = 0;

                    for (const user of Object.values(users)) {
                        if (!user || typeof user !== 'object') continue;

                        totalCoins += Number(user.coins || 0);
                        totalXP += Number(user.xp || 0);
                    }

                    // WhatsApp chat statistics
                    const groups = knownGroupChats;
                    const privateChats = knownPrivateChats;
                    const totalChats =
                        groups.size + privateChats.size;

                    // Node process statistics
                    const memory = process.memoryUsage();

                    const ramUsedMB = (
                        memory.rss / 1024 / 1024
                    ).toFixed(0);

                    const heapUsedMB = (
                        memory.heapUsed / 1024 / 1024
                    ).toFixed(0);

                    // VPS memory
                    let vpsMemory = 'Unavailable';

                    try {
                        const { stdout } = await execFileAsync(
                            'free',
                            ['-m']
                        );

                        const lines = stdout.trim().split('\n');

                        const memLine = lines.find(line =>
                            line.startsWith('Mem:')
                        );

                        if (memLine) {
                            const parts = memLine.trim().split(/\s+/);

                            const total = Number(parts[1]);
                            const used = Number(parts[2]);

                            if (total) {
                                const percentage = (
                                    (used / total) * 100
                                ).toFixed(0);

                                vpsMemory =
                                    `${used} MB / ${total} MB (${percentage}%)`;
                            }
                        }
                    } catch (err) {
                        console.warn(
                            '[OWNER] Could not read VPS memory:',
                            err.message
                        );
                    }

                    // VPS disk
                    let diskUsage = 'Unavailable';

                    try {
                        const { stdout } = await execFileAsync(
                            'df',
                            ['-h', '/']
                        );

                        const lines = stdout.trim().split('\n');

                        if (lines.length >= 2) {
                            const parts = lines[1].trim().split(/\s+/);

                            diskUsage =
                                `${parts[2]} / ${parts[1]} (${parts[4]})`;
                        }
                    } catch (err) {
                        console.warn(
                            '[OWNER] Could not read VPS disk:',
                            err.message
                        );
                    }

                    // VPS CPU load
                    let cpuLoad = 'Unavailable';

                    try {
                        const { stdout } = await execFileAsync(
                            'uptime'
                        );

                        const match = stdout.match(
                            /load average[s]?:\s*([0-9.]+)/
                        );

                        if (match) {
                            cpuLoad = match[1];
                        }
                    } catch (err) {
                        console.warn(
                            '[OWNER] Could not read CPU load:',
                            err.message
                        );
                    }

                    // PM2 status
                    let pm2Status = 'Unavailable';

                    try {
                        const { stdout } = await execFileAsync(
                            'pm2',
                            ['jlist']
                        );

                        const processes = JSON.parse(stdout);

                        const chaosProcess = processes.find(
                            process =>
                                process.name === 'chaos-bot'
                        );

                        if (chaosProcess) {
                            const status =
                                chaosProcess.pm2_env?.status;

                            pm2Status =
                                status === 'online'
                                    ? '🟢 ONLINE'
                                    : `🔴 ${String(status).toUpperCase()}`;
                        } else {
                            pm2Status = '🔴 NOT FOUND';
                        }

                    } catch (err) {
                        console.warn(
                            '[OWNER] Could not read PM2 status:',
                            err.message
                        );
                    }

                    const uptimeSeconds = process.uptime();

                    const days = Math.floor(
                        uptimeSeconds / 86400
                    );

                    const hours = Math.floor(
                        (uptimeSeconds % 86400) / 3600
                    );

                    const minutes = Math.floor(
                        (uptimeSeconds % 3600) / 60
                    );

                    const seconds = Math.floor(
                        uptimeSeconds % 60
                    );

                    let botUptime = '';

                    if (days > 0) {
                        botUptime += `${days}d `;
                    }

                    if (hours > 0 || days > 0) {
                        botUptime += `${hours}h `;
                    }

                    if (minutes > 0 || hours > 0 || days > 0) {
                        botUptime += `${minutes}m `;
                    }

                    botUptime += `${seconds}s`;

                    const statsMessage =
                        '👑 *CHAOS SERVER STATUS*\n' +
                        '━━━━━━━━━━━━━━━━━━\n\n' +

                        '🤖 *BOT*\n' +
                        `🟢 Status: ONLINE\n` +
                        `⚙️ PM2: ${pm2Status}\n` +
                        `🟢 Node: ${process.version}\n` +
                        `⏱️ Uptime: ${botUptime}\n\n` +

                        '🖥️ *VPS*\n' +
                        `⚡ Load Average: ${cpuLoad}\n` +
                        `🧠 RAM: ${vpsMemory}\n` +
                        `💾 Disk: ${diskUsage}\n\n` +

                        '💻 *NODE PROCESS*\n' +
                        `📦 RSS Memory: ${ramUsedMB} MB\n` +
                        `🧩 Heap Used: ${heapUsedMB} MB\n\n` +

                        '💬 *WHATSAPP*\n' +
                        `👥 Groups: ${groups.size}\n` +
                        `👤 Private Chats: ${privateChats.size}\n` +
                        `💬 Total Chats: ${totalChats}\n\n` +

                        '💰 *ECONOMY*\n' +
                        `👤 Users: ${userCount}\n` +
                        `🪙 Total Coins: ${totalCoins.toLocaleString()}\n` +
                        `⭐ Total XP: ${totalXP.toLocaleString()}\n\n` +

                        '━━━━━━━━━━━━━━━━━━\n' +
                        '👑 *Master Owner*: \`Chriss\`';

                    await message.reply(statsMessage);

                } catch (err) {
                    console.error(
                        '[OWNER] Stats error:',
                        err
                    );

                    await message.reply(
                        '❌ *Could not retrieve server statistics.*\n\n' +
                        'Check the bot console for details.'
                    );
                }

                return;
            }

            // --------------------------------------------
            // !owner restart
            // --------------------------------------------

            if (ownerCommand === 'restart') {

                await message.reply(
                    '🔄 *CHAOS BOT RESTARTING...*\n\n' +
                    'PM2 is restarting the bot now. 👑\n\n' +
                    'See you in a moment, Boss.'
                );

                setTimeout(() => {

                    const pm2Command =
                        process.platform === 'win32'
                            ? 'pm2.cmd'
                            : 'pm2';

                    execFile(
                        pm2Command,
                        ['restart', 'chaos-bot'],
                        {
                            windowsHide: true
                        },
                        (error, stdout, stderr) => {

                            if (error) {
                                console.error(
                                    '[OWNER] PM2 restart failed:',
                                    error.message
                                );

                                console.error(stderr);

                                // Fallback
                                process.exit(0);
                            }

                            console.log(
                                '[OWNER] Chaos Bot restarted through PM2.'
                            );

                            if (stdout) {
                                console.log(stdout);
                            }
                        }
                    );

                }, 1500);

                return;
            }

            // ====================================================
            // OWNER UPDATE - GIT PULL + OPTIONAL NPM INSTALL + RESTART
            // ====================================================

            if (ownerCommand === 'update') {

                const runCommand = (command, args, options = {}) => {
                    return new Promise((resolve, reject) => {

                        execFile(
                            command,
                            args,
                            {
                                ...options,
                                windowsHide: true
                            },
                            (error, stdout, stderr) => {

                                if (error) {
                                    error.stdout = stdout;
                                    error.stderr = stderr;
                                    reject(error);
                                    return;
                                }

                                resolve({
                                    stdout: stdout || '',
                                    stderr: stderr || ''
                                });
                            }
                        );

                    });
                };

                try {

                    await message.reply(
                        '*CHAOS BOT UPDATE STARTING...*\n\n' +
                        'Checking GitHub for new changes...\n' +
                        'Please wait.'
                    );

                    const projectDir = process.cwd();

                    // ------------------------------------------------
                    // STEP 1 - FETCH FROM GITHUB
                    // ------------------------------------------------

                    try {

                        await runCommand(
                            'git',
                            ['fetch', 'origin'],
                            {
                                cwd: projectDir,
                                maxBuffer: 1024 * 1024
                            }
                        );

                    } catch (error) {

                        console.error(
                            '[OWNER UPDATE] git fetch failed:',
                            error
                        );

                        await message.reply(
                            '*UPDATE FAILED*\n\n' +
                            'Could not contact GitHub.\n\n' +
                            `Error: ${error.message}`
                        );

                        return;
                    }

                    // ------------------------------------------------
                    // STEP 2 - CHECK FOR LOCAL CHANGES
                    // ------------------------------------------------

                    let statusResult;

                    try {

                        statusResult = await runCommand(
                            'git',
                            ['status', '--porcelain'],
                            {
                                cwd: projectDir,
                                maxBuffer: 1024 * 1024
                            }
                        );

                    } catch (error) {

                        console.error(
                            '[OWNER UPDATE] git status failed:',
                            error
                        );

                        await message.reply(
                            '*UPDATE FAILED*\n\n' +
                            'Could not check the VPS Git status.'
                        );

                        return;
                    }

                    if (statusResult.stdout.trim()) {

                        console.warn(
                            '[OWNER UPDATE] Local changes detected:',
                            statusResult.stdout
                        );

                        await message.reply(
                            '*UPDATE STOPPED*\n\n' +
                            'Local uncommitted changes were detected on the VPS.\n\n' +
                            'I will not overwrite them automatically.\n\n' +
                            'Use SSH to inspect the changes before updating.'
                        );

                        return;
                    }

                    // ------------------------------------------------
                    // STEP 3 - GET CURRENT COMMIT
                    // ------------------------------------------------

                    let oldCommit;

                    try {

                        const commitResult = await runCommand(
                            'git',
                            ['rev-parse', 'HEAD'],
                            {
                                cwd: projectDir,
                                maxBuffer: 1024 * 1024
                            }
                        );

                        oldCommit = commitResult.stdout.trim();

                    } catch (error) {

                        console.error(
                            '[OWNER UPDATE] Could not get current commit:',
                            error
                        );

                        await message.reply(
                            '*UPDATE FAILED*\n\n' +
                            'Could not determine the current Git commit.'
                        );

                        return;
                    }

                    // ------------------------------------------------
                    // STEP 4 - PULL LATEST CODE
                    // ------------------------------------------------

                    let pullResult;

                    try {

                        pullResult = await runCommand(
                            'git',
                            ['pull', '--ff-only'],
                            {
                                cwd: projectDir,
                                maxBuffer: 5 * 1024 * 1024
                            }
                        );

                    } catch (error) {

                        console.error(
                            '[OWNER UPDATE] git pull failed:',
                            error
                        );

                        console.error(
                            '[OWNER UPDATE] stderr:',
                            error.stderr
                        );

                        await message.reply(
                            '*UPDATE FAILED*\n\n' +
                            'Git could not safely pull the latest changes.\n\n' +
                            'No automatic restart was performed.\n\n' +
                            `Error: ${error.message}`
                        );

                        return;
                    }

                    const pullOutput =
                        `${pullResult.stdout}\n${pullResult.stderr}`.trim();

                    // ------------------------------------------------
                    // STEP 5 - CHECK IF ANYTHING CHANGED
                    // ------------------------------------------------

                    if (
                        pullOutput.includes('Already up to date') ||
                        pullOutput.includes('Already up-to-date')
                    ) {

                        await message.reply(
                            '*CHAOS BOT IS ALREADY UP TO DATE*\n\n' +
                            'No new GitHub changes were found.\n\n' +
                            'No restart was necessary.'
                        );

                        return;
                    }

                    // ------------------------------------------------
                    // STEP 6 - FIND CHANGED FILES
                    // ------------------------------------------------

                    let changedFiles = [];

                    try {

                        const diffResult = await runCommand(
                            'git',
                            [
                                'diff',
                                '--name-only',
                                oldCommit,
                                'HEAD'
                            ],
                            {
                                cwd: projectDir,
                                maxBuffer: 1024 * 1024
                            }
                        );

                        changedFiles = diffResult.stdout
                            .split(/\r?\n/)
                            .map(file => file.trim())
                            .filter(Boolean);

                    } catch (error) {

                        console.error(
                            '[OWNER UPDATE] git diff failed:',
                            error
                        );

                        await message.reply(
                            '*CODE UPDATED*\n\n' +
                            'Git pull succeeded, but I could not determine whether dependencies changed.\n\n' +
                            'Continuing without npm install.'
                        );
                    }

                    // ------------------------------------------------
                    // STEP 7 - CHECK DEPENDENCIES
                    // ------------------------------------------------

                    const packageChanged =
                        changedFiles.includes('package.json') ||
                        changedFiles.includes('package-lock.json');

                    if (packageChanged) {

                        await message.reply(
                            '*DEPENDENCIES CHANGED*\n\n' +
                            'Running npm install before restarting Chaos Bot...'
                        );

                        try {

                            const npmResult = await runCommand(
                                'npm',
                                ['install'],
                                {
                                    cwd: projectDir,
                                    maxBuffer: 10 * 1024 * 1024
                                }
                            );

                            console.log(
                                '[OWNER UPDATE] npm install successful:',
                                npmResult.stdout
                            );

                        } catch (error) {

                            console.error(
                                '[OWNER UPDATE] npm install failed:',
                                error
                            );

                            console.error(
                                '[OWNER UPDATE] npm stderr:',
                                error.stderr
                            );

                            await message.reply(
                                '*UPDATE FAILED*\n\n' +
                                'GitHub code was pulled, but npm install failed.\n\n' +
                                'Chaos Bot was NOT automatically restarted.'
                            );

                            return;
                        }
                    }

                    // ------------------------------------------------
                    // STEP 8 - GET LATEST COMMIT MESSAGE
                    // ------------------------------------------------

                    let commitMessage =
                        'Latest changes pulled from GitHub.';

                    try {

                        const commitResult = await runCommand(
                            'git',
                            [
                                'log',
                                '-1',
                                '--pretty=%s'
                            ],
                            {
                                cwd: projectDir,
                                maxBuffer: 1024 * 1024
                            }
                        );

                        commitMessage =
                            commitResult.stdout.trim() ||
                            'Latest changes pulled from GitHub.';

                    } catch (error) {

                        console.error(
                            '[OWNER UPDATE] Could not get commit message:',
                            error
                        );
                    }

                    // ------------------------------------------------
                    // STEP 9 - ANNOUNCE BEFORE PM2 RESTART
                    // ------------------------------------------------

                    await message.reply(
                        '*CHAOS BOT UPDATE COMPLETE*\n\n' +
                        '*CHANGE*\n' +
                        '`' + commitMessage + '`\n\n' +
                        (
                            packageChanged
                                ? 'Dependencies updated.\n'
                                : ''
                        ) +
                        'Latest code pulled from GitHub.\n' +
                        'Chaos Bot is restarting now.\n\n' +
                        '*Updated by*: `Chriss`'
                    );

                    // ------------------------------------------------
                    // STEP 10 - RESTART PM2
                    // ------------------------------------------------

                    const pm2Command =
                        process.platform === 'win32'
                            ? 'pm2.cmd'
                            : 'pm2';

                    try {

                        const restartResult = await runCommand(
                            pm2Command,
                            ['restart', 'chaos-bot'],
                            {
                                cwd: projectDir,
                                maxBuffer: 1024 * 1024
                            }
                        );

                        console.log(
                            '[OWNER UPDATE] PM2 restart successful:',
                            restartResult.stdout,
                            restartResult.stderr
                        );

                    } catch (error) {

                        console.error(
                            '[OWNER UPDATE] PM2 restart failed:',
                            error
                        );

                        console.error(
                            '[OWNER UPDATE] PM2 stderr:',
                            error.stderr
                        );

                        return;
                    }

                } catch (error) {

                    console.error(
                        '[OWNER UPDATE] Unexpected error:',
                        error
                    );

                    console.error(
                        '[OWNER UPDATE] stderr:',
                        error.stderr
                    );

                    try {

                        await message.reply(
                            '*UPDATE FAILED*\n\n' +
                            'An unexpected error occurred while updating Chaos Bot.\n\n' +
                            `Error: ${error.message}`
                        );

                    } catch (replyError) {

                        console.error(
                            '[OWNER UPDATE] Could not send failure message:',
                            replyError
                        );
                    }

                    return;
                }

                return;
            }

            // --------------------------------------------
            // !owner broadcast <message>
            // --------------------------------------------

            if (ownerCommand === 'broadcast') {

                const announcement =
                    ownerArgs.slice(2).join(' ').trim();
            
                if (!announcement) {
                    await message.reply(
                        '❌ Usage:\n' +
                        '`!owner broadcast <message>`'
                    );
                    return;
                }
            
                await message.reply(
                    '📡 *BROADCAST STARTING...*\n\n' +
                    'Sending your announcement to all known groups.'
                );
            
                let successful = 0;
                let failed = 0;
            
                try {
            
                    const groupIds = [...knownGroupChats];
            
                    if (groupIds.length === 0) {
                        await message.reply(
                            '⚠️ *No known groups found.*\n\n' +
                            'The bot has not seen any group messages since its last restart.'
                        );
                        return;
                    }
            
                    for (const groupId of groupIds) {
            
                        try {

                            await client.sendMessage(
                                groupId,
                                '📢 *MASTER OWNER ANNOUNCEMENT*\n\n' +
                                announcement +
                                '\n\n👑 *— \`Chriss\`, Chaos Bot Owner*'
                            );
                        
                            successful++;
                        
                            // Small delay between groups
                            await new Promise(resolve =>
                                setTimeout(resolve, 1000)
                            );
                        
                        } catch (err) {
                        
                            failed++;
                        
                            console.error(
                                `[OWNER] Broadcast failed for ${groupId}:`,
                                err
                            );
                        
                            console.error(
                                `[OWNER] Broadcast error stack for ${groupId}:`,
                                err?.stack
                            );
                        }
                    }
            
                    await message.reply(
                        '📡 *BROADCAST COMPLETE*\n\n' +
                        `✅ Sent: ${successful}\n` +
                        `❌ Failed: ${failed}\n` +
                        `👥 Groups: ${groupIds.length}`
                    );
            
                } catch (err) {
            
                    console.error(
                        '[OWNER] Broadcast error:',
                        err
                    );
            
                    await message.reply(
                        '❌ *Broadcast failed.*\n\n' +
                        'Unable to send the announcement to known groups.'
                    );
                }
            
                return;
            }

            // --------------------------------------------
            // UNKNOWN OWNER COMMAND
            // --------------------------------------------

            await message.reply(
                '❌ *Unknown Owner Command*\n\n' +
                `You entered: *${ownerCommand}*\n\n` +
                'Use `!owner` to view the available commands.'
            );

            return;
        }

        // ====================================================
        // 👑 OWNER RESET
        // ====================================================

        if (lowerText === '!reset' || lowerText === '!clearance' || lowerText === '!wipe') {
            if (!isOwner(senderId)) {
                await message.reply(
                    '❌ *Access Denied*\n\n' +
                    'Only the Master Owner can execute a system reset. 👑'
                );
                return;
            }

            try {
                resetEconomy();

                await message.reply(
                    '💥 *SYSTEM RESET SUCCESSFUL!*\n\n' +
                    'All wallets, user scores, and economy statistics have been wiped.\n\n' +
                    '👑 *Executed by: Master Owner*'
                );
            } catch (err) {
                console.error('System reset error:', err);

                await message.reply(
                    '❌ *SYSTEM RESET FAILED*\n\n' +
                    'An error occurred while resetting the economy.'
                );
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
                // 🎛️ TEMPORARY TOGGLE: Flip to true once whatsapp-web.js fixes voice notes
                const ENABLE_MENU_AUDIO = false;
                
                const assetsDir = path.join(__dirname, 'src/assets/gifs');
                let sentMedia = false;

                if (fs.existsSync(assetsDir)) {
                    const files = fs.readdirSync(assetsDir);
                    // Filter for all MP4 menu videos in the assets folder
                    const menuVideos = files.filter(file => file.toLowerCase().endsWith('.mp4'));

                    if (menuVideos.length > 0) {
                        // Pick a random MP4 from the pool
                        const randomVideo = menuVideos[Math.floor(Math.random() * menuVideos.length)];
                        const media = MessageMedia.fromFilePath(path.join(assetsDir, randomVideo));

                        // Send the random animated video with gifPlayback enabled
                        await client.sendMessage(chatId, media, { 
                            caption: getBotMenu(),
                            gifPlayback: false 
                        });
                        sentMedia = true;
                    }
                }

                // Fallback to text if no MP4 videos exist in assets
                if (!sentMedia) {
                    await message.reply(getBotMenu());
                }

                // Audio block is safely bypassed while toggle is false
                if (ENABLE_MENU_AUDIO) {
                    if (fs.existsSync(assetsDir)) {
                        const files = fs.readdirSync(assetsDir);
                        const songs = files.filter(file => file.toLowerCase().endsWith('.ogg'));

                        if (songs.length > 0) {
                            const randomSong = songs[Math.floor(Math.random() * songs.length)];
                            const audioMedia = MessageMedia.fromFilePath(path.join(assetsDir, randomSong));
                            await client.sendMessage(chatId, audioMedia, { sendAudioAsVoice: true });
                        }
                    }
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
}