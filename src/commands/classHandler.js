const crypto = require('crypto');
const { readClassDB, writeClassDB, flushClassDB, classExists, isUserAlreadyRep } = require('../database/classdb');
const { createSession, updateSessionState, getSession, endSession, getPortalMetrics, closeActiveRollCall, getEATDateKey } = require('../tools/classSession');
const { timeToMinutes, minutesToTime, checkCollision } = require('../tools/timeHelper');
const { hashSecret, verifySecret, generateAuthorizationCode, generateNumericOtp } = require('../utils/credentials');

// --- NEW: MARKETPLACE LIVE CHAT REGISTRY ---
const activeMarketChats = new Map();
const activeApplicationReviews = new Set();

// Helper to combine registered students and ensure the Main Class Rep is always included
function getAllClassParticipants(classData) {
    const members = { ...(classData.members || {}) };
    
    // Check if the Rep is already in the members list
    let repExists = false;
    for (const mId in members) {
        if (members[mId].phoneId === classData.repId) {
            repExists = true;
            break;
        }
    }
    
    // If the Rep isn't in members, inject a temporary participant profile for them
    if (!repExists && classData.repId) {
        members['rep_main_profile'] = {
            name: classData.repName || 'Class Rep',
            admission: 'REP',
            phoneId: classData.repId,
            isRep: true
        };
    }
    
    return members;
}

// Helper to sort members: Main Rep first (👑), Assistant Reps second (⭐), then alphabetical students
function getSortedMemberIds(classData) {
    const members = getAllClassParticipants(classData);
    const mIds = Object.keys(members);
    
    return mIds.sort((idA, idB) => {
        const a = members[idA];
        const b = members[idB];
        
        const aIsRep = a.phoneId === classData.repId || a.isRep;
        const bIsRep = b.phoneId === classData.repId || b.isRep;
        
        const aIsAsst = classData.assistantReps?.includes(a.phoneId);
        const bIsAsst = classData.assistantReps?.includes(b.phoneId);
        
        if (aIsRep && !bIsRep) return -1;
        if (!aIsRep && bIsRep) return 1;
        
        if (aIsAsst && !bIsAsst) return -1;
        if (!aIsAsst && bIsAsst) return 1;
        
        return (a.name || '').localeCompare(b.name || '');
    });
}

// Helper to count unread market notifications
function getMarketNotifs(className, userId) {
    const db = readClassDB();
    const market = db.classes[className]?.marketplace || [];
    let count = 0;
    market.forEach(item => {
        // Count pending bids for sellers
        if (item.sellerId === userId && item.status === 'ACTIVE') {
            item.bids.forEach(b => { if (b.status === 'PENDING') count++; });
        }
        // Count unread rejections/acceptances for buyers
        item.bids.forEach(b => {
            if (b.buyerId === userId && !b.readByBuyer && (b.status === 'REJECTED' || b.status === 'ACCEPTED')) count++;
        });
    });
    return count;
}

// Keep a copy of each numbered Class Portal menu so 0 can return one screen at a time.
function trackClassNavigation(message, userId, input = null) {
    const session = getSession(userId);
    if (!session || !message || typeof message.reply !== 'function' || message.__classNavigationTracked) return;

    const originalReply = message.reply.bind(message);
    const stateAtInput = session.state;
    let returnedToParentMenu = false;

    const getReplyText = (args) => {
        const content = args[0];
        if (typeof content === 'string') return content;
        if (content && typeof content === 'object') {
            return typeof content.body === 'string' ? content.body : (typeof content.caption === 'string' ? content.caption : '');
        }
        return '';
    };

    const isNumberedMenu = (body) => {
        if (!body) return false;
        const hasFirstOption = /(?:^|\n)\s*(?:│[^\n]*?)?1[.)]\s/m.test(body)
            || /(?:^|\n)\s*│[^\n]*\x601\x60/m.test(body);
        const hasBackOption = /(?:^|\n)\s*(?:│[^\n]*?)?0[.)]\s*(?:🔙\s*)?(?:back|main menu|dashboard|return)/im.test(body)
            || /(?:^|\n)\s*│[^\n]*\x600\x60[^\n]*(?:back|main menu|dashboard|return)/im.test(body);
        const hasGatewayExit = /(?:^|\n)\s*(?:│[^\n]*?)?99[.)]\s*.*exit/im.test(body)
            || /(?:^|\n)\s*│[^\n]*\x6099\x60[^\n]*exit/im.test(body);
        return hasFirstOption && (hasBackOption || hasGatewayExit);
    };

    message.__classNavigationTracked = true;
    message.reply = async (...args) => {
        const result = await originalReply(...args);
        const currentSession = getSession(userId);
        if (!currentSession) return result;

        if (!currentSession.navigationMenus) currentSession.navigationMenus = Object.create(null);
        const body = getReplyText(args);
        const currentState = currentSession.state;

        if (isNumberedMenu(body)) {
            currentSession.navigationMenus[currentState] = body;
            currentSession.pendingBackState = null;
            if (input === '0' && currentState !== stateAtInput) returnedToParentMenu = true;
            return result;
        }

        const parentMenu = currentSession.navigationMenus[currentState];
        if (input === '0' && !returnedToParentMenu && currentState !== stateAtInput && parentMenu) {
            returnedToParentMenu = true;
            await originalReply(parentMenu);
            currentSession.pendingBackState = null;
            return result;
        }

        currentSession.pendingBackState = parentMenu ? currentState : null;
        return result;
    };
}

function getAttendanceHistoryChoices(classData, filter = null) {
    const history = Array.isArray(classData?.attendanceHistory) ? classData.attendanceHistory : [];
    let records = history.map((record, index) => ({
        record,
        index,
        id: record.id || ('legacy_' + (record.closedAt || record.dateKey || index) + '_' + String(record.unit || 'class'))
    }));

    if (filter?.type === 'unit') {
        const query = filter.value.toLowerCase();
        records = records.filter(({ record }) => String(record.unit || '').toLowerCase().includes(query));
    } else if (filter?.type === 'date') {
        records = records.filter(({ record }) => record.dateKey === filter.value);
    } else if (filter?.type === 'student') {
        const query = filter.value.toLowerCase();
        records = records.filter(({ record }) => (record.attendance || []).some(student =>
            [student.name, student.admission, student.memberKey].some(value =>
                String(value || '').toLowerCase().includes(query)
            )
        ));
    }

    return records.slice(-10).reverse();
}

function buildAttendanceHistoryView(classData, filter = null) {
    const choices = getAttendanceHistoryChoices(classData, filter);
    const filterLabel = filter
        ? '🔎 Filter: ' + filter.type + ' — ' + filter.value + '\n\n'
        : '';
    if (choices.length === 0) {
        return {
            choices,
            text: '📭 No attendance records match this view.\n\nType filter unit <text>, filter date YYYY-MM-DD, filter student <name>, or clear.\n(Type *0* to return to Class Members)'
        };
    }

    const rows = choices.map(({ record }, index) => {
        const total = Number(record.rosterCount) || (Array.isArray(record.attendance) ? record.attendance.length : 0);
        const present = Number.isFinite(Number(record.presentCount))
            ? Number(record.presentCount)
            : (record.attendance || []).filter(item => ['PRESENT', 'LATE'].includes(item.status)).length;
        return (index + 1) + '. *' + (record.unit || 'Class') + '* — ' + (record.dateKey || 'Date unavailable')
            + '\n   🟢 ' + present + ' present / ' + total + ' on roster';
    });

    return {
        choices,
        text: '📖 *RECENT ATTENDANCE HISTORY*\n━━━━━━━━━━━━━━━━━━\n' + filterLabel + rows.join('\n')
            + '\n\nReply with a number to inspect and correct a register.'
            + '\nFilters: filter unit <text> | filter date YYYY-MM-DD | filter student <name/admission>'
            + '\nType clear to remove the filter. (Type *0* to return to Class Members)'
    };
}

function buildAttendanceDetailView(record) {
    const attendance = Array.isArray(record?.attendance) ? record.attendance : [];
    if (!attendance.length) {
        return '📭 This archived record has no per-student roster.\n(Type *0* to return to attendance history)';
    }

    const rows = attendance.map((student, index) => {
        const status = String(student.status || 'ABSENT').toUpperCase();
        const reason = student.correctionReason ? ' — ' + student.correctionReason : '';
        return (index + 1) + '. *' + (student.name || 'Unknown student') + '* (' + (student.admission || 'no admission') + ') — ' + status + reason;
    });

    return '🧾 *' + (record.unit || 'CLASS') + ' — ' + (record.dateKey || 'date unavailable') + '*\n'
        + 'Present/late: ' + (Number(record.presentCount) || 0) + '/' + (Number(record.rosterCount) || attendance.length)
        + '\n━━━━━━━━━━━━━━━━━━\n' + rows.join('\n')
        + '\n\nCorrections (include a reason):'
        + '\nlate <number> <reason> | excused <number> <reason>'
        + '\ncorrect <number> present|absent|late|excused <reason>'
        + '\n(Type *0* to return to history)';
}

function normalizeAttendanceFilterInput(input) {
    if (input.toLowerCase() === 'clear') return { clear: true };
    const match = input.match(/^filter\s+(unit|date|student)\s+(.+)$/i);
    if (!match) return null;
    const type = match[1].toLowerCase();
    const value = match[2].trim();
    if (!value || value.length > 80) return null;
    if (type === 'date' && !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
    return { type, value };
}

function updateAttendanceCorrection(classData, record, memberIndex, nextStatus, reason, correctedBy) {
    const attendance = Array.isArray(record.attendance) ? record.attendance : [];
    const student = attendance[memberIndex];
    if (!student) return { error: 'That roster number is not in this record.' };

    const previousStatus = String(student.status || 'ABSENT').toUpperCase();
    const previousAttended = ['PRESENT', 'LATE'].includes(previousStatus);
    const nextAttended = ['PRESENT', 'LATE'].includes(nextStatus);
    const member = classData.members?.[student.memberKey];
    if (member && previousAttended !== nextAttended) {
        const current = Math.max(0, Number(member.attendedClasses) || 0);
        member.attendedClasses = Math.max(0, current + (nextAttended ? 1 : -1));
    }

    student.status = nextStatus;
    student.correctionReason = reason;
    student.correctedAt = Date.now();
    if (nextAttended && !student.checkedInAt && nextStatus === 'LATE') {
        student.checkedInAt = student.correctedAt;
        student.checkInTime = new Date(student.correctedAt).toLocaleTimeString('en-US', { timeZone: 'Africa/Nairobi' });
    }

    if (!record.attendees || typeof record.attendees !== 'object') record.attendees = {};
    if (nextAttended) {
        record.attendees[student.memberKey] = {
            name: student.name || 'Unknown student',
            regNo: student.admission || '',
            timestamp: student.checkInTime || 'Corrected by Class Rep',
            checkedInAt: Number(student.checkedInAt) || null,
            status: nextStatus,
            correctionReason: reason
        };
    } else {
        delete record.attendees[student.memberKey];
    }

    record.presentCount = attendance.filter(item => ['PRESENT', 'LATE'].includes(String(item.status || '').toUpperCase())).length;
    record.rosterCount = attendance.length;
    if (!Array.isArray(record.corrections)) record.corrections = [];
    record.corrections.push({
        memberKey: student.memberKey,
        name: student.name || 'Unknown student',
        from: previousStatus,
        to: nextStatus,
        reason,
        correctedAt: student.correctedAt,
        correctedBy
    });
    return { student, previousStatus };
}

function buildRepMembersMenu(isMainRep) {
    const roleOptions = isMainRep
        ? '3. 🎖️ Promote to Assistant Rep\n4. 🔻 Revoke Assistant Rep\n'
        : '';
    const ghostOption = isMainRep ? 5 : 3;
    const historyOption = isMainRep ? 6 : 4;
    return '👥 *CLASS MEMBERS*\n━━━━━━━━━━━━━━━━━━\n1. 👁️ View All Members\n2. 🗑️ Remove a Member\n'
        + roleOptions + ghostOption + '. 👻 View Attendance Summary\n'
        + historyOption + '. 📖 Recent Attendance History\n\n0. 🔙 Back to Dashboard';
}

async function sendRepMembersMenu(message, isMainRep) {
    await message.reply(buildRepMembersMenu(isMainRep));
}

// Entry point triggered by !class
async function handleClassCommand(client, message, userId, userName) {
    createSession(userId, 'MAIN_MENU');
    trackClassNavigation(message, userId);
    await sendMainMenu(message);
}

// Helper to send the Main Menu
async function sendMainMenu(message) {
  const menu = `╭──────────────────────────────╮
│        ⚡ _*TUM*_ × _*CHAOS*_ ⚡        
│                               
│           \`CLASS PORTAL\`          
│          \`GATEWAY HUB\`          
│                               
│   ❒ SYSTEM ☞『_*ONLINE*_』        
│   ❒ ENGINE ☞『_*SECURE*_』        
╰──────────────────────────────╯

┌─── ░◈ _*GATEWAY*_ ◈░ ──────────────┐
│
│🏫 \`1\`
│    ☞『_*View & Login to a Class*_』
➫➫➫➫ΞΞΞΞΞΞΞΞΞΞΞΞΞΞΞΞΞΞΞΞΞ
│🛠️ \`2\`
│    ☞『_*Create a New Class (Reps)*_』
➫➫➫➫ΞΞΞΞΞΞΞΞΞΞΞΞΞΞΞΞΞΞΞΞΞ
│🚪 \`99\`
│    ☞『_*Exit gateway*_』
│
└──────────────────────────────┘

╭──────────────────────────────╮
│                               
│        👑░◈ _*PORTAL*_ ◈░        
│                               
│   💬 \`Reply with a number\`    
│                               
╰──────────────────────────────╯
      ⚡ _*TUM*_ × _*CHAOS*_ ⚡        
      「 SECURE THE SYSTEM 」`;

  await message.reply(menu);
}

// The core state router that processes raw text while logged in
async function handleInput(client, message, userId, text, userName) {
    const session = getSession(userId);
    if (!session) return;

    const input = text.trim();
    trackClassNavigation(message, userId, input);

    if (input === '0' && session.pendingBackState === session.state) {
        const currentMenu = session.navigationMenus?.[session.state];
        session.pendingBackState = null;
        if (currentMenu) {
            await message.reply(currentMenu);
            return;
        }
    } else if (input !== '0') {
        session.pendingBackState = null;
    }

    // ========================================================
    // 🛒 MARKETPLACE LIVE NEGOTIATION INTERCEPTOR
    // ========================================================
    if (activeMarketChats.has(userId)) {
        const chatData = activeMarketChats.get(userId);
        
        // Check for exit commands
        if (input === '0' || input.toLowerCase() === 'done' || input.toLowerCase() === 'done negotiating?') {
            activeMarketChats.delete(userId);
            activeMarketChats.delete(chatData.targetId);
            
            await client.sendMessage(userId, `🛑 *Negotiation Ended.*\nYou have left the live chat. Sending you back to the Market...`);
            await client.sendMessage(chatData.targetId, `🛑 *The other party ended the negotiation.*`);
            
            // Route them both back to the Market Home safely
            updateSessionState(userId, 'MARKET_HOME', session.data);
            const targetSession = getSession(chatData.targetId);
            if (targetSession) updateSessionState(chatData.targetId, 'MARKET_HOME', targetSession.data);
            return;
        }

        // Route the message anonymously to the partner
        try {
            await client.sendMessage(chatData.targetId, `💬 *${chatData.alias}:* ${input}\n\n_(Type *0* to stop negotiating)_`);
        } catch (e) {
            console.warn("[MARKET] Failed to route live message.");
        }
        return; // STOP EXECUTION! Do not process portal menus.
    }
    // ========================================================

    try {
        const db = readClassDB();
        switch (session.state) {
            case 'MAIN_MENU': {
                if (input === '1') {
                    // Show list of created classes
                    const classes = Object.keys(db.classes);
                    if (classes.length === 0) {
                        await message.reply(`⚠️ No classes have been created yet.\n\nType *99* to exit, or *2* to create one.`);
                        return;
                    }
                    
                    let classList = `🏫 *AVAILABLE CLASSES*\n━━━━━━━━━━━━━━━━━━\n`;
                    classes.forEach((cls, idx) => {
                        classList += `${idx + 1}. ${cls}\n`;
                    });
                    classList += `\n*Reply with the number of your class:*\n(Type *0* to go back)`;
                    
                    updateSessionState(userId, 'SELECT_CLASS');
                    await message.reply(classList);
                } 
                else if (input === '2') {
                    // SECURITY: Check if they are already a rep
                    if (isUserAlreadyRep(userId)) {
                        await message.reply(`❌ *ACCESS DENIED*\n\nYou have already created and manage a class portal. Reps are strictly limited to one class.\n\n(Type *0* to go back)`);
                        return;
                    }
                    
                    updateSessionState(userId, 'CREATE_CLASS_GATEWAY');
                    await message.reply(
                        `🛠️ *CLASS REP ONBOARDING*\n━━━━━━━━━━━━━━━━━━\n\n` +
                        `To create a class portal, you must be an authorized Class Representative.\n\n` +
                        `1. 🎟️ I have an Authorization Code\n` +
                        `2. 📝 Apply for a Code\n\n` +
                        `(Type *0* to go back)`
                    );
                } 
                else {
                    await message.reply('❌ Invalid choice. Reply with 1, 2, or 99 to exit.');
                }
                break;
            }

            // NEW STATE: CHOOSE TO ENTER CODE OR APPLY
            case 'CREATE_CLASS_GATEWAY': {
                if (input === '0') {
                    updateSessionState(userId, 'MAIN_MENU');
                    await sendMainMenu(message);
                    return;
                }
                
                if (input === '1') {
                    updateSessionState(userId, 'CREATE_CLASS_AUTH');
                    await message.reply(`🔐 *AUTHORIZATION REQUIRED*\n\nPlease enter the *One-Time Authorization Code* provided by the Master Owner:\n\n(Type *0* to go back)`);
                } 
                else if (input === '2') {
                    updateSessionState(userId, 'APP_CLASS');
                    await message.reply(`📝 *REP APPLICATION (Step 1 of 2)*\n━━━━━━━━━━━━━━━━━━\n\nEnter your *Target Class & Year* (e.g., BSIT/2024):\n\n(Type *0* to cancel)`);
                } 
                else {
                    await message.reply('❌ Invalid choice. Reply 1, 2, or 0 to go back.');
                }
                break;
            }

            // WIZARD STEP 1: CLASS
            case 'APP_CLASS': {
                if (input === '0') { 
                    updateSessionState(userId, 'CREATE_CLASS_GATEWAY'); 
                    await message.reply(`🛠️ *CLASS REP ONBOARDING*\n━━━━━━━━━━━━━━━━━━\n\nTo create a class portal, you must be an authorized Class Representative.\n\n1. 🎟️ I have an Authorization Code\n2. 📝 Apply for a Code\n\n(Type *0* to go back)`); 
                    return; 
                }
                updateSessionState(userId, 'APP_LINK', { ...session.data, appClass: input.toUpperCase() });
                await message.reply(`✅ Class saved: *${input.toUpperCase()}*\n\n📝 *REP APPLICATION (Step 2 of 2)*\n\nPaste the *WhatsApp Group Invite Link* for your class.\n\n⚠️ *CRITICAL:* Please ensure you are ready to accept join requests so the admin can verify your group!`);
                break;
            }

            // WIZARD STEP 2: LINK & SUBMIT
            case 'APP_LINK': {
                if (input === '0') { 
                    updateSessionState(userId, 'APP_CLASS'); 
                    await message.reply(`📝 *REP APPLICATION (Step 1 of 2)*\n━━━━━━━━━━━━━━━━━━\n\nEnter your *Target Class & Year* (e.g., BSIT/2024):\n\n(Type *0* to cancel)`);
                    return; 
                }
                
                // Persist each application independently so replies always target
                // the quoted applicant, even after restarts or overlapping submissions.
                const ownerJid = '254111659469@c.us'; // Your Master Owner Number
                const applicationId = `app_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
                const application = {
                    id: applicationId,
                    applicantId: userId,
                    applicantName: userName,
                    className: session.data.appClass,
                    inviteLink: input.trim(),
                    status: 'PENDING',
                    submittedAt: Date.now()
                };
                if (!Array.isArray(db.applications)) db.applications = [];
                db.applications.push(application);
                const pendingApplications = db.applications.filter(item => item.status === 'PENDING' || item.status === 'APPROVING');
                const resolvedApplications = db.applications.filter(item => item.status !== 'PENDING' && item.status !== 'APPROVING').slice(-200);
                db.applications = [...resolvedApplications, ...pendingApplications];
                writeClassDB(db);
                await flushClassDB();

                const appSummary = `📩 *NEW CLASS REP APPLICATION*\n━━━━━━━━━━━━━━━━━━\n` +
                                   `👤 *WA Profile:* ${userName}\n` +
                                   `🏫 *Class:* ${session.data.appClass}\n` +
                                   `🔗 *Link:* ${input}\n\n` +
                                   `🆔 *Application ID:* \`${applicationId}\`\n` +
                                   `📱 *User ID:* \`${userId}\`\n━━━━━━━━━━━━━━━━━━\n` +
                                   `👉 *Swipe right to reply to this message with:*\n` +
                                   `*accept* (to approve & send code)\n` +
                                   `*reject <reason>* (to deny)`;
                
                try {
                    await client.sendMessage(ownerJid, appSummary);
                } catch (e) {
                    console.warn("[CLASS PORTAL] Could not send application to owner.", e);
                    db.applications = db.applications.filter(item => item.id !== applicationId);
                    writeClassDB(db);
                    await flushClassDB();
                    updateSessionState(userId, 'MAIN_MENU');
                    await message.reply('❌ I could not deliver your application to the administrators. Please try again later.');
                    await sendMainMenu(message);
                    return;
                }

                // 2. Wrap up with the Applicant
                updateSessionState(userId, 'MAIN_MENU');
                await message.reply(`🎉 *APPLICATION SUBMITTED!*\n\nYour application has been safely transmitted to the system administrators.\n\n⏳ *NEXT STEPS:*\n1. An admin will use your link to verify you in the group.\n2. You will receive a direct message with your Authorization Code once approved!\n\n*(Returning to Main Menu...)*`);
                await sendMainMenu(message);
                break;
            }

            // NEW STATE: VERIFY THE AUTH CODE
            case 'CREATE_CLASS_AUTH': {
                if (input === '0') {
                    updateSessionState(userId, 'CREATE_CLASS_GATEWAY'); 
                    await message.reply(`🛠️ *CLASS REP ONBOARDING*\n━━━━━━━━━━━━━━━━━━\n\nTo create a class portal, you must be an authorized Class Representative.\n\n1. 🎟️ I have an Authorization Code\n2. 📝 Apply for a Code\n\n(Type *0* to go back)`); 
                    return;
                }
                
                const cleanInput = input.trim().toUpperCase();
                
                // Validate against the database array
                if (!db.repCodes || !db.repCodes.some(code => verifySecret(cleanInput, code))) {
                    await message.reply(`❌ *INVALID CODE*\n\nThe authorization code is incorrect, already used, or expired.\n\nPlease try again or type *0* to go back.`);
                    return;
                }
                
                // Code is valid! We keep it in session memory and consume it ONLY when the class is successfully created.
                updateSessionState(userId, 'CREATE_CLASS_NAME', { authCode: cleanInput });
                await message.reply(`✅ *AUTHORIZATION ACCEPTED*\n\n🛠️ *CREATE A NEW CLASS*\n\nEnter your class name and year in this exact format:\n*Course/Year* (e.g., BSIT/2024)\n\n(Type *0* to cancel)`);
                break;
            }

            case 'CREATE_CLASS_NAME': {
                if (input === '0') {
                    updateSessionState(userId, 'CREATE_CLASS_AUTH');
                    await message.reply(`🔐 *AUTHORIZATION REQUIRED*\n\nPlease enter the *One-Time Authorization Code* provided by the Master Owner:\n\n(Type *0* to go back)`);
                    return;
                }
                
                // Validate format using regex: letters/numbers, slash, 4 digits
                if (!/^[A-Z0-9-]+\/\d{4}$/i.test(input)) {
                    await message.reply(`❌ Invalid format.\n\nPlease use the format *Course/Year* (e.g., BSIT/2024).`);
                    return;
                }
                
                const className = input.toUpperCase();
                if (classExists(className)) {
                    await message.reply(`❌ The class *${className}* already exists!\n\nEnter a different name, or type *0* to go back.`);
                    return;
                }

                updateSessionState(userId, 'CREATE_CLASS_PASS', { ...session.data, pendingClassName: className });
                await message.reply(`✅ Class Name Accepted: *${className}*\n\n🔒 Now, create a *Class Password* for this portal.\n(This is the password you will share with your students to enter).`);
                break;
            }

            case 'CREATE_CLASS_PASS': {
                if (input === '0') {
                    updateSessionState(userId, 'CREATE_CLASS_NAME', session.data);
                    await message.reply(`📝 *CLASS NAME*\n\nCurrent name: *${session.data.pendingClassName}*\nEnter the class name (e.g., BSIT/2024), or type *0* to return to authorization.`);
                    return;
                }

                // SECURITY: Double check the code wasn't used by someone else while they were typing
                if (!db.repCodes || !db.repCodes.some(code => verifySecret(session.data.authCode, code))) {
                    await message.reply(`❌ *AUTHORIZATION EXPIRED*\n\nYour code was just used by someone else or revoked by the system. Class creation failed.\n\nType *0* to go back.`);
                    return;
                }

                // CONSUME THE CODE: Remove it from the database permanently
                db.repCodes = db.repCodes.filter(c => !verifySecret(session.data.authCode, c));

                const newClassName = session.data.pendingClassName;
                
                // Write the new class to the database
                db.classes[newClassName] = {
                    repName: userName, 
                    repId: userId,
                    assistantReps: [],     
                    classPassword: hashSecret(input),
                    timetable: { sunday: [], monday: [], tuesday: [], wednesday: [], thursday: [], friday: [], saturday: [] },
                    updates: [],
                    members: {}, 
                    issues: [],
                    logs: [],
                    assessments: []
                };
                writeClassDB(db);

                updateSessionState(userId, 'MAIN_MENU');
                await message.reply(`🎉 *CLASS SUCCESSFULLY CREATED!*\n\n🏫 *Class:* ${newClassName}\n👑 *Rep:* ${userName}\n\nYour portal is now live. Share the password you just entered with your students. Reply with *1* to login and start building your timetable, or *99* to exit.\n\n*DO NOT FORGET YOUR PASSWORD.*`);
                await sendMainMenu(message);
                break;
            }

            case 'SELECT_CLASS': {
                if (input === '0') {
                    updateSessionState(userId, 'MAIN_MENU');
                    await sendMainMenu(message);
                    return;
                }
                
                const classListKeys = Object.keys(db.classes);
                const selectedIdx = parseInt(input) - 1;

                if (isNaN(selectedIdx) || selectedIdx < 0 || selectedIdx >= classListKeys.length) {
                    await message.reply(`❌ Invalid selection. Please reply with a valid number from the list.`);
                    return;
                }

                const selectedClass = classListKeys[selectedIdx];
                updateSessionState(userId, 'ENTER_CLASS_PASS', { selectedClass });
                await message.reply(`🔐 *GATEKEEPER: ${selectedClass}*\n\nEnter the Class Password to proceed:\n\n(Type *0* to go back)`);
                break;
            }

            case 'ENTER_CLASS_PASS': {
                if (input === '0') {
                    const db = readClassDB();
                    const classes = Object.keys(db.classes);
                    let classList = `🏫 *AVAILABLE CLASSES*\n━━━━━━━━━━━━━━━━━━\n`;
                    classes.forEach((cls, idx) => {
                        classList += `${idx + 1}. ${cls}\n`;
                    });
                    classList += `\n*Reply with the number of your class:*\n(Type *0* to go back)`;
                    
                    updateSessionState(userId, 'SELECT_CLASS', session.data);
                    await message.reply(classList);
                    return;
                }

                const targetClass = session.data.selectedClass;
                const classData = db.classes[targetClass];

                if (!verifySecret(input, classData.classPassword)) {
                    await message.reply(`❌ Incorrect Class Password for *${targetClass}*.\nTry again, or type *0* to go back.`);
                    return;
                }

                // Password Correct! Route them based on who they are
                const isMainRep = userId === classData.repId;
                const isAssistant = classData.assistantReps && classData.assistantReps.includes(userId);

                if (isMainRep || isAssistant) {
                    // They are the Class Rep or Assistant Rep
                    updateSessionState(userId, 'REP_DASHBOARD', { loggedInClass: targetClass, isMainRep });
                    const roleTitle = isMainRep ? 'Class Rep' : 'Assistant Rep';
                    await message.reply(`✅ *Access Granted*\nWelcome back, ${roleTitle} ${userName}!`);
                    await sendRepDashboard(message, targetClass);
                } else {
                    // They are a Student
                    updateSessionState(userId, 'STUDENT_GATEWAY', { loggedInClass: targetClass });
                    await message.reply(`✅ *Access Granted*\nWelcome to the ${targetClass} portal.`);
                    await sendStudentGateway(message, targetClass);
                }
                break;
            }

            // ==========================================
            // PHASE 3: REP DASHBOARD & TIMETABLE WIZARD
            // ==========================================
            case 'REP_DASHBOARD': {
                if (input === '0') {
                    updateSessionState(userId, 'MAIN_MENU');
                    await sendMainMenu(message);
                    return;
                }
                if (input === '1') {
                    updateSessionState(userId, 'REP_TIMETABLE_MENU', session.data);
                    await message.reply(`📅 *TIMETABLE MANAGEMENT*\n━━━━━━━━━━━━━━━━━━\n1. 👁️ View Current Timetable\n2. 🛠️ Run Timetable Wizard (Create new Timetable)\n3. Modify/Cancel Classes\n\n0. 🔙 Back to Dashboard`);
                } else if (input === '2') {
                    updateSessionState(userId, 'REP_UPDATES_MENU', session.data);
                    await message.reply(`📢 *UPDATES MANAGEMENT*\n━━━━━━━━━━━━━━━━━━\n1. 👁️ View Updates\n2. ✍️ Post New Update\n3. 🗑️ Clear All Updates\n4. 🔔 Remind Update\n\n0. 🔙 Back to Dashboard`);
                } else if (input === '3') {
                    updateSessionState(userId, 'REP_MEMBERS_MENU', session.data);
                    await sendRepMembersMenu(message, session.data.isMainRep);
                } else if (input === '4') {
                    updateSessionState(userId, 'REP_ISSUES_MENU', session.data);
                    await message.reply(`🚨 *ISSUES DESK*\n━━━━━━━━━━━━━━━━━━\n1. 👁️ View Locked Accounts\n2. 🔓 Resolve / Unlock an Account\n\n0. 🔙 Back to Dashboard`);
                } else if (input === '5') {
                    // View Logs
                    const logs = db.classes[session.data.loggedInClass].logs || [];
                    if (logs.length === 0) {
                        await message.reply(`📭 No logs available yet.\n\n(Type *0* to go back)`);
                    } else {
                        let logStr = `📜 *CLASS AUDIT LOGS*\n━━━━━━━━━━━━━━━━━━\n`;
                        logs.slice(-10).forEach(l => {
                            const dateObj = new Date(l.timestamp);
                            const tStr = dateObj.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Nairobi' });
                            const dStr = dateObj.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'Africa/Nairobi' });
                            logStr += `▪️ [${dStr} ${tStr}] ${l.text}\n`;
                        });
                        await message.reply(logStr + `\n(Type *0* to go back)`);
                    }
                } else if (input === '6') {
                    // Start Roll Call
                    const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
                    const todayIdx = new Date(new Date().toLocaleString("en-US", {timeZone: "Africa/Nairobi"})).getDay();
                    const todayStr = days[todayIdx];
                    const todayClasses = db.classes[session.data.loggedInClass].timetable[todayStr];

                    if (!todayClasses || todayClasses.length === 0) {
                        await message.reply(`🏖️ There are no classes on the timetable for today (*${todayStr.toUpperCase()}*).\n\nUpdate the timetable first, or type *0* to go back.`);
                        return;
                    }

                    let rcStr = `✅ *SELECT CLASS FOR ROLL CALL*\n━━━━━━━━━━━━━━━━━━\nToday is *${todayStr.toUpperCase()}*.\n\n`;
                    todayClasses.forEach((c, idx) => {
                        rcStr += `${idx + 1}. *${c.unit}* (@ ${c.time})\n`;
                    });
                    rcStr += `\n*Reply with the number of the class:*\n(Type *0* to cancel)`;

                    updateSessionState(userId, 'REP_ROLLCALL_SELECT', { ...session.data, todayClasses, todayStr });
                    await message.reply(rcStr);
                } else if (input === '7') {
                    // Close & View Roll Call
                    const activeRC = db.classes[session.data.loggedInClass].activeRollCall;
                    
                    if (!activeRC) {
                        await message.reply(`❌ There is no active roll call to close.\n\n(Type *0* to go back)`);
                        return;
                    }

                    const attendees = Object.values(activeRC.attendees || {});
                    let report = `🛑 *ROLL CALL CLOSED*\n━━━━━━━━━━━━━━━━━━\n📚 Unit: *${activeRC.unit}*\n📅 Date: *${activeRC.date}*\n👥 Total Present: *${attendees.length}*\n━━━━━━━━━━━━━━━━━━\n\n`;
                    
                    if (attendees.length === 0) {
                        report += `No students marked themselves present. 📭`;
                    } else {
                        attendees.forEach((student, idx) => {
                            report += `${idx + 1}. ${student.name} (${student.regNo}) - [${student.timestamp}]\n`;
                        });
                    }

                    closeActiveRollCall(db.classes[session.data.loggedInClass]);
                    writeClassDB(db);

                    await message.reply(report + `\n\n(Type *0* to go back to Dashboard)`);
                } else if (input === '8') {
                    // Initialize the assessments array if it doesn't exist for older classes
                    if (!db.classes[session.data.loggedInClass].assessments) {
                        db.classes[session.data.loggedInClass].assessments = [];
                        writeClassDB(db);
                    }
                    updateSessionState(userId, 'REP_DEADLINES_MENU', session.data);
                    await message.reply(`📚 *DEADLINES & ASSESSMENTS*\n━━━━━━━━━━━━━━━━━━\n1. ➕ Add New Deadline\n2. 👁️ View Active Deadlines\n3. 🗑️ Delete a Deadline\n4. 🚨 Send Panic Blast (Reminder)\n\n0. 🔙 Back to Dashboard`);
                } else if (input === '9') {
                    // Initialize syndicates array if it doesn't exist
                    if (!db.classes[session.data.loggedInClass].syndicates) {
                        db.classes[session.data.loggedInClass].syndicates = [];
                        writeClassDB(db);
                    }
                    updateSessionState(userId, 'REP_SYNDICATE_MENU', session.data);
                    await message.reply(`🎲 *SYNDICATE MAKER*\n━━━━━━━━━━━━━━━━━━\n1. 🎲 Generate New Groups\n2. 👁️ View Active Groups\n3. 🚀 Broadcast Groups to Class\n4. 🗑️ Clear All Groups\n\n0. 🔙 Back to Dashboard`);
                } else if (input === '10') {
                    updateSessionState(userId, 'REP_WHISPER_MENU', session.data);
                    await message.reply(`🤫 *WHISPER INBOX*\n━━━━━━━━━━━━━━━━━━\n1. 📥 View Unread Whispers\n2. ✍️ Reply to a Whisper\n3. 🗑️ Clear Inbox\n\n0. 🔙 Back to Dashboard`);
                } else if (input === '11') {
                    // Enter Hustle Board
                    const sClass = session.data.loggedInClass;
                    const sDb = db.classes[sClass];
                    
                    if (!sDb.marketplace) { sDb.marketplace = []; writeClassDB(db); }
                    updateSessionState(userId, 'MARKET_HOME', session.data);
                    const notifs = getMarketNotifs(sClass, userId);
                    await message.reply(`🛒 *THE HUSTLE BOARD*\n━━━━━━━━━━━━━━━━━━\n1. 🛍️ Buy (Browse Items)\n2. 🏷️ Sell / Barter an Item\n3. 🔔 Notifications (${notifs})\n4. 📦 My Listings\n\n0. 🔙 Back to Dashboard`);
                } else if (input === '12') {
                    if (!db.classes[session.data.loggedInClass].polls) {
                        db.classes[session.data.loggedInClass].polls = [];
                        writeClassDB(db);
                    }
                    updateSessionState(userId, 'REP_POLL_MENU', session.data);
                    await message.reply(`📊 *CLASS POLLS*\n━━━━━━━━━━━━━━━━━━\n1. ➕ Create New Poll\n2. 👁️ View Past Results\n3. 🗑️ Clear Poll History\n\n0. 🔙 Back to Dashboard`);
                } else if (input === '13') {
                    const isHoliday = db.classes[session.data.loggedInClass].holidayMode || false;
                    updateSessionState(userId, 'REP_HOLIDAY_MENU', session.data);
                    
                    await message.reply(
                        `🌴 *HOLIDAY MODE SETTINGS*\n━━━━━━━━━━━━━━━━━━\n` +
                        `Current Status: *${isHoliday ? '🟢 ON (Alerts Muted)' : '🔴 OFF (Alerts Active)'}*\n\n` +
                        `Holiday Mode mutes all automated timetable warnings, deadline alerts, and daily morning/night reminders for your class.\n\n` +
                        `1. 🟢 Turn Holiday Mode ON\n` +
                        `2. 🔴 Turn Holiday Mode OFF\n\n` +
                        `0. 🔙 Back to Dashboard`
                    );
                 } else {
                    await message.reply(`❌ Invalid choice. Type 1-13, 0 to go back, or 99 to exit.`);
                } 
                break;
            }

            // ==========================================
            // PHASE 7: SYNDICATE MAKER (GROUP RANDOMIZER)
            // ==========================================
            case 'REP_SYNDICATE_MENU': {
                if (input === '0') {
                    updateSessionState(userId, 'REP_DASHBOARD', session.data);
                    await sendRepDashboard(message, session.data.loggedInClass);
                    return;
                }

                let syndicates = db.classes[session.data.loggedInClass].syndicates || [];

                if (input === '1') {
                    const memberCount = Object.keys(db.classes[session.data.loggedInClass].members).length;
                    if (memberCount < 2) {
                        await message.reply(`⚠️ Not enough students registered to form groups. You need at least 2 students.\n\n(Type *0* to go back)`);
                        return;
                    }
                    updateSessionState(userId, 'REP_SYNDICATE_SIZE', session.data);
                    await message.reply(`🎲 *GENERATE NEW GROUPS*\n\nThere are currently *${memberCount}* students registered in this class.\n\nHow many students should be in each group?\n(Reply with a number, e.g., *4* or *5*)\n\n0. 🔙 Cancel`);
                
                } else if (input === '2') {
                    if (syndicates.length === 0) {
                        await message.reply(`📭 No groups have been generated yet.\n(Type *0* to go back)`);
                        return;
                    }

                    let viewStr = `👥 *ACTIVE SYNDICATES*\n━━━━━━━━━━━━━━━━━━\n\n`;
                    syndicates.forEach((group, i) => {
                        viewStr += `*GROUP ${i + 1}*\n`;
                        group.forEach(student => {
                            viewStr += `▪️ ${student.name} (${student.admission})\n`;
                        });
                        viewStr += `\n`;
                    });
                    
                    await message.reply(viewStr + `(Type *0* to go back)`);
                
                } else if (input === '3') {
                    if (syndicates.length === 0) {
                        await message.reply(`📭 No groups to broadcast.\n(Type *0* to go back)`);
                        return;
                    }

                    const members = db.classes[session.data.loggedInClass].members;
                    const memberIds = Object.keys(members);
                    
                    await message.reply(`🚀 *BROADCASTING GROUPS*\n\nSending the group lists to all ${memberIds.length} registered students...\n\nPlease wait.`);
                    
                    // Format the message
                    let broadcastMsg = `🎲 *OFFICIAL CLASS GROUPS* 🎲\n\n🏫 Class: *${session.data.loggedInClass}*\n👑 Assigned by: *${db.classes[session.data.loggedInClass].repName}*\n━━━━━━━━━━━━━━━━━━\n\n`;
                    syndicates.forEach((group, i) => {
                        broadcastMsg += `*GROUP ${i + 1}*\n`;
                        group.forEach(student => broadcastMsg += `▪️ ${student.name}\n`);
                        broadcastMsg += `\n`;
                    });

                    // Send the blast
                    let sentCount = 0;
                    for (let mId of memberIds) {
                        try {
                            await client.sendMessage(members[mId].phoneId, broadcastMsg);
                            sentCount++;
                        } catch (e) {
                            console.warn(`[CLASS PORTAL] Failed to send groups to ${members[mId].name}`);
                        }
                    }

                    await message.reply(`✅ *BLAST COMPLETE*\n\nSuccessfully sent group lists to ${sentCount} students.\n\n(Type *0* to go back)`);

                } else if (input === '4') {
                    db.classes[session.data.loggedInClass].syndicates = [];
                    writeClassDB(db);
                    await message.reply(`🗑️ All groups have been cleared and deleted from the database.\n\n(Type *0* to go back)`);
                } else {
                    await message.reply(`❌ Invalid choice.`);
                }
                break;
            }

            case 'REP_SYNDICATE_SIZE': {
                if (input === '0') {
                    updateSessionState(userId, 'REP_SYNDICATE_MENU', session.data);
                    await message.reply(`🎲 Returning to Syndicate Menu...`);
                    return;
                }

                const groupSize = parseInt(input.trim(), 10);
                const classData = db.classes[session.data.loggedInClass];
                
                const membersObj = getAllClassParticipants(classData);
                const memberIds = getSortedMemberIds(classData);

                if (isNaN(groupSize) || groupSize < 2) {
                    await message.reply(`❌ Invalid size. A group must have at least 2 members. Try again:`);
                    return;
                }

                if (groupSize >= memberIds.length) {
                    await message.reply(`❌ Group size cannot be larger than the total number of participants (${memberIds.length}). Try again:`);
                    return;
                }

                // 1. Shuffle the Member IDs using Fisher-Yates Algorithm
                let shuffledIds = [...memberIds];
                for (let i = shuffledIds.length - 1; i > 0; i--) {
                    const j = Math.floor(Math.random() * (i + 1));
                    [shuffledIds[i], shuffledIds[j]] = [shuffledIds[j], shuffledIds[i]];
                }

                // 2. Chunk into groups
                const newSyndicates = [];
                for (let i = 0; i < shuffledIds.length; i += groupSize) {
                    const groupIds = shuffledIds.slice(i, i + groupSize);
                    
                    const mappedGroup = groupIds.map(id => {
                        const m = membersObj[id];
                        const isRep = m.phoneId === classData.repId || m.isRep;
                        const isAsst = classData.assistantReps?.includes(m.phoneId);
                        
                        let badge = '';
                        if (isRep) badge = ' 👑';
                        else if (isAsst) badge = ' ⭐';

                        return {
                            id: id,
                            name: m.name + badge,
                            admission: m.admission
                        };
                    });
                    
                    newSyndicates.push(mappedGroup);
                }

                // 3. Save to database
                db.classes[session.data.loggedInClass].syndicates = newSyndicates;
                
                db.classes[session.data.loggedInClass].logs.push({
                    text: `Generated ${newSyndicates.length} random groups (Size: ${groupSize})`,
                    timestamp: Date.now()
                });

                writeClassDB(db);

                updateSessionState(userId, 'REP_SYNDICATE_MENU', session.data);
                await message.reply(`🎉 *GROUPS SUCCESSFULLY GENERATED!*\n\nCreated *${newSyndicates.length}* groups of approximately *${groupSize}* participants each (including the Class Rep).\n\nReply with *2* to view them, or *3* to broadcast them immediately to the class.\n\n0. 🔙 Back`);
                break;
            }

            case 'REP_ROLLCALL_SELECT': {
                if (input === '0') {
                    updateSessionState(userId, 'REP_DASHBOARD', session.data);
                    await sendRepDashboard(message, session.data.loggedInClass);
                    return;
                }

                const selectedIdx = parseInt(input) - 1;
                const todayClasses = session.data.todayClasses;

                if (isNaN(selectedIdx) || selectedIdx < 0 || selectedIdx >= todayClasses.length) {
                    await message.reply(`❌ Invalid selection. Reply with a valid number.`);
                    return;
                }

                const targetUnit = todayClasses[selectedIdx].unit;
                const members = db.classes[session.data.loggedInClass].members;
                const memberIds = Object.keys(members);

                if (memberIds.length === 0) {
                    await message.reply(`⚠️ You cannot start a roll call because no students are registered in this class yet.\n\n(Type *0* to go back)`);
                    return;
                }

                if (db.classes[session.data.loggedInClass].activeRollCall) {
                    const active = db.classes[session.data.loggedInClass].activeRollCall;
                    await message.reply(`⚠️ A roll call for *${active.unit}* is already open. Close it before starting another register.\n\n(Type *0* to go back)`);
                    return;
                }

                // Open the register in the database
                db.classes[session.data.loggedInClass].activeRollCall = {
                    unit: targetUnit,
                    date: new Date().toLocaleDateString("en-US", {timeZone: "Africa/Nairobi"}),
                    dateKey: getEATDateKey(),
                    startedAt: Date.now(),
                    source: 'manual',
                    rosterSnapshot: Object.entries(db.classes[session.data.loggedInClass].members || {}).map(([memberKey, member]) => ({
                        memberKey,
                        name: member.name || 'Unknown student',
                        admission: member.admission || ''
                    })),
                    attendees: {}
                };
                writeClassDB(db);

                // Initiate DM Blast
                await message.reply(`🚀 *ROLL CALL INITIATED*\n\nSending direct messages to ${memberIds.length} registered students for *${targetUnit}*...\n\nPlease wait a moment.`);

                let sentCount = 0;
                for (let mId of memberIds) {
                    const student = members[mId];
                    try {
                        // Custom prompt asking if they are present for that particular class
                        await client.sendMessage(student.phoneId, `📢 *URGENT: ROLL CALL*\n\n🏫 Class: *${session.data.loggedInClass}*\n\nAre you present for *${targetUnit}*?\n\nReply directly to this message with the word:\n*PRESENT*`);
                        sentCount++;
                    } catch (e) {
                        console.warn(`[CLASS PORTAL] Could not send roll call DM to ${student.name}`);
                    }
                }

                updateSessionState(userId, 'REP_DASHBOARD', session.data);
                await message.reply(`✅ *BLAST COMPLETE*\n\nSuccessfully sent roll call DMs to ${sentCount} students.\n\nSelect Option *7* in your dashboard to view the list and close the attendance.`);
                await sendRepDashboard(message, session.data.loggedInClass);
                break;
            }

            case 'REP_TIMETABLE_MENU': {
                if (input === '0') {
                    updateSessionState(userId, 'REP_DASHBOARD', session.data);
                    await sendRepDashboard(message, session.data.loggedInClass);
                    return;
                }
                if (input === '1') {
                    const tt = db.classes[session.data.loggedInClass].timetable;
                    let ttStr = `📅 *${session.data.loggedInClass} TIMETABLE*\n━━━━━━━━━━━━━━━━━━\n`;
                    const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
                    
                    days.forEach(d => {
                        ttStr += `*${d.toUpperCase()}*\n`;
                        if (!tt[d] || tt[d].length === 0) {
                            ttStr += `  Free Day 🏖️\n`;
                        } else {
                            tt[d].forEach(c => ttStr += `  ▪️ ${c.unit} @ ${c.time}\n`);
                        }
                        ttStr += `\n`;
                    });
                    
                    // 🛡️ NEW: Catch the view state
                    updateSessionState(userId, 'REP_TIMETABLE_VIEW', session.data);
                    await message.reply(ttStr + `(Type *0* to go back)`);
                } else if (input === '2') {
                    // Start Wizard - Build in temporary session memory first to prevent data loss on cancel
                    const tempTimetable = { sunday: [], monday: [], tuesday: [], wednesday: [], thursday: [], friday: [], saturday: [] };

                    updateSessionState(userId, 'TIMETABLE_WIZARD', { ...session.data, dayIndex: 0, tempTimetable });
                    await message.reply(
                        `🛠️ *TIMETABLE WIZARD INITIATED*\n\n` +
                        `We will build this day by day, starting with *SUNDAY*.\n\n` +
                        `Enter classes one at a time using this exact format:\n` +
                        `*Unit Name, Time* (e.g., Calculus, 08:00 AM)\n\n` +
                        `Type *NEXT* when you are done adding classes for the current day.\n` +
                        `Type *0* to abort wizard.`
                    );
                } else if (input === '3') {
                    //The Edit / Modify Timetable option
                    updateSessionState(userId, 'REP_EDIT_SELECT_DAY', session.data);
                    await message.reply(
                        `✏️ *MODIFY TIMETABLE*\n━━━━━━━━━━━━━━━━━━\n` +
                        `Which day do you want to edit?\n\n` +
                        `1. Monday\n2. Tuesday\n3. Wednesday\n4. Thursday\n5. Friday\n6. Saturday\n7. Sunday\n\n` +
                        `*Reply with a number (1-7):*\n(Type *0* to go back)`
                    );
                }
                break;
            }

            case 'REP_TIMETABLE_VIEW': {
                if (input === '0') {
                    updateSessionState(userId, 'REP_TIMETABLE_MENU', session.data);
                    await message.reply(`📅 *TIMETABLE MANAGEMENT*\n━━━━━━━━━━━━━━━━━━\n1. 👁️ View Current Timetable\n2. 🛠️ Run Timetable Wizard (Create new Timetable)\n3. Modify/Cancel Classes\n\n0. 🔙 Back to Dashboard`);
                }
                break;
            }

            case 'TIMETABLE_WIZARD': {
                if (input === '0') {
                    updateSessionState(userId, 'REP_TIMETABLE_MENU', session.data);
                    await message.reply(
                        `🛠️ *Wizard Aborted.* Your previous timetable remains safe and unchanged.\n\n` +
                        `📅 *TIMETABLE MANAGEMENT*\n` +
                        `1. View Current Timetable\n` +
                        `2. Re-run Timetable Wizard (Overwrite)\n` +
                        `3. Modify/Cancel Classes\n\n` +
                        `0. 🔙 Back to Dashboard`
                    );
                    return;
                }

                const daysList = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
                const currentDayStr = daysList[session.data.dayIndex];
                const tempTimetable = session.data.tempTimetable;

                if (input.toUpperCase() === 'NEXT' || input.toUpperCase() === 'DONE') {
                    if (session.data.dayIndex >= 6) {
                        const db = readClassDB();
                        db.classes[session.data.loggedInClass].timetable = tempTimetable;
                        writeClassDB(db);

                        updateSessionState(userId, 'REP_DASHBOARD', session.data);
                        await message.reply(`🎉 *TIMETABLE COMPLETED & SAVED!*\n\nAll 7 days have been configured successfully.`);
                        await sendRepDashboard(message, session.data.loggedInClass);
                    } else {
                        const nextDayIdx = session.data.dayIndex + 1;
                        updateSessionState(userId, 'TIMETABLE_WIZARD', { ...session.data, dayIndex: nextDayIdx });
                        await message.reply(`✅ *${currentDayStr.toUpperCase()}* saved to draft.\n\nMoving to 📅 *${daysList[nextDayIdx].toUpperCase()}*.\n\nEnter a class (*Unit, Time*) or type *NEXT* if there are no classes.`);
                    }
                    return;
                }

                if (!input.includes(',')) {
                    await message.reply(`❌ Invalid format.\n\nPlease use a comma to separate the unit and time.\nExample: *Programming, 10:00 AM*`);
                    return;
                }

                const [unit, timeStr] = input.split(',').map(s => s.trim());
                const startMins = timeToMinutes(timeStr);

                if (startMins === null) {
                    await message.reply(`❌ Invalid time format. Try again (e.g., *Programming, 10:00 AM* or *14:00*):`);
                    return;
                }

                // Default estimation of 3 hours (180 mins) per class slot
                const endMins = startMins + 180;

                const collisionCheck = checkCollision(tempTimetable[currentDayStr], startMins, endMins);
                if (collisionCheck && collisionCheck.collision) {
                    await message.reply(`❌ This time overlaps with *${collisionCheck.conflict.unit}* (${collisionCheck.conflict.startTime}–${collisionCheck.conflict.endTime}). Choose a time that does not overlap.`);
                    return;
                }

                tempTimetable[currentDayStr].push({
                    unit,
                    time: timeStr,
                    startTime: timeStr,
                    endTime: minutesToTime(endMins),
                    startMinutes: startMins,
                    endMinutes: endMins,
                    duration: 3
                });

                await message.reply(`✅ Added *${unit}* at *${timeStr}* on *${currentDayStr.toUpperCase()}* (Draft).\n\nEnter another class for ${currentDayStr.toUpperCase()}, or type *NEXT* to move to the next day.`);
                break;
            }

            case 'REP_EDIT_SELECT_DAY': {
                if (input === '0') {
                    // Back to the Timetable Menu
                    updateSessionState(userId, 'REP_TIMETABLE_MENU', session.data);
                    await message.reply(
                        `📅 *TIMETABLE MANAGEMENT*\n━━━━━━━━━━━━━━━━━━\n1. 👁️ View Current Timetable\n2. 🛠️ Run Timetable Wizard (Create new Timetable)\n3. Modify/Cancel Classes\n\n0. 🔙 Back to Dashboard`
                    );
                    return;
                }

                const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
                const dayIdx = parseInt(input) - 1;

                if (isNaN(dayIdx) || dayIdx < 0 || dayIdx > 6) {
                    await message.reply(`❌ Invalid choice. Reply 1-7 for the day of the week, or 0 to go back.`);
                    return;
                }

                const selectedDay = days[dayIdx];
                const daySchedule = db.classes[session.data.loggedInClass].timetable?.[selectedDay.toLowerCase()] || [];

                if (daySchedule.length === 0) {
                    await message.reply(`📭 No classes scheduled for ${selectedDay}. Reply 0 to go back.`);
                    return;
                }

                let msg = `📅 *${selectedDay.toUpperCase()} CLASSES*\n\nWhich class do you want to modify?\n`;
                daySchedule.forEach((cls, i) => {
                    msg += `${i + 1}. *${cls.unit}* (${cls.time})\n`;
                });
                msg += `\n0. 🔙 Back`;

                updateSessionState(userId, 'REP_EDIT_SELECT_CLASS', { ...session.data, editDay: selectedDay, daySchedule });
                await message.reply(msg);
                break;
            }

            // 2. SELECT CLASS & ACTION
            case 'REP_EDIT_SELECT_CLASS': {
                if (input === '0') { 
                    updateSessionState(userId, 'REP_EDIT_SELECT_DAY', session.data); 
                    await message.reply(`✏️ *MODIFY TIMETABLE*\n━━━━━━━━━━━━━━━━━━\nWhich day do you want to edit?\n\n1. Monday\n2. Tuesday\n3. Wednesday\n4. Thursday\n5. Friday\n6. Saturday\n7. Sunday\n\n*Reply with a number (1-7):*\n0. 🔙 Back`);
                    return; 
                }
                
                const classIdx = parseInt(input) - 1;
                const targetClass = session.data.daySchedule[classIdx];

                if (!targetClass) {
                    await message.reply(`❌ Invalid selection.`);
                    return;
                }

                updateSessionState(userId, 'REP_EDIT_ACTION', { ...session.data, targetClass, classIdx });
                await message.reply(`🛠️ *MODIFYING: ${targetClass.unit}*\n\nWhat is happening to this class?\n1. 🛑 Cancelled / Bounced\n2. ⏳ Postponed / Moved to new time\n\n0. 🔙 Cancel`);
                break;
            }

            // 3. HANDLE CANCEL OR POSTPONE ROUTING
            case 'REP_EDIT_ACTION': {
                    if (input === '0') { 
                        updateSessionState(userId, 'REP_EDIT_SELECT_CLASS', session.data); 
                        let msg = `📅 *${session.data.editDay.toUpperCase()} CLASSES*\n\nWhich class do you want to modify?\n`;
                        session.data.daySchedule.forEach((cls, i) => {
                            msg += `${i + 1}. *${cls.unit}* (${cls.startTime} - ${cls.endTime})\n`;
                        });
                        msg += `\n0. 🔙 Back`;
                        await message.reply(msg);
                        return; 
                    }

                if (input === '1') {
                    // It's a cancellation
                    updateSessionState(userId, 'REP_EDIT_SCOPE', { ...session.data, editType: 'CANCEL' });
                    await message.reply(`🛑 *CANCELLING CLASS*\nIs this permanent, or just for this week?\n1. 🗓️ Temporary (Just this week)\n2. ⚠️ Permanent (Remove from timetable forever)`);
                } else if (input === '2') {
                    // It's a move - Ask for target day first (Cross-day support)
                    updateSessionState(userId, 'REP_EDIT_NEW_DAY', { ...session.data, editType: 'MOVE' });
                    await message.reply(`⏳ *MOVING CLASS*\nWhich day is it moving to?\n1. Mon  2. Tue  3. Wed  4. Thu  5. Fri  6. Sat  7. Sun`);
                }
                break;
            }

            // (Skipping intermediate MOVE input states for brevity: REP_EDIT_NEW_DAY -> REP_EDIT_NEW_TIME -> REP_EDIT_NEW_DURATION)

            // 4. THE EXECUTION ENGINE (Applying the Math & DB Save)
            case 'REP_EDIT_SCOPE': {
                if (input === '0') {
                    updateSessionState(userId, 'REP_EDIT_ACTION', session.data);
                    await message.reply(`🛠️ *MODIFYING: ${session.data.targetClass.unit}*\n\nWhat is happening to this class?\n1. 🛑 Cancelled / Bounced\n2. ⏳ Postponed / Moved to new time\n\n0. 🔙 Back`);
                    return;
                }

                const isTemp = input === '1';
                const db = readClassDB();
                const classData = db.classes[session.data.loggedInClass];
                const target = session.data.targetClass;
                
                if (!classData.exceptions) classData.exceptions = {};

                // Get exactly today's date in EAT (Mombasa time) for Temporary tracking
                const todayEAT = new Date(new Date().toLocaleString("en-US", {timeZone: "Africa/Nairobi"}));
                const dateKey = todayEAT.toISOString().split('T')[0]; 

                if (session.data.editType === 'CANCEL') {
                    if (isTemp) {
                        if (!classData.exceptions[dateKey]) classData.exceptions[dateKey] = {};
                        classData.exceptions[dateKey][target.unit] = { status: 'CANCELLED' };
                        await message.reply(`✅ *TEMPORARY EXCEPTION ADDED*\n${target.unit} is cancelled for this week only. Alerts are disabled for today.`);
                    } else {
                        // Permanent: Delete from array
                        classData.timetable[session.data.editDay].splice(session.data.classIdx, 1);
                        await message.reply(`✅ *PERMANENT DELETION*\n${target.unit} has been permanently removed from ${session.data.editDay}.`);
                    }
                } 
                // [Logic for MOVE goes here, utilizing the Phase 1 collision check before saving]

                writeClassDB(db);
                updateSessionState(userId, 'REP_DASHBOARD', session.data);
                break;
            }

            // --- THE POSTPONE / MOVE ENGINE ---

            case 'REP_EDIT_NEW_DAY': {
                if (input === '0') {
                    updateSessionState(userId, 'REP_EDIT_ACTION', session.data);
                    await message.reply(`🛠️ *MODIFYING: ${session.data.targetClass.unit}*\n\nWhat is happening to this class?\n1. 🛑 Cancelled / Bounced\n2. ⏳ Postponed / Moved to new time\n\n0. 🔙 Back`);
                    return;
                }

                const daysMap = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
                const dayIdx = parseInt(input) - 1;
                
                if (isNaN(dayIdx) || dayIdx < 0 || dayIdx > 6) {
                    await message.reply(`❌ Invalid choice. Reply 1-7 for the day of the week.`);
                    return;
                }
                
                updateSessionState(userId, 'REP_EDIT_NEW_TIME', { ...session.data, newDay: daysMap[dayIdx] });
                await message.reply(`🕒 What is the *NEW Start Time* for this class?\n(e.g., 02:00 PM, 14:00)`);
                break;
            }

            case 'REP_EDIT_NEW_TIME': {
                if (input === '0') {
                    updateSessionState(userId, 'REP_EDIT_NEW_DAY', session.data);
                    await message.reply(`⏳ *MOVING CLASS*\nWhich day is it moving to?\n1. Mon  2. Tue  3. Wed  4. Thu  5. Fri  6. Sat  7. Sun\n\n0. 🔙 Back`);
                    return;
                }

                const startMins = timeToMinutes(input);
                if (startMins === null) {
                    await message.reply(`❌ Invalid time format. Try again (e.g., 02:00 PM):`);
                    return;
                }
                
                updateSessionState(userId, 'REP_EDIT_NEW_DURATION', { ...session.data, newStartMins: startMins, newStartTimeStr: input });
                await message.reply(`⏳ What is the *duration* in hours?\n(Reply with a number, e.g., 2 or 3)`);
                break;
            }

            case 'REP_EDIT_NEW_DURATION': {
                if (input === '0') {
                    updateSessionState(userId, 'REP_EDIT_NEW_TIME', session.data);
                    await message.reply(`🕒 What is the *NEW Start Time* for this class?\n(e.g., 02:00 PM, 14:00)\n\n0. 🔙 Back`);
                    return;
                }

                const duration = parseFloat(input);
                if (isNaN(duration) || duration <= 0) {
                    await message.reply(`❌ Invalid duration. Try again (e.g., 3):`);
                    return;
                }
                
                const newStartMins = session.data.newStartMins;
                const newEndMins = newStartMins + (duration * 60);
                const newDay = session.data.newDay;
                const targetClass = session.data.targetClass;
                
                const db = readClassDB();
                const daySchedule = db.classes[session.data.loggedInClass].timetable?.[newDay] || [];
                
                // 🛑 COLLISION CHECK 
                // (If moving on the same day, ignore the original class to prevent it from colliding with itself)
                const ignoreName = (newDay.toLowerCase() === session.data.editDay.toLowerCase()) ? targetClass.unit : null;
                const collisionCheck = checkCollision(daySchedule, newStartMins, newEndMins, ignoreName);
                
                if (collisionCheck.collision) {
                    const conflict = collisionCheck.conflict;
                    await message.reply(`🚨 *SCHEDULE CONFLICT!*\n\nMoving to ${newDay.toUpperCase()} at ${minutesToTime(newStartMins)} overlaps with *${conflict.unit}* (${conflict.startTime} - ${conflict.endTime}).\n\nPlease enter a different start time:`);
                    updateSessionState(userId, 'REP_EDIT_NEW_TIME', session.data); // Backtrack to time
                    return;
                }
                
                updateSessionState(userId, 'REP_EDIT_MOVE_SCOPE', { ...session.data, newEndMins, newDuration: duration });
                await message.reply(`✅ *TIME AVAILABLE*\n\nIs this move permanent or just for this week?\n1. 🗓️ Temporary (Just this week)\n2. ⚠️ Permanent (Forever)`);
                break;
            }

            case 'REP_EDIT_MOVE_SCOPE': {
                if (input === '0') {
                    updateSessionState(userId, 'REP_EDIT_NEW_DURATION', session.data);
                    await message.reply(`⏳ What is the *duration* in hours?\n(Reply with a number, e.g., 2 or 3)\n\n0. 🔙 Back`);
                    return;
                }

                const isTemp = input === '1';
                const db = readClassDB();
                const classData = db.classes[session.data.loggedInClass];
                const target = session.data.targetClass;
                const { editDay, classIdx, newDay, newStartMins, newEndMins, newDuration } = session.data;
                
                const newStartTimeStr = minutesToTime(newStartMins);
                const newEndTimeStr = minutesToTime(newEndMins);

                // Mombasa Base Date Math
                const todayEAT = new Date(new Date().toLocaleString("en-US", {timeZone: "Africa/Nairobi"}));
                
                if (isTemp) {
                    if (!classData.exceptions) classData.exceptions = {};
                    
                    // 1. Cancel the original class for TODAY
                    const dateKey = todayEAT.toISOString().split('T')[0]; 
                    if (!classData.exceptions[dateKey]) classData.exceptions[dateKey] = {};
                    classData.exceptions[dateKey][target.unit] = { status: 'CANCELLED' };

                    // 2. Calculate the future date of the Make-up class
                    const daysMap = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
                    const currentDayIdx = todayEAT.getDay(); 
                    const targetDayIdx = daysMap.indexOf(newDay.toLowerCase());
                    
                    let daysAhead = targetDayIdx - currentDayIdx;
                    if (daysAhead < 0) daysAhead += 7; // If target day passed, it means next week
                    
                    const targetDate = new Date(todayEAT);
                    targetDate.setDate(todayEAT.getDate() + daysAhead); // JS handles month-wrapping automatically
                    const targetDateKey = targetDate.toISOString().split('T')[0];

                    // 3. Inject the "Ghost Class" into that future date
                    if (!classData.exceptions[targetDateKey]) classData.exceptions[targetDateKey] = {};
                    classData.exceptions[targetDateKey][target.unit + "_TEMP"] = {
                        status: 'MOVED',
                        unit: target.unit + ' (Makeup Class)',
                        startTime: newStartTimeStr,
                        endTime: newEndTimeStr,
                        startMinutes: newStartMins,
                        endMinutes: newEndMins
                    };

                    await message.reply(`✅ *TEMPORARY MOVE SAVED*\n\n${target.unit} is cancelled for today.\nA makeup class is scheduled for *${newDay.toUpperCase()}* (${targetDateKey}) at ${newStartTimeStr}.`);
                } else {
                    // PERMANENT MOVE
                    const oldDayLower = editDay.toLowerCase();
                    
                    // 1. Delete from old day
                    classData.timetable[oldDayLower].splice(classIdx, 1);
                    
                    // 2. Inject into new day
                    if (!classData.timetable[newDay]) classData.timetable[newDay] = [];
                    classData.timetable[newDay].push({
                        unit: target.unit,
                        startTime: newStartTimeStr,
                        endTime: newEndTimeStr,
                        startMinutes: newStartMins,
                        endMinutes: newEndMins,
                        duration: newDuration
                    });
                    
                    // 3. Sort chronologically so morning classes are first
                    classData.timetable[newDay].sort((a, b) => a.startMinutes - b.startMinutes);
                    
                    await message.reply(`✅ *PERMANENT MOVE SAVED*\n\n${target.unit} has been permanently moved to *${newDay.toUpperCase()}* at ${newStartTimeStr}.`);
                }

                writeClassDB(db);
                updateSessionState(userId, 'REP_DASHBOARD', session.data);
                await sendRepDashboard(message, session.data.loggedInClass);
                break;
            }

            case 'REP_UPDATES_MENU': {
                if (input === '0') {
                    updateSessionState(userId, 'REP_DASHBOARD', session.data);
                    await sendRepDashboard(message, session.data.loggedInClass);
                    return;
                }
                
                if (input === '1') {
                    const ONE_DAY = 24 * 60 * 60 * 1000;
                    const now = Date.now();
                    
                    // Filter out updates older than 24 hours (and safely handle any old updates missing a timestamp)
                    db.classes[session.data.loggedInClass].updates = db.classes[session.data.loggedInClass].updates.filter(u => u.timestamp && (now - u.timestamp < ONE_DAY));
                    writeClassDB(db);

                    const updates = db.classes[session.data.loggedInClass].updates;
                    if (updates.length === 0) {
                        await message.reply(`📭 No active updates from the last 24 hours.\n(Type *0* to go back)`);
                        return;
                    }
                    
                    let upStr = `📢 *24H CLASS UPDATES*\n━━━━━━━━━━━━━━━━━━\n\n`;
                    updates.forEach((u, i) => {
                        const dateObj = new Date(u.timestamp);
                        const timeString = dateObj.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Nairobi' });
                        
                        if (i === updates.length - 1) {
                            upStr += `🚨 *LATEST UPDATE [${timeString}]*\n*${u.text}*\n\n`;
                        } else {
                            upStr += `▪️ [${timeString}]\n${u.text}\n\n`;
                        }
                    });
                    await message.reply(upStr + `(Type *0* to go back)`);
                    
                } else if (input === '2') {
                    updateSessionState(userId, 'REP_ADD_UPDATE', session.data);
                    await message.reply(`✍️ *POST NEW UPDATE*\n\nType your announcement below.\nIt will be timestamped automatically.\n\n(Type *0* to cancel)`);
                    
                } else if (input === '3') {
                    db.classes[session.data.loggedInClass].updates = [];
                    writeClassDB(db);
                    await message.reply(`🗑️ Updates history cleared.\n(Type *0* to go back)`);
                } else if (input === '4') {
                const ONE_DAY = 24 * 60 * 60 * 1000;
                const now = Date.now();
                
                // Filter out old updates first
                db.classes[session.data.loggedInClass].updates = db.classes[session.data.loggedInClass].updates.filter(u => u.timestamp && (now - u.timestamp < ONE_DAY));
                writeClassDB(db);

                const updates = db.classes[session.data.loggedInClass].updates;
                if (updates.length === 0) {
                    await message.reply(`📭 No active updates available to remind.\n(Type *0* to go back)`);
                    return;
                }

                let remStr = `🔔 *SELECT UPDATE TO REMIND*\n━━━━━━━━━━━━━━━━━━\n\n`;
                updates.forEach((u, i) => {
                    const dateObj = new Date(u.timestamp);
                    const timeString = dateObj.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Nairobi' });
                    remStr += `${i + 1}. [${timeString}]\n${u.text}\n\n`;
                });
                remStr += `*Reply with the number of the update to broadcast:*\n(Type *0* to cancel)`;

                updateSessionState(userId, 'REP_REMIND_UPDATE_SELECT', session.data);
                await message.reply(remStr);
            }
                break;
            }

            case 'REP_REMIND_UPDATE_SELECT': {
                if (input === '0') {
                    updateSessionState(userId, 'REP_UPDATES_MENU', session.data);
                    await message.reply(`📢 *UPDATES MANAGEMENT*\n━━━━━━━━━━━━━━━━━━\n1. 👁️ View Updates\n2. ✍️ Post New Update\n3. 🗑️ Clear All Updates\n4. 🔔 Remind Update\n\n0. 🔙 Back`);
                    return;
                }

                const updates = db.classes[session.data.loggedInClass].updates;
                const selectedIdx = parseInt(input) - 1;

                if (isNaN(selectedIdx) || selectedIdx < 0 || selectedIdx >= updates.length) {
                    await message.reply(`❌ Invalid selection. Reply with a valid number.`);
                    return;
                }

                const targetUpdate = updates[selectedIdx].text;
                
                // Initiate DM Blast
                const members = db.classes[session.data.loggedInClass].members;
                const memberIds = Object.keys(members);
                let blastStatus = "";

                if (memberIds.length > 0) {
                    await message.reply(`🚀 *BROADCASTING REMINDER*\n\nSending direct messages to ${memberIds.length} registered students...\n\nPlease wait a moment.`);

                    let sentCount = 0;
                    let failedCount = 0;
                    let successList = "";
                    let failList = "";

                    for (let mId of memberIds) {
                        const student = members[mId];
                        try {
                            await client.sendMessage(
                                student.phoneId,
                                `🔔 *REMINDER: CLASS ANNOUNCEMENT*\n\n🏫 Class: *${session.data.loggedInClass}*\n👑 Rep: *${db.classes[session.data.loggedInClass].repName}*\n\n${targetUpdate}\n\n_(This is a reminder of an active update)_`
                            );
                            sentCount++;
                            successList += `▪️ ${student.name} (${student.admission})\n`;
                        } catch (e) {
                            console.warn(`[CLASS PORTAL] Could not send reminder DM to ${student.name}`);
                            failedCount++;
                            failList += `▪️ ${student.name} (${student.admission})\n`;
                        }
                    }

                    blastStatus = `✅ *REMINDER BLAST COMPLETE*\n🟢 Delivered: ${sentCount}\n🔴 Failed: ${failedCount}\n\n`;

                    if (sentCount > 0) {
                        blastStatus += `*✅ DELIVERED TO:*\n${successList}\n`;
                    }
                    if (failedCount > 0) {
                        blastStatus += `*❌ FAILED TO DELIVER:*\n${failList}\n`;
                    }

                } else {
                    blastStatus = `⚠️ *NO BROADCAST*\nNo students are currently registered to receive this reminder.\n\n`;
                }

                updateSessionState(userId, 'REP_UPDATES_MENU', session.data);
                await message.reply(`${blastStatus}✅ *Reminder Processed!*\n\n1. 👁️ View Updates\n2. ✍️ Post New Update\n3. 🗑️ Clear All Updates\n4. 🔔 Remind Update\n\n0. 🔙 Back`);
                break;
            }

            case 'REP_ADD_UPDATE': {
                if (input === '0') {
                    updateSessionState(userId, 'REP_UPDATES_MENU', session.data);
                    await message.reply(`📢 *UPDATES MANAGEMENT*\n━━━━━━━━━━━━━━━━━━\n1. 👁️ View Updates\n2. ✍️ Post New Update\n3. 🗑️ Clear All Updates\n4. 🔔 Remind Update\n\n0. 🔙 Back to Dashboard`);
                    return;
                }
                
                // Save the new update
                db.classes[session.data.loggedInClass].updates.push({
                    text: input,
                    timestamp: Date.now()
                });
                writeClassDB(db);
                
                // Initiate DM Blast to all students
                const members = db.classes[session.data.loggedInClass].members;
                const memberIds = Object.keys(members);
                
                if (memberIds.length > 0) {
                    await message.reply(`🚀 *BROADCASTING UPDATE*\n\nSending direct messages to ${memberIds.length} registered students...\n\nPlease wait a moment.`);
                    
                    let sentCount = 0;
                    for (let mId of memberIds) {
                        const student = members[mId];
                        try {
                            await client.sendMessage(
                                student.phoneId, 
                                `📢 *URGENT CLASS ANNOUNCEMENT*\n\n🏫 Class: *${session.data.loggedInClass}*\n👑 Rep: *${db.classes[session.data.loggedInClass].repName}*\n\n${input}\n\n_(This update will disappear from your portal in 24 hours)_`
                            );
                            sentCount++;
                        } catch (e) {
                            console.warn(`[CLASS PORTAL] Could not send update DM to ${student.name}`);
                        }
                    }
                    await message.reply(`✅ *BLAST COMPLETE*\n\nSuccessfully sent the update to ${sentCount} students.`);
                }
                
                updateSessionState(userId, 'REP_UPDATES_MENU', session.data);
                await message.reply(`✅ *Update Posted & Saved!*\n\n1. 👁️ View Updates\n2. ✍️ Post New Update\n3. 🗑️ Clear All Updates\n4. 🔔 Remind Update\n\n0. 🔙 Back`);
                break;
            }

            // ==========================================
            // PHASE 5: REP MEMBERS & ISSUES MANAGEMENT
            // ==========================================
            case 'REP_MEMBERS_MENU': {
                if (input === '0') {
                    updateSessionState(userId, 'REP_DASHBOARD', session.data);
                    await sendRepDashboard(message, session.data.loggedInClass);
                    return;
                }
                const classData = db.classes[session.data.loggedInClass];
                const members = getAllClassParticipants(classData);
                const mIds = getSortedMemberIds(classData);
                const ghostListOption = session.data.isMainRep ? '5' : '3';
                const historyOption = session.data.isMainRep ? '6' : '4';

                if (input === '1') {
                    if (mIds.length === 0) {
                        await message.reply(`📭 No participants registered yet.\n(Type *0* to go back)`);
                        return;
                    }
                    let mList = `👥 *REGISTERED PARTICIPANTS (${mIds.length})*\n━━━━━━━━━━━━━━━━━━\n`;
                    mIds.forEach((id, idx) => {
                        const m = members[id];
                        const isRep = m.phoneId === classData.repId || m.isRep;
                        const isAsst = classData.assistantReps?.includes(m.phoneId);
                        
                        let badge = '';
                        if (isRep) badge = ' 👑 *[Class Rep]*';
                        else if (isAsst) badge = ' ⭐ *[Asst Rep]*';

                        mList += `${idx + 1}. ${m.name.toUpperCase()} (${m.admission.toUpperCase()})${badge}\n`;
                    });
                    await message.reply(mList + `\n(Type *0* to go back)`);
                } else if (input === '2') {
                    if (mIds.length === 0) {
                        await message.reply(`📭 No students to remove.\n(Type *0* to go back)`);
                        return;
                    }
                    let mList = `🗑️ *REMOVE A STUDENT*\n━━━━━━━━━━━━━━━━━━\n`;
                    mIds.forEach((id, idx) => {
                        mList += `${idx + 1}. ${members[id].name.toUpperCase()} (${members[id].admission.toUpperCase()})\n`;
                    });
                    mList += `\n*Reply with the number to REMOVE them:*\n(Type *0* to cancel)`;
                    updateSessionState(userId, 'REP_MEMBERS_REMOVE', { ...session.data, memberIds: mIds });
                    await message.reply(mList);
                } else if (input === '3' && session.data.isMainRep) {
                    if (mIds.length === 0) {
                        await message.reply(`📭 No registered students to promote.\n(Type *0* to go back)`);
                        return;
                    }
                    let mList = `🎖️ *PROMOTE TO ASSISTANT*\n━━━━━━━━━━━━━━━━━━\n`;
                    mIds.forEach((id, idx) => {
                        const isAsst = db.classes[session.data.loggedInClass].assistantReps?.includes(members[id].phoneId);
                        mList += `${idx + 1}. ${members[id].name.toUpperCase()} (${members[id].admission.toUpperCase()}) ${isAsst ? '⭐ *(Already Asst)*' : ''}\n`;
                    });
                    mList += `\n*Reply with the number to PROMOTE them:*\n(Type *0* to cancel)`;
                    updateSessionState(userId, 'REP_MEMBERS_PROMOTE', { ...session.data, memberIds: mIds });
                    await message.reply(mList);
                } else if (input === '4' && session.data.isMainRep) {
                    const assistants = db.classes[session.data.loggedInClass].assistantReps || [];
                    if (assistants.length === 0) {
                        await message.reply(`📭 You do not have any active Assistant Reps to revoke.\n(Type *0* to go back)`);
                        return;
                    }
                    let mList = `🔻 *REVOKE ASSISTANT*\n━━━━━━━━━━━━━━━━━━\n`;
                    const asstIds = mIds.filter(id => assistants.includes(members[id].phoneId));
                    asstIds.forEach((id, idx) => {
                        mList += `${idx + 1}. ${members[id].name.toUpperCase()} (${members[id].admission.toUpperCase()})\n`;
                    });
                    mList += `\n*Reply with the number to REVOKE them:*\n(Type *0* to cancel)`;
                    updateSessionState(userId, 'REP_MEMBERS_REVOKE', { ...session.data, asstIds });
                    await message.reply(mList);
                } else if (input === ghostListOption) {
                    // 👻 THE GHOST TRACKER
                    if (mIds.length === 0) {
                        await message.reply(`📭 No students to track.\n(Type *0* to go back)`);
                        return;
                    }
                    
                    const classData = db.classes[session.data.loggedInClass];
                    const totalSessions = classData.totalRollCalls || 0;
                    if (totalSessions === 0) {
                        await message.reply(`⚠️ You haven't run any Roll Calls yet!\n\n(Type *0* to go back)`);
                        return;
                    }

                    let ghostStr = `👻 *THE GHOST LIST (ATTENDANCE)* 👻\nTotal Sessions: ${totalSessions}\n━━━━━━━━━━━━━━━━━━\n`;
                    
                    // Sort students by lowest attendance first
                    const sortedStudents = mIds.map(id => members[id]).sort((a, b) => (a.attendedClasses || 0) - (b.attendedClasses || 0));
                    
                    sortedStudents.forEach(m => {
                        const attended = m.attendedClasses || 0;
                        const percentage = Math.round((attended / totalSessions) * 100);
                        const icon = percentage < 50 ? '🚨' : (percentage < 75 ? '⚠️' : '✅');
                        ghostStr += `${icon} *${m.name.toUpperCase()}*: ${attended}/${totalSessions} (${percentage}%)\n`;
                    });

                    await message.reply(ghostStr + `\n(Type *0* to go back)`);
                } else if (input === historyOption) {
                    const view = buildAttendanceHistoryView(classData, null);
                    updateSessionState(userId, 'REP_ATTENDANCE_HISTORY', {
                        ...session.data,
                        attendanceHistoryRecordIds: view.choices.map(choice => choice.id),
                        attendanceHistoryFilter: null
                    });
                    await message.reply(view.text);
                }
                break;
            }

          case 'REP_ATTENDANCE_HISTORY': {
              const className = session.data.loggedInClass;
              const classData = db.classes?.[className];
              if (!classData) {
                  await message.reply('❌ The selected class could not be found. Type !class to reopen the portal.');
                  endSession(userId);
                  return;
              }

              if (input === '0') {
                  updateSessionState(userId, 'REP_MEMBERS_MENU', session.data);
                  await sendRepMembersMenu(message, session.data.isMainRep);
                  return;
              }

              const filterInput = normalizeAttendanceFilterInput(input);
              if (filterInput) {
                  const filter = filterInput.clear ? null : { type: filterInput.type, value: filterInput.value };
                  const view = buildAttendanceHistoryView(classData, filter);
                  updateSessionState(userId, 'REP_ATTENDANCE_HISTORY', {
                      ...session.data,
                      attendanceHistoryFilter: filter,
                      attendanceHistoryRecordIds: view.choices.map(choice => choice.id)
                  });
                  await message.reply(view.text);
                  return;
              }
              if (/^filter\b/i.test(input) || input.toLowerCase() === 'clear') {
                  await message.reply('❌ Use filter unit <text>, filter date YYYY-MM-DD, filter student <name>, or clear.');
                  return;
              }

              const selected = Number(input);
              const recordIds = session.data.attendanceHistoryRecordIds || [];
              if (!Number.isInteger(selected) || selected < 1 || selected > recordIds.length) {
                  await message.reply('❌ Choose a number from the attendance history list, or use a filter command.');
                  return;
              }
              const view = buildAttendanceHistoryView(classData, session.data.attendanceHistoryFilter || null);
              const choice = view.choices[selected - 1];
              if (!choice || choice.id !== recordIds[selected - 1]) {
                  updateSessionState(userId, 'REP_ATTENDANCE_HISTORY', {
                      ...session.data,
                      attendanceHistoryRecordIds: view.choices.map(item => item.id)
                  });
                  await message.reply(view.text + '\n\nThe history changed; choose a number from this refreshed list.');
                  return;
              }

              updateSessionState(userId, 'REP_ATTENDANCE_DETAIL', {
                  ...session.data,
                  attendanceRecordId: choice.id
              });
              await message.reply(buildAttendanceDetailView(choice.record));
              return;
          }

          case 'REP_ATTENDANCE_DETAIL': {
              const className = session.data.loggedInClass;
              const classData = db.classes?.[className];
              if (!classData) {
                  await message.reply('❌ The selected class could not be found. Type !class to reopen the portal.');
                  endSession(userId);
                  return;
              }
              const history = Array.isArray(classData.attendanceHistory) ? classData.attendanceHistory : [];
              const record = history.find((item, index) =>
                  (item.id || ('legacy_' + (item.closedAt || item.dateKey || index) + '_' + String(item.unit || 'class'))) === session.data.attendanceRecordId
              );
              if (!record) {
                  updateSessionState(userId, 'REP_ATTENDANCE_HISTORY', session.data);
                  await message.reply('📭 That archived register is no longer available.');
                  return;
              }

              if (input === '0') {
                  const view = buildAttendanceHistoryView(classData, session.data.attendanceHistoryFilter || null);
                  updateSessionState(userId, 'REP_ATTENDANCE_HISTORY', {
                      ...session.data,
                      attendanceHistoryRecordIds: view.choices.map(choice => choice.id)
                  });
                  await message.reply(view.text);
                  return;
              }

              let nextStatus;
              let memberNumber;
              let reason;
              const statusCorrection = input.match(/^correct\s+(\d+)\s+(present|absent|late|excused)\s+(.+)$/i);
              const markCorrection = input.match(/^(late|excused)\s+(\d+)\s+(.+)$/i);
              if (statusCorrection) {
                  memberNumber = Number(statusCorrection[1]);
                  nextStatus = statusCorrection[2].toUpperCase();
                  reason = statusCorrection[3].trim();
              } else if (markCorrection) {
                  memberNumber = Number(markCorrection[2]);
                  nextStatus = markCorrection[1].toUpperCase();
                  reason = markCorrection[3].trim();
              } else {
                  await message.reply('❌ Use late <number> <reason>, excused <number> <reason>, or correct <number> present|absent|late|excused <reason>.');
                  return;
              }

              if (reason.length < 3 || reason.length > 240) {
                  await message.reply('❌ Add a clear reason of 3–240 characters.');
                  return;
              }

              const result = updateAttendanceCorrection(
                  classData,
                  record,
                  memberNumber - 1,
                  nextStatus,
                  reason,
                  session.data.repName || session.data.currentUserName || userId
              );
              if (result.error) {
                  await message.reply('❌ ' + result.error);
                  return;
              }
              writeClassDB(db);
              await message.reply(
                  '✅ Updated ' + result.student.name + ': ' + result.previousStatus + ' → ' + nextStatus
                  + '. Reason recorded for audit.\n\n' + buildAttendanceDetailView(record)
              );
              return;
          }

          case 'REP_MEMBERS_REMOVE': {
              if (input === '0') {
                  updateSessionState(userId, 'REP_MEMBERS_MENU', session.data);
                  await sendRepMembersMenu(message, session.data.isMainRep);
                  return;
              }
              const selectedIdx = parseInt(input) - 1;
              const mIds = session.data.memberIds;
              
              if (isNaN(selectedIdx) || selectedIdx < 0 || selectedIdx >= mIds.length) {
                  await message.reply(`❌ Invalid selection. Reply with a valid number.`);
                  return;
              }
              
              const targetId = mIds[selectedIdx];
              const targetName = db.classes[session.data.loggedInClass].members[targetId].name;
              
              // Delete member
              delete db.classes[session.data.loggedInClass].members[targetId];
              // Log it
              db.classes[session.data.loggedInClass].logs.push({
                  text: `Removed Member: ${targetName}`,
                  timestamp: Date.now()
              });
              writeClassDB(db);

              updateSessionState(userId, 'REP_MEMBERS_MENU', session.data);
              await message.reply(`✅ *${targetName}* has been removed from the class.`);
              await sendRepMembersMenu(message, session.data.isMainRep);
              break;
          }

          case 'REP_MEMBERS_PROMOTE': {
            if (input === '0') {
                updateSessionState(userId, 'REP_MEMBERS_MENU', session.data);
                await sendRepMembersMenu(message, session.data.isMainRep);
                return;
            }
            const selectedIdx = parseInt(input) - 1;
            const mIds = session.data.memberIds;
            
            if (isNaN(selectedIdx) || selectedIdx < 0 || selectedIdx >= mIds.length) {
                await message.reply(`❌ Invalid selection. Reply with a valid number.`);
                return;
            }
            
            const targetId = mIds[selectedIdx];
            const targetStudent = db.classes[session.data.loggedInClass].members[targetId];
            
            if (!db.classes[session.data.loggedInClass].assistantReps) {
                db.classes[session.data.loggedInClass].assistantReps = [];
            }
            
            if (db.classes[session.data.loggedInClass].assistantReps.includes(targetStudent.phoneId)) {
                await message.reply(`⚠️ *${targetStudent.name}* is already an Assistant Rep!\n\n(Type *0* to go back)`);
                return;
            }
            
            db.classes[session.data.loggedInClass].assistantReps.push(targetStudent.phoneId);
            db.classes[session.data.loggedInClass].logs.push({ 
                text: `Promoted Assistant: ${targetStudent.name}`, 
                timestamp: Date.now() 
            });
            writeClassDB(db);

            updateSessionState(userId, 'REP_MEMBERS_MENU', session.data);
            await message.reply(`✅ *${targetStudent.name}* has been promoted to Assistant Rep!`);
            await sendRepMembersMenu(message, session.data.isMainRep);
            break;
        }

        case 'REP_MEMBERS_REVOKE': {
            if (input === '0') {
                updateSessionState(userId, 'REP_MEMBERS_MENU', session.data);
                await sendRepMembersMenu(message, session.data.isMainRep);
                return;
            }
            const selectedIdx = parseInt(input) - 1;
            const asstIds = session.data.asstIds;
            
            if (isNaN(selectedIdx) || selectedIdx < 0 || selectedIdx >= asstIds.length) {
                await message.reply(`❌ Invalid selection. Reply with a valid number.`);
                return;
            }
            
            const targetId = asstIds[selectedIdx];
            const targetStudent = db.classes[session.data.loggedInClass].members[targetId];
            
            let assistants = db.classes[session.data.loggedInClass].assistantReps || [];
            db.classes[session.data.loggedInClass].assistantReps = assistants.filter(phone => phone !== targetStudent.phoneId);
            
            db.classes[session.data.loggedInClass].logs.push({ 
                text: `Revoked Assistant: ${targetStudent.name}`, 
                timestamp: Date.now() 
            });
            writeClassDB(db);

            updateSessionState(userId, 'REP_MEMBERS_MENU', session.data);
            await message.reply(`✅ *${targetStudent.name}* has been demoted back to a regular student.`);
            await sendRepMembersMenu(message, session.data.isMainRep);
            break;
        }

        // ==========================================
            // PHASE 8: THE WHISPER PROTOCOL (REP SIDE)
            // ==========================================
            case 'REP_WHISPER_MENU': {
                if (input === '0') {
                    updateSessionState(userId, 'REP_DASHBOARD', session.data);
                    await sendRepDashboard(message, session.data.loggedInClass);
                    return;
                }
                
                let whispers = db.classes[session.data.loggedInClass].whispers || [];

                if (input === '1') {
                    const unread = whispers.filter(w => !w.replied);
                    if (unread.length === 0) {
                        await message.reply(`📭 Inbox empty. No unread whispers.\n\n(Type *0* to go back)`);
                        return;
                    }
                    
                    let wStr = `📥 *UNREAD WHISPERS*\n━━━━━━━━━━━━━━━━━━\n\n`;
                    unread.forEach((w, i) => {
                        const dObj = new Date(w.timestamp);
                        const tStr = dObj.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Nairobi' });
                        wStr += `*ID: [${w.hash}]* (${tStr})\n"${w.text}"\n\n`;
                    });
                    await message.reply(wStr + `To reply, go back and select option 2.\n\n(Type *0* to go back)`);
                
                } else if (input === '2') {
                    updateSessionState(userId, 'REP_WHISPER_SELECT', session.data);
                    await message.reply(`✍️ *REPLY TO A WHISPER*\n\nEnter the exact Hash ID of the whisper you want to reply to (e.g., Ghost-8F2A):\n\n(Type *0* to cancel)`);
                
                } else if (input === '3') {
                    db.classes[session.data.loggedInClass].whispers = [];
                    writeClassDB(db);
                    await message.reply(`🗑️ Inbox wiped clean.\n\n(Type *0* to go back)`);
                }
                break;
            }

            case 'REP_WHISPER_SELECT': {
                if (input === '0') {
                    updateSessionState(userId, 'REP_WHISPER_MENU', session.data);
                    await message.reply(`Returning to Inbox...`);
                    return;
                }
                
                const whispers = db.classes[session.data.loggedInClass].whispers || [];
                const targetIdx = whispers.findIndex(w => w.hash.toLowerCase() === input.trim().toLowerCase());
                
                if (targetIdx === -1) {
                    await message.reply(`❌ Hash ID not found. Make sure you typed it correctly.\n\nTry again or type *0* to cancel:`);
                    return;
                }

                updateSessionState(userId, 'REP_WHISPER_REPLY', { ...session.data, whisperIdx: targetIdx });
                await message.reply(`✅ *Whisper Found!*\n\n"${whispers[targetIdx].text}"\n\nType your reply below. It will be sent as an anonymous DM to the student.\n\n(Type *0* to cancel)`);
                break;
            }

            case 'REP_WHISPER_REPLY': {
                if (input === '0') {
                    updateSessionState(userId, 'REP_WHISPER_MENU', session.data);
                    await message.reply(`Reply cancelled.`);
                    return;
                }

                const sClass = session.data.loggedInClass;
                const wIdx = session.data.whisperIdx;
                const whisper = db.classes[sClass].whispers[wIdx];
                const studentId = whisper.studentId;
                const studentPhoneId = db.classes[sClass].members[studentId]?.phoneId;

                if (studentPhoneId) {
                    try {
                        const replyMsg = `🤫 *WHISPER RESPONSE*\n━━━━━━━━━━━━━━━━━━\n*Your Feedback:* "${whisper.text}"\n\n*Rep's Reply:* "${input}"`;
                        await client.sendMessage(studentPhoneId, replyMsg);
                    } catch (e) {
                        console.warn(`Failed to send whisper reply to ${studentPhoneId}`);
                    }
                }

                // Mark as replied
                db.classes[sClass].whispers[wIdx].replied = true;
                writeClassDB(db);

                updateSessionState(userId, 'REP_WHISPER_MENU', session.data);
                await message.reply(`✅ *REPLY SENT*\n\nThe student has received your message anonymously.\n\n(Type *0* to go back)`);
                break;
            }

          case 'REP_ISSUES_MENU': {
              if (input === '0') {
                  updateSessionState(userId, 'REP_DASHBOARD', session.data);
                  await sendRepDashboard(message, session.data.loggedInClass);
                  return;
              }
              
              const issues = db.classes[session.data.loggedInClass].issues;
              
              if (input === '1') {
                  if (issues.length === 0) {
                      await message.reply(`✅ No pending security issues!\n(Type *0* to go back)`);
                      return;
                  }
                  let issList = `🚨 *LOCKED ACCOUNTS*\n━━━━━━━━━━━━━━━━━━\n`;
                  issues.forEach(iss => {
                      const dateObj = new Date(iss.timestamp);
                      const dStr = dateObj.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'Africa/Nairobi' });
                      issList += `▪️ *${iss.name}* (Locked on ${dStr})\n   Reason: ${iss.reason}\n\n`;
                  });
                  await message.reply(issList + `(Type *0* to go back)`);
              } else if (input === '2') {
                  if (issues.length === 0) {
                      await message.reply(`✅ No accounts to unlock.\n(Type *0* to go back)`);
                      return;
                  }
                  let issList = `🔓 *UNLOCK A STUDENT*\n━━━━━━━━━━━━━━━━━━\nPlease verify their identity in the group chat before unlocking.\n\n`;
                  issues.forEach((iss, idx) => {
                      issList += `${idx + 1}. ${iss.name}\n`;
                  });
                  issList += `\n*Reply with the number to UNLOCK:*\n(Type *0* to cancel)`;
                  updateSessionState(userId, 'REP_ISSUES_RESOLVE', session.data);
                  await message.reply(issList);
              }
              break;
          }

          case 'REP_ISSUES_RESOLVE': {
            if (input === '0') {
                updateSessionState(userId, 'REP_ISSUES_MENU', session.data);
                await message.reply(`🚨 *ISSUES DESK*\n━━━━━━━━━━━━━━━━━━\n1. 👁️ View Locked Accounts\n2. 🔓 Resolve / Unlock an Account\n\n0. 🔙 Back`);
                return;
            }
            
            const issues = db.classes[session.data.loggedInClass].issues;
            const selectedIdx = parseInt(input) - 1;
            
            if (isNaN(selectedIdx) || selectedIdx < 0 || selectedIdx >= issues.length) {
                await message.reply(`❌ Invalid selection. Reply with a valid number.`);
                return;
            }
            
            const targetIssue = issues[selectedIdx];
            
            // Generate a random 4-digit One-Time Code
            const otpCode = generateNumericOtp();
            
            // Unlock the student and assign the OTP
            if (db.classes[session.data.loggedInClass].members[targetIssue.memberId]) {
                db.classes[session.data.loggedInClass].members[targetIssue.memberId].locked = false;
                db.classes[session.data.loggedInClass].members[targetIssue.memberId].pendingRepReset = true;
                db.classes[session.data.loggedInClass].members[targetIssue.memberId].resetOtp = hashSecret(otpCode);
            }
            
            issues.splice(selectedIdx, 1);
            
            db.classes[session.data.loggedInClass].logs.push({
                text: `Unlocked Member: ${targetIssue.name} (OTP Issued)`,
                timestamp: Date.now()
            });
            
            writeClassDB(db);

            updateSessionState(userId, 'REP_ISSUES_MENU', session.data);
            await message.reply(`✅ *${targetIssue.name}* has been unlocked.\n\n🔒 *CRITICAL:* Please give them this One-Time Reset Code: *${otpCode}*\n\nThey must enter this code to regain access to their account.\n\n0. 🔙 Back`);
            break;
            }

            // ==========================================
            // PHASE 9: THE HUSTLE BOARD (MARKETPLACE)
            // ==========================================
            case 'MARKET_HOME': {
                if (input === '0') {
                    // Send back to respective dashboard
                    const isRep = session.data.isMainRep !== undefined;
                    updateSessionState(userId, isRep ? 'REP_DASHBOARD' : 'STUDENT_DASHBOARD', session.data);
                    if (isRep) await sendRepDashboard(message, session.data.loggedInClass);
                    else await sendStudentDashboard(message, session.data.loggedInClass, session.data.studentName || db.classes[session.data.loggedInClass].repName);
                    return;
                }
                const mDb = db.classes[session.data.loggedInClass];
                
                if (input === '1') { // BROWSE
                    if (mDb.marketplace.length === 0) {
                        await message.reply(`📭 The market is currently empty.\n\n(Type *0* to go back)`);
                        return;
                    }
                    let mStr = `🛍️ *ACTIVE LISTINGS*\n━━━━━━━━━━━━━━━━━━\n\n`;
                    mDb.marketplace.forEach((item, i) => {
                        const statusTag = item.status === 'SOLD' ? '🔴 [SOLD]' : '🟢 [ACTIVE]';
                        mStr += `${i + 1}. ${statusTag} *${item.itemName}*\n   ${item.type === 'CASH' ? '💰 Price:' : '🔄 Wants:'} ${item.price}\n\n`;
                    });
                    mStr += `*Reply with the number to view or make an offer:*\n(Type *0* to go back)`;
                    updateSessionState(userId, 'MARKET_BROWSE', session.data);
                    await message.reply(mStr);
                
                } else if (input === '2') { // SELL
                    const mDb = db.classes[session.data.loggedInClass];
                    
                    // ANTI-SPAM GUARDRAIL: Limit to 5 active listings per user
                    const myActiveItems = (mDb.marketplace || []).filter(i => i.sellerId === userId && i.status === 'ACTIVE');
                    
                    if (myActiveItems.length >= 5) {
                        await message.reply(`⚠️ *LIMIT REACHED*\n\nYou already have 5 active listings on the global board. To prevent spam, please delete or close an old listing before adding a new one.\n\n(Type *0* to go back)`);
                        return;
                    }

                    updateSessionState(userId, 'MARKET_SELL_TYPE', session.data);
                    await message.reply(`🏷️ *CREATE LISTING*\n\nHow do you want to trade this item?\n1. 💰 Sell for Cash\n2. 🔄 Barter (Trade for something else)\n\n(Type *0* to cancel)`);
                
                } else if (input === '3') { // NOTIFICATIONS
                    let notifStr = `🔔 *YOUR NOTIFICATIONS*\n━━━━━━━━━━━━━━━━━━\n\n`;
                    let hasNotifs = false;
                    const pendingBids = [];

                    mDb.marketplace.forEach((item, itemIdx) => {
                        // 1. Check for bids on MY items
                        if (item.sellerId === userId && item.status === 'ACTIVE') {
                            item.bids.forEach((bid, bidIdx) => {
                                if (bid.status === 'PENDING') {
                                    pendingBids.push({ itemIdx, bidIdx, item, bid });
                                    hasNotifs = true;
                                    notifStr += `[NEW OFFER] On your *${item.itemName}*\nAnonymous Buyer offers: ${bid.offer}\n\n`;
                                }
                            });
                        }
                        // 2. Check for replies to MY bids
                        item.bids.forEach((bid, bidIdx) => {
                            if (bid.buyerId === userId && !bid.readByBuyer) {
                                if (bid.status === 'REJECTED') {
                                    notifStr += `[REJECTED] Your offer of ${bid.offer} on *${item.itemName}* was rejected.\nReason: "${bid.rejectReason}"\n\n`;
                                    hasNotifs = true;
                                    mDb.marketplace[itemIdx].bids[bidIdx].readByBuyer = true; // Mark as read
                                } else if (bid.status === 'ACCEPTED') {
                                    notifStr += `[ACCEPTED!] Your offer on *${item.itemName}* won!\nThe Seller will DM you shortly.\n\n`;
                                    hasNotifs = true;
                                    mDb.marketplace[itemIdx].bids[bidIdx].readByBuyer = true; // Mark as read
                                }
                            }
                        });
                    });

                    writeClassDB(db); // Save the read statuses

                    if (!hasNotifs) {
                        await message.reply(`📭 You have no new notifications.\n\n(Type *0* to go back)`);
                        return;
                    }

                    if (pendingBids.length > 0) {
                        notifStr += `━━━━━━━━━━━━━━━━━━\n*You have pending offers to review.*\nReply with *1* to start reviewing them, or *0* to go back.`;
                        updateSessionState(userId, 'MARKET_REVIEW_START', { ...session.data, pendingBids });
                    } else {
                        notifStr += `(Type *0* to go back)`;
                    }
                    await message.reply(notifStr);
                
                } else if (input === '4') { // MY LISTINGS
                    let myItems = mDb.marketplace.filter(i => i.sellerId === userId);
                    if (myItems.length === 0) {
                        await message.reply(`📦 You haven't listed anything yet.\n\n(Type *0* to go back)`);
                        return;
                    }
                    let mStr = `📦 *MY LISTINGS*\n━━━━━━━━━━━━━━━━━━\n`;
                    myItems.forEach((item, i) => {
                        mStr += `${i + 1}. [${item.status}] ${item.itemName}\n`;
                    });
                    mStr += `\n*Reply with the number to DELETE a listing:*\n(Type *0* to go back)`;
                    
                    // Pass the filtered items into the session so we know exactly which one they select
                    updateSessionState(userId, 'MARKET_MY_LISTINGS', { ...session.data, myItems });
                    await message.reply(mStr);
                }
                break;
            }

            // --- BUY FLOW ---
            case 'MARKET_BROWSE': {
                if (input === '0') { updateSessionState(userId, 'MARKET_HOME', session.data); await message.reply("Returning to Hustle Board..."); return; }
                const mDb = db.classes[session.data.loggedInClass].marketplace;
                const idx = parseInt(input) - 1;
                if (isNaN(idx) || idx < 0 || idx >= mDb.length) { await message.reply("❌ Invalid choice."); return; }
                
                const item = mDb[idx];
                if (item.sellerId === userId) {
                    await message.reply(`⚠️ This is your own listing.\n\n(Type *0* to go back)`); return;
                }

                updateSessionState(userId, 'MARKET_MAKE_OFFER', { ...session.data, itemIdx: idx });
                
                let viewStr = `📦 *ITEM DETAILS*\n━━━━━━━━━━━━━━━━━━\n🏷️ Item: ${item.itemName}\n🔖 Type: ${item.type}\n${item.type === 'CASH' ? '💰 Price' : '🔄 Wants'}: ${item.price}\n🛑 Status: ${item.status}\n\n`;
                
                if (item.status === 'SOLD') {
                    await message.reply(viewStr + `⚠️ This item is already sold.\n\n(Type *0* to go back)`);
                } else {
                    viewStr += `1. 💸 Make an Anonymous Offer\n0. 🔙 Cancel`;
                    await message.reply(viewStr);
                }
                break;
            }

            case 'MARKET_MAKE_OFFER': {
                if (input === '0') { 
                    updateSessionState(userId, 'MARKET_BROWSE', session.data); 
                    
                    // Rebuild the Browse Menu
                    const mDb = db.classes[session.data.loggedInClass].marketplace;
                    let mStr = `🛍️ *ACTIVE LISTINGS*\n━━━━━━━━━━━━━━━━━━\n\n`;
                    mDb.forEach((item, i) => {
                        const statusTag = item.status === 'SOLD' ? '🔴 [SOLD]' : '🟢 [ACTIVE]';
                        mStr += `${i + 1}. ${statusTag} *${item.itemName}*\n   ${item.type === 'CASH' ? '💰 Price:' : '🔄 Wants:'} ${item.price}\n\n`;
                    });
                    mStr += `*Reply with the number to view or make an offer:*\n0. 🔙 Back`;
                    await message.reply(mStr);
                    return; 
                }

                if (input === '1') {
                    updateSessionState(userId, 'MARKET_SUBMIT_OFFER', session.data);
                    await message.reply(`🤫 *ANONYMOUS OFFER*\n\nType your offer below (either a Cash Amount or an Item to Trade).\nYour identity will remain completely hidden from the seller.\n\n(Type *0* to cancel)`);
                }
                break;
            }

            case 'MARKET_SUBMIT_OFFER': {
                if (input === '0') { 
                    updateSessionState(userId, 'MARKET_MAKE_OFFER', session.data); 
                    const item = db.classes[session.data.loggedInClass].marketplace[session.data.itemIdx];
                    await message.reply(`📦 *ITEM DETAILS*\n━━━━━━━━━━━━━━━━━━\n🏷️ Item: ${item.itemName}\n🔖 Type: ${item.type}\n${item.type === 'CASH' ? '💰 Price' : '🔄 Wants'}: ${item.price}\n🛑 Status: ${item.status}\n\n1. 💸 Make an Anonymous Offer\n0. 🔙 Back`);
                    return; 
                }
                
                const mDb = db.classes[session.data.loggedInClass].marketplace;
                const item = mDb[session.data.itemIdx];
                const alias = 'Buyer-' + Math.random().toString(36).substring(2, 5).toUpperCase();
                
                item.bids.push({
                    buyerId: userId,
                    alias: alias,
                    offer: input,
                    status: 'PENDING',
                    readByBuyer: false
                });
                writeClassDB(db);

                // Alert the Seller
                try {
                    await client.sendMessage(item.sellerId, `🔔 *MARKET ALERT*\nYou have a new anonymous offer on your *${item.itemName}*!\n\nHead to the Class Portal -> Hustle Board -> Notifications to view it.`);
                } catch (e) {}

                updateSessionState(userId, 'MARKET_HOME', session.data);
                await message.reply(`✅ *OFFER SENT ANONYMOUSLY*\n\nThe seller has been notified. You will receive an alert when they respond.\n\nReturning to Hustle Board...`);
                break;
            }

            // --- SELL FLOW ---
            case 'MARKET_SELL_TYPE': {
                if (input === '0') { updateSessionState(userId, 'MARKET_HOME', session.data); await message.reply("Cancelled."); return; }
                const type = input === '1' ? 'CASH' : 'BARTER';
                updateSessionState(userId, 'MARKET_SELL_NAME', { ...session.data, sellType: type });
                await message.reply(`🏷️ What is the Name of the item?\n(e.g., Used HP Laptop, Networking Notes)`);
                break;
            }

            case 'MARKET_SELL_NAME': {
                if (input === '0') { 
                    updateSessionState(userId, 'MARKET_SELL_TYPE', session.data); 
                    await message.reply(`🏷️ *CREATE LISTING*\n\nHow do you want to trade this item?\n1. 💰 Sell for Cash\n2. 🔄 Barter (Trade for something else)\n\n0. 🔙 Cancel`); 
                    return; 
                }

                updateSessionState(userId, 'MARKET_SELL_PRICE', { ...session.data, sellName: input });
                const prompt = session.data.sellType === 'CASH' ? '💰 What is your asking price? (e.g., 15000 Ksh)' : '🔄 What are you looking to get in exchange? (e.g., Help with a Java Project)';
                await message.reply(prompt);
                break;
            }

            case 'MARKET_SELL_PRICE': {
                if (input === '0') { 
                    updateSessionState(userId, 'MARKET_SELL_NAME', session.data); 
                    await message.reply(`🏷️ What is the Name of the item?\n(e.g., Used HP Laptop, Networking Notes)\n\n0. 🔙 Back`); 
                    return; 
                }

                const mDb = db.classes[session.data.loggedInClass];
                mDb.marketplace.push({
                    id: 'mkt_' + Date.now(),
                    sellerId: userId,
                    type: session.data.sellType,
                    itemName: session.data.sellName,
                    price: input,
                    status: 'ACTIVE',
                    bids: []
                });
                writeClassDB(db);
                
                updateSessionState(userId, 'MARKET_HOME', session.data);
                await message.reply(`🎉 *LISTING CREATED*\n\nYour item is now live on the Hustle Board! You will receive DMs when anonymous offers arrive.`);
                break;
            }

            // --- REVIEW BIDS & LIVE CHAT FLOW ---
            case 'MARKET_REVIEW_START': {
                if (input === '0') { updateSessionState(userId, 'MARKET_HOME', session.data); await message.reply("Returning to Market..."); return; }
                if (input === '1') {
                    // Pull the first pending bid
                    const target = session.data.pendingBids[0];
                    updateSessionState(userId, 'MARKET_PROCESS_BID', { ...session.data, target });
                    
                    await message.reply(`📝 *REVIEWING OFFER*\n━━━━━━━━━━━━━━━━━━\n📦 Item: ${target.item.itemName}\n👤 From: ${target.bid.alias}\n💵 Offer: ${target.bid.offer}\n\n1. ✅ Accept Offer\n2. ❌ Reject Offer\n3. 💬 Open Live Negotiation\n\n0. 🔙 Decide Later`);
                }
                break;
            }

            case 'MARKET_PROCESS_BID': {
                if (input === '0') { 
                    updateSessionState(userId, 'MARKET_REVIEW_START', session.data); 
                    await message.reply(`🔔 *YOUR NOTIFICATIONS*\n━━━━━━━━━━━━━━━━━━\n*You have pending offers to review.*\nReply with *1* to start reviewing them, or *0* to go back.`); 
                    return; 
                }
                const { itemIdx, bidIdx } = session.data.target;
                const mDb = db.classes[session.data.loggedInClass].marketplace;
                const theBid = mDb[itemIdx].bids[bidIdx];

                if (input === '1') { // ACCEPT
                    theBid.status = 'ACCEPTED';
                    mDb[itemIdx].status = 'SOLD';
                    
                    // Reject all other pending bids
                    mDb[itemIdx].bids.forEach(b => {
                        if (b.status === 'PENDING') {
                            b.status = 'REJECTED';
                            b.rejectReason = 'Item sold to another buyer.';
                        }
                    });
                    writeClassDB(db);

                    // Reveal to both parties
                    const sellerWa = `wa.me/${userId.split('@')[0]}`;
                    const buyerWa = `wa.me/${theBid.buyerId.split('@')[0]}`;
                    
                    try { await client.sendMessage(theBid.buyerId, `🎉 *OFFER ACCEPTED!* 🎉\nThe seller accepted your offer on *${mDb[itemIdx].itemName}*!\n\nMessage them here to finalize: ${sellerWa}`); } catch(e){}
                    
                    updateSessionState(userId, 'MARKET_HOME', session.data);
                    await message.reply(`✅ *DEAL CLOSED*\n\nYou accepted the offer! The item is marked SOLD.\nHere is the buyer's contact info to organize exchange: ${buyerWa}`);

                } else if (input === '2') { // REJECT
                    updateSessionState(userId, 'MARKET_REJECT_REASON', session.data);
                    await message.reply(`❌ *REJECTING OFFER*\n\nPlease type a brief reason for the rejection (e.g., "Too low, looking for at least 10k"):\n(Type *0* to cancel)`);
                
                } else if (input === '3') { // NEGOTIATE (THE LIVE CHAT INITIATOR)
                    // Lock both users into the active chat registry
                    activeMarketChats.set(userId, { targetId: theBid.buyerId, alias: 'Seller' });
                    activeMarketChats.set(theBid.buyerId, { targetId: userId, alias: theBid.alias });
                    
                    try {
                        await client.sendMessage(theBid.buyerId, `💬 *MARKET INTERCOM*\nThe Seller of *${mDb[itemIdx].itemName}* wants to negotiate your offer of ${theBid.offer}.\n\n*You are now in a LIVE, ANONYMOUS CHAT with them.*\nEverything you type will be sent to the seller.\n\n_(Type *0* at any time to end the chat)_`);
                    } catch(e) {}
                    
                    // We don't change session state because the interceptor blocks the menu anyway
                    await message.reply(`🟢 *LIVE CHAT SECURED*\n\nYou are now anonymously connected to ${theBid.alias}. Everything you type will be sent directly to them.\n\n_(Type *0* at any time to close the connection)_`);
                }
                break;
            }

            case 'MARKET_REJECT_REASON': {
                if (input === '0') { 
                    updateSessionState(userId, 'MARKET_PROCESS_BID', session.data); 
                    const target = session.data.target;
                    await message.reply(`📝 *REVIEWING OFFER*\n━━━━━━━━━━━━━━━━━━\n📦 Item: ${target.item.itemName}\n👤 From: ${target.bid.alias}\n💵 Offer: ${target.bid.offer}\n\n1. ✅ Accept Offer\n2. ❌ Reject Offer\n3. 💬 Open Live Negotiation\n\n0. 🔙 Decide Later`);
                    return; 
                }
                const { itemIdx, bidIdx } = session.data.target;
                const mDb = db.classes[session.data.loggedInClass].marketplace;
                
                mDb[itemIdx].bids[bidIdx].status = 'REJECTED';
                mDb[itemIdx].bids[bidIdx].rejectReason = input;
                writeClassDB(db);

                try {
                    await client.sendMessage(mDb[itemIdx].bids[bidIdx].buyerId, `🔔 *MARKET UPDATE*\nYour offer on *${mDb[itemIdx].itemName}* was updated. Check your portal notifications.`);
                } catch(e) {}

                updateSessionState(userId, 'MARKET_HOME', session.data);
                await message.reply(`✅ Rejection sent to the buyer.\n\nReturning to Market...`);
                break;
            }

            case 'MARKET_MY_LISTINGS': {
                if (input === '0') { 
                    updateSessionState(userId, 'MARKET_HOME', session.data); 
                    await message.reply("Returning to Market..."); 
                    return; 
                }
                
                const myItems = session.data.myItems;
                const selectedIdx = parseInt(input) - 1;
                
                if (isNaN(selectedIdx) || selectedIdx < 0 || selectedIdx >= myItems.length) {
                    await message.reply(`❌ Invalid selection. Reply with a valid number from the list, or type *0* to go back.`);
                    return;
                }
                
                const targetItem = myItems[selectedIdx];
                const mDb = db.classes[session.data.loggedInClass];
                
                // Locate the exact item in the main marketplace array using its unique ID
                const realIdx = mDb.marketplace.findIndex(i => i.id === targetItem.id);
                
                if (realIdx !== -1) {
                    mDb.marketplace.splice(realIdx, 1);
                    writeClassDB(db);
                    
                    updateSessionState(userId, 'MARKET_HOME', session.data);
                    await message.reply(`✅ *LISTING DELETED*\n\n"${targetItem.itemName}" has been permanently removed from the Hustle Board.\n\nReturning to Market...`);
                } else {
                    await message.reply(`❌ Could not locate the item. It may have already been deleted.`);
                }
                break;
            }

            // ==========================================
            // PHASE 10: POLLS & GOVERNANCE
            // ==========================================
            case 'REP_POLL_MENU': {
                if (input === '0') {
                    updateSessionState(userId, 'REP_DASHBOARD', session.data);
                    await sendRepDashboard(message, session.data.loggedInClass);
                    return;
                }
                const polls = db.classes[session.data.loggedInClass].polls || [];

                if (input === '1') {
                    const activePoll = polls.find(p => p.status === 'ACTIVE');
                    if (activePoll) {
                        await message.reply(`⚠️ There is already an active poll running. Please wait for it to close before starting a new one.\n\n(Type *0* to go back)`);
                        return;
                    }
                    updateSessionState(userId, 'REP_POLL_QUESTION', session.data);
                    await message.reply(`📊 *CREATE NEW POLL*\n\nWhat is the question for the class?\n(e.g., When should we schedule the makeup class?)\n\n(Type *0* to cancel)`);
                } else if (input === '2') {
                    const closedPolls = polls.filter(p => p.status === 'CLOSED');
                    if (closedPolls.length === 0) {
                        await message.reply(`📭 No completed polls to display.\n(Type *0* to go back)`);
                        return;
                    }
                    let resStr = `📊 *PAST POLL RESULTS*\n━━━━━━━━━━━━━━━━━━\n\n`;
                    closedPolls.forEach((p, i) => {
                        resStr += `*Poll ${i+1}:* ${p.question}\n`;
                        resStr += p.finalResultStr ? p.finalResultStr.replace('🛑 *POLL CLOSED* 🛑\n━━━━━━━━━━━━━━━━━━\n', '').replace(`❓ *${p.question}*\n\n`, '') : 'No data';
                        resStr += `\n━━━━━━━━━━━━━━━━━━\n\n`;
                    });
                    await message.reply(resStr + `(Type *0* to go back)`);
                } else if (input === '3') {
                    db.classes[session.data.loggedInClass].polls = db.classes[session.data.loggedInClass].polls.filter(p => p.status === 'ACTIVE');
                    writeClassDB(db);
                    await message.reply(`🗑️ Past poll history cleared. (Active polls are kept).\n(Type *0* to go back)`);
                }
                break;
            }

            case 'REP_POLL_QUESTION': {
                if (input === '0') { updateSessionState(userId, 'REP_POLL_MENU', session.data); await message.reply("Cancelled."); return; }
                updateSessionState(userId, 'REP_POLL_OPTIONS', { ...session.data, pollQuestion: input });
                await message.reply(`✅ Question saved: *${input}*\n\nNow, enter the options separated by commas.\n(e.g., Monday 8AM, Tuesday 2PM, Cancel it)\n\n*Note: I will automatically add an "Abstain / Don't Vote" option for you.*`);
                break;
            }

            case 'REP_POLL_OPTIONS': {
                if (input === '0') {
                    updateSessionState(userId, 'REP_POLL_QUESTION', session.data);
                    await message.reply(`📊 *CREATE NEW POLL*\n\nWhat is the question for the class?\n(e.g., When should we schedule the makeup class?)\n\n(Type *0* to cancel)`);
                    return;
                }
                
                const options = input.split(',').map(o => o.trim()).filter(o => o.length > 0);
                if (options.length < 2) {
                    await message.reply(`❌ You must provide at least two options separated by a comma. Try again:`);
                    return;
                }
                options.push("Abstain / I don't want to vote");
                
                updateSessionState(userId, 'REP_POLL_DURATION', { ...session.data, pollOptions: options });
                await message.reply(`✅ Options saved (${options.length} total).\n\nHow many *hours* should this poll run for before closing automatically?\n(Reply with a number, e.g., 2, 12, 24)`);
                break;
            }

            case 'REP_POLL_DURATION': {
                if (input === '0') {
                    updateSessionState(userId, 'REP_POLL_OPTIONS', session.data);
                    await message.reply(`✅ Question saved: *${session.data.pollQuestion}*\n\nNow, enter the options separated by commas.\n(e.g., Monday 8AM, Tuesday 2PM, Cancel it)\n\n*Note: I will automatically add an "Abstain / Don't Vote" option for you.*`);
                    return;
                }
                const hours = parseFloat(input);
                if (isNaN(hours) || hours <= 0) {
                    await message.reply(`❌ Invalid duration. Please enter a valid number of hours (e.g., 2):`);
                    return;
                }

                const sClass = session.data.loggedInClass;
                const members = db.classes[sClass].members || {};
                const memberIds = Object.keys(members);
                
                if (memberIds.length === 0) {
                    await message.reply(`⚠️ You have no registered students to send this poll to!`);
                    updateSessionState(userId, 'REP_POLL_MENU', session.data);
                    return;
                }

                const newPoll = {
                    id: `poll_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`,
                    question: session.data.pollQuestion,
                    options: session.data.pollOptions,
                    votes: {},
                    expiresAt: Date.now() + (hours * 60 * 60 * 1000),
                    status: 'ACTIVE'
                };

                if (!db.classes[sClass].polls) db.classes[sClass].polls = [];
                db.classes[sClass].polls.push(newPoll);
                writeClassDB(db);

                // Build Blast Message
                let blastMsg = `📊 *CLASS POLL: ${sClass}* 📊\n\n*${newPoll.question}*\n\n`;
                newPoll.options.forEach((opt, idx) => {
                    blastMsg += `${idx + 1}️⃣ ${opt}\n`;
                });
                blastMsg += `\n👉 *Reply to this exact poll message with a single number (e.g., 1 or 2) to cast your anonymous vote.*`;
                blastMsg += `\n_Poll ID: ${newPoll.id}_`;

                await message.reply(`🚀 *LAUNCHING POLL*\n\nBroadcasting to ${memberIds.length} students...`);

                let sentCount = 0;
                for (const mId of memberIds) {
                    try {
                        await client.sendMessage(members[mId].phoneId, blastMsg);
                        sentCount++;
                    } catch (e) {
                        console.warn(`[POLL] Failed to send to ${members[mId].name}`);
                    }
                }

                updateSessionState(userId, 'REP_DASHBOARD', session.data);
                await message.reply(`✅ *POLL LIVE!*\n\nSent to ${sentCount} students. The results will be automatically DMed to you in ${hours} hours.\n\nReturning to Dashboard...`);
                await sendRepDashboard(message, sClass);
                break;
            }

            // ==========================================
            // PHASE 11: HOLIDAY MODE CONFIGURATION
            // ==========================================
            case 'REP_HOLIDAY_MENU': {
                if (input === '0') {
                    updateSessionState(userId, 'REP_DASHBOARD', session.data);
                    await sendRepDashboard(message, session.data.loggedInClass);
                    return;
                }
                
                if (input === '1') {
                    db.classes[session.data.loggedInClass].holidayMode = true;
                    writeClassDB(db);
                    
                    updateSessionState(userId, 'REP_DASHBOARD', session.data);
                    await message.reply(`🌴 *HOLIDAY MODE ACTIVATED*\n\nAll automated alerts for *${session.data.loggedInClass}* are now MUTED. Enjoy your break!\n\nReturning to Dashboard...`);
                    await sendRepDashboard(message, session.data.loggedInClass);
                    
                } else if (input === '2') {
                    db.classes[session.data.loggedInClass].holidayMode = false;
                    writeClassDB(db);
                    
                    updateSessionState(userId, 'REP_DASHBOARD', session.data);
                    await message.reply(`🔴 *HOLIDAY MODE DISABLED*\n\nAutomated alerts and reminders for *${session.data.loggedInClass}* have been RESTORED.\n\nReturning to Dashboard...`);
                    await sendRepDashboard(message, session.data.loggedInClass);
                    
                } else {
                    await message.reply(`❌ Invalid choice. Reply 1 to turn ON, 2 to turn OFF, or 0 to go back.`);
                }
                break;
            }
            
            // ==========================================
            // PHASE 6: CAT & ASSIGNMENT TRACKER
            // ==========================================
            case 'REP_DEADLINES_MENU': {
                if (input === '0') {
                    updateSessionState(userId, 'REP_DASHBOARD', session.data);
                    await sendRepDashboard(message, session.data.loggedInClass);
                    return;
                }
                
                let assessments = db.classes[session.data.loggedInClass].assessments || [];
                const now = Date.now();
                
                // AUTO-PRUNING: Silently remove deadlines that have passed
                const originalLength = assessments.length;
                assessments = assessments.filter(a => a.timestamp > now);
                if (assessments.length !== originalLength) {
                    db.classes[session.data.loggedInClass].assessments = assessments;
                    writeClassDB(db);
                }

                if (input === '1') {
                    updateSessionState(userId, 'REP_DEADLINES_ADD_TYPE', session.data);
                    await message.reply(`➕ *ADD NEW DEADLINE (Step 1 of 4)*\n\nWhat type of assessment is this?\nReply with the number:\n\n1. 🔴 CAT / Exam\n2. 📘 Assignment\n3. 👥 Group Project\n\n0. 🔙 Cancel`);
                } else if (input === '2') {
                    if (assessments.length === 0) {
                        await message.reply(`🎉 No active deadlines right now!\n(Type *0* to go back)`);
                        return;
                    }
                    
                    // Sort by closest deadline first
                    assessments.sort((a, b) => a.timestamp - b.timestamp);
                    
                    let viewStr = `⏳ *UPCOMING DEADLINES*\n━━━━━━━━━━━━━━━━━━\n\n`;
                    assessments.forEach(a => {
                        const timeDiffMs = a.timestamp - now;
                        let countdown = "";

                        if (timeDiffMs <= 0) {
                            countdown = "⚠️ Deadline Passed";
                        } else {
                            const days = Math.floor(timeDiffMs / (1000 * 60 * 60 * 24));
                            const hours = Math.floor((timeDiffMs % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
                            const minutes = Math.floor((timeDiffMs % (1000 * 60 * 60)) / (1000 * 60));
                            const seconds = Math.floor((timeDiffMs % (1000 * 60)) / 1000);
                            
                            let parts = [];
                            if (days > 0) parts.push(`${days}d`);
                            if (hours > 0 || days > 0) parts.push(`${hours}h`);
                            parts.push(`${minutes}m`);
                            parts.push(`${seconds}s`);
                            
                            countdown = parts.join(' ');
                        }
                        
                        viewStr += `${a.icon} *[${a.type}] ${a.unit}*\n`;
                        viewStr += `📝 Details: ${a.details}\n`;
                        viewStr += `⏰ Due In: *${countdown}*\n\n`;
                    });
                    
                    await message.reply(viewStr + `(Type *0* to go back)`);
                } else if (input === '3') {
                    if (assessments.length === 0) {
                        await message.reply(`📭 No active deadlines to delete.\n(Type *0* to go back)`);
                        return;
                    }
                    
                    let delStr = `🗑️ *DELETE A DEADLINE*\n━━━━━━━━━━━━━━━━━━\n\n`;
                    assessments.forEach((a, i) => {
                        delStr += `${i + 1}. [${a.type}] ${a.unit}\n`;
                    });
                    delStr += `\n*Reply with the number to delete:*\n(Type *0* to cancel)`;
                    
                    updateSessionState(userId, 'REP_DEADLINES_REMOVE', session.data);
                    await message.reply(delStr);
                } else if (input === '4') {
                    if (assessments.length === 0) {
                        await message.reply(`📭 No active deadlines to broadcast.\n(Type *0* to go back)`);
                        return;
                    }
                    
                    let panicStr = `🚨 *PANIC BLAST SELECTION*\n━━━━━━━━━━━━━━━━━━\n\n`;
                    assessments.forEach((a, i) => {
                        panicStr += `${i + 1}. [${a.type}] ${a.unit}\n`;
                    });
                    panicStr += `\n*Reply with the number to send an URGENT warning to all students:*\n(Type *0* to cancel)`;
                    
                    updateSessionState(userId, 'REP_DEADLINES_PANIC', session.data);
                    await message.reply(panicStr);
                } else {
                    await message.reply(`❌ Invalid choice.`);
                }
                break;
            }

            // WIZARD STEP 1: TYPE
            case 'REP_DEADLINES_ADD_TYPE': {
                if (input === '0') {
                    updateSessionState(userId, 'REP_DEADLINES_MENU', session.data);
                    await message.reply(`📚 *DEADLINES & ASSESSMENTS*\n━━━━━━━━━━━━━━━━━━\n1. ➕ Add New Deadline\n2. 👁️ View Active Deadlines\n3. 🗑️ Delete a Deadline\n4. 🚨 Send Panic Blast\n\n0. 🔙 Back`);
                    return;
                }
                
                let type, icon;
                if (input === '1') { type = 'CAT'; icon = '🔴'; }
                else if (input === '2') { type = 'ASSIGNMENT'; icon = '📘'; }
                else if (input === '3') { type = 'PROJECT'; icon = '👥'; }
                else { await message.reply(`❌ Invalid choice. Reply 1, 2, or 3.`); return; }
                
                updateSessionState(userId, 'REP_DEADLINES_ADD_UNIT', { ...session.data, newDeadline: { type, icon } });
                await message.reply(`✅ Type Selected: *${type}*\n\n➕ *ADD NEW DEADLINE (Step 2 of 4)*\n\nWhat is the *Unit Name*?\n(e.g., Database Systems)\n\n0. 🔙 Cancel`);
                break;
            }

            // WIZARD STEP 2: UNIT
            case 'REP_DEADLINES_ADD_UNIT': {
                if (input === '0') {
                    updateSessionState(userId, 'REP_DEADLINES_ADD_TYPE', session.data);
                    await message.reply(`➕ *ADD NEW DEADLINE (Step 1 of 4)*\n\nWhat type of assessment is this?\nReply with the number:\n\n1. 🔴 CAT / Exam\n2. 📘 Assignment\n3. 👥 Group Project\n\n0. 🔙 Cancel`);
                    return;
                }
                
                const newDeadline = session.data.newDeadline;
                newDeadline.unit = input;
                
                updateSessionState(userId, 'REP_DEADLINES_ADD_DESC', { ...session.data, newDeadline });
                await message.reply(`✅ Unit Saved: *${input}*\n\n➕ *ADD NEW DEADLINE (Step 3 of 4)*\n\nEnter the task details or submission link.\n(e.g., Chapter 4 PDF due on portal)\n\n0. 🔙 Cancel`);
                break;
            }

            // WIZARD STEP 3: DETAILS
            case 'REP_DEADLINES_ADD_DESC': {
                if (input === '0') {
                    updateSessionState(userId, 'REP_DEADLINES_ADD_UNIT', session.data);
                    await message.reply(`✅ Type Selected: *${session.data.newDeadline.type}*\n\n➕ *ADD NEW DEADLINE (Step 2 of 4)*\n\nWhat is the *Unit Name*?\n(e.g., Database Systems)\n\n0. 🔙 Back`);
                    return;
                }
                
                const newDeadline = session.data.newDeadline;
                newDeadline.details = input;
                
                updateSessionState(userId, 'REP_DEADLINES_ADD_DATE', { ...session.data, newDeadline });
                await message.reply(`✅ Details Saved.\n\n➕ *ADD NEW DEADLINE (Step 4 of 4)*\n\nWhen is this due? Use this exact format:\n*DD/MM/YYYY, HH:MM*\n\nExample for 2:30 PM on Oct 15: *15/10/2026, 14:30*\n\n0. 🔙 Cancel`);
                break;
            }

            // WIZARD STEP 4: PARSE DATE & SAVE
            case 'REP_DEADLINES_ADD_DATE': {
                if (input === '0') {
                    updateSessionState(userId, 'REP_DEADLINES_ADD_DESC', session.data);
                    await message.reply(`✅ Unit Saved: *${session.data.newDeadline.unit}*\n\n➕ *ADD NEW DEADLINE (Step 3 of 4)*\n\nEnter the task details or submission link.\n(e.g., Chapter 4 PDF due on portal)\n\n0. 🔙 Back`);
                    return;
                }
                
                // Flexible regex: allows 1 or 2 digits for day, month, hour, and minute (e.g., 9:5 or 09:05)
                const dateRegex = /^(\d{1,2})\/(\d{1,2})\/(\d{4}),\s*(\d{1,2}):(\d{1,2})$/;
                const match = input.match(dateRegex);
                
                if (!match) {
                    await message.reply(`❌ Invalid Format.\n\nPlease use: *DD/MM/YYYY, HH:MM*\nExample: *5/10/2026, 14:5* or *15/10/2026, 14:30*`);
                    return;
                }
                
                const [_, dayStr, monthStr, yearStr, hourStr, minuteStr] = match;
                const day = parseInt(dayStr, 10);
                const month = parseInt(monthStr, 10);
                const year = parseInt(yearStr, 10);
                const hour = parseInt(hourStr, 10);
                const minute = parseInt(minuteStr, 10);
                
                // Strict Range Validations
                if (month < 1 || month > 12) {
                    await message.reply(`❌ Invalid month (*${month}*). Months must be between 1 and 12.`);
                    return;
                }
                if (day < 1 || day > 31) {
                    await message.reply(`❌ Invalid day (*${day}*). Days must be between 1 and 31.`);
                    return;
                }
                if (hour < 0 || hour > 23) {
                    await message.reply(`❌ Invalid hour (*${hour}*). Hours must be between 0 and 23 in 24-hour format.`);
                    return;
                }
                if (minute < 0 || minute > 59) {
                    await message.reply(`❌ Invalid minute (*${minute}*). Minutes must be between 0 and 59.`);
                    return;
                }
                
                // Automatically format single digits with leading zeros (e.g., 9 -> 09)
                const pDay = String(day).padStart(2, '0');
                const pMonth = String(month).padStart(2, '0');
                const pHour = String(hour).padStart(2, '0');
                const pMin = String(minute).padStart(2, '0');

                // Explicitly parse using East Africa Time (+03:00)
                const isoString = `${year}-${pMonth}-${pDay}T${pHour}:${pMin}:00+03:00`;
                const dueTimestamp = new Date(isoString).getTime();
                
                if (isNaN(dueTimestamp)) {
                    await message.reply(`❌ Invalid date combination (such as an invalid day for that month, e.g., February 30th). Please check and try again.`);
                    return;
                }
                
                if (dueTimestamp < Date.now()) {
                    await message.reply(`❌ That date is in the past! Please enter a future due date.`);
                    return;
                }
                
                const newDeadline = session.data.newDeadline;
                newDeadline.timestamp = dueTimestamp;

                // --- NEW: MULTI-STAGE URGENCY DETECTION & MUTING ---
                const timeDiffMs = dueTimestamp - Date.now();
                
                let stage1Ms = 0, stage2Ms = 0;
                if (newDeadline.type === 'CAT') {
                    stage1Ms = 24 * 60 * 60 * 1000;
                    stage2Ms = 12 * 60 * 60 * 1000;
                } else if (newDeadline.type === 'PROJECT') {
                    stage1Ms = 12 * 60 * 60 * 1000;
                    stage2Ms = 6 * 60 * 60 * 1000;
                } else if (newDeadline.type === 'ASSIGNMENT') {
                    stage1Ms = 2 * 60 * 60 * 1000;
                    stage2Ms = 1 * 60 * 60 * 1000;
                }

                // Initialize flags cleanly
                newDeadline.hasWarnedStage1 = false;
                newDeadline.hasWarnedStage2 = false;

                if (timeDiffMs <= stage2Ms) {
                    // Extreme urgency (mute BOTH background stages to prevent spam)
                    newDeadline.hasWarnedStage1 = true;
                    newDeadline.hasWarnedStage2 = true;
                } else if (timeDiffMs <= stage1Ms) {
                    // Moderate urgency (mute stage 1 only, let stage 2 run automatically later)
                    newDeadline.hasWarnedStage1 = true;
                }
                
                // Keep the old flag synced for database stability
                newDeadline.hasAutoWarned = newDeadline.hasWarnedStage1;
                // ---------------------------------------------------
                
                db.classes[session.data.loggedInClass].assessments.push(newDeadline);
                writeClassDB(db);
                
                updateSessionState(userId, 'REP_DEADLINES_MENU', session.data);

                // --- DYNAMIC SUCCESS MESSAGE ---
                let replyMsg = `🎉 *DEADLINE CREATED!*\n\n`;
                
                if (timeDiffMs <= stage2Ms) {
                    replyMsg += `⚠️ *EXTREME URGENCY DETECTED:*\nThis deadline is critically close. All automated background reminders have been muted to prevent spam.\n\n👉 *Use Option 4 (Panic Blast) right now to notify students immediately!*\n\n`;
                } else if (timeDiffMs <= stage1Ms) {
                    replyMsg += `⚠️ *MODERATE URGENCY DETECTED:*\nThe first automated reminder was bypassed because the deadline is close. The *final* automated reminder will still fire when it gets extremely close.\n\n👉 *Use Option 4 (Panic Blast) right now if you want to notify students of this addition immediately!*\n\n`;
                } else {
                    replyMsg += `It is now actively counting down. The system will automatically send two phased reminders to students as it gets close.\n\n`;
                }

                replyMsg += `1. ➕ Add New Deadline\n2. 👁️ View Active Deadlines\n3. 🗑️ Delete a Deadline\n4. 🚨 Send Panic Blast\n\n0. 🔙 Back`;
                
                await message.reply(replyMsg);
                break;
            }

            // DELETE DEADLINE
            case 'REP_DEADLINES_REMOVE': {
                if (input === '0') {
                    updateSessionState(userId, 'REP_DEADLINES_MENU', session.data);
                    await message.reply(`📚 Returning to Deadlines Menu....`);
                    return;
                }
                
                const assessments = db.classes[session.data.loggedInClass].assessments;
                const selectedIdx = parseInt(input) - 1;
                
                if (isNaN(selectedIdx) || selectedIdx < 0 || selectedIdx >= assessments.length) {
                    await message.reply(`❌ Invalid selection. Reply with a valid number.`);
                    return;
                }
                
                assessments.splice(selectedIdx, 1);
                writeClassDB(db);
                
                updateSessionState(userId, 'REP_DEADLINES_MENU', session.data);
                await message.reply(`✅ Deadline Deleted successfully.\n\n0. 🔙 Back to Deadlines Menu`);
                break;
            }

            // PANIC BLAST (BROADCAST DEADLINE)
            case 'REP_DEADLINES_PANIC': {
                if (input === '0') {
                    updateSessionState(userId, 'REP_DEADLINES_MENU', session.data);
                    await message.reply(`📚 Returning to Deadlines Menu...`);
                    return;
                }
                
                const assessments = db.classes[session.data.loggedInClass].assessments;
                const selectedIdx = parseInt(input) - 1;
                
                if (isNaN(selectedIdx) || selectedIdx < 0 || selectedIdx >= assessments.length) {
                    await message.reply(`❌ Invalid selection. Reply with a valid number.`);
                    return;
                }
                
                const targetDeadline = assessments[selectedIdx];
                const timeDiffMs = targetDeadline.timestamp - Date.now();
                const days = Math.floor(timeDiffMs / (1000 * 60 * 60 * 24));
                const hours = Math.floor((timeDiffMs % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
                let countdown = days > 0 ? `${days} Days, ${hours} Hours` : `${hours} Hours`;
                
                const members = db.classes[session.data.loggedInClass].members;
                const memberIds = Object.keys(members);
                let blastStatus = "";

                if (memberIds.length > 0) {
                    await message.reply(`🚀 *INITIATING PANIC BLAST*\n\nSending direct messages to ${memberIds.length} registered students...\n\nPlease wait a moment.`);

                    let sentCount = 0;
                    let failedCount = 0;
                    let successList = "";
                    let failList = "";

                    for (let mId of memberIds) {
                        const student = members[mId];
                        try {
                            await client.sendMessage(
                                student.phoneId,
                                `🚨 *DEADLINE WARNING* 🚨\n\n🏫 Class: *${session.data.loggedInClass}*\n\n${targetDeadline.icon} *[${targetDeadline.type}] ${targetDeadline.unit}*\n📝 Details: ${targetDeadline.details}\n⏰ *DUE IN: ${countdown}*\n\n_(Submitted by Rep: ${db.classes[session.data.loggedInClass].repName})_`
                            );
                            sentCount++;
                            successList += `▪️ ${student.name} (${student.admission})\n`;
                        } catch (e) {
                            failedCount++;
                            failList += `▪️ ${student.name} (${student.admission})\n`;
                        }
                    }

                    blastStatus = `✅ *PANIC BLAST COMPLETE*\n🟢 Delivered: ${sentCount}\n🔴 Failed: ${failedCount}\n\n`;
                    if (sentCount > 0) blastStatus += `*✅ DELIVERED TO:*\n${successList}\n`;
                    if (failedCount > 0) blastStatus += `*❌ FAILED TO DELIVER:*\n${failList}\n`;

                } else {
                    blastStatus = `⚠️ *NO BROADCAST*\nNo students are currently registered to receive this warning.\n\n`;
                }

                updateSessionState(userId, 'REP_DEADLINES_MENU', session.data);
                await message.reply(`${blastStatus}✅ *Panic Blast Processed!*\n\n0. 🔙 Back to Deadlines Menu`);
                break;
            }
            // ==========================================
            // PHASE 4: STUDENT GATEWAY & SECURITY
            // ==========================================
            case 'STUDENT_GATEWAY': {
                if (input === '0') {
                    updateSessionState(userId, 'MAIN_MENU');
                    await sendMainMenu(message);
                    return;
                }
                if (input === '1') {
                    // Login Process
                    const members = db.classes[session.data.loggedInClass].members;
                    const memberIds = Object.keys(members);
                    
                    if (memberIds.length === 0) {
                        await message.reply(`⚠️ No students are registered in this class yet.\nType *0* to go back, or *2* to register.`);
                        return;
                    }
  
                    let memberList = `👥 *SELECT YOUR NAME*\n━━━━━━━━━━━━━━━━━━\n`;
                    memberIds.forEach((mId, idx) => {
                        memberList += `${idx + 1}. ${members[mId].name}\n`;
                    });
                    memberList += `\n*Reply with your number:*\n(Type *0* to go back)`;
                    
                    updateSessionState(userId, 'STUDENT_LOGIN_SELECT', { ...session.data, memberIds });
                    await message.reply(memberList);
  
                } else if (input === '2') {
                    // ========================================================
                    // GLOBAL SECURITY CHECK: Scan ALL classes in the database
                    // ========================================================
                    let registeredClassFound = null;
                    let existingStudentName = null;
  
                    for (const [className, classData] of Object.entries(db.classes)) {
                      if (classData.members) {
                          const matchedMember = Object.values(classData.members).find(
                              m => m.phoneId === userId
                          );
                          if (matchedMember) {
                              registeredClassFound = className;
                              existingStudentName = matchedMember.name;
                              break;
                          }
                      }
                  }
  
                    if (registeredClassFound) {
                        await message.reply(
                            `❌ *GLOBAL REGISTRATION BLOCKED*\n\n` +
                            `Your WhatsApp number is already registered under *${existingStudentName}* in another class portal: *${registeredClassFound}*.\n\n` +
                            `You are restricted to a single active student profile across the system.\n\n` +
                            `(Type *0* to go back)`
                        );
                        return;
                    }
                    // ========================================================
  
                    // Registration Process Step 1
                    updateSessionState(userId, 'STUDENT_REG_NAME', session.data);
                    await message.reply(`📝 *STUDENT REGISTRATION*\n\nEnter your *Full Name*:\n(Type *0* to cancel)`);
                } else {
                    await message.reply(`❌ Invalid choice. Type 1 or 2.`);
                }
                break;
            }

            // --- REGISTRATION FLOW ---
            case 'STUDENT_REG_NAME': {
                if (input === '0') { updateSessionState(userId, 'STUDENT_GATEWAY', session.data); await sendStudentGateway(message, session.data.loggedInClass); return; }
                updateSessionState(userId, 'STUDENT_REG_ADM', { ...session.data, regName: input });
                await message.reply(`✅ Name saved: *${input}*\n\nEnter your *Admission Number* (e.g., BSIT/045J/2024):`);
                break;
            }

            case 'STUDENT_REG_ADM': {
                if (input === '0') { 
                    updateSessionState(userId, 'STUDENT_REG_NAME', session.data); 
                    await message.reply(`📝 *STUDENT REGISTRATION*\n\nEnter your *Full Name*:\n(Type *0* to cancel)`); 
                    return; 
                }
              
              const cleanAdm = input.trim().toUpperCase();
              const members = db.classes[session.data.loggedInClass].members;

              // SECURITY CHECK: Prevent duplicate admission numbers
              const admissionTaken = Object.values(members).some(
                  m => m.admission.toUpperCase() === cleanAdm
              );
              
              if (admissionTaken) {
                  await message.reply(`❌ *DUPLICATE ADMISSION*\n\nThe admission number *${input}* is already registered in this class database.\n\nIf this is your admission number, someone else has used it or you already registered. Use the login option.`);
                  return;
              }

              updateSessionState(userId, 'STUDENT_REG_PASS', { ...session.data, regAdm: cleanAdm });
              await message.reply(`✅ Admission No saved: *${cleanAdm}*\n\nCreate a *Personal Password* for your portal login:\n(Make it secure but easy to remember!)`);
              break;
          }

          case 'STUDENT_REG_PASS': {
            if (input === '0') { 
                updateSessionState(userId, 'STUDENT_REG_ADM', session.data); 
                await message.reply(`✅ Name saved: *${session.data.regName}*\n\nEnter your *Admission Number* (e.g., BSIT/045J/2024):`); 
                return; 
            }

              updateSessionState(userId, 'STUDENT_REG_SEC_Q', { ...session.data, regPass: input });
              await message.reply(`✅ Password saved.\n\n🛡️ *SECURITY RECOVERY*\nPlease type a custom *Security Question* (e.g., What is my pet's name?, What is my favorite movie?).\n\nYou will be asked this if you forget your password:`);
              break;
          }

          case 'STUDENT_REG_SEC_Q': {
                if (input === '0') { 
                    updateSessionState(userId, 'STUDENT_REG_PASS', session.data); 
                    await message.reply(`✅ Admission No saved: *${session.data.regAdm}*\n\nCreate a *Personal Password* for your portal login:\n(Make it secure but easy to remember!)`); 
                    return; 
                }

              updateSessionState(userId, 'STUDENT_REG_SEC_A', { ...session.data, secQuestion: input });
              await message.reply(`✅ Question saved: *${input}*\n\nNow, type the *Answer* to your question:\n(Keep it simple and easy to remember!)`);
              break;
          }

          case 'STUDENT_REG_SEC_A': {
            if (input === '0') { 
                updateSessionState(userId, 'STUDENT_REG_SEC_Q', session.data); 
                await message.reply(`✅ Password saved.\n\n🛡️ *SECURITY RECOVERY*\nPlease type a custom *Security Question* (e.g., What is my pet's name?, What is my favorite movie?).\n\nYou will be asked this if you forget your password:`); 
                return; 
            }
              
              // Save to Database
              const newMemberId = `std_${Date.now()}`;
              db.classes[session.data.loggedInClass].members[newMemberId] = {
                  name: session.data.regName,
                  admission: session.data.regAdm,
                  password: hashSecret(session.data.regPass),
                  securityQuestion: session.data.secQuestion,
                  securityAnswer: hashSecret(input.trim().toLowerCase()),
                  locked: false,
                  phoneId: userId
              };
              
              // Add to Class Logs
              db.classes[session.data.loggedInClass].logs.push({
                  text: `New Registration: ${session.data.regName} (${session.data.regAdm})`,
                  timestamp: Date.now()
              });
              
              writeClassDB(db);
              
              updateSessionState(userId, 'STUDENT_DASHBOARD', { ...session.data, currentStudentId: newMemberId, studentName: session.data.regName });
              await message.reply(`🎉 *REGISTRATION COMPLETE!*\n\nWelcome to the ${session.data.loggedInClass} portal, ${session.data.regName}.`);
              await sendStudentDashboard(message, session.data.loggedInClass, session.data.regName);
              break;
          }

            // --- LOGIN FLOW ---
            case 'STUDENT_LOGIN_SELECT': {
              if (input === '0') { updateSessionState(userId, 'STUDENT_GATEWAY', session.data); await sendStudentGateway(message, session.data.loggedInClass); return; }
              
              const selectedIdx = parseInt(input) - 1;
              const mIds = session.data.memberIds;
              
              if (isNaN(selectedIdx) || selectedIdx < 0 || selectedIdx >= mIds.length) {
                  await message.reply(`❌ Invalid selection. Reply with a valid number.`);
                  return;
              }
              
              const chosenMemberId = mIds[selectedIdx];
              const chosenStudent = db.classes[session.data.loggedInClass].members[chosenMemberId];
              
              if (chosenStudent.locked) {
                  await message.reply(`🚨 *ACCOUNT LOCKED*\n\nYour account has been locked due to failed security attempts. The Class Rep has been notified to resolve this issue.\n\nType *0* to go back.`);
                  return;
              }

              // NEW BLOCK: Check if the Rep just unlocked them and issued an OTP
              if (chosenStudent.pendingRepReset) {
                  updateSessionState(userId, 'STUDENT_LOGIN_OTP', { ...session.data, loginTargetId: chosenMemberId, otpAttempts: 0 });
                  await message.reply(`🔓 *ACCOUNT UNLOCKED*\n\nYour Class Rep has resolved your lockout. \n\nPlease enter the *4-Digit One-Time Code* provided by your Class Rep:`);
                  return;
              }

              // Normal Login (If not locked, and not pending an OTP reset)
              updateSessionState(userId, 'STUDENT_LOGIN_PASS', { ...session.data, loginTargetId: chosenMemberId, attempts: 0 });
              await message.reply(`🔐 *LOGIN: ${chosenStudent.name}*\n\nEnter your Personal Password:\n(Type *0* to go back)`);
              break;
          }

          case 'STUDENT_LOGIN_PASS': {
            if (input === '0') { 
                const db = readClassDB();
                const members = db.classes[session.data.loggedInClass].members;
                let memberList = `👥 *SELECT YOUR NAME*\n━━━━━━━━━━━━━━━━━━\n`;
                session.data.memberIds.forEach((mId, idx) => {
                    memberList += `${idx + 1}. ${members[mId].name}\n`;
                });
                memberList += `\n*Reply with your number:*\n(Type *0* to go back)`;
                
                updateSessionState(userId, 'STUDENT_LOGIN_SELECT', session.data); 
                await message.reply(memberList);
                return; 
            }
                
                const targetStudentId = session.data.loginTargetId;
                const studentRecord = db.classes[session.data.loggedInClass].members[targetStudentId];
                let attempts = session.data.attempts || 0;

                if (verifySecret(input, studentRecord.password)) {
                    // Success
                    updateSessionState(userId, 'STUDENT_DASHBOARD', { ...session.data, currentStudentId: targetStudentId, studentName: studentRecord.name });
                    await message.reply(`✅ *Access Granted*\nWelcome back, ${studentRecord.name}!`);
                    await sendStudentDashboard(message, session.data.loggedInClass, studentRecord.name);
                } else {
                    attempts++;
                    if (attempts >= 3) {
                      // 3 Strikes - Go to Security Question
                      updateSessionState(userId, 'STUDENT_LOGIN_SEC', { ...session.data, secAttempts: 0 });
                      await message.reply(`🚨 *TOO MANY FAILED ATTEMPTS*\n\nTo verify your identity, please answer your security question:\n\n❓ *${studentRecord.securityQuestion}*`);
                  } else {
                        updateSessionState(userId, 'STUDENT_LOGIN_PASS', { ...session.data, attempts });
                        await message.reply(`❌ Incorrect Password.\nYou have ${3 - attempts} attempt(s) left.\nTry again, or type *0* to go back.`);
                    }
                }
                break;
            }

            case 'STUDENT_LOGIN_SEC': {
                if (input === '0') {
                    const db = readClassDB();
                    const chosenStudent = db.classes[session.data.loggedInClass].members[session.data.loginTargetId];
                    updateSessionState(userId, 'STUDENT_LOGIN_PASS', session.data);
                    await message.reply(`🔐 *LOGIN: ${chosenStudent.name}*\n\nEnter your Personal Password:\n(Type *0* to go back)`);
                    return;
                }
              const secStudentId = session.data.loginTargetId;
              const secRecord = db.classes[session.data.loggedInClass].members[secStudentId];
              let secAttempts = session.data.secAttempts || 0;

              // Compare input in lowercase to make it forgiving (e.g. "Fluffy" vs "fluffy")
              if (verifySecret(input.trim().toLowerCase(), secRecord.securityAnswer)) {
                  updateSessionState(userId, 'STUDENT_RESET_PASS', session.data);
                  await message.reply(`✅ *IDENTITY VERIFIED*\n\nPlease enter a *NEW* Personal Password for your account:`);
              } else {
                  secAttempts++;
                  if (secAttempts >= 2) {
                      // Total Lockout
                      db.classes[session.data.loggedInClass].members[secStudentId].locked = true;
                      db.classes[session.data.loggedInClass].issues.push({
                          memberId: secStudentId,
                          name: secRecord.name,
                          reason: 'Failed Custom Security Question',
                          timestamp: Date.now()
                      });
                      writeClassDB(db);
                      
                      updateSessionState(userId, 'MAIN_MENU');
                      await message.reply(`🚨 *ACCOUNT LOCKED*\n\nYou failed the security verification. An issue has been raised with your Class Rep. You cannot login until they resolve it.\n\nType *99* to exit.`);
                  } else {
                      updateSessionState(userId, 'STUDENT_LOGIN_SEC', { ...session.data, secAttempts });
                      await message.reply(`❌ Incorrect Answer. You have 1 attempt left before your account is locked:`);
                  }
              }
              break;
          }

            case 'STUDENT_RESET_PASS': {
                if (input === '0') {
                    const db = readClassDB();
                    const chosenStudent = db.classes[session.data.loggedInClass].members[session.data.loginTargetId];
                    updateSessionState(userId, 'STUDENT_LOGIN_PASS', { ...session.data, attempts: 0 });
                    await message.reply(`🔐 *LOGIN: ${chosenStudent.name}*\n\nEnter your Personal Password:\n(Type *0* to go back)`);
                    return;
                }

                const resetStudentId = session.data.loginTargetId;
                db.classes[session.data.loggedInClass].members[resetStudentId].password = hashSecret(input);
                writeClassDB(db);
                
                updateSessionState(userId, 'STUDENT_DASHBOARD', { ...session.data, currentStudentId: resetStudentId, studentName: db.classes[session.data.loggedInClass].members[resetStudentId].name });
                await message.reply(`✅ *PASSWORD RESET SUCCESSFUL*\n\nWelcome back to your portal.`);
                await sendStudentDashboard(message, session.data.loggedInClass, db.classes[session.data.loggedInClass].members[resetStudentId].name);
                break;
            }

            // --- REP UNLOCK / OTP FLOW ---
            case 'STUDENT_LOGIN_OTP': {
                if (input === '0') { 
                    const db = readClassDB();
                    const members = db.classes[session.data.loggedInClass].members;
                    let memberList = `👥 *SELECT YOUR NAME*\n━━━━━━━━━━━━━━━━━━\n`;
                    session.data.memberIds.forEach((mId, idx) => {
                        memberList += `${idx + 1}. ${members[mId].name}\n`;
                    });
                    memberList += `\n*Reply with your number:*\n(Type *0* to go back)`;
                    
                    updateSessionState(userId, 'STUDENT_LOGIN_SELECT', session.data); 
                    await message.reply(memberList);
                    return; 
                }
              
              const otpTargetId = session.data.loginTargetId;
              const otpRecord = db.classes[session.data.loggedInClass].members[otpTargetId];
              let otpAttempts = session.data.otpAttempts || 0;

              if (verifySecret(input, otpRecord.resetOtp)) {
                  updateSessionState(userId, 'STUDENT_FORCE_NEW_PASS', session.data);
                  await message.reply(`✅ *CODE ACCEPTED*\n\nLet's get your account fully recovered.\n\nPlease enter a *NEW Personal Password*:`);
              } else {
                  otpAttempts++;
                  if (otpAttempts >= 3) {
                      db.classes[session.data.loggedInClass].members[otpTargetId].locked = true;
                      db.classes[session.data.loggedInClass].members[otpTargetId].pendingRepReset = false;
                      
                      db.classes[session.data.loggedInClass].issues.push({
                          memberId: otpTargetId,
                          name: otpRecord.name,
                          reason: 'Failed Rep-Assigned OTP Code',
                          timestamp: Date.now()
                      });
                      writeClassDB(db);
                      
                      updateSessionState(userId, 'MAIN_MENU');
                      await message.reply(`🚨 *ACCOUNT LOCKED*\n\nYou failed the One-Time Code. Your account is locked again.\n\nType *99* to exit.`);
                  } else {
                      updateSessionState(userId, 'STUDENT_LOGIN_OTP', { ...session.data, otpAttempts });
                      await message.reply(`❌ Incorrect Code. You have ${3 - otpAttempts} attempt(s) left:`);
                  }
              }
              break;
          }

          case 'STUDENT_FORCE_NEW_PASS': {
            if (input === '0') { updateSessionState(userId, 'STUDENT_GATEWAY', session.data); await sendStudentGateway(message, session.data.loggedInClass); return; }
            updateSessionState(userId, 'STUDENT_FORCE_NEW_SEC_Q', { ...session.data, tempPass: input });
            await message.reply(`✅ Password saved.\n\nNow, please type a *NEW Custom Security Question* (e.g., What is my favorite food?):`);
            break;
        }

        case 'STUDENT_FORCE_NEW_SEC_Q': {
            if (input === '0') { updateSessionState(userId, 'STUDENT_GATEWAY', session.data); await sendStudentGateway(message, session.data.loggedInClass); return; }
            updateSessionState(userId, 'STUDENT_FORCE_NEW_SEC_A', { ...session.data, newSecQuestion: input });
            await message.reply(`✅ Question saved: *${input}*\n\nNow, type the *Answer* to that question:`);
            break;
        }

        case 'STUDENT_FORCE_NEW_SEC_A': {
            if (input === '0') { updateSessionState(userId, 'STUDENT_GATEWAY', session.data); await sendStudentGateway(message, session.data.loggedInClass); return; }
            
            const finalTargetId = session.data.loginTargetId;
            const memberRef = db.classes[session.data.loggedInClass].members[finalTargetId];
            
            // Save new credentials and clear OTP locks
            memberRef.password = hashSecret(session.data.tempPass);
            memberRef.securityQuestion = session.data.newSecQuestion;
            memberRef.securityAnswer = hashSecret(input.trim().toLowerCase());
            memberRef.pendingRepReset = false;
            delete memberRef.resetOtp;
            
            writeClassDB(db);
            
            updateSessionState(userId, 'STUDENT_DASHBOARD', { ...session.data, currentStudentId: finalTargetId, studentName: memberRef.name });
            await message.reply(`🎉 *RECOVERY COMPLETE!*\n\nYour new password and security question are saved. Welcome back to your portal.`);
            await sendStudentDashboard(message, session.data.loggedInClass, memberRef.name);
            break;
        }

            // --- STUDENT DASHBOARD ---
            case 'STUDENT_DASHBOARD': {
                if (input === '0') {
                    updateSessionState(userId, 'MAIN_MENU');
                    await sendMainMenu(message);
                    return;
                }
                
                const sClass = session.data.loggedInClass;
                const sDb = db.classes[sClass];

                if (input === '1') {
                    // View Today's Timetable
                    const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
                    const todayIdx = new Date(new Date().toLocaleString("en-US", {timeZone: "Africa/Nairobi"})).getDay();
                    const todayStr = days[todayIdx];
                    const todayClasses = sDb.timetable[todayStr];
                    
                    let todayRes = `📅 *TODAY'S CLASSES (${todayStr.toUpperCase()})*\n━━━━━━━━━━━━━━━━━━\n`;
                    if (!todayClasses || todayClasses.length === 0) {
                        todayRes += `No classes scheduled for today! 🏖️\n`;
                    } else {
                        todayClasses.forEach(c => todayRes += `▪️ *${c.unit}* @ ${c.time}\n`);
                    }
                    
                    // 🛡️ NEW: Locks them in a view state so 0 goes back to Dashboard
                    updateSessionState(userId, 'STUDENT_VIEW_ONLY', session.data);
                    await message.reply(todayRes + `\n(Type *0* to go back)`);

                } else if (input === '2') {
                    // View Full Timetable
                    const daysList = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
                    let ttFull = `🗓️ *FULL TIMETABLE*\n━━━━━━━━━━━━━━━━━━\n`;
                    daysList.forEach(d => {
                        if (sDb.timetable[d] && sDb.timetable[d].length > 0) {
                            ttFull += `*${d.toUpperCase()}*\n`;
                            sDb.timetable[d].forEach(c => ttFull += `  ▪️ ${c.unit} @ ${c.time}\n`);
                            ttFull += `\n`;
                        }
                    });
                    if (ttFull === `🗓️ *FULL TIMETABLE*\n━━━━━━━━━━━━━━━━━━\n`) ttFull += `No classes scheduled yet.\n`;
                    
                    // 🛡️ NEW: Locks them in a view state so 0 goes back to Dashboard
                    updateSessionState(userId, 'STUDENT_VIEW_ONLY', session.data);
                    await message.reply(ttFull + `(Type *0* to go back)`);

                } else if (input === '3') {
                    // View Upcoming Deadlines
                    let assessments = sDb.assessments || [];
                    const now = Date.now();
                    assessments = assessments.filter(a => a.timestamp > now);
                    
                    if (assessments.length === 0) {
                        await message.reply(`🎉 *NO UPCOMING DEADLINES!*\n\nYou are all caught up.\n\n(Type *0* to go back)`);
                        return;
                    }
                    
                    assessments.sort((a, b) => a.timestamp - b.timestamp);
                    let viewStr = `⏳ *YOUR UPCOMING DEADLINES*\n━━━━━━━━━━━━━━━━━━\n\n`;
                    assessments.forEach(a => {
                        const timeDiffMs = a.timestamp - now;
                        let countdown = "";

                        if (timeDiffMs <= 0) {
                            countdown = "⚠️ Deadline Passed";
                        } else {
                            const days = Math.floor(timeDiffMs / (1000 * 60 * 60 * 24));
                            const hours = Math.floor((timeDiffMs % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
                            const minutes = Math.floor((timeDiffMs % (1000 * 60 * 60)) / (1000 * 60));
                            const seconds = Math.floor((timeDiffMs % (1000 * 60)) / 1000);
                            
                            let parts = [];
                            if (days > 0) parts.push(`${days}d`);
                            if (hours > 0 || days > 0) parts.push(`${hours}h`);
                            parts.push(`${minutes}m`);
                            parts.push(`${seconds}s`);
                            
                            countdown = parts.join(' ');
                        }
                        
                        viewStr += `${a.icon} *[${a.type}] ${a.unit}*\n📝 Details: ${a.details}\n⏰ Due In: *${countdown}*\n\n`;
                    });
                    await message.reply(viewStr + `(Type *0* to go back)`);

                } else if (input === '4') {
                    // View Updates
                    const ONE_DAY = 24 * 60 * 60 * 1000;
                    const now = Date.now();
                    const recentUpdates = (sDb.updates || []).filter(u => now - u.timestamp < ONE_DAY);

                    if (recentUpdates.length === 0) {
                        await message.reply(`📭 No active updates from the Class Rep in the last 24 hours.\n(Type *0* to go back)`);
                        return;
                    }
                    
                    let upStr = `📢 *24H CLASS UPDATES*\n━━━━━━━━━━━━━━━━━━\n\n`;
                    recentUpdates.forEach((u, i) => {
                        const dObj = new Date(u.timestamp);
                        const tStr = dObj.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Nairobi' });
                        if (i === recentUpdates.length - 1) upStr += `🚨 *LATEST [${tStr}]*\n*${u.text}*\n\n`;
                        else upStr += `▪️ [${tStr}]\n${u.text}\n\n`;
                    });
                    await message.reply(upStr + `(Type *0* to go back)`);

                } else if (input === '5') {
                    // View Classmates (including Rep and Assistants)
                    const membersObj = getAllClassParticipants(sDb);
                    const mIds = getSortedMemberIds(sDb);

                    if (mIds.length === 0) {
                        await message.reply(`No participants registered yet.\n(Type *0* to go back)`);
                        return;
                    }
                    let cmStr = `👥 *CLASS PARTICIPANTS (${mIds.length})*\n━━━━━━━━━━━━━━━━━━\n`;
                    mIds.forEach((id, idx) => {
                        const m = membersObj[id];
                        const isRep = m.phoneId === sDb.repId || m.isRep;
                        const isAsst = sDb.assistantReps?.includes(m.phoneId);
                        
                        let badge = '';
                        if (isRep) badge = ' 👑 *[Class Rep]*';
                        else if (isAsst) badge = ' ⭐ *[Asst Rep]*';

                        cmStr += `${idx + 1}. ${m.name.toUpperCase()} (${m.admission.toUpperCase()})${badge}\n`;
                    });
                    await message.reply(cmStr + `\n(Type *0* to go back)`);
                } else if (input === '6') {
                    // ⏱️ THE CHRONOS ENGINE
                    const currentEAT = new Date(new Date().toLocaleString("en-US", {timeZone: "Africa/Nairobi"}));
                    const daysList = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
                    const todayStr = daysList[currentEAT.getDay()];
                    const todayClasses = sDb.timetable[todayStr] || [];

                    if (todayClasses.length === 0) {
                        await message.reply(`🏖️ No classes scheduled for today! Relax.\n\n(Type *0* to go back)`);
                        return;
                    }

                    const currentMins = (currentEAT.getHours() * 60) + currentEAT.getMinutes();
                    let nextClass = null;
                    let minDiff = Infinity;

                    todayClasses.forEach(c => {
                        const match = c.time.match(/(\d+):(\d+)\s*(AM|PM)/i);
                        if (match) {
                            let h = parseInt(match[1]);
                            let m = parseInt(match[2]);
                            if (match[3].toUpperCase() === 'PM' && h !== 12) h += 12;
                            if (match[3].toUpperCase() === 'AM' && h === 12) h = 0;
                            
                            const classMins = (h * 60) + m;
                            const diff = classMins - currentMins;
                            
                            if (diff > 0 && diff < minDiff) {
                                minDiff = diff;
                                nextClass = c;
                            }
                        }
                    });

                    if (nextClass) {
                        const hrs = Math.floor(minDiff / 60);
                        const mins = minDiff % 60;
                        const timeString = hrs > 0 ? `${hrs}h ${mins}m` : `${mins}m`;
                        await message.reply(`⏱️ *CHRONOS ENGINE*\n━━━━━━━━━━━━━━━━━━\n**Next Class:** ${nextClass.unit}\n**Starts In:** ${timeString} (at ${nextClass.time})\n\n(Type *0* to go back)`);
                    } else {
                        await message.reply(`✅ All of today's scheduled classes have already passed.\n\n(Type *0* to go back)`);
                    }

                } else if (input === '7') {
                    // 🤫 INITIATE WHISPER PROTOCOL
                    updateSessionState(userId, 'STUDENT_WHISPER_COMPOSE', session.data);
                    await message.reply(`🤫 *THE WHISPER PROTOCOL*\n\nYour message will be sent anonymously to the Class Rep. Your name and phone number will be hidden.\n\nType your feedback/complaint below:\n(Type *0* to cancel)`);
                
                } else if (input === '8') {
                    // 👻 GHOST TRACKER: SIGN ROLL CALL
                    if (!sDb.activeRollCall) {
                        await message.reply(`❌ No active roll call right now. Wait for your Class Rep to open the register.\n\n(Type *0* to go back)`);
                        return;
                    }

                    const mId = session.data.currentStudentId;
                    const studentData = sDb.members[mId];
                    if (!sDb.activeRollCall.attendees || typeof sDb.activeRollCall.attendees !== 'object') sDb.activeRollCall.attendees = {};
                    if (sDb.activeRollCall.attendees[mId]) {
                        await message.reply(`✅ You have already signed the register for *${sDb.activeRollCall.unit}*.\n\n(Type *0* to go back)`);
                        return;
                    }

                    studentData.attendedClasses = (studentData.attendedClasses || 0) + 1;
                    studentData.lastSigned = sDb.activeRollCall.dateKey || sDb.activeRollCall.date;
                    // Push students to the Rep's active register
                    sDb.activeRollCall.attendees[mId] = {
                        name: studentData.name,
                        regNo: studentData.admission,
                        timestamp: new Date().toLocaleTimeString("en-US", {timeZone: "Africa/Nairobi"}),
                        checkedInAt: Date.now(),
                        status: 'PRESENT'
                    };
                    writeClassDB(db);

                    await message.reply(`✅ *ATTENDANCE LOGGED*\nYour presence has been recorded in the Ghost Tracker.\n\n(Type *0* to go back)`);
                } else if (input === '9') {
                    // Enter Hustle Board
                    if (!sDb.marketplace) { sDb.marketplace = []; writeClassDB(db); }
                    updateSessionState(userId, 'MARKET_HOME', session.data);
                    const notifs = getMarketNotifs(sClass, userId);
                    await message.reply(`🛒 *THE HUSTLE BOARD*\n━━━━━━━━━━━━━━━━━━\n1. 🛍️ Buy (Browse Items)\n2. 🏷️ Sell / Barter an Item\n3. 🔔 Notifications (${notifs})\n4. 📦 My Listings\n\n0. 🔙 Back to Dashboard`);
                } else if (input === '10') {
                    // View Poll Results
                    if (!sDb.polls) { sDb.polls = []; writeClassDB(db); }
                    const closedPolls = sDb.polls.filter(p => p.status === 'CLOSED');
                    if (closedPolls.length === 0) {
                        await message.reply(`📭 No completed polls to display.\n(Type *0* to go back)`);
                        return;
                    }
                    let resStr = `📊 *PAST POLL RESULTS*\n━━━━━━━━━━━━━━━━━━\n\n`;
                    closedPolls.forEach((p, i) => {
                        resStr += `*Poll ${i+1}:* ${p.question}\n`;
                        resStr += p.finalResultStr ? p.finalResultStr.replace('🛑 *POLL CLOSED* 🛑\n━━━━━━━━━━━━━━━━━━\n', '').replace(`❓ *${p.question}*\n\n`, '') : 'No data';
                        resStr += `\n━━━━━━━━━━━━━━━━━━\n\n`;
                    });
                    await message.reply(resStr + `(Type *0* to go back)`);
                } else if (input === '11') {
                    const now = Date.now();
                    const dayMs = 24 * 60 * 60 * 1000;
                    const weekEnd = now + (7 * dayMs);
                    let weekText = `🗓️ *MY WEEK — ${sClass}*\n━━━━━━━━━━━━━━━━━━\n\n`;
                    for (let offset = 0; offset < 7; offset++) {
                        const dayDate = new Date(now + (offset * dayMs));
                        const parts = new Intl.DateTimeFormat('en-US', {
                            timeZone: 'Africa/Nairobi',
                            weekday: 'long',
                            day: 'numeric',
                            month: 'short'
                        }).formatToParts(dayDate);
                        const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
                        const dayName = values.weekday.toLowerCase();
                        const classes = sDb.timetable?.[dayName] || [];
                        weekText += `* ${values.weekday} ${values.day} ${values.month}*\n`;
                        weekText += classes.length
                            ? classes.slice(0, 5).map(item => `  • ${item.unit} @ ${item.time}`).join('\n') + '\n'
                            : '  • No classes scheduled\n';
                    }
                    const deadlines = (sDb.assessments || [])
                        .filter(item => Number(item.timestamp) > now && Number(item.timestamp) <= weekEnd)
                        .sort((a, b) => Number(a.timestamp) - Number(b.timestamp))
                        .slice(0, 4);
                    weekText += '\n⏳ *Deadlines (next 7 days)*\n';
                    weekText += deadlines.length
                        ? deadlines.map(item => {
                            const due = new Intl.DateTimeFormat('en-KE', {
                                timeZone: 'Africa/Nairobi',
                                day: 'numeric',
                                month: 'short',
                                hour: '2-digit',
                                minute: '2-digit'
                            }).format(new Date(item.timestamp));
                            return `• ${item.unit || item.type}: ${due}`;
                        }).join('\n')
                        : '• None recorded\n';
                    const activePolls = (sDb.polls || []).filter(poll => poll.status === 'ACTIVE').slice(0, 3);
                    weekText += '\n📊 *Active polls*\n';
                    weekText += activePolls.length
                        ? activePolls.map(poll => `• ${poll.question}`).join('\n')
                        : '• None\n';
                    const updates = (sDb.updates || []).filter(update => Number(update.timestamp) >= now - (7 * dayMs)).slice(-3);
                    weekText += '\n📢 *Recent updates*\n';
                    weekText += updates.length
                        ? updates.map(update => `• ${String(update.text).slice(0, 180)}`).join('\n')
                        : '• No recent updates\n';
                    const studentKey = session.data.currentStudentId;
                    const attendanceRecords = (Array.isArray(sDb.attendanceHistory) ? sDb.attendanceHistory : [])
                        .filter(record => Number(record.closedAt) >= now - (7 * dayMs));
                    const studentSessions = attendanceRecords.filter(record =>
                        record.attendance?.some(item => item.memberKey === studentKey && ['PRESENT', 'LATE'].includes(item.status))
                    ).length;
                    if (attendanceRecords.length) {
                        weekText += `\n👻 *My attendance (last 7 days)*: ${studentSessions}/${attendanceRecords.length} sessions`;
                    }
                    updateSessionState(userId, 'STUDENT_VIEW_ONLY', session.data);
                    await message.reply(weekText + '\n\n(Type *0* to go back)');
                 } else {
                    await message.reply(`❌ Invalid choice. Type 1-11, 0 to go back, or 99 to exit.`);
                }
                break;
            }

            case 'STUDENT_VIEW_ONLY': {
                if (input === '0') {
                    updateSessionState(userId, 'STUDENT_DASHBOARD', session.data);
                    await sendStudentDashboard(message, session.data.loggedInClass, session.data.studentName);
                }
                break;
            }

            case 'STUDENT_WHISPER_COMPOSE': {
                if (input === '0') {
                    updateSessionState(userId, 'STUDENT_DASHBOARD', session.data);
                    await sendStudentDashboard(message, session.data.loggedInClass, session.data.studentName);
                    return;
                }
                
                const sClass = session.data.loggedInClass;
                if (!db.classes[sClass].whispers) db.classes[sClass].whispers = [];

                // Generate a random anonymous hash (e.g., Ghost-8F2A)
                const anonHash = 'Ghost-' + Math.random().toString(36).substring(2, 6).toUpperCase();
                
                db.classes[sClass].whispers.push({
                    hash: anonHash,
                    studentId: session.data.currentStudentId,
                    text: input,
                    timestamp: Date.now(),
                    replied: false
                });
                writeClassDB(db);

                updateSessionState(userId, 'STUDENT_DASHBOARD', session.data);
                await message.reply(`✅ *WHISPER DELIVERED*\n\nYour anonymous feedback has been safely routed to the Rep's inbox.\n\n(Type *0* to go back)`);
                break;
            }
        }
    } catch (error) {
        console.error('[CLASS PORTAL ERROR]', error);
        await message.reply('❌ An error occurred in the class portal. Type *99* to restart.');
    }
}

// --- LIVE RADAR ENGINE ---
function getCurrentClassStatus(classData) {
    const currentEAT = new Date(new Date().toLocaleString("en-US", {timeZone: "Africa/Nairobi"}));
    const daysList = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    const todayStr = daysList[currentEAT.getDay()];
    const currentMins = (currentEAT.getHours() * 60) + currentEAT.getMinutes();
    
    // Get date key for temporary exceptions (e.g., 2026-09-23)
    const y = currentEAT.getFullYear();
    const m = String(currentEAT.getMonth() + 1).padStart(2, '0');
    const d = String(currentEAT.getDate()).padStart(2, '0');
    const dateKey = `${y}-${m}-${d}`;

    const todayClasses = classData.timetable?.[todayStr] || [];
    const todayExceptions = classData.exceptions?.[dateKey] || {};

    let ongoingClass = null;
    let nextClass = null;
    let minDiff = Infinity;

    const processSlot = (unitName, startMins, endMins, displayTime) => {
        if (currentMins >= startMins && currentMins <= endMins) {
            ongoingClass = unitName;
        } else if (startMins > currentMins) {
            const diff = startMins - currentMins;
            if (diff < minDiff) {
                minDiff = diff;
                nextClass = { unit: unitName, diff };
            }
        }
    };

    // 1. Check Master Timetable
    todayClasses.forEach(c => {
        if (todayExceptions[c.unit] && todayExceptions[c.unit].status === 'CANCELLED') return;
        
        let sMins = c.startMinutes;
        let eMins = c.endMinutes;

        // Fallback for older classes created before the time upgrade
        if (sMins === undefined && c.time) {
            const match = c.time.match(/(\d+):(\d+)\s*(AM|PM)/i);
            if (match) {
                let h = parseInt(match[1]); let min = parseInt(match[2]);
                if (match[3].toUpperCase() === 'PM' && h !== 12) h += 12;
                if (match[3].toUpperCase() === 'AM' && h === 12) h = 0;
                sMins = (h * 60) + min;
                eMins = sMins + 180; // Estimate 3 hours
            }
        }
        if (sMins !== undefined) processSlot(c.unit, sMins, eMins, c.startTime || c.time);
    });

    // 2. Check for classes temporarily moved TO today
    for (const exKey in todayExceptions) {
        const ex = todayExceptions[exKey];
        if (ex.status === 'MOVED') processSlot(ex.unit, ex.startMinutes, ex.endMinutes, ex.startTime);
    }

    if (ongoingClass) return `🟢 ONGOING: ${ongoingClass}`;
    if (nextClass) {
        const hrs = Math.floor(nextClass.diff / 60);
        const mins = nextClass.diff % 60;
        const tStr = hrs > 0 ? `${hrs}h ${mins}m` : `${mins}m`;
        return `⏳ NEXT: ${nextClass.unit} (in ${tStr})`;
    }
    
    return todayClasses.length > 0 ? "✅ ALL FINISHED TODAY" : "🏖️ FREE DAY";
}

// UI Helpers for Dashboards
async function sendRepDashboard(message, className) {
    const db = readClassDB();
    const classData = db.classes[className] || {};
    const metrics = getPortalMetrics(className, classData.repId);
    
    const repStatus = metrics.repOnline ? '🟢 ONLINE' : '🔴 OFFLINE';
    const holidayStatus = classData.holidayMode ? '🌴 ACTIVE' : '🔴 OFF';
    const classRadar = getCurrentClassStatus(classData);

    const menu = `╭──────────────────────────────╮
│        ⚡ _*TUM*_ × _*CHAOS*_ ⚡        
│                               
│         \`REP COMMAND\`         
│           \`[ ${className} ]\`         
│                               
│   👑 CLASSREP STATUS: ${repStatus}          
│   👥 STUDENTS : ${metrics.activeCount}🟢 ONLINE     
│   🌴 HOLIDAY MODE : ${holidayStatus}  
│   📡 RADAR: ${classRadar}    
╰──────────────────────────────╯
  
  ┌─── ░◈ _*CONTROL BOARD*_ ◈░ ───────┐
  │
  │📅 \`1\` ☞『_*Manage Timetable*_』
  │📢 \`2\` ☞『_*Manage Updates*_』
  │👥 \`3\` ☞『_*Class Members & Attendance*_』
  │🚨 \`4\` ☞『_*Resolve Issues*_』
  │📜 \`5\` ☞『_*View Audit Logs*_』
  │✅ \`6\` ☞『_*Start Roll Call*_』
  │🛑 \`7\` ☞『_*Close Roll Call*_』
  │📚 \`8\` ☞『_*Manage Deadlines*_』
  │🎲 \`9\` ☞『_*Syndicate Maker*_』
  │🤫 \`10\` ☞『_*Whisper Inbox (Feedback)*_』
  │🛒 \`11\` ☞『_*Hustle Board (Market)*_』
  │📊 \`12\` ☞『_*Manage Polls*_』
  │🌴 \`13\` ☞『_*Toggle Holiday Mode*_』
  │🔙 \`0\` ☞『_*Main Menu*_』
  │🚪 \`99\` ☞『_*Logout*_』
  │
  └──────────────────────────────┘
          ⚡ _*TUM*_ × _*CHAOS*_ ⚡`;
  
    await message.reply(menu);
}

async function sendStudentDashboard(message, className, studentName) {
    const db = readClassDB();
    const classData = db.classes[className] || {};

    const polls = classData.polls || [];
    const marketplace = classData.marketplace || [];
    const assessments = classData.assessments || [];
    
    const activePollsCount = polls.filter(p => p.status === 'ACTIVE').length;
    const marketCount = marketplace.filter(i => i.status === 'ACTIVE').length;
    const activeDeadlines = assessments.filter(a => a.timestamp > Date.now()).length;
    const rcStatus = classData.activeRollCall ? '🟢 ACTIVE' : '🔴 CLOSED';

    const metrics = getPortalMetrics(className, classData.repId);
    const repStatus = metrics.repOnline ? '🟢 ONLINE' : '🔴 OFFLINE';
    const classRadar = getCurrentClassStatus(classData);

    const menu = `╭──────────────────────────────╮
│        ⚡ _*TUM*_ × _*CHAOS*_ ⚡        
│                               
│        \`STUDENT PORTAL\`       
│           \`[ ${className} ]\`         
│                               
│   👤 STUDENT: ${studentName}          
│   📝 ROLL CALL: ${rcStatus}           
│   👑 CLASSREP : ${repStatus}
│   👥 CLASSMATES : ${metrics.activeCount}🟢 ONLINE
│   📡 RADAR: ${classRadar}
╰──────────────────────────────╯
  
  ┌─── ░◈ _*STUDENT HUB*_ ◈░ ────────┐
  │
  │📅 \`1\` ☞『_*Today's Classes*_』
  │🗓️ \`2\` ☞『_*Full Timetable*_』
  │⏳ \`3\` ☞『_*Upcoming Deadlines (${activeDeadlines})*_』
  │📢 \`4\` ☞『_*View Class Updates*_』
  │👥 \`5\` ☞『_*View Classmates*_』
  │⏱️ \`6\` ☞『_*Chronos Engine (Next Class)*_』
  │🤫 \`7\` ☞『_*Whisper Protocol (Feedback)*_』
  │👻 \`8\` ☞『_*Sign Attendance (Ghost Tracker)*_』
  │🛒 \`9\` ☞『_*Hustle Board (${marketCount} Active)*_』
  │📊 \`10\` ☞『_*View Polls (${activePollsCount} Active)*_』
  │🗓️ \`11\` ☞『_*My Week*_』
  │🔙 \`0\` ☞『_*Main Menu*_』
  │🚪 \`99\` ☞『_*Logout*_』
  │
  └──────────────────────────────┘
          ⚡ _*TUM*_ × _*CHAOS*_ ⚡`;
  
    await message.reply(menu);
}

async function sendStudentGateway(message, className) {
  const menu = `╭──────────────────────────────╮
│        ⚡ _*TUM*_ × _*CHAOS*_ ⚡        
│                               
│          \`STUDENT PORTAL\`         
│           \`[ ${className} ]\`         
│                               
│   ❒ ACCESS ☞『_*PENDING*_』       
╰──────────────────────────────╯

┌─── ░◈ _*AUTHENTICATION*_ ◈░ ──────┐
│
│🔑 \`1\`
│    ☞『_*Login (Already Registered)*_』
➫➫➫➫ΞΞΞΞΞΞΞΞΞΞΞΞΞΞΞΞΞΞΞΞΞ
│📝 \`2\`
│    ☞『_*Register (First Time)*_』
➫➫➫➫ΞΞΞΞΞΞΞΞΞΞΞΞΞΞΞΞΞΞΞΞΞ
│🔙 \`0\`
│    ☞『_*Back to Main Menu*_』
➫➫➫➫ΞΞΞΞΞΞΞΞΞΞΞΞΞΞΞΞΞΞΞΞΞ
│🚪 \`99\`
│    ☞『_*Logout*_』
│
└──────────────────────────────┘
      ⚡ _*TUM*_ × _*CHAOS*_ ⚡`;

  await message.reply(menu);
}

/**
 * Intercepts 'PRESENT' messages in DMs and logs attendance
 */
async function handleAttendance(message, userId, client) {
    const text = message.body ? message.body.trim().toLowerCase() : '';
    if (text !== 'present') return false; // Ignore if they didn't say present

    const db = readClassDB();
    let studentClass = null;
    let memberId = null;
    let studentData = null;

    // 1. Find which class this student belongs to
    for (const className in db.classes) {
        if (db.classes[className].members) {
            const foundId = Object.keys(db.classes[className].members).find(id => db.classes[className].members[id].phoneId === userId);
            if (foundId) {
                studentClass = className;
                memberId = foundId;
                studentData = db.classes[className].members[foundId];
                break;
            }
        }
    }

    if (!studentClass) return false; 

    const activeRC = db.classes[studentClass].activeRollCall;
    
    // 2. Check if a roll call is actually running for their class
    if (!activeRC) {
        await message.reply("❌ There is no active roll call for your class right now.");
        return true; 
    }

    // 3. Find their internal ID to check if they already signed in
    if (!activeRC.attendees) activeRC.attendees = {};
    if (activeRC.attendees[memberId]) {
        await message.reply(`⚠️ You are already marked present for *${activeRC.unit}*.`);
        return true; 
    }

    // 4. Mark them present
    activeRC.attendees[memberId] = {
        name: studentData.name,
        regNo: studentData.admission,
        timestamp: new Date().toLocaleTimeString("en-US", {timeZone: "Africa/Nairobi"}),
        checkedInAt: Date.now(),
        status: 'PRESENT'
    };

    // Update their Ghost Tracker tally
    studentData.attendedClasses = (studentData.attendedClasses || 0) + 1;
    studentData.lastSigned = activeRC.dateKey || getEATDateKey();

    writeClassDB(db);

    await message.reply(`✅ *ATTENDANCE CONFIRMED*\n\nName: *${studentData.name}*\nUnit: *${activeRC.unit}*\nStatus: *PRESENT* 🟢`);
    return true;
}

async function handleOwnerApplicationReply(client, message, text, applicationId) {
    if (activeApplicationReviews.has(applicationId)) {
        await message.reply('⏳ This application is already being processed.');
        return true;
    }

    activeApplicationReviews.add(applicationId);
    try {
        return await processOwnerApplicationReply(client, message, text, applicationId);
    } finally {
        activeApplicationReviews.delete(applicationId);
    }
}

async function processOwnerApplicationReply(client, message, text, applicationId) {
    const action = String(text || '').trim().split(/\s+/)[0].toLowerCase();
    if (!['accept', 'reject'].includes(action)) return false;

    const db = readClassDB();
    if (!Array.isArray(db.applications)) db.applications = [];
    const application = db.applications.find(item => item.id === applicationId);
    if (!application) {
        await message.reply('⚠️ I could not find that application. Ask the applicant to submit it again.');
        return true;
    }
    if (application.status === 'APPROVED' || application.status === 'REJECTED') {
        await message.reply(`ℹ️ Application ${applicationId} was already ${application.status.toLowerCase()}.`);
        return true;
    }

    if (action === 'accept') {
        // Revoke a hash left by an interrupted approval before issuing a replacement.
        if (application.authorizationCodeHash) {
            db.repCodes = (db.repCodes || []).filter(hash => hash !== application.authorizationCodeHash);
        }

        const code = generateAuthorizationCode();
        const codeHash = hashSecret(code);
        if (!Array.isArray(db.repCodes)) db.repCodes = [];
        db.repCodes.push(codeHash);
        application.status = 'APPROVING';
        application.authorizationCodeHash = codeHash;
        application.reviewStartedAt = Date.now();
        writeClassDB(db);
        await flushClassDB();

        try {
            await client.sendMessage(
                application.applicantId,
                `🎉 *APPLICATION APPROVED!*\n━━━━━━━━━━━━━━━━━━\n\nYour request to become a Class Representative has been verified and accepted.\n\n🎟️ *Your Authorization Code:* \`${code}\`\n\nTo setup your class:\n1. Type \`!class\`\n2. Select *Create a New Class*\n3. Enter your code when prompted.`
            );
        } catch (error) {
            db.repCodes = db.repCodes.filter(hash => hash !== codeHash);
            application.status = 'PENDING';
            delete application.authorizationCodeHash;
            delete application.reviewStartedAt;
            writeClassDB(db);
            await flushClassDB();
            console.warn('[CLASS PORTAL] Could not send authorization code to applicant:', error.message);
            await message.reply('❌ The code could not be delivered, so this application remains pending. You can retry by replying accept to its application card.');
            return true;
        }

        application.status = 'APPROVED';
        application.reviewedAt = Date.now();
        delete application.authorizationCodeHash;
        delete application.reviewStartedAt;
        writeClassDB(db);
        await flushClassDB();
        await message.reply(`✅ Application ${applicationId} approved. The authorization code was delivered to the applicant.`);
        return true;
    }

    if (application.authorizationCodeHash) {
        db.repCodes = (db.repCodes || []).filter(hash => hash !== application.authorizationCodeHash);
        delete application.authorizationCodeHash;
        delete application.reviewStartedAt;
        application.status = 'PENDING';
        writeClassDB(db);
        await flushClassDB();
    }

    let reasonText = String(text || '').trim().replace(/^reject\b/i, '').trim();
    if (reasonText.startsWith(applicationId)) reasonText = reasonText.slice(applicationId.length).trim();
    const reason = reasonText || 'Failed security verification checks.';
    try {
        await client.sendMessage(
            application.applicantId,
            `❌ *APPLICATION REJECTED*\n━━━━━━━━━━━━━━━━━━\n\nYour request to create a Class Portal was denied by the administrators.\n\n*Reason:* ${reason}`
        );
    } catch (error) {
        console.warn('[CLASS PORTAL] Could not send rejection notice to applicant:', error.message);
        await message.reply('❌ The rejection notice could not be delivered. The application remains pending.');
        return true;
    }

    application.status = 'REJECTED';
    application.rejectionReason = reason;
    application.reviewedAt = Date.now();
    writeClassDB(db);
    await flushClassDB();
    await message.reply(`✅ Application ${applicationId} rejected. The applicant was notified.`);
    return true;
}

async function handleOwnerPlaintextResponse(client, message, text, lowerText) {
    if (!/^(accept|reject)(?:\s|$)/i.test(String(text || '').trim())) return false;
    const match = String(text || '').trim().match(/^(accept|reject)\s+(app_[A-Za-z0-9_-]+)(?:\s+([\s\S]*))?$/i);
    if (!match) {
        await message.reply('Reply to the specific application card with `accept` or `reject <reason>`. You can also use `accept <Application ID>` or `reject <Application ID> <reason>`.');
        return true;
    }

    const action = match[1].toLowerCase();
    const applicationId = match[2];
    const details = match[3] || '';
    return handleOwnerApplicationReply(client, message, `${action} ${details}`.trim(), applicationId);
}

module.exports = {
    handleClassCommand,
    handleInput,
    handleAttendance,
    handleOwnerPlaintextResponse,
    handleOwnerApplicationReply
};
