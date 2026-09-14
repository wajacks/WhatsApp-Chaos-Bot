const activeClassSessions = new Map();
const SESSION_TIMEOUT_MS = 120 * 1000; // 2 minutes

function createSession(userId, state = 'MAIN_MENU', data = {}) {
    if (activeClassSessions.has(userId)) {
        clearTimeout(activeClassSessions.get(userId).timer);
    }

    const timer = setTimeout(() => {
        endSession(userId, true);
    }, SESSION_TIMEOUT_MS);

    activeClassSessions.set(userId, { state, data, timer });
}

function updateSessionState(userId, newState, newData = null) {
    const session = activeClassSessions.get(userId);
    if (!session) return false;

    clearTimeout(session.timer);
    const newTimer = setTimeout(() => {
        endSession(userId, true);
    }, SESSION_TIMEOUT_MS);

    session.state = newState;
    if (newData) {
        session.data = { ...session.data, ...newData };
    }
    session.timer = newTimer;
    
    activeClassSessions.set(userId, session);
    return true;
}

function getSession(userId) {
    return activeClassSessions.get(userId) || null;
}

function endSession(userId, autoTimedOut = false) {
    const session = activeClassSessions.get(userId);
    if (session) {
        clearTimeout(session.timer);
        activeClassSessions.delete(userId);
        if (autoTimedOut) {
            console.log(`[CLASS PORTAL] Session for ${userId} timed out.`);
        }
    }
}

function isUserInClassSession(userId) {
    return activeClassSessions.has(userId);
}

module.exports = {
    createSession,
    updateSessionState,
    getSession,
    endSession,
    isUserInClassSession
};