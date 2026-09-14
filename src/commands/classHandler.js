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
            case 'MAIN_MENU':
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

            case 'CREATE_CLASS_NAME':
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

            case 'CREATE_CLASS_PASS':
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

            case 'SELECT_CLASS':
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

            case 'ENTER_CLASS_PASS':
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

            // ==========================================
            // PHASE 3: REP DASHBOARD & TIMETABLE WIZARD
            // ==========================================
            case 'REP_DASHBOARD':
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
                    await message.reply(`🚧 This feature is coming in Phase 4 (Student Registrations & Issues).\nType *0* to go back.`);
                } else {
                    await message.reply(`❌ Invalid choice. Type 1-5, 0 to go back, or 99 to exit.`);
                }
                break;

            case 'REP_TIMETABLE_MENU':
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

            case 'TIMETABLE_WIZARD':
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

            case 'REP_UPDATES_MENU':
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
                        // Convert to EAT (UTC+3) formatting for local context
                        const timeString = dateObj.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Nairobi' });
                        const dateString = dateObj.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'Africa/Nairobi' });
                        
                        // Highlight the latest one in bold
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

            case 'REP_ADD_UPDATE':
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

            // Leave the STUDENT_GATEWAY placeholder below it for Phase 4
            case 'STUDENT_GATEWAY':
                await message.reply(`🛠️ Student Gateway is under construction (Phase 4).\nType *0* to go back to main menu, or *99* to exit.`);
                if (input === '0') {
                    updateSessionState(userId, 'MAIN_MENU');
                    await sendMainMenu(message);
                }
                break;
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

module.exports = {
    handleClassCommand,
    handleInput
};