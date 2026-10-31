const { handleAiCommand } = require('./handler');
const { sendTextAsVoiceNote } = require('../voice/voiceNoteAudio');
const { areSameWhatsAppUser } = require('../../utils/identity');
const { createAiPresence } = require('./presence');
const {
    isWhatsAppFrameError,
    reportWhatsAppFrameFailure
} = require('../../tools/whatsappHealthWatchdog');

const SPEECH_API_VERSION = '2025-10-15';

function voiceNotesEnabled() {
    return /^true$/i.test(String(process.env.AI_VOICE_NOTES_ENABLED || '').trim());
}

function isAudioMessage(message) {
    return !!message && !!message.hasMedia && ['ptt', 'audio'].includes(String(message.type || '').toLowerCase());
}

async function isAddressedToBot({ message, isGroup, client }) {
    if (!isGroup) return true;
    if (/^!ai(?:\s|$)/i.test(String(message.body || '').trim())) return true;

    const botId = client && client.info && client.info.wid && client.info.wid._serialized;
    const mentionedIds = Array.isArray(message.mentionedIds) ? message.mentionedIds : [];
    if (botId) {
        for (const id of mentionedIds) {
            if (await areSameWhatsAppUser(client, id, botId)) return true;
        }
    }

    if (message.hasQuotedMsg) {
        try {
            const quotedMessage = await message.getQuotedMessage();
            return !!quotedMessage && !!quotedMessage.fromMe;
        } catch (error) {
            console.warn('[AI VOICE] Could not inspect replied-to message:', error.message);
        }
    }
    return false;
}

function getSpeechEndpoint() {
    const configuredEndpoint = String(process.env.AZURE_SPEECH_ENDPOINT || '').trim();
    const region = String(process.env.AZURE_SPEECH_REGION || '').trim();
    const endpoint = configuredEndpoint || (region ? 'https://' + region + '.api.cognitive.microsoft.com/' : '');
    if (!endpoint) throw new Error('Azure Speech endpoint is not configured.');

    let parsed;
    try { parsed = new URL(endpoint); } catch (_) { throw new Error('Azure Speech endpoint is invalid.'); }
    if (parsed.protocol !== 'https:') throw new Error('Azure Speech endpoint must use HTTPS.');
    return parsed.toString().replace(/\/+$/, '');
}

function configuredLocales() {
    const raw = process.env.AZURE_SPEECH_LOCALES === undefined
        ? 'en-KE,sw-KE,ar-EG,af-ZA,zu-ZA,so-SO,am-ET'
        : process.env.AZURE_SPEECH_LOCALES;
    return String(raw).split(',').map(locale => locale.trim()).filter(Boolean).slice(0, 10);
}

function audioByteLength(base64) {
    const value = String(base64 || '');
    const padding = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0;
    return Math.max(0, Math.floor(value.length * 3 / 4) - padding);
}

function getPositiveInteger(value, fallback, max) {
    const parsed = Number.parseInt(value || '', 10);
    return Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, max) : fallback;
}

async function transcribeVoiceNote(message) {
    const key = String(process.env.AZURE_SPEECH_KEY || '').trim();
    if (!key) throw new Error('Azure Speech key is not configured.');

    const media = await message.downloadMedia();
    if (!media || !media.data) throw new Error('WhatsApp did not provide the voice audio.');
    const maxAudioMb = getPositiveInteger(process.env.AI_VOICE_MAX_AUDIO_MB, 20, 100);
    const maxBytes = maxAudioMb * 1024 * 1024;
    if (audioByteLength(media.data) > maxBytes) {
        throw new Error('The voice note exceeds the configured audio size limit.');
    }

    const audioBuffer = Buffer.from(media.data, 'base64');
    const mimeType = String(media.mimetype || 'audio/ogg').split(';')[0].trim() || 'audio/ogg';
    const form = new FormData();
    form.append('audio', new Blob([audioBuffer], { type: mimeType }), media.filename || 'voice-note.ogg');
    const locales = configuredLocales();
    if (locales.length) form.append('definition', JSON.stringify({ locales }));

    const endpoint = getSpeechEndpoint() + '/speechtotext/transcriptions:transcribe?api-version=' + SPEECH_API_VERSION;
    const timeoutMs = getPositiveInteger(process.env.AI_VOICE_TRANSCRIBE_TIMEOUT_MS, 60000, 180000);
    const deadline = Date.now() + timeoutMs;
    const retryDelaysMs = [2000, 4000, 8000, 16000];
    const retryableStatuses = new Set([429, 500, 502, 503, 504]);
    let response;
    let payload = {};

    for (let attempt = 0; attempt <= retryDelaysMs.length; attempt++) {
        const remainingMs = deadline - Date.now();
        if (remainingMs <= 0) {
            throw new Error('Azure Speech transcription timed out before a retry could complete.');
        }

        response = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Ocp-Apim-Subscription-Key': key },
            body: form,
            signal: AbortSignal.timeout(remainingMs)
        });

        payload = {};
        try { payload = await response.json(); } catch (_) {}
        if (response.ok || !retryableStatuses.has(response.status) || attempt === retryDelaysMs.length) break;

        const retryAfterHeader = response.headers.get('retry-after');
        const retryAfterSeconds = retryAfterHeader === null ? Number.NaN : Number(retryAfterHeader);
        const backoffMs = Number.isFinite(retryAfterSeconds) && retryAfterSeconds >= 0
            ? Math.min(Math.max(retryAfterSeconds * 1000, 1000), retryDelaysMs[attempt])
            : retryDelaysMs[attempt];
        if (Date.now() + backoffMs >= deadline) break;
        await new Promise(resolve => setTimeout(resolve, backoffMs));
    }

    if (!response || !response.ok) {
        const detail = String(payload && payload.error && payload.error.message || payload.message || '')
            .replace(/[\r\n\t]+/g, ' ').slice(0, 240);
        throw new Error('Azure Speech transcription failed (' + (response && response.status || 'unknown') + ')' + (detail ? ': ' + detail : '.'));
    }

    const transcript = Array.isArray(payload.combinedPhrases)
        ? payload.combinedPhrases.map(item => item && item.text || '').filter(Boolean).join(' ').trim()
        : Array.isArray(payload.phrases)
            ? payload.phrases.map(item => item && item.text || '').filter(Boolean).join(' ').trim()
            : '';
    return transcript;
}

async function handleAiVoiceNote(context) {
    const { message, isGroup, client } = context;
    if (!isAudioMessage(message) || message.fromMe || !voiceNotesEnabled()) return false;

    const addressed = await isAddressedToBot({ message, isGroup, client });
    if (!addressed) return false;

    if (!process.env.AZURE_SPEECH_KEY || (!process.env.AZURE_SPEECH_ENDPOINT && !process.env.AZURE_SPEECH_REGION)) {
        await message.reply('🎙️ Voice-note AI is enabled but Azure Speech is not configured yet. Ask the bot owner to finish its private .env settings.');
        return true;
    }

    const presence = createAiPresence(client, context.chatId || message.from);
    try {
        await presence.typing();
        let transcript;
        try {
            transcript = await transcribeVoiceNote(message);
        } catch (error) {
            console.error('[AI VOICE] Transcription failed:', error.message);
            const messageText = /exceeds the configured audio size limit/i.test(error.message)
                ? '🎙️ That voice note is too large for the current limit. Please send a shorter one.'
                : '🎙️ I could not transcribe that voice note right now. Please try again in a moment.';
            await message.reply(messageText);
            return true;
        }

        if (!transcript) {
            await message.reply('🎙️ I could not make out any speech in that audio. Please try a clearer voice note.');
            return true;
        }

        const aiContext = {
            ...context,
            text: transcript,
            lowerText: transcript.toLowerCase(),
            shouldHandleNaturalText: true,
            isVoiceInput: true,
            replyWithAudio: async answer => {
                const spokenText = String(answer || '').trim();
                if (!spokenText) return '';
                await presence.recording();
                return sendTextAsVoiceNote({
                    text: spokenText,
                    chatId: context.chatId,
                    senderId: context.senderId,
                    client,
                    baseDir: context.baseDir,
                    fs: context.fs,
                    path: context.path,
                    execFileAsync: context.execFileAsync,
                    googleTTS: context.googleTTS,
                    EdgeTTS: context.EdgeTTS,
                    MessageMedia: context.MessageMedia,
                    voiceSelections: context.voiceSelections,
                    EDGE_TTS_VOICES: context.EDGE_TTS_VOICES,
                    DEFAULT_EDGE_VOICE: context.DEFAULT_EDGE_VOICE
                });
            }
        };

        try {
            await handleAiCommand(aiContext);
        } catch (error) {
            if (isWhatsAppFrameError(error)) {
                console.error('[AI VOICE] WhatsApp frame detached while delivering the audio reply.');
                reportWhatsAppFrameFailure(client, error);
                return true;
            }
            console.error('[AI VOICE] AI/audio reply failed:', error.message);
            await message.reply('🎙️ I could not prepare an audio reply right now. Please try again or send the request as text.');
        }
        return true;
    } finally {
        await presence.clear();
    }
}

module.exports = { handleAiVoiceNote, isAudioMessage, transcribeVoiceNote };
