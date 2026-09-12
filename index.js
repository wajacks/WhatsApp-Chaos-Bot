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
const { logMessage, getChatHistory } = require('./src/database/chatlog');

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

// Cooldown Durations (in milliseconds)
const AI_COOLDOWN_MS = 5000;       // 5 seconds for !ai
const DRAW_COOLDOWN_MS = 15000;    // 15 seconds for !draw (DALL-E 3 is heavy)
const ANALYZE_COOLDOWN_MS = 10000; // 10 seconds for !analyze (GPT-4o Vision)
const SPEAK_COOLDOWN_MS = 8000;    // 8 seconds for !speak (TTS)

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

        // Record message for the catch-up feature
        logMessage(chatId, userName, text);

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
                
                await client.sendMessage(chatId, imageMedia, { caption: `🎨 *Prompt:* "${prompt}"` });
            
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
        await message.reply(
            '🎙️ Please provide text.\n\n*Example:* `!speak Hello Chaos Group!`'
        );
        return;
    }

    const now = Date.now();
    const lastUsed = speakCooldowns.get(senderId) || 0;

    if (now - lastUsed < SPEAK_COOLDOWN_MS) {
        const remaining = Math.ceil(
            (SPEAK_COOLDOWN_MS - (now - lastUsed)) / 1000
        );

        await message.reply(
            `⏳ *Voice Engine Cooling Down...*\nPlease wait ${remaining}s.`
        );
        return;
    }

    speakCooldowns.set(senderId, now);

    // Temporary TTS files
    const tempDir = path.join(__dirname, 'temp');

    const timestamp =
        `${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;

    const inputFile = path.join(
        tempDir,
        `chaos-tts-${timestamp}.mp3`
    );

    const outputFile = path.join(
        tempDir,
        `chaos-tts-${timestamp}.ogg`
    );

    try {

        // --------------------------------------------------------
        // CREATE TEMP DIRECTORY
        // --------------------------------------------------------

        if (!fs.existsSync(tempDir)) {
            fs.mkdirSync(tempDir, { recursive: true });
        }

        await message.reply(
            '🎙️ *CHAOS VOICE ENGINE*\nGenerating voice audio...'
        );

        // --------------------------------------------------------
        // 1. GOOGLE TTS
        // --------------------------------------------------------

        const audioBase64 = await googleTTS.getAudioBase64(
            speechText,
            {
                lang: 'en',
                slow: false,
                host: 'https://translate.google.com'
            }
        );

        // --------------------------------------------------------
        // 2. SAVE GOOGLE TTS MP3
        // --------------------------------------------------------

        fs.writeFileSync(
            inputFile,
            Buffer.from(audioBase64, 'base64')
        );

        // --------------------------------------------------------
        // 3. CONVERT MP3 → OGG/OPUS USING FFMPEG
        // --------------------------------------------------------

        console.log('🎙️ Converting TTS audio to OGG/Opus...');

        await execFileAsync(
            'ffmpeg',
            [
                '-y',

                // Input
                '-i',
                inputFile,

                // Mono
                '-ac',
                '1',

                // Opus codec
                '-c:a',
                'libopus',

                // Voice-note bitrate
                '-b:a',
                '32k',

                // Variable bitrate
                '-vbr',
                'on',

                // Optimize for voice
                '-application',
                'voip',

                // Output
                outputFile
            ],
            {
                windowsHide: true
            }
        );

        // --------------------------------------------------------
        // 4. VERIFY FFMPEG OUTPUT
        // --------------------------------------------------------

        if (!fs.existsSync(outputFile)) {
            throw new Error(
                'FFmpeg did not create the OGG voice file.'
            );
        }

        const outputStats = fs.statSync(outputFile);

        if (outputStats.size === 0) {
            throw new Error(
                'FFmpeg created an empty OGG voice file.'
            );
        }

        console.log(
            `✅ TTS conversion successful: ` +
            `${(outputStats.size / 1024).toFixed(1)} KB`
        );

        // --------------------------------------------------------
        // 5. LOAD OGG/OPUS FILE
        // --------------------------------------------------------

        const oggBuffer = fs.readFileSync(outputFile);

        const oggBase64 = oggBuffer.toString('base64');

        // IMPORTANT:
        // This is now a REAL OGG/Opus file.
        const audioMedia = new MessageMedia(
            'audio/ogg; codecs=opus',
            oggBase64,
            'chaos-tts.ogg'
        );

        // --------------------------------------------------------
        // 6. SEND AS WHATSAPP VOICE NOTE
        // --------------------------------------------------------

        await client.sendMessage(
            chatId,
            audioMedia,
            {
                sendAudioAsVoice: true
            }
        );

        console.log(
            `🎙️ Chaos TTS voice note sent successfully to ${chatId}`
        );

    } catch (ttsErr) {

        console.error(
            '❌ Speech Generation Error:',
            ttsErr
        );

        await message.reply(
            `❌ Text-to-speech engine failed.\n\nError: ${ttsErr.message}`
        );

    } finally {

        // --------------------------------------------------------
        // 7. CLEAN UP TEMPORARY FILES
        // --------------------------------------------------------

        try {

            if (fs.existsSync(inputFile)) {
                fs.unlinkSync(inputFile);
            }

            if (fs.existsSync(outputFile)) {
                fs.unlinkSync(outputFile);
            }

        } catch (cleanupErr) {

            console.warn(
                '⚠️ TTS cleanup warning:',
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
                'You are capable of reasoning, generating images, analyzing images, and producing voice notes.\n' +
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
                '- !pay <amount> — Pay another player.\n' +
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