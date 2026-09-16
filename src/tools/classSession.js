const activeClassSessions = new Map();
const SESSION_TIMEOUT_MS = 600 * 1000; // 10 minutes
const { readClassDB, writeClassDB } = require('../database/classdb');

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

function startDeadlineMonitor(client) {
    console.log("[CLASS PORTAL] ⏳ Auto-Deadline Monitor Started...");
    
    // Run this check every 5 minutes (300,000 ms)
    setInterval(async () => {
        const db = readClassDB();
        const now = Date.now();
        let dbChanged = false;

        for (const className in db.classes) {
            const classData = db.classes[className];
            if (!classData.assessments || classData.assessments.length === 0) continue;

            for (let i = 0; i < classData.assessments.length; i++) {
                const a = classData.assessments[i];
                const timeRemaining = a.timestamp - now;

                // 1. Define custom urgency thresholds based on task type
                let warningThresholdMs = 0;
                let timeText = "";

                if (a.type === 'CAT') {
                    warningThresholdMs = 24 * 60 * 60 * 1000; // 24 Hours
                    timeText = "24 Hours";
                } else if (a.type === 'PROJECT') {
                    warningThresholdMs = 12 * 60 * 60 * 1000; // 12 Hours
                    timeText = "12 Hours";
                } else if (a.type === 'ASSIGNMENT') {
                    warningThresholdMs = 2 * 60 * 60 * 1000;  // 2 Hours
                    timeText = "2 Hours";
                }

                // 2. Check if we have crossed this specific deadline's threshold
                if (timeRemaining > 0 && timeRemaining <= warningThresholdMs && !a.hasAutoWarned) {
                    
                    // Mark as warned so we don't spam
                    a.hasAutoWarned = true;
                    dbChanged = true;

                    // 3. Customize the psychological impact of the message
                    let alertHeader = "";
                    if (a.type === 'CAT') {
                        alertHeader = `🚨 *URGENT EXAM WARNING* 🚨\nTime to study! Your CAT is exactly ${timeText} away!`;
                    } else if (a.type === 'PROJECT') {
                        alertHeader = `👥 *PROJECT DEADLINE* 👥\nWrap up those final touches! Your Group Project is due in ${timeText}!`;
                    } else if (a.type === 'ASSIGNMENT') {
                        alertHeader = `⏳ *SUBMISSION REMINDER* ⏳\nFinal call! Your Assignment is due in ${timeText}!`;
                    }

                    const messageBody = `${alertHeader}\n\n🏫 Class: *${className}*\n${a.icon} *[${a.type}] ${a.unit}*\n📝 Details: ${a.details}\n\n_(This is an automated system reminder)_`;

                    // Broadcast to all registered students
                    const members = classData.members || {};
                    for (const mId in members) {
                        try {
                            await client.sendMessage(members[mId].phoneId, messageBody);
                        } catch (e) {
                            console.warn(`[CLASS PORTAL] Failed to send auto-warning to ${members[mId].name}`);
                        }
                    }
                    console.log(`[CLASS PORTAL] 🚨 Auto-Warning deployed for ${className}: ${a.unit} (${timeText} threshold)`);
                }
            }
        }

        if (dbChanged) {
            writeClassDB(db);
        }
    }, 300000); // 5 minutes
}

module.exports = {
    createSession,
    updateSessionState,
    getSession,
    endSession,
    isUserInClassSession,
    artDeadlineMonitor
};