const fs = require('fs');
const { MessageMedia } = require('whatsapp-web.js');
const {
    saveClassNoteFile,
    resolveClassNotePath,
    deleteClassNoteFile,
    getDisplayFilename,
    MAX_NOTE_BYTES
} = require('../tools/classNotes');

function cleanLabel(value, maxLength = 80) {
    return String(value || '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

function getClassNotes(classData) {
    if (!Array.isArray(classData.notes)) classData.notes = [];
    return classData.notes;
}

function getTimetableUnits(classData) {
    const units = new Map();
    for (const daySlots of Object.values(classData.timetable || {})) {
        for (const slot of Array.isArray(daySlots) ? daySlots : []) {
            const unit = cleanLabel(slot?.unit);
            if (unit) units.set(unit.toLowerCase(), unit);
        }
    }
    for (const note of getClassNotes(classData)) {
        const unit = cleanLabel(note?.unit);
        if (unit) units.set(unit.toLowerCase(), unit);
    }
    return [...units.values()].sort((a, b) => a.localeCompare(b));
}

function getNotesUnits(classData) {
    const units = new Map();
    for (const note of getClassNotes(classData)) {
        const unit = cleanLabel(note?.unit);
        if (unit) units.set(unit.toLowerCase(), unit);
    }
    return [...units.values()].sort((a, b) => a.localeCompare(b));
}

function getUnitNotes(classData, unit) {
    const key = String(unit || '').trim().toLowerCase();
    return getClassNotes(classData)
        .filter(note => String(note?.unit || '').trim().toLowerCase() === key)
        .sort((a, b) => Number(a.uploadedAt || 0) - Number(b.uploadedAt || 0));
}

function buildNumberedUnits(title, units, options = {}) {
    let body = `📚 *${title}*\n━━━━━━━━━━━━━━━━━━\n`;
    if (units.length) body += units.map((unit, index) => `${index + 1}. ${unit}`).join('\n') + '\n';
    else body += '\nNo units have been added yet.\n';
    if (options.allowNew) body += '\nA. Add a unit name\n';
    body += '\n0. 🔙 Back';
    return body;
}

function buildStudentFilesMenu(unit, notes) {
    let body = `📚 *${unit} — NOTES & MATERIALS*\n━━━━━━━━━━━━━━━━━━\n`;
    body += notes.map((note, index) => `${index + 1}. ${cleanLabel(note.title || note.fileName || 'Class notes')}\n`).join('');
    body += '\nA. Send all files\n0. 🔙 Back';
    return body;
}

function buildRepFilesMenu(unit, notes) {
    let body = `🗂️ *MANAGE ${unit} FILES*\n━━━━━━━━━━━━━━━━━━\n`;
    if (notes.length) {
        body += notes.map((note, index) => `${index + 1}. 🗑️ ${cleanLabel(note.title || note.fileName || 'Class notes')}\n`).join('');
    } else {
        body += '\nNo files are attached to this unit yet.\n';
    }
    body += '\nA. Upload another file\n0. 🔙 Back';
    return body;
}

function isClassRep(userId, session, classData) {
    return session.data?.isMainRep === true || userId === classData.repId ||
        (Array.isArray(classData.assistantReps) && classData.assistantReps.includes(userId));
}

function isClassStudent(userId, session, classData) {
    const member = classData.members?.[session.data?.currentStudentId];
    return Boolean(member && member.phoneId === userId);
}

function addClassLog(classData, text) {
    if (!Array.isArray(classData.logs)) classData.logs = [];
    classData.logs.push({ text, timestamp: Date.now() });
    if (classData.logs.length > 200) classData.logs.splice(0, classData.logs.length - 200);
}

async function showRepFiles(message, updateSessionState, userId, session, className, unit, classData) {
    const notes = getUnitNotes(classData, unit);
    updateSessionState(userId, 'REP_NOTES_MANAGE_FILES', { ...session.data, notesUnit: unit });
    await message.reply(buildRepFilesMenu(unit, notes));
}

async function sendOneNote(client, userId, className, unit, note, storageOptions = {}) {
    const filePath = resolveClassNotePath(className, note, storageOptions);
    await fs.promises.access(filePath, fs.constants.R_OK);
    const media = MessageMedia.fromFilePath(filePath);
    media.filename = getDisplayFilename(note);
    await client.sendMessage(userId, media, {
        caption: `📚 ${unit} — ${cleanLabel(note.title || 'Class notes')}`
    });
}

async function handleClassNotesInput(context) {
    const {
        client,
        message,
        userId,
        input,
        session,
        db,
        notesStorageOptions = {},
        updateSessionState,
        sendRepDashboard,
        sendStudentDashboard
    } = context;
    const state = session.state;
    if (!state.startsWith('REP_NOTES_') && !state.startsWith('STUDENT_NOTES_')) return false;

    const className = session.data?.loggedInClass;
    const classData = db.classes?.[className];
    if (!classData) {
        updateSessionState(userId, 'MAIN_MENU');
        await message.reply('❌ This class portal is no longer available. Type *!class* to open the portal again.');
        return true;
    }

    const isRepState = state.startsWith('REP_NOTES_');
    if ((isRepState && !isClassRep(userId, session, classData)) ||
        (!isRepState && !isClassStudent(userId, session, classData))) {
        updateSessionState(userId, 'MAIN_MENU');
        await message.reply('❌ Please sign in to your Class Portal account again.');
        return true;
    }

    const notes = getClassNotes(classData);
    const returnToDashboard = async () => {
        if (isRepState) {
            updateSessionState(userId, 'REP_DASHBOARD', session.data);
            await sendRepDashboard(message, className);
        } else {
            updateSessionState(userId, 'STUDENT_DASHBOARD', session.data);
            await sendStudentDashboard(message, className, session.data.studentName);
        }
    };

    switch (state) {
        case 'REP_NOTES_MENU':
            if (input === '0') await returnToDashboard();
            else if (input === '1') {
                const uploadData = { ...session.data, notesReturnState: null, notesTargetId: null };
                const units = getTimetableUnits(classData);
                if (!units.length) {
                    updateSessionState(userId, 'REP_NOTES_UPLOAD_UNIT_NAME', { ...uploadData, notesUnitReturnState: 'REP_NOTES_MENU' });
                    await message.reply('📚 No timetable units are listed yet. Enter the unit name for these files.\n\n0. 🔙 Back');
                } else {
                    updateSessionState(userId, 'REP_NOTES_UPLOAD_UNIT', uploadData);
                    await message.reply(buildNumberedUnits('CHOOSE A UNIT FOR UPLOAD', units, { allowNew: true }));
                }
            } else if (input === '2') {
                const units = getNotesUnits(classData);
                updateSessionState(userId, 'REP_NOTES_MANAGE_UNIT', session.data);
                await message.reply(buildNumberedUnits('CHOOSE A UNIT TO MANAGE', units));
            } else {
                await message.reply('❌ Choose 1 to upload a file, 2 to manage files, or 0 to go back.');
            }
            return true;

        case 'REP_NOTES_UPLOAD_UNIT': {
            if (input === '0') {
                updateSessionState(userId, 'REP_NOTES_MENU', session.data);
                await message.reply('🗂️ *NOTES MANAGEMENT*\n\n1. Upload a file\n2. Browse or delete files\n\n0. 🔙 Back to Dashboard');
                return true;
            }
            const units = getTimetableUnits(classData);
            if (input.toUpperCase() === 'A') {
                updateSessionState(userId, 'REP_NOTES_UPLOAD_UNIT_NAME', { ...session.data, notesUnitReturnState: 'REP_NOTES_UPLOAD_UNIT' });
                await message.reply('Enter the unit name for these files.\n\n0. 🔙 Back');
                return true;
            }
            const index = Number(input) - 1;
            if (!Number.isInteger(index) || index < 0 || index >= units.length) {
                await message.reply(buildNumberedUnits('CHOOSE A UNIT FOR UPLOAD', units, { allowNew: true }));
                return true;
            }
            updateSessionState(userId, 'REP_NOTES_UPLOAD_TITLE', { ...session.data, notesUnit: units[index] });
            await message.reply(`Enter a short title for the file under *${units[index]}*.\n\n0. 🔙 Back`);
            return true;
        }

        case 'REP_NOTES_UPLOAD_UNIT_NAME': {
            if (input === '0') {
                if (session.data.notesUnitReturnState === 'REP_NOTES_UPLOAD_UNIT') {
                    updateSessionState(userId, 'REP_NOTES_UPLOAD_UNIT', session.data);
                    await message.reply(buildNumberedUnits('CHOOSE A UNIT FOR UPLOAD', getTimetableUnits(classData), { allowNew: true }));
                } else {
                    updateSessionState(userId, 'REP_NOTES_MENU', session.data);
                    await message.reply('🗂️ *NOTES MANAGEMENT*\n\n1. Upload a file\n2. Browse or delete files\n\n0. 🔙 Back to Dashboard');
                }
                return true;
            }
            const unit = cleanLabel(input);
            if (!unit) {
                await message.reply('❌ Enter a unit name, or reply 0 to go back.');
                return true;
            }
            updateSessionState(userId, 'REP_NOTES_UPLOAD_TITLE', { ...session.data, notesUnit: unit });
            await message.reply(`Enter a short title for the file under *${unit}*.\n\n0. 🔙 Back`);
            return true;
        }

        case 'REP_NOTES_UPLOAD_TITLE': {
            if (input === '0') {
                if (session.data.notesReturnState === 'REP_NOTES_MANAGE_FILES') {
                    await showRepFiles(message, updateSessionState, userId, session, className, session.data.notesUnit, classData);
                    return true;
                }
                const units = getTimetableUnits(classData);
                if (session.data.notesUnit && !units.some(unit => unit.toLowerCase() === session.data.notesUnit.toLowerCase())) {
                    units.unshift(session.data.notesUnit);
                }
                updateSessionState(userId, 'REP_NOTES_UPLOAD_UNIT', session.data);
                await message.reply(buildNumberedUnits('CHOOSE A UNIT FOR UPLOAD', units, { allowNew: true }));
                return true;
            }
            const title = cleanLabel(input);
            if (!title) {
                await message.reply('❌ Enter a file title, or reply 0 to choose another unit.');
                return true;
            }
            updateSessionState(userId, 'REP_NOTES_UPLOAD_FILE', { ...session.data, notesTitle: title });
            await message.reply(`📎 Send the document for *${session.data.notesUnit} — ${title}* as a WhatsApp attachment.\n\nAccepted: PDF, Word, PowerPoint, Excel, TXT, JPG, or PNG (up to 20 MB).\n0. 🔙 Back`);
            return true;
        }

        case 'REP_NOTES_UPLOAD_FILE': {
            if (input === '0') {
                updateSessionState(userId, 'REP_NOTES_UPLOAD_TITLE', session.data);
                await message.reply(`Enter a short title for the file under *${session.data.notesUnit}*.\n\n0. 🔙 Back`);
                return true;
            }
            if (!message.hasMedia || typeof message.downloadMedia !== 'function') {
                await message.reply('📎 Please attach the file in WhatsApp, or reply 0 to go back.');
                return true;
            }
            const declaredSize = Number(message._data?.size || message.size || 0);
            if (declaredSize > MAX_NOTE_BYTES) {
                await message.reply('❌ Files must be 20 MB or smaller. Send a smaller file, or reply 0 to go back.');
                return true;
            }

            try {
                const media = await message.downloadMedia();
                const savedFile = await saveClassNoteFile(className, media, notesStorageOptions);
                const note = {
                    id: require('crypto').randomBytes(12).toString('hex'),
                    unit: session.data.notesUnit,
                    title: session.data.notesTitle,
                    fileName: cleanLabel(media.filename || session.data.notesTitle),
                    storedName: savedFile.storedName,
                    mimeType: savedFile.mimeType,
                    sizeBytes: savedFile.sizeBytes,
                    uploadedBy: userId,
                    uploadedAt: Date.now()
                };
                notes.push(note);
                addClassLog(classData, `Notes file uploaded: ${note.unit} — ${note.title}`);
                context.writeClassDB(db);
                await message.reply(`✅ *FILE SAVED*\n\n${note.title} is now attached to *${note.unit}*. Students can receive it from Notes & Materials in their dashboard.`);
                if (session.data.notesReturnState === 'REP_NOTES_MANAGE_FILES') {
                    await showRepFiles(message, updateSessionState, userId, session, className, session.data.notesUnit, classData);
                } else {
                    updateSessionState(userId, 'REP_NOTES_UPLOAD_UNIT', session.data);
                    await message.reply(buildNumberedUnits('CHOOSE A UNIT FOR UPLOAD', getTimetableUnits(classData), { allowNew: true }));
                }
            } catch (error) {
                await message.reply(`❌ ${error.message || 'The file could not be saved.'}\n\nTry again, or reply 0 to go back.`);
            }
            return true;
        }

        case 'REP_NOTES_MANAGE_UNIT': {
            if (input === '0') {
                updateSessionState(userId, 'REP_NOTES_MENU', session.data);
                await message.reply('🗂️ *NOTES MANAGEMENT*\n\n1. Upload a file\n2. Browse or delete files\n\n0. 🔙 Back to Dashboard');
                return true;
            }
            const units = getNotesUnits(classData);
            const index = Number(input) - 1;
            if (!Number.isInteger(index) || index < 0 || index >= units.length) {
                await message.reply(buildNumberedUnits('CHOOSE A UNIT TO MANAGE', units));
                return true;
            }
            await showRepFiles(message, updateSessionState, userId, session, className, units[index], classData);
            return true;
        }

        case 'REP_NOTES_MANAGE_FILES': {
            const unit = session.data.notesUnit;
            const unitNotes = getUnitNotes(classData, unit);
            if (input === '0') {
                updateSessionState(userId, 'REP_NOTES_MANAGE_UNIT', session.data);
                await message.reply(buildNumberedUnits('CHOOSE A UNIT TO MANAGE', getNotesUnits(classData)));
                return true;
            }
            if (input.toUpperCase() === 'A') {
                updateSessionState(userId, 'REP_NOTES_UPLOAD_TITLE', { ...session.data, notesReturnState: 'REP_NOTES_MANAGE_FILES' });
                await message.reply(`Enter a short title for another file under *${unit}*.\n\n0. 🔙 Back`);
                return true;
            }
            const index = Number(input) - 1;
            if (!Number.isInteger(index) || index < 0 || index >= unitNotes.length) {
                await message.reply(buildRepFilesMenu(unit, unitNotes));
                return true;
            }
            updateSessionState(userId, 'REP_NOTES_DELETE_CONFIRM', {
                ...session.data,
                notesTargetId: unitNotes[index].id
            });
            await message.reply(`🗑️ Delete *${cleanLabel(unitNotes[index].title || unitNotes[index].fileName)}* from *${unit}*?\n\n1. Delete this file\n0. 🔙 Keep it and go back`);
            return true;
        }

        case 'REP_NOTES_DELETE_CONFIRM': {
            if (input === '0') {
                await showRepFiles(message, updateSessionState, userId, session, className, session.data.notesUnit, classData);
                return true;
            }
            if (input !== '1') {
                await message.reply('❌ Choose 1 to delete the file or 0 to keep it and go back.');
                return true;
            }
            const target = notes.find(note => note.id === session.data.notesTargetId);
            if (!target) {
                await message.reply('📭 That file is no longer in the notes list.');
            } else {
                try {
                    await deleteClassNoteFile(className, target, notesStorageOptions);
                    classData.notes = notes.filter(note => note.id !== target.id);
                    addClassLog(classData, `Notes file deleted: ${target.unit} — ${target.title}`);
                    context.writeClassDB(db);
                    await message.reply(`✅ *FILE DELETED*\n\n${cleanLabel(target.title)} was removed from *${target.unit}*.\n\n` + buildRepFilesMenu(target.unit, getUnitNotes(classData, target.unit)));
                } catch (error) {
                    await message.reply(`❌ The file could not be deleted: ${error.message}`);
                }
            }
            updateSessionState(userId, 'REP_NOTES_MANAGE_FILES', { ...session.data, notesTargetId: null });
            return true;
        }

        case 'STUDENT_NOTES_UNITS': {
            if (input === '0') {
                updateSessionState(userId, 'STUDENT_DASHBOARD', session.data);
                await sendStudentDashboard(message, className, session.data.studentName);
                return true;
            }
            const units = getNotesUnits(classData);
            const index = Number(input) - 1;
            if (!Number.isInteger(index) || index < 0 || index >= units.length) {
                await message.reply(buildNumberedUnits('NOTES & MATERIALS', units));
                return true;
            }
            const unit = units[index];
            updateSessionState(userId, 'STUDENT_NOTES_FILES', { ...session.data, notesUnit: unit });
            await message.reply(buildStudentFilesMenu(unit, getUnitNotes(classData, unit)));
            return true;
        }

        case 'STUDENT_NOTES_FILES': {
            if (input === '0') {
                updateSessionState(userId, 'STUDENT_NOTES_UNITS', session.data);
                await message.reply(buildNumberedUnits('NOTES & MATERIALS', getNotesUnits(classData)));
                return true;
            }
            const unit = session.data.notesUnit;
            const unitNotes = getUnitNotes(classData, unit);
            const selection = input.toUpperCase() === 'A'
                ? unitNotes
                : (() => {
                    const index = Number(input) - 1;
                    return Number.isInteger(index) && index >= 0 && index < unitNotes.length ? [unitNotes[index]] : null;
                })();
            if (!selection) {
                await message.reply(buildStudentFilesMenu(unit, unitNotes));
                return true;
            }
            let sent = 0;
            let failed = 0;
            const studentPhoneId = classData.members?.[session.data.currentStudentId]?.phoneId || userId;
            for (const note of selection) {
                try {
                    await sendOneNote(client, studentPhoneId, className, unit, note, notesStorageOptions);
                    sent++;
                } catch (error) {
                    failed++;
                    console.warn(`[CLASS NOTES] Could not send ${note.id} to a student:`, error.message);
                }
            }
            const summary = failed
                ? `📎 Sent ${sent} of ${selection.length} file${selection.length === 1 ? '' : 's'}. ${failed} could not be delivered.`
                : `📎 Sent ${sent} file${sent === 1 ? '' : 's'} directly to this chat.`;
            await message.reply(`${summary}\n\nChoose another file or reply 0 to go back.`);
            return true;
        }

        default:
            return false;
    }
}

module.exports = {
    handleClassNotesInput,
    getTimetableUnits,
    getNotesUnits,
    getUnitNotes,
    buildStudentFilesMenu,
    buildRepFilesMenu
};
