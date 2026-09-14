const { readClassDB, writeClassDB, classExists } = require('../database/classdb');
const { createSession, updateSessionState, getSession, endSession } = require('../tools/classSession');

// Entry point triggered by !class
async function handleClassCommand(client, message, userId, userName) {
    createSession(userId, 'MAIN_MENU');
    await sendMainMenu(message);
}

// Helper to send the Main Menu
async function sendMainMenu(message) {
    const menu = `🎓 *CLASS PORTAL GATEWAY*\n` +
                 `━━━━━━━━━━━━━━━━━━\n` +
                 `1. 🏫 View & Login to a Class\n` +
                 `2. 🛠️ Create a New Class (Class Reps)\n\n` +
                 `99. 🚪 Exit\n\n` +
                 `*Reply with a number:*`;
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
                    updateSessionState(userId, 'CREATE_CLASS_NAME');
                    await message.reply(`🛠️ *CREATE A NEW CLASS*\n\nEnter your class name and year in this exact format:\n*Course/Year* (e.g., BSIT/2024)\n\n(Type *0* to go back)`);
                } 
                else {
                    await message.reply('❌ Invalid choice. Reply with 1, 2, or 99 to exit.');
                }
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

                // Move to next state, temporarily saving the class name in the session data
                updateSessionState(userId, 'CREATE_CLASS_PASS', { pendingClassName: className });
                await message.reply(`✅ Class Name Accepted: *${className}*\n\n🔒 Now, create a *Class Password* for this portal.\n(This is the password you will share with your students to enter).`);
                break;
            }

            case 'CREATE_CLASS_PASS': {
                if (input === '0') {
                    updateSessionState(userId, 'MAIN_MENU');
                    await sendMainMenu(message);
                    return;
                }

                const newClassName = session.data.pendingClassName;
                
                // Write the new class to the database
                db.classes[newClassName] = {
                    repName: userName, // Automatically captures their WhatsApp Name
                    repId: userId,     // Their hidden internal ID (safe from usernames update)
                    classPassword: input,
                    timetable: { sunday: [], monday: [], tuesday: [], wednesday: [], thursday: [], friday: [], saturday: [] },
                    updates: [],
                    members: {}, // Student data will go here
                    issues: [],
                    logs: []
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
                if (userId === classData.repId) {
                    // They are the Class Rep
                    updateSessionState(userId, 'REP_DASHBOARD', { loggedInClass: targetClass });
                    await message.reply(`✅ *Access Granted*\nWelcome back, Class Rep ${classData.repName}!`);
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
                    await message.reply(`📢 *UPDATES MANAGEMENT*\n━━━━━━━━━━━━━━━━━━\n1. 👁️ View Updates\n2. ✍️ Post New Update\n3. 🗑️ Clear All Updates\n\n0. 🔙 Back to Dashboard`);
                } else if (['3', '4', '5'].includes(input)) {
                    await message.reply(`🚧 This feature is coming in Phase 5 (Student Registrations & Issues).\nType *0* to go back.`);
                } else {
                    await message.reply(`❌ Invalid choice. Type 1-5, 0 to go back, or 99 to exit.`);
                }
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
                    const updates = db.classes[session.data.loggedInClass].updates;
                    if (updates.length === 0) {
                        await message.reply(`📭 No updates have been posted yet.\n(Type *0* to go back)`);
                        return;
                    }
                    
                    let upStr = `📢 *CLASS UPDATES*\n━━━━━━━━━━━━━━━━━━\n\n`;
                    updates.forEach((u, i) => {
                        const dateObj = new Date(u.timestamp);
                        const timeString = dateObj.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Nairobi' });
                        const dateString = dateObj.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'Africa/Nairobi' });
                        
                        if (i === updates.length - 1) {
                            upStr += `🚨 *LATEST UPDATE [${dateString} - ${timeString}]*\n*${u.text}*\n\n`;
                        } else {
                            upStr += `▪️ [${dateString} - ${timeString}]\n${u.text}\n\n`;
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
                }
                break;
            }

            case 'REP_ADD_UPDATE': {
                if (input === '0') {
                    updateSessionState(userId, 'REP_UPDATES_MENU', session.data);
                    await message.reply(`📢 *UPDATES MANAGEMENT*\n━━━━━━━━━━━━━━━━━━\n1. 👁️ View Updates\n2. ✍️ Post New Update\n3. 🗑️ Clear All Updates\n\n0. 🔙 Back`);
                    return;
                }
                
                db.classes[session.data.loggedInClass].updates.push({
                    text: input,
                    timestamp: Date.now()
                });
                writeClassDB(db);
                
                updateSessionState(userId, 'REP_UPDATES_MENU', session.data);
                await message.reply(`✅ *Update Posted Successfully!*\n\n1. 👁️ View Updates\n2. ✍️ Post New Update\n3. 🗑️ Clear All Updates\n\n0. 🔙 Back`);
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
                updateSessionState(userId, 'STUDENT_REG_PASS', { ...session.data, regAdm: input });
                await message.reply(`✅ Admission No saved: *${input}*\n\nCreate a *Personal Password* for your portal login:\n(Make it secure but easy to remember!)`);
                break;
            }

            case 'STUDENT_REG_PASS': {
                if (input === '0') { updateSessionState(userId, 'STUDENT_GATEWAY', session.data); await sendStudentGateway(message, session.data.loggedInClass); return; }
                updateSessionState(userId, 'STUDENT_REG_SEC', { ...session.data, regPass: input });
                await message.reply(`✅ Password saved.\n\n🛡️ *SECURITY QUESTION*\nIn case you forget your password, what is your *National ID Number*?`);
                break;
            }

            case 'STUDENT_REG_SEC': {
                if (input === '0') { updateSessionState(userId, 'STUDENT_GATEWAY', session.data); await sendStudentGateway(message, session.data.loggedInClass); return; }
                
                // Save to Database
                const newMemberId = `std_${Date.now()}`;
                db.classes[session.data.loggedInClass].members[newMemberId] = {
                    name: session.data.regName,
                    admission: session.data.regAdm,
                    password: session.data.regPass,
                    securityId: input,
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
                        await message.reply(`🚨 *TOO MANY FAILED ATTEMPTS*\n\nTo verify your identity, please enter your *National ID Number* (Security Question):`);
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

                if (input === secRecord.securityId) {
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
                            reason: 'Failed Security Verification',
                            timestamp: Date.now()
                        });
                        writeClassDB(db);
                        
                        updateSessionState(userId, 'MAIN_MENU');
                        await message.reply(`🚨 *ACCOUNT LOCKED*\n\nYou failed the security verification. An issue has been raised with your Class Rep. You cannot login until they resolve it.\n\nType *99* to exit.`);
                    } else {
                        updateSessionState(userId, 'STUDENT_LOGIN_SEC', { ...session.data, secAttempts });
                        await message.reply(`❌ Incorrect ID Number. You have 1 attempt left before your account is locked:`);
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
                    // View Updates
                    if (sDb.updates.length === 0) {
                        await message.reply(`📭 No updates from the Class Rep.\n(Type *0* to go back)`);
                        return;
                    }
                    let upStr = `📢 *CLASS UPDATES*\n━━━━━━━━━━━━━━━━━━\n\n`;
                    sDb.updates.forEach((u, i) => {
                        const dObj = new Date(u.timestamp);
                        const tStr = dObj.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Nairobi' });
                        const dStr = dObj.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'Africa/Nairobi' });
                        if (i === sDb.updates.length - 1) upStr += `🚨 *LATEST [${dStr} - ${tStr}]*\n*${u.text}*\n\n`;
                        else upStr += `▪️ [${dStr} - ${tStr}]\n${u.text}\n\n`;
                    });
                    await message.reply(upStr + `(Type *0* to go back)`);

                } else if (input === '4') {
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
                    await message.reply(`❌ Invalid choice. Type 1-4, 0 to go back, or 99 to exit.`);
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
    const menu = `👑 *REP DASHBOARD: ${className}*\n` +
                 `━━━━━━━━━━━━━━━━━━\n` +
                 `1. 📅 Manage Timetable\n` +
                 `2. 📢 Manage Updates\n` +
                 `3. 👥 Class Members\n` +
                 `4. 🚨 Resolve Issues\n` +
                 `5. 📜 View Logs\n\n` +
                 `0. 🔙 Back to Main Menu\n` +
                 `99. 🚪 Logout`;
    await message.reply(menu);
}

async function sendStudentGateway(message, className) {
    const menu = `🏫 *STUDENT PORTAL: ${className}*\n` +
                 `━━━━━━━━━━━━━━━━━━\n` +
                 `1. 🔑 Login (Already Registered)\n` +
                 `2. 📝 Register (First Time)\n\n` +
                 `0. 🔙 Back to Main Menu\n` +
                 `99. 🚪 Logout`;
    await message.reply(menu);
}

async function sendStudentDashboard(message, className, studentName) {
    const menu = `🏫 *${className} PORTAL*\n` +
                 `👤 Student: ${studentName}\n` +
                 `━━━━━━━━━━━━━━━━━━\n` +
                 `1. 📅 View Today's Classes\n` +
                 `2. 🗓️ View Full Timetable\n` +
                 `3. 📢 View Updates\n` +
                 `4. 👥 View Classmates\n\n` +
                 `0. 🔙 Back to Main Menu\n` +
                 `99. 🚪 Logout`;
    await message.reply(menu);
}

module.exports = {
    handleClassCommand,
    handleInput
};