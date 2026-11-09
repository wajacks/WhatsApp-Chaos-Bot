const GAME_CHOICES = [
    { key: 'rebus', label: 'Country Rebus', hint: 'Solve the emoji clue' },
    { key: 'wordle', label: 'Wordle', hint: 'Guess the shared five-letter word' },
    { key: 'wordchain', label: 'Word Chain', hint: 'Build a chain of words' },
    { key: 'scramble', label: 'Scrambled Word', hint: 'Race to solve each word' },
    { key: 'wordforge', label: 'Word Forge', hint: 'Build words from a private rack' },
    { key: 'numberrun', label: 'Number Run', hint: 'Guess with higher or lower clues' },
    { key: 'truthhunt', label: 'Truth Hunt', hint: 'Judge each claim' },
    { key: 'mafia', label: 'Mafia', hint: 'Play with secret roles' }
];

const PICK_TIMEOUT_MS = 5 * 60 * 1000;
const pendingPicks = new Map();

function getPickerKey(chatId, userId) {
    return `${String(chatId || '')}:${String(userId || '')}`;
}

function buildGamePickerMenu() {
    return `🎮 *CHOOSE A GAME TO OPEN*\n━━━━━━━━━━━━━━━━━━\n` +
        GAME_CHOICES.map((game, index) => `${index + 1}. *${game.label}* — ${game.hint}`).join('\n') +
        `\n\nReply with a number to open its lobby.\n0. 🔙 Cancel`;
}

function beginGamePicker(chatId, userId, now = Date.now()) {
    pendingPicks.set(getPickerKey(chatId, userId), { startedAt: now });
    return buildGamePickerMenu();
}

function resolveGamePickerInput(chatId, userId, input, now = Date.now()) {
    const key = getPickerKey(chatId, userId);
    const pending = pendingPicks.get(key);
    if (!pending) return { status: 'none' };

    if (now - pending.startedAt > PICK_TIMEOUT_MS) {
        pendingPicks.delete(key);
        return { status: 'expired' };
    }

    const value = String(input || '').trim();
    if (value === '0') {
        pendingPicks.delete(key);
        return { status: 'cancelled' };
    }
    if (/^!/.test(value)) {
        pendingPicks.delete(key);
        return { status: 'command' };
    }

    const index = Number(value) - 1;
    if (/^\d+$/.test(value) && Number.isInteger(index) && index >= 0 && index < GAME_CHOICES.length) {
        pendingPicks.delete(key);
        return { status: 'selected', game: GAME_CHOICES[index] };
    }
    return { status: 'invalid' };
}

function clearGamePicker(chatId, userId) {
    return pendingPicks.delete(getPickerKey(chatId, userId));
}

module.exports = {
    GAME_CHOICES,
    PICK_TIMEOUT_MS,
    buildGamePickerMenu,
    beginGamePicker,
    resolveGamePickerInput,
    clearGamePicker
};
