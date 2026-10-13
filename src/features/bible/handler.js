async function sendVerseVoiceNote({ text, message, chatId, senderId, voiceSelections, EDGE_TTS_VOICES, DEFAULT_EDGE_VOICE, voiceCooldowns, VOICE_COOLDOWN_MS, EdgeTTS, googleTTS, fallbackLanguage, execFileAsync, baseDir, fs, path, MessageMedia, client }) {
    if (text.length > 4000) {
        await message.reply('⚠️ That passage is too long for one voice note. Request a shorter verse range.');
        return;
    }

    const now = Date.now();
    const lastUsed = voiceCooldowns.get(senderId) || 0;
    if (now - lastUsed < VOICE_COOLDOWN_MS) {
        const remaining = Math.ceil((VOICE_COOLDOWN_MS - (now - lastUsed)) / 1000);
        await message.reply('⏳ Voice engine cooling down. Please wait ' + remaining + 's before requesting another narration.');
        return;
    }
    voiceCooldowns.set(senderId, now);

    const selectedVoiceKey = voiceSelections.get(senderId) || DEFAULT_EDGE_VOICE;
    const selectedVoice = EDGE_TTS_VOICES[selectedVoiceKey] || EDGE_TTS_VOICES[DEFAULT_EDGE_VOICE];
    if (!selectedVoice) {
        await message.reply('⚠️ The selected voice is unavailable. Choose a voice with !voice and try again.');
        return;
    }

    const tempDir = path.join(baseDir, 'temp');
    const timestamp = Date.now() + '-' + Math.random().toString(36).slice(2, 8);
    const inputFile = path.join(tempDir, 'bible-verse-' + timestamp + '.mp3');
    const outputFile = path.join(tempDir, 'bible-verse-' + timestamp + '.ogg');

    try {
        fs.mkdirSync(tempDir, { recursive: true });

        try {
            const tts = new EdgeTTS({
                voice: selectedVoice.voice,
                lang: selectedVoice.voice.split('-').slice(0, 2).join('-')
            });
            await tts.ttsPromise(text, inputFile);

            if (!fs.existsSync(inputFile) || fs.statSync(inputFile).size === 0) {
                throw new Error('Edge TTS did not produce an audio file.');
            }
        } catch (edgeError) {
            console.warn(
                '⚠️ Edge TTS failed for Bible narration; trying Google TTS fallback:',
                edgeError.message || edgeError
            );

            const audioParts = await googleTTS.getAllAudioBase64(text, {
                lang: fallbackLanguage,
                slow: false,
                host: 'https://translate.google.com'
            });
            if (!Array.isArray(audioParts) || audioParts.length === 0) {
                throw new Error('Google TTS did not return audio.');
            }

            const audioBuffer = Buffer.concat(
                audioParts.map(part => Buffer.from(part.base64, 'base64'))
            );
            if (audioBuffer.length === 0) {
                throw new Error('Google TTS returned empty audio.');
            }
            fs.writeFileSync(inputFile, audioBuffer);
        }

        await execFileAsync('ffmpeg', [
            '-y', '-i', inputFile, '-ac', '1', '-ar', '48000',
            '-c:a', 'libopus', '-b:a', '32k', '-vbr', 'on',
            '-application', 'voip', outputFile
        ], { windowsHide: true });

        if (!fs.existsSync(outputFile) || fs.statSync(outputFile).size === 0) {
            throw new Error('Voice conversion did not produce an audio file.');
        }

        const media = new MessageMedia(
            'audio/ogg; codecs=opus',
            fs.readFileSync(outputFile).toString('base64'),
            'bible-verse.ogg'
        );
        await client.sendMessage(chatId, media, { sendAudioAsVoice: true });
    } catch (error) {
        console.error('❌ Bible narration error:', error);
        await message.reply('⚠️ I sent the verse text, but could not create its voice note.');
    } finally {
        try {
            if (fs.existsSync(inputFile)) fs.unlinkSync(inputFile);
            if (fs.existsSync(outputFile)) fs.unlinkSync(outputFile);
        } catch (cleanupError) {
            console.warn('⚠️ Bible narration cleanup warning:', cleanupError.message);
        }
    }
}

async function handleBibleMessages({ message, chatId, senderId, text, lowerText, pendingBibleRequests, fetchBibleVerse, googleTTS, voiceSelections, EDGE_TTS_VOICES, DEFAULT_EDGE_VOICE, voiceCooldowns, VOICE_COOLDOWN_MS, EdgeTTS, execFileAsync, baseDir, fs, path, MessageMedia, client }) {
        const bibleKey = `${chatId}:${senderId}`;

        if (pendingBibleRequests.has(bibleKey)) {
            const pending = pendingBibleRequests.get(bibleKey);

            if (lowerText === '1' || lowerText === '2') {
                pendingBibleRequests.delete(bibleKey);
                const language = lowerText === '1' ? 'english' : 'swahili';
                try {
                    const result = await fetchBibleVerse(pending.reference, language);
                    if (!result.success) {
                        await message.reply(`❌ ${result.error}`);
                        return true;
                    }

                    const verseReference =
                        `${result.book} ${result.chapter}:${result.startVerse}` +
                        (result.endVerse !== result.startVerse ? `-${result.endVerse}` : '');
                    const languageName = language === 'english' ? 'English' : 'Kiswahili';
                    await message.reply(
                        `📖 *${verseReference}*\n\n` +
                        `${result.text}\n\n` +
                        `— *${languageName}*`
                    );
                    if (pending.includeAudio) {
                        await sendVerseVoiceNote({
                            text: `${verseReference}. ${result.text}`,
                            message,
                            chatId,
                            senderId,
                            voiceSelections,
                            EDGE_TTS_VOICES,
                            DEFAULT_EDGE_VOICE,
                            voiceCooldowns,
                            VOICE_COOLDOWN_MS,
                            EdgeTTS,
                            googleTTS,
                            fallbackLanguage: language === 'swahili' ? 'sw' : 'en',
                            execFileAsync,
                            baseDir,
                            fs,
                            path,
                            MessageMedia,
                            client
                        });
                    }
                } catch (error) {
                    console.error('❌ Bible Error:', error);
                    await message.reply(
                        '❌ *Bible System Error*\n\n' +
                        'I could not retrieve that verse right now.'
                    );
                }
                return true;
            }
        }

        if (lowerText === '!verse' || lowerText.startsWith('!verse ')) {
            const request = text.replace(/^!verse/i, '').trim();
            const includeAudio = /\s+audio$/i.test(request);
            const reference = request.replace(/\s+audio$/i, '').trim();
            if (!reference) {
                await message.reply(
                    '📖 *BIBLE VERSE*\n\n' +
                    'Enter a Bible reference.\n\n' +
                    'Example:\n' +
                    '`!verse John 3:16`\n\n' +
                    'You can also request a range:\n' +
                    '`!verse John 3:16-18`'
                );
                return true;
            }

            pendingBibleRequests.set(bibleKey, {
                reference,
                includeAudio,
                timestamp: Date.now()
            });
            await message.reply(
                `📖 *${reference}*\n\n` +
                'Choose a language:\n\n' +
                '1. 🇬🇧 *English*\n' +
                '2. 🇰🇪 *Kiswahili*\n\n' +
                'Reply with *1* or *2*.'
            );
            return true;
        }

        return false;
}

module.exports = { handleBibleMessages };
