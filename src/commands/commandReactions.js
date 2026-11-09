const commandReactions = {
    profile: '👤', bal: '💰', balance: '💰', daily: '🎁', store: '🏪', catalog: '🏪', market: '🏪', buy: '🛒', beg: '🥷', request: '🥷', pay: '💸',
    ai: '🧠', analyze: '🔎', draw: '🎨', catchup: '🛰️', summary: '🛰️', speak: '🎙️', tts: '🎙️', voice: '🗣️', verse: '📖', nyimbo: '🎵', hymn: '🎼', randomsong: '🎵', song: '🎵', track: '🎵', video: '🎬',
    join: '👥', start: '🚀', stop: '🛑', play: '🎮', rguess: '🎯', hint: '💡', scramblehint: '💡',
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
