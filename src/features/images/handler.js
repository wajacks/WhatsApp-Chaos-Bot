const handlePendingDrawSelection = async (context) => {
    const {
        message, chatId, senderId, text, client, MessageMedia, axios,
        imageState, DRAW_COOLDOWN_MS, DRAW_GLOBAL_COOLDOWN_MS,
        ANALYZE_COOLDOWN_MS, canUseImageFeatures, IMAGE_ACCESS_DENIED_MESSAGE,
        buildImageAnalysisContent, azureClient, getUserBalance, deductBalance, addCoins, isOwner
    } = context;
        const generateSelectedImage = async (prompt, choice) => {
            if (!canUseImageFeatures(senderId)) {
                await message.reply(IMAGE_ACCESS_DENIED_MESSAGE);
                return;
            }
            if (imageState.drawGenerationInProgress) {
                await message.reply('🎨 Another image job is running. Please try again shortly.');
                return;
            }

            const deployment = choice.kind === 'azure'
                ? (process.env[choice.envName] || choice.defaultDeployment)
                : null;
            if (choice.kind === 'azure' && (!process.env.AZURE_OPENAI_KEY || !process.env.AZURE_OPENAI_ENDPOINT)) {
                await message.reply('⚙️ Azure image generation is not configured. Ask the bot owner to check the Azure settings.');
                return;
            }

            const now = Date.now();
            const lastUsed = imageState.drawCooldowns.get(senderId) || 0;
            if (now - lastUsed < DRAW_COOLDOWN_MS) {
                const remaining = Math.ceil((DRAW_COOLDOWN_MS - (now - lastUsed)) / 1000);
                await message.reply('⏳ *Image Studio Cooling Down...*\nPlease wait ' + remaining + 's.');
                return;
            }

            const globalRemaining = DRAW_GLOBAL_COOLDOWN_MS - (now - imageState.lastDrawAt);
            if (globalRemaining > 0) {
                await message.reply('⏳ Image Studio is pacing requests. Please wait ' + Math.ceil(globalRemaining / 1000) + 's.');
                return;
            }

            const generationCost = choice.kind === 'azure' && !isOwner(senderId) ? 5000 : 0;
            if (generationCost > 0) {
                const balance = getUserBalance(senderId);
                if (balance < generationCost) {
                    await message.reply('💸 Azure image generation costs $5,000 game dollars. Your balance is $' +
                        Number(balance).toLocaleString() + '. Use !buycoins to add funds.');
                    return;
                }
                if (!deductBalance(senderId, generationCost)) {
                    await message.reply('⚠️ Your balance changed before I could start. Check !bal and try again.');
                    return;
                }
            }
            let chargedAmount = generationCost;

            imageState.drawCooldowns.set(senderId, now);
            imageState.lastDrawAt = now;
            imageState.drawGenerationInProgress = true;

            const providerStartedAt = Date.now();
            try {
                await message.reply('🎨 *Image Studio Active...* Generating with ' + choice.label + '.');
                let imageMedia;

                if (choice.kind === 'pollinations') {
                    const encodedPrompt = encodeURIComponent(prompt);
                    const imageUrl = 'https://image.pollinations.ai/prompt/' + encodedPrompt + '?width=1024&height=1024&nologo=true';
                    imageMedia = await MessageMedia.fromUrl(imageUrl, { unsafeMime: true });
                } else {
                    const endpoint = process.env.AZURE_OPENAI_ENDPOINT.replace(/\/+$/, '');
                    const configuredTimeout = Number(process.env.AZURE_OPENAI_IMAGE_TIMEOUT_MS);
                    const imageTimeoutMs = Number.isFinite(configuredTimeout) && configuredTimeout > 0
                        ? configuredTimeout
                        : 300000;
                    const response = await axios.post(
                        endpoint + '/openai/v1/images/generations?api-version=preview',
                        {
                            model: deployment,
                            prompt,
                            size: '1024x1024',
                            n: 1,
                            quality: 'high',
                            output_format: 'png'
                        },
                        {
                            headers: {
                                'Content-Type': 'application/json',
                                'api-key': process.env.AZURE_OPENAI_KEY
                            },
                            timeout: imageTimeoutMs
                        }
                    );

                    const imageData = response.data?.data?.[0]?.b64_json;
                    if (!imageData) {
                        throw new Error('Azure returned no base64 image data.');
                    }

                    console.log('✅ Azure image generated with ' + deployment + ' in ' + ((Date.now() - providerStartedAt) / 1000).toFixed(1) + 's.');
                    imageMedia = new MessageMedia('image/png', imageData, 'chaos-image.png');
                }

                const captionPrompt = prompt.length > 800 ? prompt.slice(0, 797) + '...' : prompt;
                const costLine = generationCost > 0
                    ? '\n*Cost:* $5,000 game dollars'
                    : '\n*Cost:* Free';
                const caption = '🎨 *' + choice.label + '*\n*Prompt:* "' + captionPrompt + '"' +
                    costLine + '\n`wantam`👆😅';
                await client.sendMessage(chatId, imageMedia, { caption });
                chargedAmount = 0;
            } catch (imgErr) {
                const providerMessage = imgErr.response?.data?.error?.message || imgErr.message || 'Unknown image generation error';
                console.error('❌ Image Generation Error:', {
                    provider: choice.label,
                    status: imgErr.response?.status,
                    code: imgErr.code,
                    elapsedSeconds: ((Date.now() - providerStartedAt) / 1000).toFixed(1),
                    message: providerMessage
                });
                let wasRefunded = false;
                if (chargedAmount > 0) {
                    try {
                        addCoins(senderId, chargedAmount);
                        chargedAmount = 0;
                        wasRefunded = true;
                    } catch (refundError) {
                        console.error('[IMAGE BILLING] Could not refund failed generation:', refundError);
                    }
                }
                await message.reply('❌ ' + choice.label + ' image generation failed. Check provider settings, Azure quota, and bot logs.' +
                    (wasRefunded ? ' Your $5,000 was refunded.' : ''));
            } finally {
                imageState.drawGenerationInProgress = false;
            }
        };

        const imageChoiceKey = chatId + ':' + senderId;
        let pendingDrawChoice = imageState.pendingDrawChoices.get(imageChoiceKey);
        if (pendingDrawChoice && pendingDrawChoice.expiresAt <= Date.now()) {
            clearTimeout(pendingDrawChoice.timer);
            imageState.pendingDrawChoices.delete(imageChoiceKey);
            if (/^[12]$/.test(text)) {
                await message.reply('⌛ That image selection expired. Send !draw <prompt> to start again.');
                return true;
            }
            pendingDrawChoice = null;
        }

        if (pendingDrawChoice && /^(cancel|cancel draw)$/i.test(text)) {
            clearTimeout(pendingDrawChoice.timer);
            imageState.pendingDrawChoices.delete(imageChoiceKey);
            await message.reply('🛑 Image generation cancelled.');
            return true;
        }

        if (pendingDrawChoice && /^\d+$/.test(text)) {
            if (!canUseImageFeatures(senderId)) {
                clearTimeout(pendingDrawChoice.timer);
                imageState.pendingDrawChoices.delete(imageChoiceKey);
                await message.reply(IMAGE_ACCESS_DENIED_MESSAGE);
                return true;
            }
            const choice = imageState.IMAGE_MODEL_CHOICES.find((item) => item.number === text);
            if (!choice) {
                await message.reply('Choose 1 or 2, or reply `cancel`.');
                return true;
            }
            if (imageState.drawGenerationInProgress) {
                await message.reply('🎨 Another image job is running. Your selection is still waiting; try again shortly.');
                return true;
            }
            const lastUsed = imageState.drawCooldowns.get(senderId) || 0;
            const remaining = DRAW_COOLDOWN_MS - (Date.now() - lastUsed);
            if (remaining > 0) {
                await message.reply('⏳ Image Studio is cooling down. Reply ' + text + ' again in ' + Math.ceil(remaining / 1000) + 's.');
                return true;
            }
            const globalRemaining = DRAW_GLOBAL_COOLDOWN_MS - (Date.now() - imageState.lastDrawAt);
            if (globalRemaining > 0) {
                await message.reply('⏳ Image Studio is pacing requests. Reply ' + text + ' again in ' + Math.ceil(globalRemaining / 1000) + 's.');
                return true;
            }
            if (choice.kind === 'azure' && (!process.env.AZURE_OPENAI_KEY || !process.env.AZURE_OPENAI_ENDPOINT)) {
                await message.reply('⚙️ Azure image generation is not configured. You can choose 2 for Pollinations instead.');
                return true;
            }

            clearTimeout(pendingDrawChoice.timer);
            imageState.pendingDrawChoices.delete(imageChoiceKey);
            await generateSelectedImage(pendingDrawChoice.prompt, choice);
            return true;
        }


    return false;
};

const handleImageCommands = async (context) => {
    const imageChoiceKey = context.chatId + ':' + context.senderId;
    const {
        message, chatId, senderId, text, imageState,
        DRAW_COOLDOWN_MS, DRAW_GLOBAL_COOLDOWN_MS, ANALYZE_COOLDOWN_MS,
        canUseImageFeatures, IMAGE_ACCESS_DENIED_MESSAGE,
        buildImageAnalysisContent, azureClient, client, MessageMedia, axios,
        getUserBalance, deductBalance, addCoins, isOwner, userName
    } = context;
        // IMAGE GENERATOR (!draw)
        // ====================================================

        const drawCommandMatch = text.match(/^!draw(?:\s+([\s\S]*))?$/i);
        if (drawCommandMatch) {
            if (!canUseImageFeatures(senderId)) {
                await message.reply(IMAGE_ACCESS_DENIED_MESSAGE);
                return true;
            }
            const prompt = (drawCommandMatch[1] || '').trim();
            if (!prompt) {
                await message.reply('🎨 Use one command: !draw <prompt>. I will show you the image model menu.');
                return true;
            }

            if (prompt.length > 4000) {
                await message.reply('✂️ Please keep the image prompt under 4,000 characters.');
                return true;
            }

            if (imageState.drawGenerationInProgress) {
                await message.reply('🎨 Another image job is running. Please try again shortly.');
                return true;
            }

            const existingChoice = imageState.pendingDrawChoices.get(imageChoiceKey);
            if (existingChoice) clearTimeout(existingChoice.timer);
            const pendingChoice = { prompt, expiresAt: Date.now() + 60000, timer: null };
            pendingChoice.timer = setTimeout(() => {
                if (imageState.pendingDrawChoices.get(imageChoiceKey) === pendingChoice) {
                    imageState.pendingDrawChoices.delete(imageChoiceKey);
                }
            }, 60000);
            if (typeof pendingChoice.timer.unref === 'function') pendingChoice.timer.unref();
            imageState.pendingDrawChoices.set(imageChoiceKey, pendingChoice);

            const menu = imageState.IMAGE_MODEL_CHOICES.map((choice) =>
                choice.number + '. ' + choice.label + ' — ' + choice.description + (choice.kind === 'azure' ? ' ($5,000 game dollars)' : ' (free)')
            ).join('\n');
            await message.reply('🎨 *Image Studio — best-first model choices*\n\n' + menu + '\n\nAzure images cost $5,000; Pollinations is free. Reply with 1 or 2 within 60 seconds. Reply `cancel` to stop.');
            return true;
        }

        // ====================================================
        // IMAGE ANALYSIS (!analyze)
        // ====================================================

        const analyzeCommandMatch = text.match(/^!analyze(?:\s+([\s\S]*))?$/i);
        if (analyzeCommandMatch) {
            if (!canUseImageFeatures(senderId)) {
                await message.reply(IMAGE_ACCESS_DENIED_MESSAGE);
                return true;
            }
            const question = (analyzeCommandMatch[1] || '').trim();
            let imageMessage = message;

            if (!imageMessage.hasMedia && message.hasQuotedMsg) {
                try {
                    imageMessage = await message.getQuotedMessage();
                } catch (quoteErr) {
                    console.warn('[IMAGE ANALYSIS] Could not access the replied-to message:', quoteErr.message);
                    imageMessage = null;
                }
            }

            if (!imageMessage || !imageMessage.hasMedia) {
                await message.reply(
                    '🔎 Attach a photo with !analyze <question> in its caption, or reply to a photo with !analyze <question>.'
                );
                return true;
            }

            if (imageMessage.type && imageMessage.type !== 'image') {
                await message.reply('🖼️ I can analyze photos only. Please send a JPEG, PNG, WebP, or GIF image.');
                return true;
            }

            const lastAnalyzeAt = imageState.analyzeCooldowns.get(senderId) || 0;
            const cooldownRemaining = ANALYZE_COOLDOWN_MS - (Date.now() - lastAnalyzeAt);
            if (cooldownRemaining > 0) {
                await message.reply('⏳ Please wait ' + Math.ceil(cooldownRemaining / 1000) + 's before analyzing another image.');
                return true;
            }

            if (!process.env.AZURE_OPENAI_KEY || !process.env.AZURE_OPENAI_ENDPOINT) {
                await message.reply('⚙️ Azure image analysis is not configured. Ask the bot owner to check the Azure settings.');
                return true;
            }

            if (!canUseImageFeatures(senderId)) {
                await message.reply(IMAGE_ACCESS_DENIED_MESSAGE);
                return true;
            }
            const analysisCost = isOwner(senderId) ? 0 : 2000;
            let chargedAmount = 0;
            if (analysisCost > 0) {
                const balance = getUserBalance(senderId, userName);
                if (balance < analysisCost) {
                    await message.reply('💸 Image analysis costs $2,000 game dollars. Your balance is $' +
                        Number(balance).toLocaleString() + '. Use !buycoins to add funds.');
                    return true;
                }
                if (!deductBalance(senderId, analysisCost)) {
                    await message.reply('⚠️ Your balance changed before I could start. Check !bal and try again.');
                    return true;
                }
                chargedAmount = analysisCost;
            }
            imageState.analyzeCooldowns.set(senderId, Date.now());
            try {
                await message.reply('🔎 Analyzing your image with the Azure vision model...');
                const imageMedia = await imageMessage.downloadMedia();
                const imageContent = buildImageAnalysisContent(imageMedia, question);
                if (!canUseImageFeatures(senderId)) {
                    await message.reply(IMAGE_ACCESS_DENIED_MESSAGE);
                    return true;
                }
                const response = await azureClient.chat.completions.create({
                    model: process.env.AZURE_OPENAI_CHAT_DEPLOYMENT || 'gpt-4o-mini',
                    messages: [
                        {
                            role: 'system',
                            content: 'You analyze user-provided images. Describe only what is visible, answer the user’s question, and be clear when a detail is uncertain.'
                        },
                        {
                            role: 'user',
                            content: imageContent
                        }
                    ],
                    max_tokens: 800
                });

                const analysis = response.choices[0]?.message?.content?.trim();
                if (!analysis) {
                    if (chargedAmount > 0) {
                        addCoins(senderId, chargedAmount);
                        chargedAmount = 0;
                    }
                    imageState.analyzeCooldowns.delete(senderId);
                    await message.reply('⚠️ The vision model returned an empty analysis. You were not charged; please try again.');
                    return true;
                }

                const chargeLine = analysisCost > 0
                    ? '\n\n💵 Cost: $2,000 game dollars'
                    : '\n\n👑 Owner use: free';
                await message.reply('🖼️ *Image analysis*\n\n' + analysis + chargeLine);
                chargedAmount = 0;
            } catch (analyzeErr) {
                console.error('❌ Image Analysis Error:', {
                    status: analyzeErr.response?.status,
                    code: analyzeErr.code,
                    message: analyzeErr.response?.data?.error?.message || analyzeErr.message
                });

                const knownFailureMessages = {
                    IMAGE_ANALYSIS_MEDIA_MISSING: 'I could not download that photo. Please resend it as a regular image (not view-once) and try again.',
                    IMAGE_ANALYSIS_UNSUPPORTED_TYPE: 'I can analyze JPEG, PNG, WebP, and GIF photos.',
                    IMAGE_ANALYSIS_TOO_LARGE: 'That image is too large. Please send an image smaller than 10 MB.',
                    IMAGE_ANALYSIS_INVALID_DATA: 'I could not read that image. Please resend the photo and try again.'
                };
                let wasRefunded = false;
                if (chargedAmount > 0) {
                    try {
                        addCoins(senderId, chargedAmount);
                        chargedAmount = 0;
                        wasRefunded = true;
                    } catch (refundError) {
                        console.error('[IMAGE BILLING] Could not refund failed analysis:', refundError);
                    }
                }
                imageState.analyzeCooldowns.delete(senderId);
                const failureMessage = knownFailureMessages[analyzeErr.code] ||
                    '❌ Image analysis failed. You were not charged. Check the Azure vision deployment, quota, and bot logs.';
                await message.reply(failureMessage + (wasRefunded ? '\n\n$2,000 was refunded.' : ''));
            }

            return true;
        }

        // ====================================================
        
    return false;
};

module.exports = { handlePendingDrawSelection, handleImageCommands };
