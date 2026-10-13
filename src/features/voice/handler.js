const handleVoiceCommands = async (context) => {
    const {
        message, text, lowerText, chatId, senderId, client, baseDir, fs, path,
        execFileAsync, googleTTS, EdgeTTS, MessageMedia, speakCooldowns,
        SPEAK_COOLDOWN_MS, voiceCooldowns, VOICE_COOLDOWN_MS,
        voiceSelections, EDGE_TTS_VOICES, DEFAULT_EDGE_VOICE
    } = context;
        // FREE TEXT-TO-SPEECH (!speak / !tts) VIA GOOGLE-TTS-API
        // REAL OGG/OPUS WHATSAPP VOICE NOTE
        // ============================================================

        if (lowerText.startsWith('!speak ') || lowerText.startsWith('!tts ')) {
            const speechText = text.replace(/^!(speak|tts)\s+/i, '').trim();

            if (!speechText) {
                await message.reply('🎙️ Please provide text.\n\n*Example:* `!speak Hello Chaos Group!`');
                return true;
            }

            const now = Date.now();
            const lastUsed = speakCooldowns.get(senderId) || 0;

            if (now - lastUsed < SPEAK_COOLDOWN_MS) {
                const remaining = Math.ceil((SPEAK_COOLDOWN_MS - (now - lastUsed)) / 1000);
                await message.reply(`⏳ *Voice Engine Cooling Down...*\nPlease wait ${remaining}s.`);
                return true;
            }

            speakCooldowns.set(senderId, now);

            const tempDir = path.join(baseDir, 'temp');
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

            return true;
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
                return true;
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
                return true;
            }
        
            const speechText = voiceInput.trim();
            if (!speechText) return true;
        
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
        
                return true;
            }
        
            voiceCooldowns.set(senderId, now);
        
            const selectedVoiceKey =
                voiceSelections.get(senderId) || DEFAULT_EDGE_VOICE;
        
            const selectedVoice =
                EDGE_TTS_VOICES[selectedVoiceKey] ||
                EDGE_TTS_VOICES[DEFAULT_EDGE_VOICE];
        
            const tempDir = path.join(baseDir, 'temp');
        
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
        
            return true;
        }

        // ====================================================

    return false;
};

module.exports = { handleVoiceCommands };
