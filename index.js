require('dotenv').config();

const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');

const execFileAsync = promisify(execFile);
const { GoogleGenAI } = require('@google/genai');
const { AzureOpenAI, OpenAI } = require('openai');
const axios = require('axios');
const googleTTS = require('google-tts-api');
const { EdgeTTS } = require('node-edge-tts');
const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const readline = require('readline');
const qrcode = require('qrcode-terminal');

const { buildWeatherResponse } = require('./src/tools/weatherFormatter');
const { createMafiaNarrator } = require('./src/features/mafia/narrator');
const { createNumberRunBanter } = require('./src/features/numberrunNarrator');
const { registerClientEvents } = require('./src/handlers/clientEvents');
const { registerMessageHandler } = require('./src/handlers/messageHandler');
const { reactToCommand } = require('./src/commands/commandReactions');
const { normalizeJid, normalizePhoneNumber, getCanonicalJid, getSenderContact, getSenderJid, getContactJid } = require('./src/utils/identity');
// ============================================================
// DATABASE
// ============================================================

const {
    addXP,
    getUserBalance,
    deductBalance,
    addCoins,
    transferCoins,
    getUser,
    readDB,
    writeDB,
    resetEconomy
} = require('./src/database/db');

const {
    createCoinPurchaseRequest,
    listPendingCoinPurchases,
    approveCoinPurchase,
    rejectCoinPurchase
} = require('./src/database/coinPurchases');

// ============================================================
// COMMANDS
// ============================================================

const { handleProfileCommand } = require('./src/commands/profile');

const {
    startWordleLobby,
    startWordleGame,
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
    startRebusGame,
    stopRebusGame,
    joinRebusLobby,
    processRebusGuess,
    processRebusHint,
    handleStealCommand
} = require('./src/games/rebuscountry');

const {
    startScrambleLobby,
    startScrambleGame,
    stopScrambleGame,
    joinScrambleLobby,
    processScrambleGuess,
    processScrambleHint,
    endScrambleGame
} = require('./src/games/scramble');

const {
    startWordForgeLobby,
    joinWordForgeLobby,
    startWordForgeGame,
    stopWordForgeGame,
    processWordForgeDmMessage,
    handleWordForgeStealCommand,
    restoreWordForgeGames
} = require('./src/games/wordforge');

const {
    startNumberRunLobby,
    joinNumberRunLobby,
    startNumberRunGame,
    stopNumberRunGame,
    processNumberRunGuess
} = require('./src/games/numberrun');

const {
    startTruthHuntLobby,
    joinTruthHuntLobby,
    startTruthHuntGame,
    stopTruthHuntGame,
    handleTruthHuntGroupMessage,
    processTruthHuntDmMessage
} = require('./src/games/truthhunt');

const { getGamesList } = require('./src/commands/gameslist');
const { handleBalanceCommand } = require('./src/commands/balance');
const { getWeather } = require('./src/tools/weather');
const { fetchBibleVerse } = require('./src/tools/bible');
const { getHymn } = require('./src/tools/hymnal');
const { getEnglishHymn } = require('./src/tools/englishHymnal');
const { sendHymnPianoAudio } = require('./src/tools/hymnalAudio');
const { logMessage, getChatHistory } = require('./src/database/chatlog');

// CLASS PORTAL:
const { resetClassDB, readClassDB, writeClassDB } = require('./src/database/classdb');
const { isUserInClassSession, endSession } = require('./src/tools/classSession');
const classHandler = require('./src/commands/classHandler');
const { handleAttendance } = require('./src/commands/classHandler');
const { startDeadlineMonitor, startPollMonitor, startDailyReminders, startTimetableMonitor, startClassWeekendBroadcast, startSystemMaintenance } = require('./src/tools/classSession');


const {
    startMafiaLobby,
    startMafiaGame,
    handleMafiaPublicMessage,
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
const { buildImageAnalysisContent } = require('./src/tools/imageAnalysis');
const {
    normalizeWhatsAppNumber,
    parseDuration,
    grantImageAccess,
    revokeImageAccess,
    listImageAccess
} = require('./src/database/imageAccess');

// ============================================================
// OPTIONAL GEMINI FALLBACK INITIALIZATION
// ============================================================

if (!process.env.GEMINI_API_KEY) {
    console.warn('⚠️ GEMINI_API_KEY is missing; the Gemini fallback will be unavailable.');
}

const ai = process.env.GEMINI_API_KEY
    ? new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY })
    : null;

// AZURE INITIALIZATION
if (!process.env.AZURE_OPENAI_KEY || !process.env.AZURE_OPENAI_ENDPOINT) {
    console.warn('⚠️ Azure OpenAI credentials are missing from .env');
}

const azureClient = new AzureOpenAI({
    endpoint: process.env.AZURE_OPENAI_ENDPOINT,
    apiKey: process.env.AZURE_OPENAI_KEY,
    apiVersion: '2024-05-01-preview'
});

const azureResourceEndpoint = process.env.AZURE_OPENAI_ENDPOINT
    ? process.env.AZURE_OPENAI_ENDPOINT.replace(/\/+$/, '')
    : '';
const azureResponsesClient = process.env.AZURE_OPENAI_KEY && azureResourceEndpoint
    ? new OpenAI({
        baseURL: azureResourceEndpoint + '/openai/v1/',
        apiKey: process.env.AZURE_OPENAI_KEY,
        maxRetries: 0
    })
    : null;

const generateMafiaNarration = createMafiaNarrator({ ai, azureClient });
const generateNumberRunBanter = createNumberRunBanter({ ai, azureClient });
const { aiMemory, MAX_AI_MEMORY, aiCooldowns } = require('./src/features/ai/state');
const imageState = require('./src/features/images/state');

const { pendingBibleRequests } = require('./src/features/bible/state');

// ====================================================
// 📊 CHAOS CHAT STATISTICS
// ====================================================

const { knownGroupChats, knownPrivateChats } = require('./src/bot/chatStats');

// ====================================================
// 👑 OWNER SYSTEM
// ====================================================

const { OWNER_NUMBER, isOwner, canUseImageFeatures, getOwnerMenu, IMAGE_ACCESS_DENIED_MESSAGE } = require('./src/commands/owner');

// ============================================================
// EDGE TTS VOICES
// ============================================================
const { voiceSelections, EDGE_TTS_VOICES, DEFAULT_EDGE_VOICE, VOICE_COOLDOWN_MS, speakCooldowns, voiceCooldowns } = require('./src/features/voice/config');

// Cooldown Durations (in milliseconds)
const AI_COOLDOWN_MS = 5000;       // 5 seconds for !ai
const DRAW_COOLDOWN_MS = 15000;    // 15 seconds per sender for Azure image generation
const DRAW_GLOBAL_COOLDOWN_MS = 12500; // Keep requests below the default GPT-image-2 rate limit
const ANALYZE_COOLDOWN_MS = 10000; // 10 seconds for !analyze (Azure vision)
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
            '--disable-accelerated-2d-canvas',
            '--no-first-run',
            '--no-zygote',
            '--disable-gpu',
            '--disable-software-rasterizer',
            '--mute-audio'
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

    registerClientEvents(client, {
        qrcode,
        startDeadlineMonitor,
        startPollMonitor,
        startDailyReminders,
        startTimetableMonitor,
        startClassWeekendBroadcast,
        startSystemMaintenance,
        restoreWordForgeGames
    });


// ============================================================
// MESSAGE HANDLER
// ============================================================

    const messageHandlerDependencies = {
        baseDir: __dirname,
        fs,
        path,
        execFileAsync,
        axios,
        googleTTS,
        EdgeTTS,
        MessageMedia,
        getUserBalance,
        deductBalance,
        addCoins,
        createCoinPurchaseRequest,
        listPendingCoinPurchases,
        approveCoinPurchase,
        rejectCoinPurchase,
        transferCoins,
        getUser,
        readDB,
        writeDB,
        resetEconomy,
        handleProfileCommand,
        startWordleLobby,
        startWordleGame,
        joinLobby,
        processGuess,
        stopGame,
        startWordChainLobby,
        joinWordChain,
        startWordChainGame,
        processWordChain,
        stopWordChainCommand,
        startRebusLobby,
        startRebusGame,
        stopRebusGame,
        joinRebusLobby,
        processRebusGuess,
        processRebusHint,
        handleStealCommand,
        startScrambleLobby,
        startScrambleGame,
        stopScrambleGame,
        joinScrambleLobby,
        processScrambleGuess,
        processScrambleHint,
        startWordForgeLobby,
        joinWordForgeLobby,
        startWordForgeGame,
        stopWordForgeGame,
        processWordForgeDmMessage,
        handleWordForgeStealCommand,
        startNumberRunLobby,
        joinNumberRunLobby,
        startNumberRunGame,
        stopNumberRunGame,
        processNumberRunGuess,
        generateNumberRunBanter,
        startTruthHuntLobby,
        joinTruthHuntLobby,
        startTruthHuntGame,
        stopTruthHuntGame,
        handleTruthHuntGroupMessage,
        processTruthHuntDmMessage,
        getGamesList,
        handleBalanceCommand,
        getWeather,
        fetchBibleVerse,
        getHymn,
        getEnglishHymn,
        sendHymnPianoAudio,
        logMessage,
        getChatHistory,
        resetClassDB,
        readClassDB,
        writeClassDB,
        isUserInClassSession,
        endSession,
        classHandler,
        handleAttendance,
        startMafiaLobby,
        startMafiaGame,
        handleMafiaPublicMessage,
        joinMafiaLobby,
        handleNightAction,
        castVote,
        endMafiaGame,
        getCatalogMenu,
        buyAsset,
        saveUserAsset,
        getBotMenu,
        handleSongCommand,
        handleVideoCommand,
        handleVideoQualityReply,
        buildImageAnalysisContent,
        normalizeWhatsAppNumber,
        parseDuration,
        grantImageAccess,
        revokeImageAccess,
        listImageAccess,
        buildWeatherResponse,
        generateMafiaNarration,
        ai,
        azureClient,
        aiMemory,
        MAX_AI_MEMORY,
        aiCooldowns,
        imageState,
        speakCooldowns,
        voiceCooldowns,
        pendingBibleRequests,
        knownGroupChats,
        knownPrivateChats,
        voiceSelections,
        EDGE_TTS_VOICES,
        DEFAULT_EDGE_VOICE,
        VOICE_COOLDOWN_MS,
        AI_COOLDOWN_MS,
        DRAW_COOLDOWN_MS,
        DRAW_GLOBAL_COOLDOWN_MS,
        ANALYZE_COOLDOWN_MS,
        SPEAK_COOLDOWN_MS,
        isOwner,
        canUseImageFeatures,
        getOwnerMenu,
        IMAGE_ACCESS_DENIED_MESSAGE,
        OWNER_NUMBER,
        getCanonicalJid,
        getSenderContact,
        getSenderJid,
        getContactJid,
        reactToCommand
    };

    registerMessageHandler(client, messageHandlerDependencies);

// ============================================================
// INITIALIZE WHATSAPP CLIENT
// ============================================================

client.initialize();
}
