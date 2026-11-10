const activeClassSessions = new Map();
const timetableNotificationQueues = new Map();
const TIGHT_CLASS_TRANSITION_DELAY_MS = 15_000;
const SESSION_TIMEOUT_MS = 600 * 1000; // 10 minutes
const PRE_CLASS_REMINDER_MINUTES = 45;
const ROLL_CALL_LATE_GRACE_MINUTES = 10;
const cron = require('node-cron');
const { readClassDB, writeClassDB, createClassDBBackup } = require('../database/classdb');
const { createVerifiedOffsiteClassDBBackup } = require('../database/offsiteBackup');
const { flushClassDB } = require('../database/classdb');
const { formatDeliveryDetails } = require('./classDelivery');

function getEATParts(date = new Date()) {
    const values = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
        timeZone: 'Africa/Nairobi',
        weekday: 'long',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23'
    }).formatToParts(date).map(part => [part.type, part.value]));

    return {
        weekday: values.weekday,
        dateKey: `${values.year}-${values.month}-${values.day}`,
        currentMinutes: (Number(values.hour) * 60) + Number(values.minute)
    };
}

function getEATDateKey(date = new Date()) {
    return getEATParts(date).dateKey;
}

function parseClassTime(value) {
    const match = String(value || '').match(/(\d{1,2}):(\d{2})\s*(AM|PM)?/i);
    if (!match) return null;
    let hour = Number(match[1]);
    const minute = Number(match[2]);
    const period = String(match[3] || '').toUpperCase();
    if (minute > 59 || hour > (period ? 12 : 23) || hour < 0 || (period && hour < 1)) return null;
    if (period === 'PM' && hour !== 12) hour += 12;
    if (period === 'AM' && hour === 12) hour = 0;
    return (hour * 60) + minute;
}

function getClassTimeRange(classSlot = {}) {
    let startMinutes = classSlot.startMinutes === null || classSlot.startMinutes === ''
        ? NaN
        : Number(classSlot.startMinutes);
    if (!Number.isFinite(startMinutes) || startMinutes < 0 || startMinutes > 1439) {
        startMinutes = parseClassTime(classSlot.startTime || classSlot.time);
    }
    if (!Number.isFinite(startMinutes)) return null;

    let endMinutes = classSlot.endMinutes === null || classSlot.endMinutes === ''
        ? NaN
        : Number(classSlot.endMinutes);
    if (!Number.isFinite(endMinutes) || endMinutes <= startMinutes) {
        endMinutes = parseClassTime(classSlot.endTime);
    }
    if (!Number.isFinite(endMinutes) || endMinutes <= startMinutes) endMinutes = startMinutes + 180;
    return { startMinutes, endMinutes };
}

function formatClassClock(totalMinutes) {
    const minuteOfDay = ((Number(totalMinutes) % 1440) + 1440) % 1440;
    const hour24 = Math.floor(minuteOfDay / 60);
    const minute = minuteOfDay % 60;
    const period = hour24 >= 12 ? 'PM' : 'AM';
    const hour12 = hour24 % 12 || 12;
    return `${hour12}:${String(minute).padStart(2, '0')} ${period}`;
}

function getScheduledClassSlots(classData, weekday, dateKey) {
    const schedule = classData?.timetable?.[String(weekday || '').toLowerCase()] || [];
    const exceptions = classData?.exceptions?.[dateKey] || {};
    const slots = [];
    const seen = new Set();

    const addSlot = (slot, source) => {
        const range = getClassTimeRange(slot);
        if (!range || !slot?.unit) return;
        const key = `${String(slot.unit).toLowerCase()}|${range.startMinutes}|${range.endMinutes}`;
        if (seen.has(key)) return;
        seen.add(key);
        slots.push({
            ...slot,
            ...range,
            startTime: slot.startTime || formatClassClock(range.startMinutes),
            endTime: slot.endTime || formatClassClock(range.endMinutes),
            source
        });
    };

    for (const slot of Array.isArray(schedule) ? schedule : []) {
        if (['CANCELLED', 'MOVED'].includes(exceptions[slot.unit]?.status)) continue;
        addSlot(slot, 'timetable');
    }
    for (const exception of Object.values(exceptions)) {
        if (exception?.status === 'MOVED') addSlot(exception, 'makeup');
    }
    return slots.sort((a, b) => a.startMinutes - b.startMinutes || a.unit.localeCompare(b.unit));
}

function isPreClassReminderDue(slot, currentMinutes) {
    const range = getClassTimeRange(slot);
    if (!range) return false;
    const reminderAt = range.startMinutes - PRE_CLASS_REMINDER_MINUTES;
    return currentMinutes >= reminderAt && currentMinutes < range.startMinutes;
}

function getScheduledStartTimestamp(dateKey, startMinutes) {
    const match = String(dateKey || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match || !Number.isFinite(Number(startMinutes))) return Date.now();
    return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 0, Number(startMinutes)) - (3 * 60 * 60 * 1000);
}

function normalizeRollCallDate(activeRollCall) {
    if (!activeRollCall) return null;
    const raw = activeRollCall.dateKey || activeRollCall.date;
    if (typeof raw === 'string') {
        const isoMatch = raw.match(/^(\d{4}-\d{2}-\d{2})/);
        if (isoMatch) return isoMatch[1];
        const usMatch = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
        if (usMatch) return `${usMatch[3]}-${usMatch[1].padStart(2, '0')}-${usMatch[2].padStart(2, '0')}`;
    }
    return activeRollCall.startedAt ? getEATDateKey(new Date(activeRollCall.startedAt)) : null;
}

function snapshotClassRoster(classData) {
    return Object.entries(classData?.members || {}).map(([memberKey, member]) => ({
        memberKey,
        name: member?.name || 'Unknown student',
        admission: member?.admission || ''
    }));
}

function getRollCallCheckInStatus(activeRollCall, checkedInAt = Date.now()) {
    const checkInTime = Number(checkedInAt);
    if (!Number.isFinite(checkInTime) || checkInTime <= 0) return 'PRESENT';
    const configuredGraceEnd = Number(activeRollCall?.lateGraceEndsAt);
    const graceEndsAt = Number.isFinite(configuredGraceEnd) && configuredGraceEnd > 0
        ? configuredGraceEnd
        : (Number(activeRollCall?.scheduledStartAt) || Number(activeRollCall?.startedAt) || checkInTime) +
            ROLL_CALL_LATE_GRACE_MINUTES * 60 * 1000;
    return checkInTime > graceEndsAt ? 'LATE' : 'PRESENT';
}

function closeActiveRollCall(classData) {
    const active = classData?.activeRollCall;
    if (!active) return null;

    const closedAt = Date.now();
    const attendees = active.attendees && typeof active.attendees === 'object' ? active.attendees : {};
    const rosterSnapshot = Array.isArray(active.rosterSnapshot)
        ? active.rosterSnapshot
        : snapshotClassRoster(classData);
    const attendance = rosterSnapshot.map(student => {
        const checkIn = attendees[student.memberKey];
        const checkedInAt = Number(checkIn?.checkedInAt) || null;
        return {
            ...student,
            status: !checkIn ? 'ABSENT' : getRollCallCheckInStatus(active, checkedInAt),
            checkedInAt,
            checkInTime: checkIn?.timestamp || null
        };
    });
    const presentCount = attendance.filter(student => student.status === 'PRESENT').length;
    const lateCount = attendance.filter(student => student.status === 'LATE').length;
    const absentCount = attendance.filter(student => student.status === 'ABSENT').length;
    const record = {
        id: `rollcall_${active.startedAt || closedAt}_${String(active.unit || 'class').replace(/[^a-z0-9]+/gi, '_').toLowerCase()}`,
        unit: active.unit || 'Unknown unit',
        dateKey: normalizeRollCallDate(active) || getEATDateKey(new Date(closedAt)),
        startedAt: Number(active.startedAt) || null,
        closedAt,
        source: active.source || 'legacy',
        presentCount: presentCount + lateCount,
        onTimeCount: presentCount,
        lateCount,
        absentCount,
        deliveryFailureCount: Number(active.deliveryFailureCount) || 0,
        rosterCount: rosterSnapshot.length,
        attendees,
        attendance
    };

    if (!Array.isArray(classData.attendanceHistory)) classData.attendanceHistory = [];
    classData.attendanceHistory.push(record);
    classData.totalRollCalls = (Number(classData.totalRollCalls) || 0) + 1;
    if (!Array.isArray(classData.logs)) classData.logs = [];
    classData.logs.push({
        text: `Roll Call Completed: ${record.unit} (${record.presentCount} present)`,
        timestamp: closedAt
    });
    delete classData.activeRollCall;
    return { ...active, attendees, closedAt, attendanceRecord: record };
}

function openActiveRollCall(classData, unit, dateKey, options = {}) {
    const active = classData.activeRollCall;
    if (active) {
        if (active.unit === unit && normalizeRollCallDate(active) === dateKey) return false;
        return false;
    }

    const startedAt = Date.now();
    const startMinutes = options.startMinutes === null || options.startMinutes === undefined || options.startMinutes === ''
        ? NaN
        : Number(options.startMinutes);
    const scheduledStartAt = Number.isFinite(startMinutes)
        ? getScheduledStartTimestamp(dateKey, startMinutes)
        : startedAt;
    classData.activeRollCall = {
        unit,
        date: dateKey,
        dateKey,
        startedAt,
        scheduledStartAt,
        lateGraceEndsAt: scheduledStartAt + (Number(options.lateGraceMinutes) || ROLL_CALL_LATE_GRACE_MINUTES) * 60 * 1000,
        startMinutes: Number.isFinite(startMinutes) ? startMinutes : null,
        endMinutes: options.endMinutes !== null && options.endMinutes !== undefined && Number.isFinite(Number(options.endMinutes))
            ? Number(options.endMinutes)
            : null,
        source: options.source || 'scheduled',
        followUpSentAt: null,
        deliveryFailureCount: 0,
        rosterSnapshot: snapshotClassRoster(classData),
        attendees: {}
    };
    return true;
}

function closeRollCallFor(classData, unit, dateKey) {
    const active = classData.activeRollCall;
    if (!active || active.unit !== unit || normalizeRollCallDate(active) !== dateKey) return null;
    return closeActiveRollCall(classData);
}


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

function makeTimetableNoticeKey(type, dateKey, slot) {
    return `${type}:${dateKey}:${Number(slot.startMinutes)}:${String(slot.unit || '').toLowerCase()}`;
}

function claimTimetableNotice(classData, type, dateKey, slot, now = Date.now()) {
    if (!classData.timetableNoticeLog || typeof classData.timetableNoticeLog !== 'object') {
        classData.timetableNoticeLog = {};
    }
    const key = makeTimetableNoticeKey(type, dateKey, slot);
    if (classData.timetableNoticeLog[key]) return false;
    classData.timetableNoticeLog[key] = now;

    const cutoff = Date.parse(`${dateKey}T00:00:00Z`) - (14 * 24 * 60 * 60 * 1000);
    for (const oldKey of Object.keys(classData.timetableNoticeLog)) {
        const oldDate = oldKey.split(':')[1];
        const timestamp = Date.parse(`${oldDate}T00:00:00Z`);
        if (Number.isFinite(timestamp) && timestamp < cutoff) delete classData.timetableNoticeLog[oldKey];
    }
    return true;
}

function addRollCallDeliveryFailures(className, unit, dateKey, startedAt, failedCount) {
    const amount = Number(failedCount) || 0;
    if (amount <= 0) return;
    const db = readClassDB();
    const classData = db.classes?.[className];
    if (!classData) return;

    const active = classData.activeRollCall;
    let target = active && active.unit === unit && normalizeRollCallDate(active) === dateKey &&
        Number(active.startedAt) === Number(startedAt) ? active : null;
    if (!target) {
        const history = Array.isArray(classData.attendanceHistory) ? classData.attendanceHistory : [];
        target = [...history].reverse().find(record => record.unit === unit && record.dateKey === dateKey &&
            Number(record.startedAt) === Number(startedAt));
    }
    if (!target) return;
    target.deliveryFailureCount = (Number(target.deliveryFailureCount) || 0) + amount;
    writeClassDB(db);
}

function enqueueRollCallNotification(client, className, classData, activeRollCall, messageText, delayMs = 0, recipientIds = null) {
    const promise = enqueueClassNotification(client, className, classData, messageText, delayMs, recipientIds);
    promise.then(result => {
        addRollCallDeliveryFailures(
            className,
            activeRollCall.unit,
            normalizeRollCallDate(activeRollCall),
            activeRollCall.startedAt,
            result?.failedCount
        );
    }).catch(() => {});
    return promise;
}

function buildRollCallSummary(record) {
    const attendance = Array.isArray(record?.attendance) ? record.attendance : [];
    const present = attendance.filter(item => item.status === 'PRESENT').length;
    const late = attendance.filter(item => item.status === 'LATE').length;
    const absent = attendance.filter(item => item.status === 'ABSENT').length;
    return `📊 *AUTOMATIC ROLL-CALL SUMMARY*\n━━━━━━━━━━━━━━━━━━\n` +
        `📚 Unit: *${record.unit}*\n📅 Date: *${record.dateKey}*\n` +
        `✅ Present on time: *${present}*\n⏰ Late: *${late}*\n❌ Absent: *${absent}*\n` +
        `⚠️ Student DMs that failed: *${Number(record.deliveryFailureCount) || 0}*`;
}

function queueScheduledClassEnd(client, className, classData, closedRollCall, messageText, delayMs = 0) {
    const delivery = enqueueRollCallNotification(client, className, classData, closedRollCall, messageText, delayMs);
    delivery.then(async () => {
        if (!classData.repId) return;
        const db = readClassDB();
        const latestClassData = db.classes?.[className];
        const latestRecord = latestClassData?.attendanceHistory?.find(record =>
            record.unit === closedRollCall.unit && record.dateKey === normalizeRollCallDate(closedRollCall) &&
            Number(record.startedAt) === Number(closedRollCall.startedAt)
        ) || closedRollCall.attendanceRecord;
        if (!latestRecord) return;
        try {
            await client.sendMessage(classData.repId, buildRollCallSummary(latestRecord));
        } catch (error) {
            console.warn(`[CLASS PORTAL] Could not send roll-call summary to the representative of ${className}:`, error.message);
        }
    }).catch(error => {
        console.warn(`[CLASS PORTAL] Could not finish class-end notifications for ${className}:`, error.message);
    });
    return delivery;
}

async function runTimetableTick(client, now = new Date(), options = {}) {
    const db = options.db || readClassDB();
    const persistDB = options.writeClassDB || writeClassDB;
    const queueClassNotice = options.enqueueClassNotification || enqueueClassNotification;
    const queueRollCallNotice = options.enqueueRollCallNotification || enqueueRollCallNotification;
    const queueClassEnd = options.queueScheduledClassEnd || queueScheduledClassEnd;
    const { weekday, dateKey: todayDateKey, currentMinutes } = getEATParts(now);
    const todayStr = weekday.toLowerCase();
    const nowTimestamp = now.getTime();
    let dbChanged = false;

    for (const className in db.classes) {
        const classData = db.classes[className];
        let endNoticeQueuedThisTick = false;
        const activeAtStart = classData.activeRollCall;

        if (activeAtStart && normalizeRollCallDate(activeAtStart) !== todayDateKey) {
            closeActiveRollCall(classData);
            dbChanged = true;
        } else if (activeAtStart && classData.exceptions?.[todayDateKey]?.[activeAtStart.unit]?.status === 'CANCELLED') {
            closeActiveRollCall(classData);
            dbChanged = true;
        } else if (activeAtStart && classData.holidayMode) {
            closeActiveRollCall(classData);
            dbChanged = true;
        }

        if (classData.holidayMode) continue;
        const slots = getScheduledClassSlots(classData, todayStr, todayDateKey);
        const active = classData.activeRollCall;
        if (active && normalizeRollCallDate(active) === todayDateKey) {
            const activeSlot = slots.find(slot => slot.unit === active.unit);
            const activeEndMinutes = Number.isFinite(Number(active.endMinutes))
                ? Number(active.endMinutes)
                : activeSlot?.endMinutes;
            if (Number.isFinite(activeEndMinutes) && currentMinutes >= activeEndMinutes) {
                const closed = closeActiveRollCall(classData);
                if (closed) {
                    queueClassEnd(
                        client,
                        className,
                        classData,
                        closed,
                        `🛑 *CLASS ENDED*\n\n${closed.unit} has officially concluded. The attendance register is now closed.`,
                        0
                    );
                    endNoticeQueuedThisTick = true;
                    dbChanged = true;
                }
            }
        }

        for (const slot of slots) {
            if (isPreClassReminderDue(slot, currentMinutes) &&
                claimTimetableNotice(classData, 'preclass', todayDateKey, slot, nowTimestamp)) {
                const minutesUntilStart = slot.startMinutes - currentMinutes;
                const lead = minutesUntilStart === 1 ? '1 minute' : `${minutesUntilStart} minutes`;
                const delivery = formatDeliveryDetails(slot);
                queueClassNotice(
                    client,
                    className,
                    classData,
                    `⏳ *UPCOMING CLASS*\n\n${slot.unit} begins in ${lead} at ${slot.startTime}.${delivery ? `\n📍 ${delivery}` : ''}`
                );
                dbChanged = true;
            }

            if (currentMinutes >= slot.startMinutes && currentMinutes < slot.endMinutes) {
                const existing = classData.activeRollCall;
                const alreadyOpen = existing && existing.unit === slot.unit && normalizeRollCallDate(existing) === todayDateKey;
                let opened = false;
                if (!existing || alreadyOpen) {
                    if (!alreadyOpen) {
                        opened = openActiveRollCall(classData, slot.unit, todayDateKey, {
                            startMinutes: slot.startMinutes,
                            endMinutes: slot.endMinutes,
                            source: 'scheduled'
                        });
                    }
                    const activeRollCall = classData.activeRollCall;
                    if ((opened || alreadyOpen) && activeRollCall &&
                        claimTimetableNotice(classData, 'start', todayDateKey, slot, nowTimestamp)) {
                        const intro = slot.source === 'makeup' ? 'MAKEUP CLASS STARTING' : 'CLASS IS STARTING';
                        const delivery = formatDeliveryDetails(slot);
                        const messageText = `🟢 *${intro}*\n\n🏫 *Unit:* ${slot.unit}\n⏰ *Time:* ${slot.startTime} - ${slot.endTime}\n\n` +
                            (delivery ? `📍 ${delivery}\n\n` : '') +
                            `_The attendance register is now open. Choose how to sign in:_\n` +
                            `1️⃣ Reply with *PRESENT*\n` +
                            `2️⃣ Type *!class* ➔ Open Student Hub ➔ Select option *8* (Sign Attendance)`;
                        queueRollCallNotice(
                            client,
                            className,
                            classData,
                            activeRollCall,
                            messageText,
                            endNoticeQueuedThisTick ? TIGHT_CLASS_TRANSITION_DELAY_MS : 0
                        );
                        dbChanged = true;
                    }
                }
            }

            if (currentMinutes >= slot.endMinutes) {
                const closed = closeRollCallFor(classData, slot.unit, todayDateKey);
                if (closed) {
                    const intro = slot.source === 'makeup' ? 'MAKEUP CLASS ENDED' : 'CLASS ENDED';
                    queueClassEnd(
                        client,
                        className,
                        classData,
                        closed,
                        `🛑 *${intro}*\n\n${closed.unit} has officially concluded. The attendance register is now closed.`,
                        endNoticeQueuedThisTick ? TIGHT_CLASS_TRANSITION_DELAY_MS : 0
                    );
                    endNoticeQueuedThisTick = true;
                    dbChanged = true;
                }
            }
        }

        const activeForFollowUp = classData.activeRollCall;
        if (activeForFollowUp && activeForFollowUp.source === 'scheduled' &&
            normalizeRollCallDate(activeForFollowUp) === todayDateKey && !activeForFollowUp.followUpSentAt) {
            const scheduledStartAt = Number(activeForFollowUp.scheduledStartAt) || Number(activeForFollowUp.startedAt);
            if (nowTimestamp >= scheduledStartAt + ROLL_CALL_LATE_GRACE_MINUTES * 60 * 1000) {
                const attendees = activeForFollowUp.attendees || {};
                const missing = (activeForFollowUp.rosterSnapshot || [])
                    .filter(student => !attendees[student.memberKey]);
                activeForFollowUp.followUpSentAt = nowTimestamp;
                dbChanged = true;
                if (missing.length) {
                    const unit = activeForFollowUp.unit;
                    queueRollCallNotice(
                        client,
                        className,
                        classData,
                        activeForFollowUp,
                        `⏰ *ROLL-CALL CHECK-IN*\n\n${unit} is in progress. If you are present, reply *PRESENT* now or open your Student Dashboard and choose *Sign Attendance*.`,
                        0,
                        missing.map(student => student.memberKey)
                    );
                }
            }
        }
    }

    if (dbChanged) persistDB(db);
}

function startTimetableMonitor(client) {
    console.log("[CLASS PORTAL] 🏫 Timetable & Auto-Roll Call Daemon Started (Cron Engine)...");
    cron.schedule('* * * * *', async () => {
        try {
            await runTimetableTick(client);
        } catch (error) {
            console.error('[CLASS PORTAL] Timetable monitor tick failed:', error);
        }
    }, { scheduled: true, timezone: "Africa/Nairobi" });
}

function getEATWeekStartTimestamp(timestamp = Date.now()) {
    const { dateKey } = getEATParts(new Date(timestamp));
    const [year, month, day] = dateKey.split('-').map(Number);
    const utcWeekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
    const daysSinceMonday = (utcWeekday + 6) % 7;
    return Date.UTC(year, month - 1, day - daysSinceMonday) - (3 * 60 * 60 * 1000);
}

function formatWrapDate(timestamp) {
    return new Intl.DateTimeFormat('en-KE', {
        timeZone: 'Africa/Nairobi',
        day: 'numeric',
        month: 'short'
    }).format(new Date(timestamp));
}

function buildWeeklyWrapUp(className, classData, now = Date.now()) {
    const weekStart = getEATWeekStartTimestamp(now);
    const weekRange = formatWrapDate(weekStart) + ' – ' + formatWrapDate(now) + ' (EAT)';
    const history = Array.isArray(classData.attendanceHistory) ? classData.attendanceHistory : [];
    const weeklyRollCalls = history.filter(record =>
        Number(record.closedAt) >= weekStart && Number(record.closedAt) <= now
    );
    const logs = Array.isArray(classData.logs) ? classData.logs : [];
    const legacyRollCalls = logs.filter(log =>
        Number(log.timestamp) >= weekStart &&
        Number(log.timestamp) <= now &&
        typeof log.text === 'string' &&
        log.text.startsWith('Roll Call Completed:')
    );
    const checkIns = weeklyRollCalls.length
        ? weeklyRollCalls.reduce((total, record) => total + (Number(record.presentCount) || 0), 0)
        : legacyRollCalls.reduce((total, log) => {
            const match = log.text.match(/\((\d+)\s+present\)/i);
            return total + (match ? Number(match[1]) : 0);
        }, 0);

    const weeklyUpdates = (Array.isArray(classData.updates) ? classData.updates : [])
        .filter(update => Number(update.timestamp) >= weekStart && Number(update.timestamp) <= now).length;
    const weeklyPolls = (Array.isArray(classData.polls) ? classData.polls : [])
        .filter(poll => poll.status === 'CLOSED' &&
            Number(poll.expiresAt) >= weekStart &&
            Number(poll.expiresAt) <= now);
    const pollVotes = weeklyPolls.reduce((total, poll) =>
        total + Object.keys(poll.votes || {}).length, 0);

    const nextWeekEnd = now + (7 * 24 * 60 * 60 * 1000);
    const upcomingDeadlines = (Array.isArray(classData.assessments) ? classData.assessments : [])
        .filter(item => Number(item.timestamp) > now && Number(item.timestamp) <= nextWeekEnd)
        .sort((a, b) => Number(a.timestamp) - Number(b.timestamp));
    const activityTotal = weeklyRollCalls.length + legacyRollCalls.length + weeklyUpdates + weeklyPolls.length;
    const activityLines = [
        '• Roll calls completed: *' + (weeklyRollCalls.length || legacyRollCalls.length) + '*',
        '• Student check-ins recorded: *' + checkIns + '*',
        '• Class updates posted: *' + weeklyUpdates + '*',
        '• Polls closed: *' + weeklyPolls.length + '* (' + pollVotes + ' votes)'
    ];
    const deadlineLines = upcomingDeadlines.slice(0, 3).map(item =>
        '• *' + (item.unit || item.type || 'Class deadline') + '* — ' +
        (item.type || 'deadline').toLowerCase() + ', ' + formatWrapDate(Number(item.timestamp))
    );
    if (upcomingDeadlines.length > 3) {
        deadlineLines.push('• Plus ' + (upcomingDeadlines.length - 3) + ' more. Type !class to view all.');
    }

    return [
        '📚 *WEEKLY CLASS WRAP-UP*',
        '🏫 *' + className + '*',
        '🗓️ ' + weekRange,
        '━━━━━━━━━━━━━━━━━━',
        '',
        '✨ *This week*',
        activityTotal > 0 ? activityLines.join('\n') : 'A quieter week in the portal—no roll calls, updates, or polls were recorded.',
        '',
        '⏭️ *Coming up in the next 7 days*',
        deadlineLines.length ? deadlineLines.join('\n') : '• No upcoming deadlines recorded.',
        '',
        'Have a restful weekend! Type !class to check your timetable and class updates.'
    ].join('\n');
}

function startClassWeekendBroadcast(client) {
    // Runs every Friday at 5:00 PM (17:00) East Africa Time
    cron.schedule('0 17 * * 5', async () => {
        console.log("[CLASS PORTAL] 📚 Broadcasting weekly class wrap-up...");
        const db = readClassDB();
        const classes = db.classes || {};

        for (const className in classes) {
            const classData = classes[className];
            const wrapUpMessage = buildWeeklyWrapUp(className, classData);
            const recipients = new Set();

            if (classData.repId) recipients.add(classData.repId);
            for (const id of classData.assistantReps || []) recipients.add(id);
            for (const member of Object.values(classData.members || {})) {
                if (member.phoneId) recipients.add(member.phoneId);
            }

            for (const recipientId of recipients) {
                try {
                    await new Promise(resolve => setTimeout(resolve, 1000));
                    await client.sendMessage(recipientId, wrapUpMessage);
                } catch (e) {
                    console.warn(`[CLASS PORTAL] Failed to send weekly wrap-up to ${recipientId}`);
                }
            }
        }
        console.log("[CLASS PORTAL] ✅ Weekly wrap-up broadcast completed.");
    }, {
        scheduled: true,
        timezone: "Africa/Nairobi"
    });
}

// Helper to blast all students. Callers may await it when notification order matters.
async function broadcastToClass(client, classData, messageText, recipientIds = null) {
    const members = classData.members || {};
    const recipients = recipientIds ? new Set(recipientIds.map(String)) : null;
    const memberEntries = Object.entries(members).filter(([memberKey, member]) =>
        !recipients || recipients.has(String(memberKey)) || recipients.has(String(member?.phoneId || ''))
    );
    const result = { sentCount: 0, failedCount: 0, failures: [] };

    for (const [memberKey, member] of memberEntries) {
        try {
            await new Promise(resolve => setTimeout(resolve, 2000));
            if (!member?.phoneId) throw new Error('Student phone ID is missing.');
            await client.sendMessage(member.phoneId, messageText);
            result.sentCount++;
        } catch (error) {
            result.failedCount++;
            result.failures.push({ memberKey, name: member?.name || 'Unknown student' });
            console.warn(`Failed to broadcast to ${member?.name || memberKey}:`, error.message);
        }
    }
    return result;
}

// Keep timetable notices for a class in order. This prevents a back-to-back
// class start message from racing its previous class end message.
function enqueueClassNotification(client, className, classData, messageText, delayMs = 0, recipientIds = null) {
    const previous = timetableNotificationQueues.get(className) || Promise.resolve();
    const current = previous
        .catch(() => {})
        .then(async () => {
            if (delayMs > 0) {
                await new Promise(resolve => setTimeout(resolve, delayMs));
            }
            return await broadcastToClass(client, classData, messageText, recipientIds);
        })
        .catch(error => {
            console.warn(`[CLASS PORTAL] Timetable notice failed for ${className}:`, error.message);
            const requestedCount = recipientIds?.length || Object.keys(classData.members || {}).length;
            return { sentCount: 0, failedCount: requestedCount, failures: [] };
        });

    timetableNotificationQueues.set(className, current);
    current.then(() => {
        if (timetableNotificationQueues.get(className) === current) {
            timetableNotificationQueues.delete(className);
        }
    });
    return current;
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

let systemMaintenanceStarted = false;

function startSystemMaintenance(client) {
    if (systemMaintenanceStarted) return;
    systemMaintenanceStarted = true;
    // 1. MIDNIGHT SWEEP: Closes orphaned roll calls at 11:59 PM daily
    cron.schedule('59 23 * * *', () => {
        const db = readClassDB();
        let changed = false;
        for (const className in db.classes) {
            if (db.classes[className].activeRollCall) {
                closeActiveRollCall(db.classes[className]);
                changed = true;
            }
        }
        if (changed) writeClassDB(db);
        console.log("[SYSTEM] Midnight Sweep complete. All active roll calls closed.");
    }, { scheduled: true, timezone: "Africa/Nairobi" });

    // 2. EXPIRE CLASS REP APPLICATIONS: Pending applications remain reviewable for 14 days.
    cron.schedule('0 4 * * *', async () => {
        const db = readClassDB();
        const now = Date.now();
        const expired = [];
        let changed = false;

        for (const application of db.applications || []) {
            const isPending = application.status === 'PENDING';
            const staleApproval = application.status === 'APPROVING' &&
                Number(application.reviewStartedAt) <= now - (10 * 60 * 1000);
            const hasExpired = Number.isFinite(Number(application.expiresAt)) &&
                Number(application.expiresAt) > 0 &&
                Number(application.expiresAt) <= now;
            if (!hasExpired || (!isPending && !staleApproval)) continue;

            if (application.authorizationCodeHash) {
                db.repCodes = (db.repCodes || []).filter(hash => hash !== application.authorizationCodeHash);
                delete application.authorizationCodeHash;
                delete application.reviewStartedAt;
                delete application.reviewedBy;
            }
            application.status = 'EXPIRED';
            application.expiredAt = now;
            expired.push(application);
            changed = true;
        }

        if (changed) {
            writeClassDB(db);
            await flushClassDB();
        }

        let notified = false;
        for (const application of expired) {
            try {
                await client.sendMessage(
                    application.applicantId,
                    '⌛ Your Class Representative application expired before it was reviewed. You may submit a new application with !class.'
                );
                application.expiryNoticeSentAt = Date.now();
                notified = true;
            } catch (error) {
                console.warn('[CLASS PORTAL] Could not send application expiry notice:', error.message);
            }
        }
        if (notified) {
            writeClassDB(db);
            await flushClassDB();
        }
    }, { scheduled: true, timezone: "Africa/Nairobi" });

    // 3. 3-DAY BACKUP: Overwrites the backup file at 3:00 AM and notifies Reps
    cron.schedule('0 3 */3 * *', async () => {
        try {
            const backupPath = await createClassDBBackup();
            console.log(`[SYSTEM] Durable local database backup created: ${backupPath}`);

            const offsiteBackupConfigured = Boolean(process.env.AZURE_CLASS_BACKUP_CONTAINER_SAS_URL && process.env.CLASS_BACKUP_ENCRYPTION_KEY);
            let offsiteBackup = { configured: offsiteBackupConfigured, verified: false };
            try {
                offsiteBackup = await createVerifiedOffsiteClassDBBackup(backupPath);
                if (offsiteBackup.verified) {
                    console.log(`[SYSTEM] Encrypted Azure class backup uploaded and verified: ${offsiteBackup.blobName}`);
                }
            } catch (backupError) {
                console.error('[SYSTEM] Encrypted off-site class backup failed:', backupError.message);
            }

            const backupNotice = offsiteBackup.verified
                ? 'The local backup and encrypted Azure copy were both verified.'
                : offsiteBackup.configured
                    ? 'The local backup completed, but the encrypted Azure copy could not be verified. The system administrator has been notified in the logs.'
                    : 'The local backup completed. Encrypted Azure off-site backup is not configured.';
            const db = readClassDB();
            for (const className in db.classes) {
                const classData = db.classes[className];
                if (classData.repId && !classData.holidayMode) {
                    try {
                        await new Promise(resolve => setTimeout(resolve, 5000));
                        await client.sendMessage(
                            classData.repId,
                            `💾 *SYSTEM MAINTENANCE*\n\n${backupNotice}\nClass data: *${className}*.`
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
    getEATParts,
    createSession,
    updateSessionState,
    getSession,
    endSession,
    isUserInClassSession,
    startDeadlineMonitor,
    startTimetableMonitor,
    getPortalMetrics,
    closeActiveRollCall,
    getRollCallCheckInStatus,
    getEATDateKey,
    parseClassTime,
    getClassTimeRange,
    getScheduledClassSlots,
    isPreClassReminderDue,
    claimTimetableNotice,
    buildRollCallSummary,
    runTimetableTick,
    broadcastToClass,
    startPollMonitor,
    startDailyReminders,
    startClassWeekendBroadcast,
    startSystemMaintenance,
};
