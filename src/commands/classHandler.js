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

    const db = readClassDB();
    const input = text.trim();

    try {
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
            
            // Placeholder states for Phase 3 & 4
            case 'REP_DASHBOARD':
            case 'STUDENT_GATEWAY':
                await message.reply(`🛠️ Dashboards are under construction (Phase 3 & 4).\nType *0* to go back to main menu, or *99* to exit.`);
                if (input === '0') {
                    updateSessionState(userId, 'MAIN_MENU');
                    await sendMainMenu(message);
                }
                break;

            default:
                await message.reply('⚠️ Session state error. Ending session.');
                endSession(userId);
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