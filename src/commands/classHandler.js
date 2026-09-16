const { readClassDB, writeClassDB, classExists, isUserAlreadyRep } = require('../database/classdb');
const { createSession, updateSessionState, getSession, endSession } = require('../tools/classSession');

let lastApplicantUserId = null;

// Entry point triggered by !class
async function handleClassCommand(client, message, userId, userName) {
    createSession(userId, 'MAIN_MENU');
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
                if (input === '0') { updateSessionState(userId, 'MAIN_MENU'); await sendMainMenu(message); return; }
                updateSessionState(userId, 'APP_LINK', { ...session.data, appClass: input.toUpperCase() });
                await message.reply(`✅ Class saved: *${input.toUpperCase()}*\n\n📝 *REP APPLICATION (Step 2 of 2)*\n\nPaste the *WhatsApp Group Invite Link* for your class.\n\n⚠️ *CRITICAL:* Please ensure you are ready to accept join requests so the admin can verify your group!`);
                break;
            }

            // WIZARD STEP 2: LINK & SUBMIT
            case 'APP_LINK': {
                if (input === '0') { updateSessionState(userId, 'MAIN_MENU'); await sendMainMenu(message); return; }
                
                // 1. Send Application to Owner
                const ownerJid = '254111659469@c.us'; // Your Master Owner Number
                
                // Formatted specifically so the bot can extract the ID when you reply to it
                const appSummary = `📩 *NEW CLASS REP APPLICATION*\n━━━━━━━━━━━━━━━━━━\n` +
                                   `👤 *WA Profile:* ${userName}\n` +
                                   `🏫 *Class:* ${session.data.appClass}\n` +
                                   `🔗 *Link:* ${input}\n\n` +
                                   `📱 *User ID:* \`${userId}\`\n━━━━━━━━━━━━━━━━━━\n` +
                                   `👉 *Swipe right to reply to this message with:*\n` +
                                   `*accept* (to approve & send code)\n` +
                                   `*reject <reason>* (to deny)`;
                
                try {
                    await client.sendMessage(ownerJid, appSummary);
                    lastApplicantUserId = userId;
                } catch (e) {
                    console.warn("[CLASS PORTAL] Could not send application to owner.", e);
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
                    updateSessionState(userId, 'MAIN_MENU');
                    await sendMainMenu(message);
                    return;
                }
                
                const cleanInput = input.trim().toUpperCase();
                
                // Validate against the database array
                if (!db.repCodes || !db.repCodes.includes(cleanInput)) {
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
                    updateSessionState(userId, 'MAIN_MENU');
                    await sendMainMenu(message);
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
                    updateSessionState(userId, 'MAIN_MENU');
                    await sendMainMenu(message);
                    return;
                }

                // SECURITY: Double check the code wasn't used by someone else while they were typing
                if (!db.repCodes || !db.repCodes.includes(session.data.authCode)) {
                    await message.reply(`❌ *AUTHORIZATION EXPIRED*\n\nYour code was just used by someone else or revoked by the system. Class creation failed.\n\nType *0* to go back.`);
                    return;
                }

                // CONSUME THE CODE: Remove it from the database permanently
                db.repCodes = db.repCodes.filter(c => c !== session.data.authCode);

                const newClassName = session.data.pendingClassName;
                
                // Write the new class to the database
                db.classes[newClassName] = {
                    repName: userName, 
                    repId: userId,
                    assistantReps: [],     
                    classPassword: input,
                    timetable: { sunday: [], monday: [], tuesday: [], wednesday: [], thursday: [], friday: [], saturday: [] },
                    updates: [],
                    members: {}, 
                    issues: [],
                    logs: [],
                    assessments: []
                };
                writeClassDB(db);

                updateSessionState(userId, 'MAIN_MENU');
                await message.reply(`🎉 *CLASS SUCCESSFULLY CREATED!*\n\n🏫 *Class:* ${newClassName}\n👑 *Rep:* ${userName}\n🔑 *Class Password:* ${input}\n\nYour portal is now live. Reply with *1* to login and start building your timetable, or *99* to exit.\n\n*DO NOT FORGET YOUR PASSWORD.*`);
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
                    updateSessionState(userId, 'MAIN_MENU');
                    await sendMainMenu(message);
                    return;
                }

                const targetClass = session.data.selectedClass;
                const classData = db.classes[targetClass];

                if (input !== classData.classPassword) {
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
                    await message.reply(`📅 *TIMETABLE MANAGEMENT*\n━━━━━━━━━━━━━━━━━━\n1. 👁️ View Current Timetable\n2. 🛠️ Run Timetable Wizard (Rebuild)\n\n0. 🔙 Back to Dashboard`);
                } else if (input === '2') {
                    updateSessionState(userId, 'REP_UPDATES_MENU', session.data);
                    await message.reply(`📢 *UPDATES MANAGEMENT*\n━━━━━━━━━━━━━━━━━━\n1. 👁️ View Updates\n2. ✍️ Post New Update\n3. 🗑️ Clear All Updates\n4. 🔔 Remind Update\n\n0. 🔙 Back to Dashboard`);
                } else if (input === '3') {
                    updateSessionState(userId, 'REP_MEMBERS_MENU', session.data);
                    let menuTxt = `👥 *CLASS MEMBERS*\n━━━━━━━━━━━━━━━━━━\n1. 👁️ View All Members\n2. 🗑️ Remove a Member\n`;
                    if (session.data.isMainRep) {
                        menuTxt += `3. 🎖️ Promote to Assistant Rep\n4. 🔻 Revoke Assistant Rep\n`;
                    }
                    menuTxt += `\n0. 🔙 Back to Dashboard`;
                    await message.reply(menuTxt);
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

                    const attendees = Object.values(activeRC.attendees);
                    let report = `🛑 *ROLL CALL CLOSED*\n━━━━━━━━━━━━━━━━━━\n📚 Unit: *${activeRC.unit}*\n📅 Date: *${activeRC.date}*\n👥 Total Present: *${attendees.length}*\n━━━━━━━━━━━━━━━━━━\n\n`;
                    
                    if (attendees.length === 0) {
                        report += `No students marked themselves present. 📭`;
                    } else {
                        attendees.forEach((student, idx) => {
                            report += `${idx + 1}. ${student.name} (${student.regNo}) - [${student.timestamp}]\n`;
                        });
                    }

                    // Log the roll call in audit logs
                    db.classes[session.data.loggedInClass].logs.push({
                        text: `Roll Call Completed: ${activeRC.unit} (${attendees.length} present)`,
                        timestamp: Date.now()
                    });

                    // Remove active roll call from memory
                    delete db.classes[session.data.loggedInClass].activeRollCall;
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
                } else {
                    await message.reply(`❌ Invalid choice. Type 1-7, 0 to go back, or 99 to exit.`);
                }
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

                // Open the register in the database
                db.classes[session.data.loggedInClass].activeRollCall = {
                    unit: targetUnit,
                    date: new Date().toLocaleDateString("en-US", {timeZone: "Africa/Nairobi"}),
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
                    await message.reply(ttStr + `(Type *0* to go back)`);
                } else if (input === '2') {
                    // Start Wizard - Clear existing timetable to rebuild fresh
                    const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
                    days.forEach(d => db.classes[session.data.loggedInClass].timetable[d] = []);
                    writeClassDB(db);

                    updateSessionState(userId, 'TIMETABLE_WIZARD', { ...session.data, dayIndex: 0 });
                    await message.reply(
                        `🛠️ *TIMETABLE WIZARD INITIATED*\n\n` +
                        `We will build this day by day, starting with *SUNDAY*.\n\n` +
                        `Enter classes one at a time using this exact format:\n` +
                        `*Unit Name, Time* (e.g., Calculus, 08:00 AM)\n\n` +
                        `Type *NEXT* when you are done adding classes for the current day.\n` +
                        `Type *0* to abort wizard.`
                    );
                }
                break;
            }

            case 'TIMETABLE_WIZARD': {
                if (input === '0') {
                    updateSessionState(userId, 'REP_DASHBOARD', session.data);
                    await sendRepDashboard(message, session.data.loggedInClass);
                    return;
                }

                const daysList = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
                const currentDayStr = daysList[session.data.dayIndex];

                if (input.toUpperCase() === 'NEXT' || input.toUpperCase() === 'DONE') {
                    if (session.data.dayIndex >= 6) {
                        // Wizard finished Saturday
                        updateSessionState(userId, 'REP_DASHBOARD', session.data);
                        await message.reply(`🎉 *TIMETABLE COMPLETED!*\n\nAll 7 days have been configured successfully.`);
                        await sendRepDashboard(message, session.data.loggedInClass);
                    } else {
                        // Move to next day
                        const nextDayIdx = session.data.dayIndex + 1;
                        updateSessionState(userId, 'TIMETABLE_WIZARD', { ...session.data, dayIndex: nextDayIdx });
                        await message.reply(`✅ *${currentDayStr.toUpperCase()}* saved.\n\nMoving to 📅 *${daysList[nextDayIdx].toUpperCase()}*.\n\nEnter a class (*Unit, Time*) or type *NEXT* if there are no classes.`);
                    }
                    return;
                }

                // Format Validation
                if (!input.includes(',')) {
                    await message.reply(`❌ Invalid format.\n\nPlease use a comma to separate the unit and time.\nExample: *Programming, 10:00 AM*`);
                    return;
                }

                const [unit, time] = input.split(',').map(s => s.trim());
                db.classes[session.data.loggedInClass].timetable[currentDayStr].push({ unit, time });
                writeClassDB(db);

                await message.reply(`✅ Added *${unit}* at *${time}* on *${currentDayStr.toUpperCase()}*.\n\nEnter another class for ${currentDayStr.toUpperCase()}, or type *NEXT* to move to the next day.`);
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
                await message.reply(`✅ *Update Posted & Saved!*\n\n1. 👁️ View Updates\n2. ✍️ Post New Update\n3. 🗑️ Clear All Updates\n\n0. 🔙 Back`);
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
                const members = db.classes[session.data.loggedInClass].members;
                const mIds = Object.keys(members);

                if (input === '1') {
                    if (mIds.length === 0) {
                        await message.reply(`📭 No students registered yet.\n(Type *0* to go back)`);
                        return;
                    }
                    let mList = `👥 *REGISTERED STUDENTS (${mIds.length})*\n━━━━━━━━━━━━━━━━━━\n`;
                    mIds.forEach((id, idx) => {
                        const m = members[id];
                        const isAsst = db.classes[session.data.loggedInClass].assistantReps?.includes(m.phoneId);
                        mList += `${idx + 1}. ${m.name} (${m.admission}) ${isAsst ? '⭐ *[Asst]*' : ''}\n`;
                    });
                    await message.reply(mList + `\n(Type *0* to go back)`);
                } else if (input === '2') {
                    if (mIds.length === 0) {
                        await message.reply(`📭 No students to remove.\n(Type *0* to go back)`);
                        return;
                    }
                    let mList = `🗑️ *REMOVE A STUDENT*\n━━━━━━━━━━━━━━━━━━\n`;
                    mIds.forEach((id, idx) => {
                        mList += `${idx + 1}. ${members[id].name} (${members[id].admission})\n`;
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
                        mList += `${idx + 1}. ${members[id].name} (${members[id].admission}) ${isAsst ? '⭐ *(Already Asst)*' : ''}\n`;
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
                        mList += `${idx + 1}. ${members[id].name} (${members[id].admission})\n`;
                    });
                    mList += `\n*Reply with the number to REVOKE them:*\n(Type *0* to cancel)`;
                    updateSessionState(userId, 'REP_MEMBERS_REVOKE', { ...session.data, asstIds });
                    await message.reply(mList);
                }
                break;
            }

          case 'REP_MEMBERS_REMOVE': {
              if (input === '0') {
                  updateSessionState(userId, 'REP_MEMBERS_MENU', session.data);
                  await message.reply(`👥 *CLASS MEMBERS*\n━━━━━━━━━━━━━━━━━━\n1. 👁️ View All Members\n2. 🗑️ Remove a Member (Intruder)\n\n0. 🔙 Back`);
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
              await message.reply(`✅ *${targetName}* has been removed from the class.\n\n1. 👁️ View All Members\n2. 🗑️ Remove a Member\n\n0. 🔙 Back`);
              break;
          }

          case 'REP_MEMBERS_PROMOTE': {
            if (input === '0') {
                updateSessionState(userId, 'REP_MEMBERS_MENU', session.data);
                await message.reply(`👥 *CLASS MEMBERS*\n━━━━━━━━━━━━━━━━━━\n1. 👁️ View All Members\n2. 🗑️ Remove a Member\n3. 🎖️ Promote to Assistant Rep\n4. 🔻 Revoke Assistant Rep\n\n0. 🔙 Back`);
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
            await message.reply(`✅ *${targetStudent.name}* has been promoted to Assistant Rep!\nThey can now login to the Rep Dashboard using the Class Password.\n\n0. 🔙 Back`);
            break;
        }

        case 'REP_MEMBERS_REVOKE': {
            if (input === '0') {
                updateSessionState(userId, 'REP_MEMBERS_MENU', session.data);
                await message.reply(`👥 *CLASS MEMBERS*\n━━━━━━━━━━━━━━━━━━\n1. 👁️ View All Members\n2. 🗑️ Remove a Member\n3. 🎖️ Promote to Assistant Rep\n4. 🔻 Revoke Assistant Rep\n\n0. 🔙 Back`);
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
            await message.reply(`✅ *${targetStudent.name}* has been demoted back to a regular student.\n\n0. 🔙 Back`);
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
            const otpCode = Math.floor(1000 + Math.random() * 9000).toString();
            
            // Unlock the student and assign the OTP
            if (db.classes[session.data.loggedInClass].members[targetIssue.memberId]) {
                db.classes[session.data.loggedInClass].members[targetIssue.memberId].locked = false;
                db.classes[session.data.loggedInClass].members[targetIssue.memberId].pendingRepReset = true;
                db.classes[session.data.loggedInClass].members[targetIssue.memberId].resetOtp = otpCode;
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
                    updateSessionState(userId, 'REP_DEADLINES_MENU', session.data);
                    await message.reply(`📚 Returning to Deadlines Menu... Type 6 to open again.`);
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
                    updateSessionState(userId, 'REP_DEADLINES_MENU', session.data);
                    await message.reply(`📚 Returning to Deadlines Menu....`);
                    return;
                }
                
                const newDeadline = session.data.newDeadline;
                newDeadline.details = input;
                
                updateSessionState(userId, 'REP_DEADLINES_ADD_DATE', { ...session.data, newDeadline });
                await message.reply(`✅ Details Saved.\n\n➕ *ADD NEW DEADLINE (Step 4 of 4)*\n\nWhen is this due? Use this exact format:\n*DD/MM/YYYY, HH:MM*\n\nExample for 2:30 PM on Oct 15: *15/10/2026, 14:30*\n\n0. 🔙 Cancel`);
                break;
            }

            // WIZARD STEP 4: PARSE DATE & SAVE
            // WIZARD STEP 4: PARSE DATE & SAVE
            case 'REP_DEADLINES_ADD_DATE': {
                if (input === '0') {
                    updateSessionState(userId, 'REP_DEADLINES_MENU', session.data);
                    await message.reply(`📚 Returning to Deadlines Menu...`);
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
                
                db.classes[session.data.loggedInClass].assessments.push(newDeadline);
                writeClassDB(db);
                
                updateSessionState(userId, 'REP_DEADLINES_MENU', session.data);
                await message.reply(`🎉 *DEADLINE CREATED!*\n\nIt is now actively counting down for all students.\n\n1. ➕ Add New Deadline\n2. 👁️ View Active Deadlines\n3. 🗑️ Delete a Deadline\n4. 🚨 Send Panic Blast\n\n0. 🔙 Back`);
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
              if (input === '0') { updateSessionState(userId, 'STUDENT_GATEWAY', session.data); await sendStudentGateway(message, session.data.loggedInClass); return; }
              
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
              if (input === '0') { updateSessionState(userId, 'STUDENT_GATEWAY', session.data); await sendStudentGateway(message, session.data.loggedInClass); return; }
              updateSessionState(userId, 'STUDENT_REG_SEC_Q', { ...session.data, regPass: input });
              await message.reply(`✅ Password saved.\n\n🛡️ *SECURITY RECOVERY*\nPlease type a custom *Security Question* (e.g., What is my pet's name?, What is my favorite movie?).\n\nYou will be asked this if you forget your password:`);
              break;
          }

          case 'STUDENT_REG_SEC_Q': {
              if (input === '0') { updateSessionState(userId, 'STUDENT_GATEWAY', session.data); await sendStudentGateway(message, session.data.loggedInClass); return; }
              updateSessionState(userId, 'STUDENT_REG_SEC_A', { ...session.data, secQuestion: input });
              await message.reply(`✅ Question saved: *${input}*\n\nNow, type the *Answer* to your question:\n(Keep it simple and easy to remember!)`);
              break;
          }

          case 'STUDENT_REG_SEC_A': {
              if (input === '0') { updateSessionState(userId, 'STUDENT_GATEWAY', session.data); await sendStudentGateway(message, session.data.loggedInClass); return; }
              
              // Save to Database
              const newMemberId = `std_${Date.now()}`;
              db.classes[session.data.loggedInClass].members[newMemberId] = {
                  name: session.data.regName,
                  admission: session.data.regAdm,
                  password: session.data.regPass,
                  securityQuestion: session.data.secQuestion,
                  securityAnswer: input.trim().toLowerCase(), // Save as lowercase for easy matching
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
                if (input === '0') { updateSessionState(userId, 'STUDENT_GATEWAY', session.data); await sendStudentGateway(message, session.data.loggedInClass); return; }
                
                const targetStudentId = session.data.loginTargetId;
                const studentRecord = db.classes[session.data.loggedInClass].members[targetStudentId];
                let attempts = session.data.attempts || 0;

                if (input === studentRecord.password) {
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
              const secStudentId = session.data.loginTargetId;
              const secRecord = db.classes[session.data.loggedInClass].members[secStudentId];
              let secAttempts = session.data.secAttempts || 0;

              // Compare input in lowercase to make it forgiving (e.g. "Fluffy" vs "fluffy")
              if (input.trim().toLowerCase() === secRecord.securityAnswer) {
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
                const resetStudentId = session.data.loginTargetId;
                db.classes[session.data.loggedInClass].members[resetStudentId].password = input;
                writeClassDB(db);
                
                updateSessionState(userId, 'STUDENT_DASHBOARD', { ...session.data, currentStudentId: resetStudentId, studentName: db.classes[session.data.loggedInClass].members[resetStudentId].name });
                await message.reply(`✅ *PASSWORD RESET SUCCESSFUL*\n\nWelcome back to your portal.`);
                await sendStudentDashboard(message, session.data.loggedInClass, db.classes[session.data.loggedInClass].members[resetStudentId].name);
                break;
            }

            // --- REP UNLOCK / OTP FLOW ---
            case 'STUDENT_LOGIN_OTP': {
              if (input === '0') { updateSessionState(userId, 'STUDENT_GATEWAY', session.data); await sendStudentGateway(message, session.data.loggedInClass); return; }
              
              const otpTargetId = session.data.loginTargetId;
              const otpRecord = db.classes[session.data.loggedInClass].members[otpTargetId];
              let otpAttempts = session.data.otpAttempts || 0;

              if (input === otpRecord.resetOtp) {
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
            memberRef.password = session.data.tempPass;
            memberRef.securityQuestion = session.data.newSecQuestion;
            memberRef.securityAnswer = input.trim().toLowerCase();
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
                    // Get current day based on East Africa Time
                    const todayIdx = new Date(new Date().toLocaleString("en-US", {timeZone: "Africa/Nairobi"})).getDay();
                    const todayStr = days[todayIdx];
                    const todayClasses = sDb.timetable[todayStr];
                    
                    let todayRes = `📅 *TODAY'S CLASSES (${todayStr.toUpperCase()})*\n━━━━━━━━━━━━━━━━━━\n`;
                    if (!todayClasses || todayClasses.length === 0) {
                        todayRes += `No classes scheduled for today! 🏖️\n`;
                    } else {
                        todayClasses.forEach(c => todayRes += `▪️ *${c.unit}* @ ${c.time}\n`);
                    }
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
                    await message.reply(ttFull + `(Type *0* to go back)`);

                } else if (input === '3') {
                    // View Upcoming Deadlines
                    let assessments = sDb.assessments || [];
                    const now = Date.now();
                    
                    // Filter out past deadlines
                    assessments = assessments.filter(a => a.timestamp > now);
                    
                    if (assessments.length === 0) {
                        await message.reply(`🎉 *NO UPCOMING DEADLINES!*\n\nYou are all caught up.\n\n(Type *0* to go back)`);
                        return;
                    }
                    
                    // Sort so the most urgent is at the top
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
                        
                        viewStr += `${a.icon} *[${a.type}] ${a.unit}*\n`;
                        viewStr += `📝 Details: ${a.details}\n`;
                        viewStr += `⏰ Due In: *${countdown}*\n\n`;
                    });
                    
                    await message.reply(viewStr + `(Type *0* to go back)`);

                } else if (input === '4') {
                    // View Updates
                    const ONE_DAY = 24 * 60 * 60 * 1000;
                    const now = Date.now();
                    
                    // Filter out updates older than 24 hours and save DB
                    sDb.updates = sDb.updates.filter(u => now - u.timestamp < ONE_DAY);
                    writeClassDB(db);

                    if (sDb.updates.length === 0) {
                        await message.reply(`📭 No active updates from the Class Rep in the last 24 hours.\n(Type *0* to go back)`);
                        return;
                    }
                    
                    let upStr = `📢 *24H CLASS UPDATES*\n━━━━━━━━━━━━━━━━━━\n\n`;
                    sDb.updates.forEach((u, i) => {
                        const dObj = new Date(u.timestamp);
                        const tStr = dObj.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Nairobi' });
                        if (i === sDb.updates.length - 1) upStr += `🚨 *LATEST [${tStr}]*\n*${u.text}*\n\n`;
                        else upStr += `▪️ [${tStr}]\n${u.text}\n\n`;
                    });
                    await message.reply(upStr + `(Type *0* to go back)`);

                } else if (input === '5') {
                    // View Classmates
                    const classMates = Object.keys(sDb.members);
                    if (classMates.length === 0) {
                        await message.reply(`No other students registered yet.\n(Type *0* to go back)`);
                        return;
                    }
                    let cmStr = `👥 *YOUR CLASSMATES*\n━━━━━━━━━━━━━━━━━━\n`;
                    classMates.forEach(mId => cmStr += `▪️ ${sDb.members[mId].name}\n`);
                    await message.reply(cmStr + `\n(Type *0* to go back)`);

                } else {
                    await message.reply(`❌ Invalid choice. Type 1-5, 0 to go back, or 99 to exit.`);
                }
                break;
            }
        }
    } catch (error) {
        console.error('[CLASS PORTAL ERROR]', error);
        await message.reply('❌ An error occurred in the class portal. Type *99* to restart.');
    }
}

// UI Helpers for Dashboards
async function sendRepDashboard(message, className) {
    const menu = `╭──────────────────────────────╮
  │        ⚡ _*TUM*_ × _*CHAOS*_ ⚡        
  │                               
  │         \`REP COMMAND\`         
  │           \`[ ${className} ]\`         
  │                               
  │   👑 LEVEL ☞『_*AUTHORIZED*_』    
  ╰──────────────────────────────╯
  
  ┌─── ░◈ _*CONTROL BOARD*_ ◈░ ───────┐
  │
  │📅 \`1\`
  │    ☞『_*Manage Timetable*_』
  ➫➫➫➫ΞΞΞΞΞΞΞΞΞΞΞΞΞΞΞΞΞΞΞΞΞ
  │📢 \`2\`
  │    ☞『_*Manage Updates*_』
  ➫➫➫➫ΞΞΞΞΞΞΞΞΞΞΞΞΞΞΞΞΞΞΞΞΞ
  │👥 \`3\`
  │    ☞『_*Class Members*_』
  ➫➫➫➫ΞΞΞΞΞΞΞΞΞΞΞΞΞΞΞΞΞΞΞΞΞ
  │🚨 \`4\`
  │    ☞『_*Resolve Issues*_』
  ➫➫➫➫ΞΞΞΞΞΞΞΞΞΞΞΞΞΞΞΞΞΞΞΞΞ
  │📜 \`5\`
  │    ☞『_*View Audit Logs*_』
  ➫➫➫➫ΞΞΞΞΞΞΞΞΞΞΞΞΞΞΞΞΞΞΞΞΞ
  │✅ \`6\`
  │    ☞『_*Start Roll Call*_』
  ➫➫➫➫ΞΞΞΞΞΞΞΞΞΞΞΞΞΞΞΞΞΞΞΞΞ
  │🛑 \`7\`
  │    ☞『_*Close & View Roll Call*_』
  ➫➫➫➫ΞΞΞΞΞΞΞΞΞΞΞΞΞΞΞΞΞΞΞΞΞ
  │🛑 \`8\`
  │    ☞『_*Manage CAT/ASSIGNMENTS*_』
  ➫➫➫➫ΞΞΞΞΞΞΞΞΞΞΞΞΞΞΞΞΞΞΞΞΞ
  │🔙 \`0\`
  │    ☞『_*Back to Main Menu*_』
  ➫➫➫➫ΞΞΞΞΞΞΞΞΞΞΞΞΞΞΞΞΞΞΞΞΞ
  │🚪 \`99\`
  │    ☞『_*Logout*_』
  │
  └──────────────────────────────┘
        ⚡ _*TUM*_ × _*CHAOS*_ ⚡        
        「 CONTROL THE CHAOS 」`;
  
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

async function sendStudentDashboard(message, className, studentName) {
  const menu = `╭──────────────────────────────╮
│        ⚡ _*TUM*_ × _*CHAOS*_ ⚡        
│                               
│           \`STUDENT HUB\`          
│           \`[ ${className} ]\`         
│                               
│   👤 USER ☞『_*${studentName}*_』 
╰──────────────────────────────╯

┌─── ░◈ _*PORTAL FEED*_ ◈░ ──────────┐
│
│📅 \`1\`
│    ☞『_*View Today's Classes*_』
➫➫➫➫ΞΞΞΞΞΞΞΞΞΞΞΞΞΞΞΞΞΞΞΞΞ
│🗓️ \`2\`
│    ☞『_*View Full Timetable*_』
➫➫➫➫ΞΞΞΞΞΞΞΞΞΞΞΞΞΞΞΞΞΞΞΞΞ
│📢 \`3\`
│    ☞『_*View CAT/ASSIGN Deadlines*_』
➫➫➫➫ΞΞΞΞΞΞΞΞΞΞΞΞΞΞΞΞΞΞΞΞΞ
│👥 \`4\`
│    ☞『_*View Updates*_』
➫➫➫➫ΞΞΞΞΞΞΞΞΞΞΞΞΞΞΞΞΞΞΞΞΞ
│👥 \`5\`
│    ☞『_*View Classmates*_』
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
    let studentData = null;

    // 1. Find which class this student belongs to
    for (const className in db.classes) {
        if (db.classes[className].members) {
            const memberObj = Object.values(db.classes[className].members).find(m => m.phoneId === userId);
            if (memberObj) {
                studentClass = className;
                studentData = memberObj;
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
    const memberId = Object.keys(db.classes[studentClass].members).find(
        key => db.classes[studentClass].members[key].phoneId === userId
    );

    if (activeRC.attendees[memberId]) {
        await message.reply(`⚠️ You are already marked present for *${activeRC.unit}*.`);
        return true; 
    }

    // 4. Mark them present
    activeRC.attendees[memberId] = {
        name: studentData.name,
        regNo: studentData.admission,
        timestamp: new Date().toLocaleTimeString("en-US", {timeZone: "Africa/Nairobi"})
    };

    writeClassDB(db);

    await message.reply(`✅ *ATTENDANCE CONFIRMED*\n\nName: *${studentData.name}*\nUnit: *${activeRC.unit}*\nStatus: *PRESENT* 🟢`);
    return true;
}

/**
 * Allows the owner to type "accept" or "reject <reason>" directly in DMs
 */
async function handleOwnerPlaintextResponse(client, message, text, lowerText) {
    if (lowerText === 'accept' || lowerText.startsWith('reject')) {
        if (!lastApplicantUserId) {
            await message.reply('⚠️ No recent class rep application found in memory to process.');
            return true; // Handled (prevents bot from treating it as an AI prompt or normal command)
        }

        const action = lowerText.split(/\s+/)[0];
        const targetJid = lastApplicantUserId;
        const db = readClassDB();

        if (action === 'accept') {
            const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; 
            let code = 'REP-';
            for (let i = 0; i < 5; i++) {
                code += chars.charAt(Math.floor(Math.random() * chars.length));
            }
            
            if (!db.repCodes) db.repCodes = [];
            db.repCodes.push(code);
            writeClassDB(db);

            try {
                await client.sendMessage(
                    targetJid, 
                    `🎉 *APPLICATION APPROVED!*\n━━━━━━━━━━━━━━━━━━\n\nYour request to become a Class Representative has been verified and accepted.\n\n🎟️ *Your Authorization Code:* \`${code}\`\n\nTo setup your class:\n1. Type \`!class\`\n2. Select *Create a New Class*\n3. Enter your code when prompted.`
                );
            } catch (e) {
                console.warn('[CLASS PORTAL] Could not send code to applicant DMs:', e);
            }
            
            await message.reply(`✅ *APPLICATION ACCEPTED*\n\nThe auth code \`${code}\` has been generated and delivered automatically to the applicant.`);
            lastApplicantUserId = null; // Clear memory after processing
            return true;
            
        } else if (action === 'reject') {
            const reason = text.slice(6).trim() || 'Failed security verification checks.';
            
            try {
                await client.sendMessage(
                    targetJid, 
                    `❌ *APPLICATION REJECTED*\n━━━━━━━━━━━━━━━━━━\n\nYour request to create a Class Portal was denied by the administrators.\n\n*Reason:* ${reason}`
                );
            } catch (e) {
                console.warn('[CLASS PORTAL] Could not send rejection to applicant DMs:', e);
            }
            
            await message.reply(`✅ *APPLICATION REJECTED*\n\nThe rejection notice has been delivered to the applicant.`);
            lastApplicantUserId = null; // Clear memory after processing
            return true;
        }
    }
    return false;
}

module.exports = {
    handleClassCommand,
    handleInput,
    handleAttendance,
    handleOwnerPlaintextResponse
};