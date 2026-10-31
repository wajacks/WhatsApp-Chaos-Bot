function escapeXml(value) {
    return String(value || '').replace(/[<>&"']/g, character => ({
        '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;'
    })[character]);
}

function getSpeechRegion() {
    const configured = String(process.env.AZURE_SPEECH_REGION || '').trim();
    if (configured) return configured;
    const endpoint = String(process.env.AZURE_SPEECH_ENDPOINT || '');
    const match = endpoint.match(/^https?:\/\/([a-z0-9-]+)\.(?:api\.cognitive\.microsoft\.com|cognitiveservices\.azure\.com)/i);
    return match ? match[1] : '';
}

function getSpeechLimit() {
    const parsed = Number.parseInt(process.env.AI_VOICE_REPLY_MAX_CHARS || '', 10);
    return Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, 4000) : 2500;
}

function shortenForSpeech(text) {
    const value = String(text || '').trim();
    const limit = getSpeechLimit();
    if (value.length <= limit) return value;
    const suffix = ' I can continue in another voice note if you ask.';
    let truncated = value.slice(0, Math.max(1, limit - suffix.length));
    const sentenceEnd = Math.max(truncated.lastIndexOf('. '), truncated.lastIndexOf('! '), truncated.lastIndexOf('? '));
    if (sentenceEnd > limit * 0.55) truncated = truncated.slice(0, sentenceEnd + 1);
    return truncated.trimEnd() + suffix;
}

async function sendTextAsVoiceNote(context) {
    const {
        text, chatId, senderId, client, baseDir, fs, path, execFileAsync,
        googleTTS, EdgeTTS, MessageMedia, voiceSelections,
        EDGE_TTS_VOICES, DEFAULT_EDGE_VOICE
    } = context;
    const speechText = shortenForSpeech(text);
    if (!speechText) return '';

    const tempDir = path.join(baseDir, 'temp');
    const stamp = Date.now() + '-' + Math.random().toString(36).slice(2, 8);
    const mp3Path = path.join(tempDir, 'ai-voice-' + stamp + '.mp3');
    const oggPath = path.join(tempDir, 'ai-voice-' + stamp + '.ogg');
    fs.mkdirSync(tempDir, { recursive: true });

    const selectedKey = voiceSelections && voiceSelections.get(senderId) || DEFAULT_EDGE_VOICE;
    const selectedVoice = EDGE_TTS_VOICES && (EDGE_TTS_VOICES[selectedKey] || EDGE_TTS_VOICES[DEFAULT_EDGE_VOICE]);
    let provider = '';

    try {
        if (EdgeTTS && selectedVoice && selectedVoice.voice) {
            try {
                const edge = new EdgeTTS({
                    voice: selectedVoice.voice,
                    lang: selectedVoice.voice.split('-').slice(0, 2).join('-')
                });
                await edge.ttsPromise(speechText, mp3Path);
                if (fs.existsSync(mp3Path) && fs.statSync(mp3Path).size > 0) provider = 'Edge TTS';
            } catch (error) {
                console.warn('[AI VOICE] Edge TTS failed; trying configured fallbacks:', error.message);
            }
        }

        const speechKey = String(process.env.AZURE_SPEECH_KEY || '').trim();
        const region = getSpeechRegion();
        if (!provider && speechKey && region && !/^false$/i.test(String(process.env.AI_VOICE_AZURE_TTS_FALLBACK || 'true'))) {
            try {
                const voice = String(process.env.AZURE_SPEECH_TTS_VOICE || 'en-KE-AsiliaNeural').trim();
                const language = voice.split('-').slice(0, 2).join('-');
                const ssml = '<speak version="1.0" xml:lang="' + escapeXml(language) + '"><voice name="' +
                    escapeXml(voice) + '">' + escapeXml(speechText) + '</voice></speak>';
                const response = await fetch('https://' + region + '.tts.speech.microsoft.com/cognitiveservices/v1', {
                    method: 'POST',
                    headers: {
                        'Ocp-Apim-Subscription-Key': speechKey,
                        'Content-Type': 'application/ssml+xml',
                        'X-Microsoft-OutputFormat': 'audio-24khz-48kbitrate-mono-mp3'
                    },
                    body: ssml,
                    signal: AbortSignal.timeout(45000)
                });
                if (!response.ok) throw new Error('Azure TTS returned HTTP ' + response.status);
                const audio = Buffer.from(await response.arrayBuffer());
                if (!audio.length) throw new Error('Azure TTS returned an empty audio file.');
                fs.writeFileSync(mp3Path, audio);
                provider = 'Azure Speech';
            } catch (error) {
                console.warn('[AI VOICE] Azure Speech TTS fallback failed:', error.message);
            }
        }

        if (!provider && googleTTS && speechText.length <= 200) {
            try {
                const audioBase64 = await googleTTS.getAudioBase64(speechText, {
                    lang: selectedVoice && selectedVoice.voice ? selectedVoice.voice.split('-')[0] : 'en',
                    slow: false,
                    host: 'https://translate.google.com'
                });
                fs.writeFileSync(mp3Path, Buffer.from(audioBase64, 'base64'));
                if (fs.statSync(mp3Path).size > 0) provider = 'Google TTS';
            } catch (error) {
                console.warn('[AI VOICE] Google TTS fallback failed:', error.message);
            }
        }

        if (!provider) throw new Error('No speech synthesis provider produced audio.');

        await execFileAsync('ffmpeg', [
            '-y', '-nostdin', '-i', mp3Path,
            '-ac', '1', '-ar', '48000',
            '-c:a', 'libopus', '-b:a', '32k',
            '-vbr', 'on', '-application', 'voip',
            oggPath
        ], { windowsHide: true });

        if (!fs.existsSync(oggPath) || fs.statSync(oggPath).size === 0) {
            throw new Error('FFmpeg did not create the WhatsApp voice note.');
        }

        const media = new MessageMedia(
            'audio/ogg; codecs=opus',
            fs.readFileSync(oggPath).toString('base64'),
            'chaos-ai-reply.ogg'
        );
        await client.sendMessage(chatId, media, { sendAudioAsVoice: true });
        console.log('[AI VOICE] Sent synthesized answer using ' + provider + '.');
        return speechText;
    } finally {
        for (const file of [mp3Path, oggPath]) {
            try { if (fs.existsSync(file)) fs.unlinkSync(file); } catch (_) {}
        }
    }
}

module.exports = { sendTextAsVoiceNote, shortenForSpeech };
