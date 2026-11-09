const activeGamesByGroup = new Map();
const participantsByGame = new Map();

function claimGame(groupId, gameName) {
    if (!groupId || !gameName) {
        return { ok: false, activeGame: null };
    }

    const activeGame = activeGamesByGroup.get(groupId);
    if (activeGame && activeGame !== gameName) {
        return { ok: false, activeGame };
    }

    if (!activeGame) participantsByGame.set(groupId, { gameName, userIds: new Set() });
    activeGamesByGroup.set(groupId, gameName);
    return { ok: true, activeGame: gameName };
}

function recordGameParticipant(groupId, gameName, userId) {
    if (!groupId || !gameName || !userId || activeGamesByGroup.get(groupId) !== gameName) return false;
    let participation = participantsByGame.get(groupId);
    if (!participation || participation.gameName !== gameName) {
        participation = { gameName, userIds: new Set() };
        participantsByGame.set(groupId, participation);
    }
    const normalizedUserId = String(userId);
    if (participation.userIds.has(normalizedUserId)) return false;
    participation.userIds.add(normalizedUserId);
    return true;
}

function releaseGame(groupId, gameName) {
    if (activeGamesByGroup.get(groupId) !== gameName) return false;
    activeGamesByGroup.delete(groupId);
    participantsByGame.delete(groupId);
    return true;
}

function getActiveGame(groupId) {
    return activeGamesByGroup.get(groupId) || null;
}

module.exports = { claimGame, releaseGame, getActiveGame, recordGameParticipant };
