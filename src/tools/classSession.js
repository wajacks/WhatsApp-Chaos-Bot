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
    console.log("[CLASS PORTAL] ⏳ Dual-Stage Auto-Deadline Monitor Started...");
    
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
                // --- NEW: ZERO HOUR DETECTION & AUTO-CLEANUP ---
                if (timeRemaining <= 0) {
                    dbChanged = true;
                    
                    const alertHeader = `🛑 *DEADLINE REACHED* 🛑\nTime is up for your ${a.type}!`;
                    const messageBody = `${alertHeader}\n\n🏫 Class: *${className}*\n${a.icon} *[${a.type}] ${a.unit}*\n📝 Details: ${a.details}\n\n_(This deadline has now been closed and removed from your portal)_`;

                    // Broadcast to all students
                    const members = classData.members || {};
                    for (const mId in members) {
                        try {
                            await client.sendMessage(members[mId].phoneId, messageBody);
                        } catch (e) {
                            console.warn(`[CLASS PORTAL] Failed to send zero-hour warning to ${members[mId].name}`);
                        }
                    }
                    console.log(`[CLASS PORTAL] 🛑 Zero-Hour reached for ${className}: ${a.unit}. Deleting from database.`);
                    
                    // Delete it from the array permanently
                    classData.assessments.splice(i, 1);
                    i--; // Adjust index so we don't skip the next item in the loop
                    continue; 
                }
                // -----------------------------------------------

                // Handle legacy deadlines from the old system gracefully
                if (a.hasAutoWarned && a.hasWarnedStage1 === undefined) {
                    a.hasWarnedStage1 = true;
                }

                // 1. Define Dual-Stage Thresholds based on task type
                let stage1Ms = 0, stage2Ms = 0;
                
                if (a.type === 'CAT') {
                    stage1Ms = 24 * 60 * 60 * 1000; // 24 Hours
                    stage2Ms = 12 * 60 * 60 * 1000; // 12 Hours
                } else if (a.type === 'PROJECT') {
                    stage1Ms = 12 * 60 * 60 * 1000; // 12 Hours
                    stage2Ms = 6 * 60 * 60 * 1000;  // 6 Hours
                } else if (a.type === 'ASSIGNMENT') {
                    stage1Ms = 2 * 60 * 60 * 1000;  // 2 Hours
                    stage2Ms = 1 * 60 * 60 * 1000;  // 1 Hour
                }

                let triggerAlert = false;

                // 2. Evaluate logic (Check Stage 2 first for extreme urgency)
                if (timeRemaining <= stage2Ms && !a.hasWarnedStage2) {
                    a.hasWarnedStage2 = true;
                    a.hasWarnedStage1 = true; // Lock stage 1 just in case it was skipped
                    triggerAlert = true;
                } 
                else if (timeRemaining <= stage1Ms && timeRemaining > stage2Ms && !a.hasWarnedStage1) {
                    a.hasWarnedStage1 = true;
                    triggerAlert = true;
                }

                if (triggerAlert) {
                    dbChanged = true;

                    // Calculate precise dynamic time
                    const days = Math.floor(timeRemaining / (1000 * 60 * 60 * 24));
                    const hours = Math.floor((timeRemaining % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
                    const minutes = Math.floor((timeRemaining % (1000 * 60 * 60)) / (1000 * 60));
                    
                    let exactTimeLeft = "";
                    if (days > 0) exactTimeLeft += `${days}d `;
                    if (hours > 0 || days > 0) exactTimeLeft += `${hours}h `;
                    exactTimeLeft += `${minutes}m`;

                    // 3. Customize Psychological Impact
                    let alertHeader = "";
                    if (a.type === 'CAT') {
                        alertHeader = a.hasWarnedStage2 
                            ? `🚨 *FINAL EXAM WARNING* 🚨\nZero hour approaching! Your CAT is exactly ${exactTimeLeft} away!`
                            : `🚨 *EXAM HEADS-UP* 🚨\nTime to study! Your CAT is exactly ${exactTimeLeft} away!`;
                    } else if (a.type === 'PROJECT') {
                        alertHeader = a.hasWarnedStage2
                            ? `👥 *FINAL PROJECT DEADLINE* 👥\nWrap up those final touches! Your Group Project is due in ${exactTimeLeft}!`
                            : `👥 *PROJECT REMINDER* 👥\nKeep working! Your Group Project is due in ${exactTimeLeft}.`;
                    } else if (a.type === 'ASSIGNMENT') {
                        alertHeader = a.hasWarnedStage2
                            ? `⏳ *FINAL SUBMISSION WARNING* ⏳\nLast chance! Your Assignment is due in ${exactTimeLeft}!`
                            : `⏳ *SUBMISSION REMINDER* ⏳\nHeads up! Your Assignment is due in ${exactTimeLeft}.`;
                    }

                    const messageBody = `${alertHeader}\n\n🏫 Class: *${className}*\n${a.icon} *[${a.type}] ${a.unit}*\n📝 Details: ${a.details}\n\n_(This is an automated system reminder)_`;

                    // Broadcast
                    const members = classData.members || {};
                    for (const mId in members) {
                        try {
                            await client.sendMessage(members[mId].phoneId, messageBody);
                        } catch (e) {
                            console.warn(`[CLASS PORTAL] Failed to send auto-warning to ${members[mId].name}`);
                        }
                    }
                }
            }
        }
        if (dbChanged) writeClassDB(db);
    }, 300000); // 5 minutes
}

module.exports = {
    createSession,
    updateSessionState,
    getSession,
    endSession,
    isUserInClassSession,
    startDeadlineMonitor
};