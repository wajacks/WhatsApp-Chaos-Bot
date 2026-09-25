const activeClassSessions = new Map();
const SESSION_TIMEOUT_MS = 600 * 1000; // 10 minutes
const cron = require('node-cron');
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
            if (classData.holidayMode) continue;
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

function startPollMonitor(client) {
    console.log("[CLASS PORTAL] 📊 Poll Monitor Started...");
    setInterval(async () => {
        const db = readClassDB();
        const now = Date.now();
        let dbChanged = false;

        for (const className in db.classes) {
            const classData = db.classes[className];
            if (!classData.polls) continue;

            for (let i = 0; i < classData.polls.length; i++) {
                const poll = classData.polls[i];
                if (poll.status === 'ACTIVE' && now > poll.expiresAt) {
                    poll.status = 'CLOSED';
                    dbChanged = true;

                    // Tally results
                    const results = Array(poll.options.length).fill(0);
                    let totalVotes = 0;
                    for (const studentId in poll.votes) {
                        const voteIdx = poll.votes[studentId];
                        if (voteIdx >= 0 && voteIdx < results.length) {
                            results[voteIdx]++;
                            totalVotes++;
                        }
                    }

                    // Format result message
                    let resultMsg = `🛑 *POLL CLOSED* 🛑\n━━━━━━━━━━━━━━━━━━\n`;
                    resultMsg += `❓ *${poll.question}*\n\n`;
                    poll.options.forEach((opt, idx) => {
                        const count = results[idx];
                        const percentage = totalVotes > 0 ? Math.round((count / totalVotes) * 100) : 0;
                        resultMsg += `${idx + 1}. ${opt} - *${count} votes* (${percentage}%)\n`;
                    });
                    resultMsg += `\nTotal Votes: ${totalVotes}`;

                    // Save the result string in the poll object so dashboards can view it
                    poll.finalResultStr = resultMsg;

                    // 1. Blast the final tally to every registered student safely
                    const members = classData.members || {};
                    for (const mId in members) {
                        try {
                            await new Promise(resolve => setTimeout(resolve, 2000));
                            await client.sendMessage(members[mId].phoneId, resultMsg);
                        } catch (e) {
                            console.warn(`[POLL] Could not send result to ${members[mId].name}`);
                        }
                    }

                    // 2. DM the Rep automatically
                    if (classData.repId) {
                        try {
                            await new Promise(resolve => setTimeout(resolve, 2000));
                            await client.sendMessage(classData.repId, `📊 *POLL FINISHED*\nYour class poll has ended and the results have been broadcasted to all students.\n\n${resultMsg}`);
                        } catch (e) {
                            console.warn(`[CLASS PORTAL] Failed to send poll results to rep for ${className}`);
                        }
                    }
                    console.log(`[CLASS PORTAL] 📊 Poll Closed for ${className}`);
                }
            }
        }
        if (dbChanged) writeClassDB(db);
    }, 60000); // Check every minute
}

function startTimetableMonitor(client) {
    console.log("[CLASS PORTAL] 🏫 Timetable & Auto-Roll Call Daemon Started (Cron Engine)...");
    
    // Runs every minute with explicit East Africa Time enforcement
    cron.schedule('* * * * *', async () => {
        const db = readClassDB();
        
        // Get precise Mombasa time via cron's native timezone handling
        const nowEAT = new Date(new Date().toLocaleString("en-US", {timeZone: "Africa/Nairobi"}));
        const currentMinutes = (nowEAT.getHours() * 60) + nowEAT.getMinutes();
        
        const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
        const todayStr = days[nowEAT.getDay()];
        const todayDateKey = nowEAT.toISOString().split('T')[0];

        let dbChanged = false;

        for (const className in db.classes) {
            const classData = db.classes[className];
            if (classData.holidayMode) continue; // Skip all alerts if holiday mode is active
            const schedule = classData.timetable?.[todayStr] || [];
            if (schedule.length === 0) continue;

            for (let i = 0; i < schedule.length; i++) {
                const cls = schedule[i];
                
                // Check if a temporary exception exists for this exact class today
                const isCancelled = classData.exceptions?.[todayDateKey]?.[cls.unit]?.status === 'CANCELLED';
                if (isCancelled) continue; // Skip all alerts

                // 1. THE 45-MINUTE WARNING (With Anti-Spam)
                if (cls.startMinutes - currentMinutes === 60) {
                    let shouldWarn = true;
                    // Anti-Spam Check: Did a class just end?
                    if (i > 0) {
                        const prevClass = schedule[i - 1];
                        const gap = cls.startMinutes - prevClass.endMinutes;
                        if (gap < 120) shouldWarn = false; // Classes are back-to-back, skip spam
                    }

                    if (shouldWarn) {
                        broadcastToClass(client, classData, `⏳ *UPCOMING CLASS*\n\n${cls.unit} begins in exactly 45 minutes at ${cls.startTime}.`);
                    }
                }

                // 2. THE START TRIGGER & AUTO-ROLL CALL
                if (currentMinutes === cls.startMinutes) {
                    const msg = `🟢 *CLASS IS STARTING*\n\n🏫 *Unit:* ${cls.unit}\n⏰ *Time:* ${cls.startTime} - ${cls.endTime}\n\n` +
                                `_The attendance register is now open. Choose how to sign in:_\n` +
                                `1️⃣ Reply with *PRESENT*\n` +
                                `2️⃣ Type *!class* ➔ Open Student Hub ➔ Select option *8* (Sign Attendance)`;
                    
                    broadcastToClass(client, classData, msg);
                    
                    // Auto-open the database roll call flag
                    classData.activeRollCall = {
                        unit: cls.unit,
                        date: todayDateKey,
                        attendees: {}
                    };
                    dbChanged = true;
                }

                // 3. THE END TRIGGER & ROLL CALL CLOSURE
                if (currentMinutes === cls.endMinutes) {
                    broadcastToClass(client, classData, `🛑 *CLASS ENDED*\n\n${cls.unit} has officially concluded. The attendance register is now closed.`);
                    
                    // Auto-close roll call
                    delete classData.activeRollCall;
                    dbChanged = true;
                }
            }

            // Process any Temporary Makeup Classes scheduled for today
            const todaysExceptions = classData.exceptions?.[todayDateKey] || {};
            for (const key in todaysExceptions) {
                const makeupClass = todaysExceptions[key];
                if (makeupClass.status === 'MOVED') {
                    // Start Trigger
                    if (currentMinutes === makeupClass.startMinutes) {
                        const makeupMsg = `🟢 *MAKEUP CLASS STARTING*\n\n🏫 *Unit:* ${makeupClass.unit}\n⏰ *Time:* ${makeupClass.startTime} - ${makeupClass.endTime}\n\n` +
                                          `_The attendance register is now open. Choose how to sign in:_\n` +
                                          `1️⃣ Reply with *PRESENT*\n` +
                                          `2️⃣ Type *!class* ➔ Open Student Hub ➔ Select option *8* (Sign Attendance)`;

                        broadcastToClass(client, classData, makeupMsg);
                        classData.activeRollCall = {
                            unit: makeupClass.unit,
                            date: todayDateKey,
                            attendees: {}
                        };
                        dbChanged = true;
                    }
                    // End Trigger
                    if (currentMinutes === makeupClass.endMinutes) {
                        broadcastToClass(client, classData, `🛑 *MAKEUP CLASS ENDED*\n\n${makeupClass.unit} has officially concluded.`);
                        delete classData.activeRollCall;
                        dbChanged = true;
                    }
                }
            }
        }

        if (dbChanged) writeClassDB(db);
    }, { scheduled: true, timezone: "Africa/Nairobi" });
}

function startClassWeekendBroadcast(client) {
    // Runs every Friday at 5:00 PM (17:00) East Africa Time
    cron.schedule('0 17 * * 5', async () => {
        console.log("[CLASS PORTAL] 🥳 Broadcasting Friday Weekend Wish to class members...");
        const db = readClassDB();
        const classes = db.classes || {};

        const weekendMessage = 
            `🎉 *HAPPY WEEKEND, SCHOLARS!* 🎉\n` +
            `━━━━━━━━━━━━━━━━━━\n\n` +
            `The week's academic hustle is finally wrapped up! Whether you're resting up, catching up on assignments, or stepping away from your laptop—make it count.\n\n` +
            `Have a safe, restful weekend, and let's bring the energy back next week! 🚀\n\n` +
            `_— Automated Class Portal Weekend Wish_`;

        for (const className in classes) {
            const classData = classes[className];
            const recipients = new Set();

            // 1. Collect Class Rep
            if (classData.repId) recipients.add(classData.repId);
            
            // 2. Collect Assistant Reps
            if (classData.assistantReps) {
                classData.assistantReps.forEach(id => recipients.add(id));
            }
            
            // 3. Collect all registered Students
            const members = classData.members || {};
            for (const mKey in members) {
                if (members[mKey].phoneId) {
                    recipients.add(members[mKey].phoneId);
                }
            }

            // 4. Blast with a safe 1-second delay between DMs to prevent spam flagging
            for (const recipientId of recipients) {
                try {
                    await new Promise(resolve => setTimeout(resolve, 1000));
                    await client.sendMessage(recipientId, weekendMessage);
                } catch (e) {
                    console.warn(`[CLASS PORTAL] Failed to send weekend wish to ${recipientId}`);
                }
            }
        }
        console.log("[CLASS PORTAL] ✅ Weekend broadcast completed.");
    }, {
        scheduled: true,
        timezone: "Africa/Nairobi"
    });
}

// Helper to blast all students
// Fire and forget: Do not use 'await' when calling this function
function broadcastToClass(client, classData, messageText) {
    const members = classData.members || {};
    const memberIds = Object.keys(members);
    
    // Background execution wrapper
    (async () => {
        for (let i = 0; i < memberIds.length; i++) {
            const mId = memberIds[i];
            try {
                // Keep the anti-spam delay, but now it doesn't block the rest of the bot
                await new Promise(resolve => setTimeout(resolve, 2000));
                await client.sendMessage(members[mId].phoneId, messageText);
            } catch (e) {
                console.warn(`Failed to broadcast to ${members[mId].name}`);
            }
        }
    })(); // Execute immediately in background
}

function getPortalMetrics(className, repId) {
    let activeCount = 0;
    let repOnline = false;

    for (const [userId, session] of activeClassSessions.entries()) {
        if (session.data && session.data.loggedInClass === className) {
            activeCount++;
            if (userId === repId) {
                repOnline = true;
            }
        }
    }
    return { activeCount, repOnline };
}

function startDailyReminders(client) {
    // 6 AM Reminder (Morning)
    cron.schedule('0 6 * * *', async () => {
        await sendDynamicReminders(client, 'MORNING');
    }, { scheduled: true, timezone: "Africa/Nairobi" });

    // 9 PM Reminder (Night)
    cron.schedule('0 21 * * *', async () => {
        await sendDynamicReminders(client, 'NIGHT');
    }, { scheduled: true, timezone: "Africa/Nairobi" });
}

async function sendDynamicReminders(client, timeOfDay) {
    console.log(`[CRON] Executing ${timeOfDay} Class Portal reminders...`);
    const db = readClassDB();
    const classes = db.classes || {};
    const isMorning = timeOfDay === 'MORNING';
    
    const greeting = isMorning ? 'Good morning' : 'Good evening';
    const actionText = isMorning 
        ? "Here is your morning check-in. Don't forget to update the portal" 
        : "Here is your evening wrap-up. Make sure the portal is ready for tomorrow";
    const studentAction = isMorning
        ? "Have a great day ahead! Remember to check your portal"
        : "Rest well! Take a moment to review your portal";

    for (const className in classes) {
        const classData = classes[className];
        
        // 🌴 Skip reminders entirely if the class is on Holiday Mode
        if (classData.holidayMode) continue;

        // 1. Remind Reps
        const repIds = new Set();
        if (classData.repId) repIds.add(classData.repId);
        if (classData.assistantReps) classData.assistantReps.forEach(id => repIds.add(id));

        for (const repId of repIds) {
            try {
                const repPhone = repId.split('@')[0];
                const msg = `🌅 *CLASS REP REMINDER*\n━━━━━━━━━━━━━━━━━━\n\n${greeting} @${repPhone}! 👑\n\n${actionText} for *${className}*.\n\nType \`!class\` to manage your dashboard.`;
                await new Promise(resolve => setTimeout(resolve, 5000));
                await client.sendMessage(repId, msg, { mentions: [repId] });
            } catch (e) {}
        }

        // 2. Remind Students
        const members = classData.members || {};
        for (const memberKey in members) {
            const studentId = members[memberKey].phoneId;
            try {
                const stuPhone = studentId.split('@')[0];
                const msg = `🔔 *STUDENT PORTAL REMINDER*\n━━━━━━━━━━━━━━━━━━\n\n${greeting} @${stuPhone}! 👋\n\n${studentAction} for *${className}* to stay updated on classes and deadlines.\n\nType \`!class\` to view your Student Hub.`;
                await new Promise(resolve => setTimeout(resolve, 5000));
                await client.sendMessage(studentId, msg, { mentions: [studentId] });
            } catch (e) {}
        }
    }
}

function startSystemMaintenance(client) {
    // 1. MIDNIGHT SWEEP: Closes orphaned roll calls at 11:59 PM daily
    cron.schedule('59 23 * * *', () => {
        const db = readClassDB();
        let changed = false;
        for (const className in db.classes) {
            if (db.classes[className].activeRollCall) {
                delete db.classes[className].activeRollCall;
                changed = true;
            }
        }
        if (changed) writeClassDB(db);
        console.log("[SYSTEM] Midnight Sweep complete. All active roll calls closed.");
    }, { scheduled: true, timezone: "Africa/Nairobi" });

    // 2. 3-DAY BACKUP: Overwrites the backup file at 3:00 AM and notifies Reps
    cron.schedule('0 3 */3 * *', async () => {
        const fs = require('fs');
        const path = require('path');
        const dbPath = path.join(__dirname, '..', 'database', 'classdb.json');
        const backupPath = path.join(__dirname, '..', 'database', 'classdb_backup.json');

        try {
            // Overwrites the old backup with the new one
            fs.copyFileSync(dbPath, backupPath);
            console.log("[SYSTEM] 3-Day Database Backup Overwritten Successfully.");

            const db = readClassDB();
            for (const className in db.classes) {
                const classData = db.classes[className];
                if (classData.repId && !classData.holidayMode) {
                    try {
                        await new Promise(resolve => setTimeout(resolve, 5000));
                        await client.sendMessage(
                            classData.repId, 
                            `💾 *SYSTEM MAINTENANCE*\n\nThe scheduled 3-day database backup was completed successfully. All class data for *${className}* is secure.`
                        );
                    } catch (e) {}
                }
            }
        } catch (err) {
            console.error("[SYSTEM] Backup failed:", err.message);
        }
    }, { scheduled: true, timezone: "Africa/Nairobi" });
}

module.exports = {
    createSession,
    updateSessionState,
    getSession,
    endSession,
    isUserInClassSession,
    startDeadlineMonitor,
    startTimetableMonitor,
    getPortalMetrics,
    startPollMonitor,
    startDailyReminders,
    startClassWeekendBroadcast,
};