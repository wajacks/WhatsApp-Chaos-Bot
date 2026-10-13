const commandReactions = {
    profile: '👤', bal: '💰', balance: '💰', daily: '🎁', store: '🏪', catalog: '🏪', market: '🏪', buy: '🛒', beg: '🥷', request: '🥷', pay: '💸',
    ai: '🧠', analyze: '🔎', draw: '🎨', catchup: '🛰️', summary: '🛰️', speak: '🎙️', tts: '🎙️', voice: '🗣️', verse: '📖', nyimbo: '🎵', hymn: '🎼', randomsong: '🎵', song: '🎵', track: '🎵', video: '🎬',
    wordle: '🟩', join: '👥', wjoin: '👥', rjoin: '👥', rebus: '🌍', joinrebus: '👥', rguess: '🎯', hint: '💡', scramble: '🔀', joinscramble: '👥', scramblehint: '💡', stopscramble: '🛑', wordforge: '🧩', joinforge: '👥', startforge: '🚀', stopforge: '🛑', mafia: '🕵️', startmafia: '🕵️', joinmafia: '👥', endmafia: '🛑', stopmafia: '🛑',
    class: '📋', classes: '📋', games: '🎮', gamelist: '🎮', ping: '📡', menu: '📋', help: '📋', commands: '📋', weather: '🌤️',
    contactowner: '📞', ownercontact: '📞', owner: '🔐'
};

async function reactToCommand(message) {
if (message.body && message.body.startsWith('!')) {
        try {
            const cleanCommand = message.body.slice(1).trim().split(/\s+/)[0].toLowerCase();
            const emoji = commandReactions[cleanCommand];

            if (emoji) {
                await message.react(emoji);
            }
        } catch (err) {
            console.warn('[COMMAND REACTION ERROR]:', err.message);
        }
    }
}

module.exports = { commandReactions, reactToCommand };
