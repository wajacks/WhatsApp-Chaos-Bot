const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
    getClassNotesDirectory,
    saveClassNoteFile,
    resolveClassNotePath,
    deleteClassNoteFile,
    getDisplayFilename
} = require('../src/tools/classNotes');
const {
    getEATParts,
    getClassTimeRange,
    getScheduledClassSlots,
    isPreClassReminderDue,
    getRollCallCheckInStatus,
    claimTimetableNotice,
    closeActiveRollCall,
    buildRollCallSummary,
    runTimetableTick
} = require('../src/tools/classSession');
const { GAME_CHOICES, beginGamePicker, resolveGamePickerInput, PICK_TIMEOUT_MS } = require('../src/games/gamePicker');
const { claimGame, getActiveGame, recordGameParticipant, releaseGame } = require('../src/games/gameRegistry');
const { openSelectedGame, joinSelectedGame, isReplyToGameLobby, startActiveGame, stopActiveGame } = require('../src/games/gameActions');
const { createCommandRouter } = require('../src/commands/router');
const { getMostJoinedGame } = require('../src/commands/profile');
const { handleClassNotesInput } = require('../src/commands/classNotes');
const { sanitizeNavigationQuestion, buildOfflineNavigationReply } = require('../src/features/ai/classPortalNavigation');

test('Class Notes stores safe file names and deletes within the class storage directory', async () => {
    const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chaos-class-notes-'));
    try {
        const saved = await saveClassNoteFile('BSIT/2024', {
            filename: 'lecture.pdf',
            mimetype: 'application/pdf',
            data: Buffer.from('%PDF test content').toString('base64')
        }, { rootDir });
        const note = { storedName: saved.storedName };
        const filePath = resolveClassNotePath('BSIT/2024', note, { rootDir });
        assert.equal(path.dirname(filePath), getClassNotesDirectory('BSIT/2024', { rootDir }));
        assert.equal(fs.readFileSync(filePath, 'utf8'), '%PDF test content');
        assert.equal(getDisplayFilename({ title: 'Lecture notes', storedName: saved.storedName }), 'Lecture notes.pdf');
        await deleteClassNoteFile('BSIT/2024', note, { rootDir });
        assert.equal(fs.existsSync(filePath), false);
        assert.throws(() => resolveClassNotePath('BSIT/2024', { storedName: '../private.pdf' }, { rootDir }));
    } finally {
        fs.rmSync(rootDir, { recursive: true, force: true });
    }
});

test('Class Notes rejects unsafe extensions and oversized attachments', async () => {
    await assert.rejects(() => saveClassNoteFile('BSIT/2024', {
        filename: 'payload.exe',
        mimetype: 'application/x-msdownload',
        data: Buffer.from('x').toString('base64')
    }), /Use a PDF/);
    await assert.rejects(() => saveClassNoteFile('BSIT/2024', {
        filename: 'large.pdf',
        mimetype: 'application/pdf',
        data: Buffer.alloc(12).toString('base64')
    }, { maxBytes: 8 }), /20 MB or smaller/);
});

test('a rep upload saves one file under its unit and returns to the upload picker', async () => {
    const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chaos-class-notes-upload-'));
    try {
        const classData = { repId: 'rep@example.test', timetable: {} };
        const db = { classes: { 'BSIT/2024': classData } };
        const session = {
            state: 'REP_NOTES_UPLOAD_FILE',
            data: { loggedInClass: 'BSIT/2024', notesUnit: 'CALCULUS I', notesTitle: 'Lecture 1' }
        };
        const replies = [];
        const message = {
            hasMedia: true,
            downloadMedia: async () => ({
                filename: 'lecture.pdf',
                mimetype: 'application/pdf',
                data: Buffer.from('lecture notes').toString('base64')
            }),
            reply: async text => replies.push(text)
        };
        await handleClassNotesInput({
            client: {}, message, userId: 'rep@example.test', input: '', session, db,
            notesStorageOptions: { rootDir },
            updateSessionState: (_userId, state, data) => { session.state = state; session.data = data || {}; },
            sendRepDashboard: async () => {}, sendStudentDashboard: async () => {}, writeClassDB: () => {}
        });
        assert.equal(classData.notes.length, 1);
        assert.equal(classData.notes[0].unit, 'CALCULUS I');
        assert.equal(classData.notes[0].title, 'Lecture 1');
        assert.equal(fs.existsSync(resolveClassNotePath('BSIT/2024', classData.notes[0], { rootDir })), true);
        assert.equal(session.state, 'REP_NOTES_UPLOAD_UNIT');
        assert.match(replies[0], /FILE SAVED/);
    } finally {
        fs.rmSync(rootDir, { recursive: true, force: true });
    }
});

test('students receive selected notes at their registered WhatsApp number', async () => {
    const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chaos-class-notes-read-'));
    try {
        const saved = await saveClassNoteFile('BSIT/2024', {
            filename: 'lecture.pdf', mimetype: 'application/pdf',
            data: Buffer.from('lecture notes').toString('base64')
        }, { rootDir });
        const classData = {
            members: { studentKey: { phoneId: '254700000001@c.us', name: 'Student' } },
            notes: [{ id: 'file-1', unit: 'CALCULUS I', title: 'Lecture 1', fileName: 'lecture.pdf', ...saved }]
        };
        const db = { classes: { 'BSIT/2024': classData } };
        const session = {
            state: 'STUDENT_NOTES_FILES',
            data: { loggedInClass: 'BSIT/2024', currentStudentId: 'studentKey', notesUnit: 'CALCULUS I', studentName: 'Student' }
        };
        const sends = [];
        const client = { sendMessage: async (...args) => sends.push(args) };
        await handleClassNotesInput({
            client, message: { reply: async () => {} }, userId: '254700000001@c.us', input: '1', session, db,
            notesStorageOptions: { rootDir },
            updateSessionState: (_userId, state, data) => { session.state = state; session.data = data || {}; },
            sendRepDashboard: async () => {}, sendStudentDashboard: async () => {}
        });
        assert.equal(sends.length, 1);
        assert.equal(sends[0][0], '254700000001@c.us');
        assert.equal(sends[0][1].filename, 'lecture.pdf');
    } finally {
        fs.rmSync(rootDir, { recursive: true, force: true });
    }
});

test('reps and assistant reps can read one uploaded note directly in chat', async () => {
    const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chaos-class-notes-rep-read-'));
    try {
        const saved = await saveClassNoteFile('BSIT/2024', {
            filename: 'lecture.pdf', mimetype: 'application/pdf',
            data: Buffer.from('lecture notes').toString('base64')
        }, { rootDir });
        const classData = {
            repId: 'rep@example.test',
            assistantReps: ['assistant@example.test'],
            notes: [{ id: 'file-rep', unit: 'CALCULUS I', title: 'Lecture 1', fileName: 'lecture.pdf', ...saved }]
        };
        const db = { classes: { 'BSIT/2024': classData } };
        const sends = [];
        const client = { sendMessage: async (...args) => sends.push(args) };
        for (const userId of ['rep@example.test', 'assistant@example.test']) {
            const session = {
                state: 'REP_NOTES_READ_FILES',
                data: { loggedInClass: 'BSIT/2024', notesUnit: 'CALCULUS I' }
            };
            await handleClassNotesInput({
                client, message: { reply: async () => {} }, userId, input: '1', session, db,
                notesStorageOptions: { rootDir },
                updateSessionState: (_id, state, data) => { session.state = state; session.data = data || {}; },
                sendRepDashboard: async () => {}, sendStudentDashboard: async () => {}
            });
        }
        assert.equal(sends.length, 2);
        assert.deepEqual(sends.map(send => send[0]), ['rep@example.test', 'assistant@example.test']);
        assert.equal(sends[0][1].filename, 'lecture.pdf');
    } finally {
        fs.rmSync(rootDir, { recursive: true, force: true });
    }
});

test('authorized class administrators can choose a class and receive all its notes', async () => {
    const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chaos-class-notes-admin-'));
    try {
        const saved = await saveClassNoteFile('BSIT/2024', {
            filename: 'lecture.pdf', mimetype: 'application/pdf',
            data: Buffer.from('lecture notes').toString('base64')
        }, { rootDir });
        const db = { classes: { 'BSIT/2024': {
            notes: [{ id: 'file-admin', unit: 'CALCULUS I', title: 'Lecture 1', fileName: 'lecture.pdf', ...saved }]
        } } };
        const session = { state: 'ADMIN_NOTES_CLASSES', data: {} };
        const sends = [];
        const client = { sendMessage: async (...args) => sends.push(args) };
        const common = {
            client, message: { reply: async () => {} }, userId: 'admin@example.test', session, db,
            notesStorageOptions: { rootDir }, isClassAdmin: true,
            updateSessionState: (_id, state, data) => { session.state = state; session.data = data || {}; },
            sendMainMenu: async () => {}
        };
        await handleClassNotesInput({ ...common, input: '1' });
        assert.equal(session.state, 'ADMIN_NOTES_UNITS');
        await handleClassNotesInput({ ...common, input: '1' });
        assert.equal(session.state, 'ADMIN_NOTES_FILES');
        await handleClassNotesInput({ ...common, input: 'A' });
        assert.equal(sends.length, 1);
        assert.equal(sends[0][0], 'admin@example.test');
        assert.equal(sends[0][1].filename, 'lecture.pdf');
    } finally {
        fs.rmSync(rootDir, { recursive: true, force: true });
    }
});

test('class note review does not expose administrator states to unauthorized users', async () => {
    const session = { state: 'ADMIN_NOTES_CLASSES', data: {} };
    const replies = [];
    await handleClassNotesInput({
        client: {}, message: { reply: async text => replies.push(text) }, userId: 'student@example.test',
        input: '1', session, db: { classes: {} }, isClassAdmin: false,
        updateSessionState: (_id, state, data) => { session.state = state; session.data = data || {}; },
        sendMainMenu: async () => {}
    });
    assert.equal(session.state, 'MAIN_MENU');
    assert.match(replies[0], /Administrator access is required/);
});

test('deleting the last note returns reps to the notes menu without a stale unit picker', async () => {
    const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chaos-class-notes-delete-last-'));
    try {
        const saved = await saveClassNoteFile('BSIT/2024', {
            filename: 'lecture.pdf', mimetype: 'application/pdf',
            data: Buffer.from('lecture notes').toString('base64')
        }, { rootDir });
        const classData = {
            repId: 'rep@example.test',
            notes: [{ id: 'last-file', unit: 'CALCULUS I', title: 'Lecture 1', fileName: 'lecture.pdf', ...saved }]
        };
        const db = { classes: { 'BSIT/2024': classData } };
        const session = {
            state: 'REP_NOTES_DELETE_CONFIRM',
            data: { loggedInClass: 'BSIT/2024', notesUnit: 'CALCULUS I', notesTargetId: 'last-file' }
        };
        const replies = [];
        const context = {
            client: {}, message: { reply: async text => replies.push(text) }, userId: 'rep@example.test',
            session, db, notesStorageOptions: { rootDir }, writeClassDB: () => {},
            updateSessionState: (_id, state, data) => { session.state = state; session.data = data || {}; },
            sendRepDashboard: async () => {}, sendStudentDashboard: async () => {}
        };
        await handleClassNotesInput({ ...context, input: '1' });
        assert.equal(classData.notes.length, 0);
        assert.equal(session.state, 'REP_NOTES_MENU');
        assert.match(replies[0], /No uploaded files remain/);
        assert.doesNotMatch(replies[0], /CHOOSE A UNIT TO MANAGE/);
        await handleClassNotesInput({ ...context, input: '0' });
        assert.equal(session.state, 'REP_DASHBOARD');
    } finally {
        fs.rmSync(rootDir, { recursive: true, force: true });
    }
});

test('legacy class times normalize and a later class reminder remains due during an earlier class', () => {
    const classData = {
        timetable: {
            monday: [
                { unit: 'CALCULUS I', time: '7:00 AM' },
                { unit: 'PROGRAMMING', startMinutes: 600, endMinutes: 780, startTime: '10:00 AM', endTime: '1:00 PM' }
            ]
        }
    };
    const slots = getScheduledClassSlots(classData, 'monday', '2026-11-09');
    assert.deepEqual(slots.map(slot => [slot.startMinutes, slot.endMinutes]), [[420, 600], [600, 780]]);
    assert.equal(getClassTimeRange({ time: '7:00 AM' }).endMinutes, 600);
    assert.equal(isPreClassReminderDue(slots[1], 555), true);
    assert.equal(isPreClassReminderDue(slots[0], 555), false);
});

test('a moved timetable class only runs at its makeup time', () => {
    const classData = {
        timetable: {
            monday: [{ unit: 'CALCULUS I', startMinutes: 420, endMinutes: 600 }]
        },
        exceptions: {
            '2026-11-09': {
                'CALCULUS I': { status: 'CANCELLED' },
                'CALCULUS I_TEMP': { status: 'MOVED', unit: 'CALCULUS I (Makeup Class)', startMinutes: 720, endMinutes: 900 }
            }
        }
    };
    const slots = getScheduledClassSlots(classData, 'monday', '2026-11-09');
    assert.deepEqual(slots.map(slot => [slot.unit, slot.startMinutes, slot.endMinutes, slot.source]), [
        ['CALCULUS I (Makeup Class)', 720, 900, 'makeup']
    ]);
});

test('class schedule date keys and weekdays use Nairobi time independent of host timezone', () => {
    const midnightNairobi = getEATParts(new Date('2026-11-08T21:00:00Z'));
    assert.equal(midnightNairobi.dateKey, '2026-11-09');
    assert.equal(midnightNairobi.weekday, 'Monday');
    assert.equal(midnightNairobi.currentMinutes, 0);
});

test('timetable reminders are idempotent for each class and day', () => {
    const classData = {};
    const slot = { unit: 'CALCULUS I', startMinutes: 600 };
    assert.equal(claimTimetableNotice(classData, 'preclass', '2026-11-09', slot, 1000), true);
    assert.equal(claimTimetableNotice(classData, 'preclass', '2026-11-09', slot, 2000), false);
});

test('the scheduler delivers the 10 AM reminder during the 7 AM class, then rolls the register forward', async () => {
    const classData = {
        repId: 'rep@example.test',
        members: {},
        timetable: {
            monday: [
                { unit: 'CALCULUS I', time: '7:00 AM' },
                { unit: 'PROGRAMMING', startMinutes: 600, endMinutes: 780, startTime: '10:00 AM', endTime: '1:00 PM' }
            ]
        }
    };
    const db = { classes: { 'BSIT/2024': classData } };
    const queued = [];
    const options = {
        db,
        writeClassDB: () => {},
        enqueueClassNotification: (_client, className, _classData, text) => queued.push({ className, text }),
        enqueueRollCallNotification: (_client, className, _classData, rollCall, text) => queued.push({ className, rollCall, text }),
        queueScheduledClassEnd: (_client, className, _classData, rollCall, text) => queued.push({ className, rollCall, text })
    };

    await runTimetableTick({ sendMessage: async () => {} }, new Date('2026-11-09T06:15:00Z'), options);
    assert.equal(classData.activeRollCall.unit, 'CALCULUS I');
    assert.ok(queued.some(item => item.text.includes('PROGRAMMING begins in 45 minutes')));

    await runTimetableTick({ sendMessage: async () => {} }, new Date('2026-11-09T07:00:00Z'), options);
    assert.equal(classData.activeRollCall.unit, 'PROGRAMMING');
    assert.equal(classData.attendanceHistory[0].unit, 'CALCULUS I');
    assert.ok(queued.some(item => item.text.includes('PROGRAMMING') && item.text.includes('CLASS IS STARTING')));
});

test('scheduled roll-call closure records late and absent students for the rep summary', () => {
    const classData = {
        members: {
            early: { name: 'Early', admission: 'A1' },
            late: { name: 'Late', admission: 'A2' },
            absent: { name: 'Absent', admission: 'A3' }
        },
        activeRollCall: {
            unit: 'CALCULUS I', dateKey: '2026-11-09', startedAt: 100,
            lateGraceEndsAt: 200, deliveryFailureCount: 2,
            rosterSnapshot: [
                { memberKey: 'early', name: 'Early', admission: 'A1' },
                { memberKey: 'late', name: 'Late', admission: 'A2' },
                { memberKey: 'absent', name: 'Absent', admission: 'A3' }
            ],
            attendees: {
                early: { checkedInAt: 150, timestamp: '7:02 AM' },
                late: { checkedInAt: 250, timestamp: '7:15 AM' }
            }
        }
    };
    const closed = closeActiveRollCall(classData);
    const record = closed.attendanceRecord;
    assert.equal(record.onTimeCount, 1);
    assert.equal(record.lateCount, 1);
    assert.equal(record.absentCount, 1);
    assert.equal(record.deliveryFailureCount, 2);
    const summary = buildRollCallSummary(record);
    assert.match(summary, /Present on time: \*1\*/);
    assert.match(summary, /Late: \*1\*/);
    assert.match(summary, /Absent: \*1\*/);
    assert.match(summary, /failed: \*2\*/);
});

test('check-ins after the ten-minute grace period are classified late', () => {
    const rollCall = { startedAt: 1000, lateGraceEndsAt: 601000 };
    assert.equal(getRollCallCheckInStatus(rollCall, 601000), 'PRESENT');
    assert.equal(getRollCallCheckInStatus(rollCall, 601001), 'LATE');
});

test('game picker isolates the caller, accepts a selection, and expires after five minutes', () => {
    const chatId = 'test-game-picker@g.us';
    const userId = 'player@example.test';
    assert.match(beginGamePicker(chatId, userId, 1000), /CHOOSE A GAME TO OPEN/);
    assert.equal(resolveGamePickerInput(chatId, 'another-user', '2', 2000).status, 'none');
    assert.equal(resolveGamePickerInput(chatId, userId, 'x', 2000).status, 'invalid');
    const choice = resolveGamePickerInput(chatId, userId, '2', 2000);
    assert.equal(choice.status, 'selected');
    assert.equal(choice.game, GAME_CHOICES[1]);
    beginGamePicker(chatId, userId, 5000);
    assert.equal(resolveGamePickerInput(chatId, userId, '1', 5000 + PICK_TIMEOUT_MS + 1).status, 'expired');
});

test('game participation is counted once per group lobby and profile ties are displayed', () => {
    const groupId = 'test-game-participation@g.us';
    assert.equal(claimGame(groupId, 'wordle').ok, true);
    assert.equal(getActiveGame(groupId), 'wordle');
    assert.equal(recordGameParticipant(groupId, 'wordle', 'one'), true);
    assert.equal(recordGameParticipant(groupId, 'wordle', 'one'), false);
    assert.equal(recordGameParticipant(groupId, 'wordle', 'two'), true);
    releaseGame(groupId, 'wordle');
    assert.deepEqual(getMostJoinedGame({ wordle: 3, rebus: 3, mafia: 1 }), {
        label: 'Wordle / Country Rebus', count: 3, tied: true
    });
    assert.equal(getMostJoinedGame({}), null);
});

test('generic game controls dispatch to the group’s currently open lobby', async () => {
    const groupId = 'test-game-controls@g.us';
    const calls = [];
    claimGame(groupId, 'wordle');
    const context = {
        message: { reply: async text => calls.push(['reply', text]) },
        client: {},
        chatId: groupId,
        senderId: 'host@example.test',
        senderContact: null
    };
    const dependencies = {
        startWordleGame: (chatId, senderId) => { calls.push(['start', chatId, senderId]); return 'Wordle started.'; },
        stopGame: (chatId, senderId) => {
            calls.push(['stop', chatId, senderId]);
            releaseGame(chatId, 'wordle');
            return 'Wordle stopped.';
        }
    };
    await startActiveGame(context, dependencies);
    await stopActiveGame(context, dependencies);
    assert.deepEqual(calls.filter(call => call[0] === 'start'), [['start', groupId, context.senderId]]);
    assert.deepEqual(calls.filter(call => call[0] === 'stop'), [['stop', groupId, context.senderId]]);
    assert.equal(getActiveGame(groupId), null);
});

test('!play selection auto-joins the host and binds controls to that bot lobby message', async () => {
    const groupId = 'test-play-auto-host@g.us';
    const replies = [];
    const profileJoins = [];
    const joinedPlayers = new Set();
    const hostContext = {
        message: {
            author: 'host@example.test',
            reply: async text => {
                replies.push(text);
                return { id: { _serialized: 'lobby-message-1' } };
            }
        },
        client: {}, chatId: groupId, senderId: 'host@example.test', economyUserId: 'host@example.test',
        userName: 'Host', senderContact: null
    };
    const dependencies = {
        startWordleLobby: chatId => {
            assert.equal(claimGame(chatId, 'wordle').ok, true);
            return '🔤 *WORDLE LOBBY OPEN*';
        },
        joinLobby: (_chatId, senderId, userName) => {
            if (joinedPlayers.has(senderId)) return `⚠️ ${userName} already joined.`;
            joinedPlayers.add(senderId);
            return `✅ ${userName} joined the match!`;
        },
        recordGameJoin: (userId, _userName, gameKey) => profileJoins.push([userId, gameKey])
    };
    try {
        assert.equal(await openSelectedGame('wordle', hostContext, dependencies), true);
        assert.equal(joinedPlayers.has('host@example.test'), true);
        assert.deepEqual(profileJoins, [['host@example.test', 'wordle']]);
        assert.match(replies[0], /WORDLE LOBBY OPEN/);

        const quote = { fromMe: true, body: '🔤 WORDLE LOBBY OPEN', id: { _serialized: 'lobby-message-1' } };
        assert.equal(await isReplyToGameLobby({ hasQuotedMsg: true, getQuotedMessage: async () => quote }, groupId), true);
        assert.equal(await isReplyToGameLobby({
            hasQuotedMsg: true,
            getQuotedMessage: async () => ({ ...quote, id: { _serialized: 'old-lobby-message' } })
        }, groupId), false);

        const playerContext = { ...hostContext, senderId: 'player@example.test', economyUserId: 'player@example.test', userName: 'Player' };
        await joinSelectedGame('wordle', playerContext, dependencies);
        await joinSelectedGame('wordle', playerContext, dependencies);
        assert.deepEqual(profileJoins, [
            ['host@example.test', 'wordle'],
            ['player@example.test', 'wordle']
        ]);
    } finally {
        releaseGame(groupId, 'wordle');
    }
});

test('reply controls start the current lobby and reject unquoted or stale commands', async () => {
    const groupId = 'test-reply-controls@g.us';
    const starts = [];
    const replies = [];
    const router = createCommandRouter({
        startWordleGame: (chatId, senderId) => {
            starts.push([chatId, senderId]);
            return 'Wordle started.';
        }
    });
    claimGame(groupId, 'wordle');
    const currentLobby = { fromMe: true, body: '🔤 WORDLE LOBBY OPEN', id: { _serialized: 'current-lobby' } };
    const context = quoted => ({
        message: {
            hasQuotedMsg: Boolean(quoted),
            getQuotedMessage: async () => quoted,
            reply: async text => replies.push(text)
        },
        client: {}, chatId: groupId, senderId: 'host@example.test',
        text: '!START', lowerText: '!start', isGroup: true
    });
    const { setGameLobbyMessage } = require('../src/games/gameRegistry');
    setGameLobbyMessage(groupId, 'wordle', 'current-lobby');
    try {
        const plainStart = context(currentLobby);
        plainStart.text = 'START';
        plainStart.lowerText = 'start';
        assert.equal(await router(plainStart), true);
        assert.deepEqual(starts, [[groupId, 'host@example.test']]);
        assert.match(replies.pop(), /Wordle started/);

        assert.equal(await router(context(currentLobby)), true);
        assert.equal(starts.length, 2);
        assert.match(replies.pop(), /Wordle started/);

        await router(context({ ...currentLobby, id: { _serialized: 'stale-lobby' } }));
        assert.equal(starts.length, 2);
        assert.match(replies.pop(), /Reply directly to the bot/);

        await router(context(null));
        assert.equal(starts.length, 2);
        assert.match(replies.pop(), /Reply directly to the bot/);

        const playContext = context(null);
        playContext.text = '!play';
        playContext.lowerText = '!play';
        await router(playContext);
        assert.match(replies.pop(), /already has an open lobby/);

        const retiredContext = context(null);
        retiredContext.text = '!wordle';
        retiredContext.lowerText = '!wordle';
        await router(retiredContext);
        assert.match(replies.pop(), /lobbies now open through !play/);
    } finally {
        releaseGame(groupId, 'wordle');
    }
});

test('navigation help redacts credential values and falls back to the current station', () => {
    const safeQuestion = sanitizeNavigationQuestion('Help, my password SuperSecret and my number is 254700123456');
    assert.doesNotMatch(safeQuestion, /SuperSecret|254700123456/);
    assert.match(safeQuestion, /\[redacted\]/);
    assert.match(buildOfflineNavigationReply('Student Dashboard'), /Student Dashboard/);
    assert.match(buildOfflineNavigationReply('Student Dashboard'), /reply \*0\*/);
});
