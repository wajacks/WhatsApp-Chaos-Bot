const STATE_REFRESH_MS = 20_000;

function createAiPresence(client, chatId) {
    if (!client || typeof client.getChatById !== 'function' || !chatId) {
        return {
            typing: async () => {},
            recording: async () => {},
            clear: async () => {}
        };
    }

    let chatPromise;
    let currentState = '';
    let refreshTimer = null;
    let operationQueue = Promise.resolve();
    let warned = false;

    const getChat = () => {
        if (!chatPromise) chatPromise = client.getChatById(chatId);
        return chatPromise;
    };

    const enqueue = operation => {
        const result = operationQueue.catch(() => {}).then(operation);
        operationQueue = result.catch(() => {});
        return result;
    };

    const applyState = state => enqueue(async () => {
        if (currentState !== state) return false;
        try {
            const chat = await getChat();
            if (currentState !== state) return false;
            if (state === 'typing') {
                await chat.sendStateTyping();
            } else if (state === 'recording') {
                await chat.sendStateRecording();
            }
            warned = false;
            return true;
        } catch (error) {
            if (!warned) {
                console.warn('[AI PRESENCE] Could not update chat state:', error.message);
                warned = true;
            }
            return false;
        }
    });

    const ensureRefresh = () => {
        if (refreshTimer) return;
        refreshTimer = setInterval(() => {
            if (currentState) void applyState(currentState);
        }, STATE_REFRESH_MS);
        if (typeof refreshTimer.unref === 'function') refreshTimer.unref();
    };

    const setState = async state => {
        currentState = state;
        ensureRefresh();
        await applyState(state);
    };

    const clear = async () => {
        currentState = '';
        if (refreshTimer) {
            clearInterval(refreshTimer);
            refreshTimer = null;
        }
        if (!chatPromise) return;

        await enqueue(async () => {
            try {
                const chat = await chatPromise;
                await chat.clearState();
            } catch (error) {
                if (!warned) {
                    console.warn('[AI PRESENCE] Could not clear chat state:', error.message);
                    warned = true;
                }
            }
        });
    };

    return {
        typing: () => setState('typing'),
        recording: () => setState('recording'),
        clear
    };
}

module.exports = { createAiPresence };
