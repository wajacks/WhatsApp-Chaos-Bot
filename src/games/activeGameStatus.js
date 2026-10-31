const games = [
    require('./wordle'),
    require('./wordchain'),
    require('./rebuscountry'),
    require('./scramble'),
    require('./wordforge'),
    require('./numberrun'),
    require('./truthhunt'),
    require('./mafia')
];

function hasActiveGames() {
    try {
        return games.some(game => game.hasActiveGames());
    } catch (error) {
        console.error('[SCHEDULED RESTART] Could not verify game state; postponing restart:', error.message);
        return true;
    }
}

module.exports = { hasActiveGames };
