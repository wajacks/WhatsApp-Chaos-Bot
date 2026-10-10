const activeGamesByGroup = new Map();

function claimGame(groupId, gameName) {
    if (!groupId || !gameName) {
        return { ok: false, activeGame: null };
    }

    const activeGame = activeGamesByGroup.get(groupId);
    if (activeGame && activeGame !== gameName) {
        return { ok: false, activeGame };
    }

    activeGamesByGroup.set(groupId, gameName);
    return { ok: true, activeGame: gameName };
}

function releaseGame(groupId, gameName) {
    if (activeGamesByGroup.get(groupId) !== gameName) return false;
    activeGamesByGroup.delete(groupId);
    return true;
}

function getActiveGame(groupId) {
    return activeGamesByGroup.get(groupId) || null;
}

module.exports = { claimGame, releaseGame, getActiveGame };
