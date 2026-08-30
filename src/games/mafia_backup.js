const fs = require('fs');
const { getUser, addCoins, addXP, readDB, writeDB } = require('../database/db');

class MafiaGame {
    constructor(client, MessageMedia) {
        this.client = client;
        this.MessageMedia = MessageMedia;
        this.inLobby = false;
        this.gameStarted = false;
        this.channelId = null;
        this.players = [];
        this.ghosts = [];
        this.nightActions = { kill: null, save: null, investigate: null };
        this.nightActionUsers = { kill: null, save: null, investigate: null };
        this.votes = new Map();
        this.votingActive = false;
        this.nightActive = false;
        this.lobbyTimer = null;
        this.nightTimer = null;
        this.voteTimer = null;
        this.gameNumber = Math.floor(100000 + Math.random() * 900000);
    }

    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    // ============================================================
    // JID / ID NORMALIZATION
    // ============================================================

    normalizeJid(jid) {
        if (!jid) return null;

        let clean = String(jid).trim();

        // Remove device suffixes if present.
        if (clean.includes('_')) {
            clean = clean.split('_')[0];
        }

        return clean;
    }

    normalizePhoneNumber(number) {
        if (!number) return null;

        const clean = String(number)
            .trim()
            .replace(/[^\d]/g, '');

        return clean || null;
    }

    canonicalizeIdentity(identity) {
        if (!identity) return null;

        // Contact object
        if (typeof identity === 'object') {
            if (identity.number) {
                const number = this.normalizePhoneNumber(identity.number);
                if (number) return `${number}@c.us`;
            }

            if (identity.id) {
                return this.canonicalizeIdentity(
                    typeof identity.id === 'string'
                        ? identity.id
                        : identity.id._serialized
                );
            }

            if (identity._serialized) {
                return this.canonicalizeIdentity(identity._serialized);
            }

            return null;
        }

        let clean = this.normalizeJid(identity);
        if (!clean) return null;

        // Normal WhatsApp JID
        if (clean.endsWith('@c.us')) {
            const number = this.normalizePhoneNumber(clean.split('@')[0]);
            return number ? `${number}@c.us` : clean;
        }

        // WhatsApp LID
        if (clean.endsWith('@lid')) {
            return clean;
        }

        // Raw phone number
        const number = this.normalizePhoneNumber(clean);
        if (number) return `${number}@c.us`;

        return clean;
    }

    // ============================================================
    // PLAYER LOOKUPS
    // ============================================================

    getPlayerById(id) {
        const normalizedId = this.canonicalizeIdentity(id);
        if (!normalizedId) return null;

        return this.players.find(player => {
            const playerId = this.canonicalizeIdentity(player.id);
            return playerId === normalizedId;
        }) || null;
    }

    getPlayerByLetter(letter) {
        if (!letter) return null;

        const cleanLetter = String(letter).trim().toUpperCase();

        return this.players.find(
            player => player.letter === cleanLetter
        ) || null;
    }

    getAlivePlayers() {
        return this.players.filter(player => player.isAlive);
    }

    getAliveNonMafiaPlayers() {
        return this.players.filter(
            player => player.isAlive && player.role !== 'Mafia'
        );
    }

    getMafia() {
        return this.players.find(
            player => player.role === 'Mafia' && player.isAlive
        ) || null;
    }

    // ============================================================
    // DEBUG
    // ============================================================

    getPlayerIdentity(player) {
        if (!player) return 'Unknown';
        return `[${player.letter}] ${player.username} (${player.id})`;
    }

    // ============================================================
    // TIMERS
    // ============================================================

    clearTimers() {
        if (this.lobbyTimer) {
            clearTimeout(this.lobbyTimer);
            this.lobbyTimer = null;
        }

        if (this.nightTimer) {
            clearTimeout(this.nightTimer);
            this.nightTimer = null;
        }

        if (this.voteTimer) {
            clearTimeout(this.voteTimer);
            this.voteTimer = null;
        }
    }

    // ============================================================
    // RESET
    // ============================================================

    resetGameState() {
        this.clearTimers();
        this.inLobby = false;
        this.gameStarted = false;
        this.votingActive = false;
        this.nightActive = false;
        this.channelId = null;
        this.players = [];
        this.ghosts = [];
        this.nightActions = {
            kill: null,
            save: null,
            investigate: null
        };
        this.nightActionUsers = {
            kill: null,
            save: null,
            investigate: null
        };
        this.votes.clear();
    }

    // ============================================================
    // FORCE END
    // ============================================================

    async forceEndGame(channelId) {
        if (!this.gameStarted && !this.inLobby) {
            return '❌ There is no active Mafia game or lobby running right now.';
        }

        this.clearTimers();
        this.votingActive = false;
        this.nightActive = false;
        this.gameStarted = false;
        this.inLobby = false;

        await this.client.sendMessage(
            channelId,
            '🛑 *MAFIA GAME TERMINATED.*\n\n' +
            'The current match has been forcefully stopped.'
        );

        this.resetGameState();

        if (global.activeMafiaGame === this) {
            global.activeMafiaGame = null;
        }

        return null;
    }

    // ============================================================
    // WIN CONDITION
    // ============================================================

    async checkWinCondition(channelId) {
        if (!this.gameStarted) return true;

        const alivePlayers = this.getAlivePlayers();
        const mafia = this.getMafia();

        if (!mafia) {
            await this.endGame(
                channelId,
                'town',
                '*VICTORY!*\n\n' +
                'The Mafia has been eliminated. The city is finally safe!'
            );
            return true;
        }

        const nonMafiaAlive = this.getAliveNonMafiaPlayers();

        if (
            alivePlayers.length <= 2 ||
            nonMafiaAlive.length <= 1
        ) {
            await this.endGame(
                channelId,
                'mafia',
                '*MAFIA VICTORY!*\n\n' +
                'The Mafia has gained control of the remaining city survivors.\n\n' +
                'The case is closed... and the Mafia walks free.'
            );
            return true;
        }

        return false;
    }

    // ============================================================
    // REWARDS
    // ============================================================

    awardPlayer(player, result) {
        try {
            const user = getUser(player.id, player.username);

            if (result === 'win') {
                const coins = player.role === 'Mafia' ? 250 : 150;
                const xp = player.role === 'Mafia' ? 200 : 175;

                addCoins(player.id, coins);
                addXP(player.id, xp, player.username);

                user.wins = (user.wins || 0) + 1;
            } else {
                addCoins(player.id, 25);
                addXP(player.id, 50, player.username);

                user.losses = (user.losses || 0) + 1;
            }

            const db = readDB();

            db[player.id] = getUser(
                player.id,
                player.username
            );

            writeDB(db);
        } catch (error) {
            console.error(
                `Failed to award Mafia result to ${player.username}:`,
                error
            );
        }
    }

    // ============================================================
    // END GAME
    // ============================================================

    async endGame(channelId, winner, message) {
        if (!this.gameStarted && !this.inLobby) return;

        this.clearTimers();
        this.votingActive = false;
        this.nightActive = false;

        for (const player of this.players) {
            const isWinner =
                (winner === 'mafia' && player.role === 'Mafia') ||
                (winner === 'town' && player.role !== 'Mafia');

            this.awardPlayer(
                player,
                isWinner ? 'win' : 'loss'
            );
        }

        this.gameStarted = false;
        this.inLobby = false;

        await this.client.sendMessage(
            channelId,
            `${message}\n\n*PROJECT MAFIA CASE GAME OVER*`
        );

        let finalRoster = '*FINAL CASE FILE*\n\n';

        for (const player of this.players) {
            const status = player.isAlive ? 'Alive' : 'Ghost';

            finalRoster +=
                `[${player.letter}] ${player.username} - *${player.role}* (${status})\n`;
        }

        finalRoster +=
            "\nRewards have been added to the players' Chaos profiles.";

        await this.client.sendMessage(
            channelId,
            finalRoster
        );

        this.resetGameState();

        if (global.activeMafiaGame === this) {
            global.activeMafiaGame = null;
        }
    }

    // ============================================================
    // START LOBBY
    // ============================================================

    async startLobby(channelId) {
        if (this.inLobby || this.gameStarted) {
            return this.client.sendMessage(
                channelId,
                'A Mafia Case is already active. Finish the current investigation first.'
            );
        }

        this.inLobby = true;
        this.gameStarted = false;
        this.channelId = channelId;
        this.players = [];
        this.ghosts = [];
        this.votes.clear();

        await this.client.sendMessage(
            channelId,
            '*PROJECT MAFIA CASE*\n\n' +
            'Welcome to the investigation. Take your time, talk, and prepare.\n\n' +
            'Registration is open for *2 minutes*.\n' +
            'Type `!joinmafia` to enter the case.\n\n' +
            'Minimum players: *4*\n' +
            'Mafia: *1*\n' +
            'Doctor: *1*\n' +
            'Detective: *1*\n' +
            'Everyone else: *Villagers*\n\n' +
            'Once registration closes, secret roles will be assigned privately.'
        );

        // Rules PDF
        try {
            const rulesPath = './rules.pdf';

            if (fs.existsSync(rulesPath)) {
                const pdfMedia = this.MessageMedia.fromFilePath(rulesPath);

                await this.client.sendMessage(
                    channelId,
                    pdfMedia,
                    {
                        caption:
                            '*Case File & Official Rules*\n' +
                            'Review the investigation rules before the case begins.'
                    }
                );
            }
        } catch (error) {
            console.error(
                'Could not send rules.pdf:',
                error
            );
        }

        // Briefing audio
        try {
            const mp3Path = './briefing.mp3';
            const oggPath = './briefing.ogg';

            let audioPath = null;

            if (fs.existsSync(mp3Path)) {
                audioPath = mp3Path;
            } else if (fs.existsSync(oggPath)) {
                audioPath = oggPath;
            }

            if (audioPath) {
                await this.sleep(1000);

                const audioMedia =
                    this.MessageMedia.fromFilePath(audioPath);

                await this.client.sendMessage(
                    channelId,
                    audioMedia,
                    {
                        caption:
                            '*Audio Dispatch*\n' +
                            'Detective briefing incoming...'
                    }
                );
            }
        } catch (error) {
            console.error(
                'Could not send Mafia briefing:',
                error.message
            );
        }

        // 2-minute lobby
        this.lobbyTimer = setTimeout(async () => {
            if (!this.inLobby) return;

            try {
                await this.startGame(channelId);
            } catch (error) {
                console.error(
                    'Mafia lobby timer error:',
                    error
                );
            }
        }, 120000);
    }

    // ============================================================
    // JOIN MAFIA
    // ============================================================

    joinGame(user, channelId) {
        if (!this.inLobby) return null;
        if (this.channelId !== channelId) return null;

        const permanentJid =
            this.canonicalizeIdentity(user);

        if (!permanentJid) {
            return '❌ Could not identify your WhatsApp account.';
        }

        console.log(
            `[MAFIA JOIN IDENTITY] raw=${user?.id || user} canonical=${permanentJid}`
        );

        if (
            this.players.some(
                player =>
                    this.canonicalizeIdentity(player.id) === permanentJid
            )
        ) {
            const existingPlayer =
                this.getPlayerById(permanentJid);

            return (
                `*${existingPlayer.username}*, you are already registered for this case!\n\n` +
                `Your identifier is *[${existingPlayer.letter}]*.`
            );
        }

        const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

        if (this.players.length >= letters.length) {
            return 'The case roster is full.';
        }

        const assignedLetter =
            letters[this.players.length];

        const player = {
            id: permanentJid,
            username: user.username || 'Unknown Player',
            tag: user.tag || '',
            letter: assignedLetter,
            role: 'Villager',
            isAlive: true,
            strikes: 0
        };

        this.players.push(player);

        console.log(
            `[MAFIA JOIN] ${player.username} registered as ` +
            `[${player.letter}] -> ${player.id}`
        );

        return (
            `*${player.username}* has joined the case!\n\n` +
            `Secret identifier: *[${assignedLetter}]*`
        );
    }

    // ============================================================
    // START GAME
    // ============================================================

    async startGame(channelId) {
        if (!this.inLobby) return;

        this.clearTimers();

        if (this.players.length < 4) {
            await this.client.sendMessage(
                channelId,
                '*REGISTRATION CLOSED.*\n\n' +
                `Only *${this.players.length}* player(s) registered.\n` +
                'At least *4 players* are required.\n\n' +
                '❌ The Mafia Case has been canceled.'
            );

            this.resetGameState();
            return;
        }

        this.inLobby = false;
        this.gameStarted = true;
        this.channelId = channelId;

        this.players.forEach(player => {
            player.role = 'Villager';
            player.isAlive = true;
            player.strikes = 0;
        });

        const shuffled = [...this.players];

        for (let i = shuffled.length - 1; i > 0; i--) {
            const j = Math.floor(
                Math.random() * (i + 1)
            );

            [shuffled[i], shuffled[j]] =
                [shuffled[j], shuffled[i]];
        }

        shuffled[0].role = 'Mafia';
        shuffled[1].role = 'Doctor';
        shuffled[2].role = 'Detective';

        // ========================================================
        // CASE ROSTER
        // ========================================================

        let roster = '*CASE ROSTER & IDENTIFIERS*\n\n';

        this.players.forEach(player => {
            roster +=
                `*[${player.letter}]* ${player.username}\n`;
        });

        // ========================================================
        // PRIVATE ROLE DMS
        // ========================================================

        for (const player of this.players) {
            let roleMessage =
                '*PROJECT MAFIA CASE*\n\n' +
                'Your secret role is:\n' +
                `*${player.role}*\n\n` +
                `${roster}\n`;

            if (player.role === 'Mafia') {
                roleMessage +=
                    '*NIGHT ACTION*\n' +
                    'Use:\n' +
                    '`!kill [Letter]`\n\n' +
                    'Choose one living player to eliminate silently.';
            } else if (player.role === 'Doctor') {
                roleMessage +=
                    '*NIGHT ACTION*\n' +
                    'Use:\n' +
                    '`!save [Letter]`\n\n' +
                    "Try to protect the Mafia's target.\n" +
                    'You have *3 strikes* before your medical license is revoked.';
            } else if (player.role === 'Detective') {
                roleMessage +=
                    '*NIGHT ACTION*\n' +
                    'Use:\n' +
                    '`!investigate [Letter]`\n\n' +
                    'Investigate one living player to determine whether they are the Mafia.\n' +
                    'You have *3 strikes* before your badge is revoked.';
            } else {
                roleMessage +=
                    '*VILLAGER*\n' +
                    'You have no night action.\n' +
                    'Listen carefully, discuss clues, and vote wisely during the day.';
            }

            try {
                await this.client.sendMessage(
                    player.id,
                    roleMessage
                );

                console.log(
                    `[MAFIA ROLE DM] ${player.username} ` +
                    `[${player.letter}] -> ${player.id}`
                );
            } catch (error) {
                console.error(
                    `Failed to send Mafia role DM to ${player.username}:`,
                    error
                );
            }
        }

        await this.client.sendMessage(
            channelId,
            '*REGISTRATION CLOSED*\n\n' +
            'The roles have been assigned privately. Take your time to read your DMs.\n' +
            'The city is going to sleep...\n\n' +
            'Mafia: choose your target carefully.\n' +
            'Doctor: choose who you think is under attack.\n' +
            'Detective: investigate a suspect.\n\n' +
            'Night actions must be submitted before the 5-minute night timer expires.'
        );

        await this.startNightPhase(channelId);
    }

    // ============================================================
    // NIGHT PHASE
    // ============================================================

    async startNightPhase(channelId) {
        if (!this.gameStarted) return;

        if (await this.checkWinCondition(channelId)) {
            return;
        }

        this.nightActive = true;
        this.votingActive = false;

        this.nightActions = {
            kill: null,
            save: null,
            investigate: null
        };

        this.nightActionUsers = {
            kill: null,
            save: null,
            investigate: null
        };

        this.votes.clear();

        await this.client.sendMessage(
            channelId,
            '*NIGHT FALLS*\n\n' +
            'Shadows stretch across the city. Complete silence takes over...\n\n' +
            'Mafia: execute your strike (`!kill [Letter]`).\n' +
            'Doctor: protect someone (`!save [Letter]`).\n' +
            'Detective: gather evidence (`!investigate [Letter]`).\n\n' +
            'You have *5 minutes* of deep night to scheme in secret.'
        );

        this.nightTimer = setTimeout(async () => {
            if (!this.gameStarted || !this.nightActive) {
                return;
            }

            try {
                await this.resolveNight(channelId);
            } catch (error) {
                console.error(
                    'Mafia night resolution error:',
                    error
                );
            }
        }, 300000);
    }

    // ============================================================
    // NIGHT ACTION HANDLER
    // ============================================================

    async handleNightAction(user, command, targetLetter) {
        if (!this.gameStarted || !this.nightActive) {
            return;
        }

        const userId =
            typeof user === 'string'
                ? user
                : user?.id;

        const cleanUserId =
            this.canonicalizeIdentity(user);

        console.log(
            `[MAFIA NIGHT] Incoming identity: raw=${userId} canonical=${cleanUserId}`
        );

        if (!cleanUserId) {
            console.error(
                '[MAFIA NIGHT] Could not determine sender identity.'
            );
            return;
        }

        const player =
            this.getPlayerById(cleanUserId);

        console.log(
            `[MAFIA NIGHT] Sender ${cleanUserId} resolved to: ` +
            `${player
                ? `${player.username} [${player.letter}] ROLE=${player.role}`
                : 'NO REGISTERED PLAYER'}`
        );

        if (!player) {
            await this.client.sendMessage(
                cleanUserId,
                '❌ You are not registered in the current Mafia Case.'
            );
            return;
        }

        if (!player.isAlive) {
            await this.client.sendMessage(
                cleanUserId,
                '👻 You are dead and cannot perform night actions.'
            );
            return;
        }

        command = String(command || '')
            .toLowerCase()
            .replace(/^!/, '');

        if (
            !['kill', 'save', 'investigate'].includes(command)
        ) {
            return;
        }

        // ========================================================
        // LETTER -> PLAYER
        // ========================================================

        const target =
            this.getPlayerByLetter(targetLetter);

        if (!target) {
            await this.client.sendMessage(
                cleanUserId,
                '❌ Invalid player letter.\n\n' +
                'Check your case roster and use a valid identifier such as `!kill C`.'
            );
            return;
        }

        if (!target.isAlive) {
            await this.client.sendMessage(
                cleanUserId,
                `❌ *[${target.letter}] ${target.username}* is already dead.\n\n` +
                'You can only target living players.'
            );
            return;
        }

        if (
            this.canonicalizeIdentity(target.id) === cleanUserId
        ) {
            await this.client.sendMessage(
                cleanUserId,
                '❌ You cannot target yourself.'
            );
            return;
        }

        console.log(
            `[MAFIA ACTION] ${player.username} ` +
            `[${player.letter}] -> !${command} ` +
            `[${target.letter}] ${target.username} (${target.id})`
        );

        // ========================================================
        // MAFIA KILL
        // ========================================================

        if (command === 'kill') {
            if (player.role !== 'Mafia') {
                await this.client.sendMessage(
                    cleanUserId,
                    '❌ You are not the Mafia.'
                );
                return;
            }

            if (this.nightActions.kill) {
                await this.client.sendMessage(
                    cleanUserId,
                    'Your Mafia target has already been locked for this night.'
                );
                return;
            }

            this.nightActions.kill = target;
            this.nightActionUsers.kill = player.id;

            await this.client.sendMessage(
                cleanUserId,
                `*TARGET LOCKED*\n\n` +
                `[${target.letter}] ${target.username} has been marked for elimination silently.`
            );

            return;
        }

        // ========================================================
        // DOCTOR SAVE
        // ========================================================

        if (command === 'save') {
            if (player.role !== 'Doctor') {
                await this.client.sendMessage(
                    cleanUserId,
                    '❌ You are not the Doctor.'
                );
                return;
            }

            if (this.nightActions.save) {
                await this.client.sendMessage(
                    cleanUserId,
                    'Your save has already been submitted for this night.'
                );
                return;
            }

            this.nightActions.save = target;
            this.nightActionUsers.save = player.id;

            await this.client.sendMessage(
                cleanUserId,
                `*PROTECTION ATTEMPT SUBMITTED*\n\n` +
                `You are protecting [${target.letter}] ${target.username}.\n\n` +
                'The result will be revealed at sunrise.'
            );

            return;
        }

        // ========================================================
        // DETECTIVE INVESTIGATION
        // ========================================================

        if (command === 'investigate') {
            if (player.role !== 'Detective') {
                await this.client.sendMessage(
                    cleanUserId,
                    '❌ You are not the Detective.'
                );
                return;
            }

            if (this.nightActions.investigate) {
                await this.client.sendMessage(
                    cleanUserId,
                    'Your investigation has already been submitted for this night.'
                );
                return;
            }

            this.nightActions.investigate = target;
            this.nightActionUsers.investigate = player.id;

            if (target.role === 'Mafia') {
                await this.client.sendMessage(
                    cleanUserId,
                    `*INVESTIGATION SUCCESSFUL*\n\n` +
                    `[${target.letter}] ${target.username} *IS THE MAFIA.*\n\n` +
                    'You found the trail.'
                );
            } else {
                player.strikes++;

                await this.client.sendMessage(
                    cleanUserId,
                    `*INVESTIGATION FAILED*\n\n` +
                    `[${target.letter}] ${target.username} is innocent.\n\n` +
                    `Detective strikes: *${player.strikes}/3*`
                );

                if (player.strikes >= 3) {
                    player.role = 'Villager';

                    await this.client.sendMessage(
                        cleanUserId,
                        '*BADGE REVOKED*\n\n' +
                        'Three false leads have destroyed your credibility.\n' +
                        'You are now a *Villager* for the remainder of the case.'
                    );
                }
            }

            return;
        }
    }

    // ============================================================
    // RESOLVE NIGHT
    // ============================================================

    async resolveNight(channelId) {
        if (!this.gameStarted || !this.nightActive) {
            return;
        }

        if (this.nightTimer) {
            clearTimeout(this.nightTimer);
            this.nightTimer = null;
        }

        this.nightActive = false;

        const killTarget = this.nightActions.kill;
        const saveTarget = this.nightActions.save;

        let killedPlayer = null;
        let doctorSaved = false;

        if (killTarget) {
            if (
                saveTarget &&
                this.canonicalizeIdentity(saveTarget.id) ===
                this.canonicalizeIdentity(killTarget.id)
            ) {
                doctorSaved = true;
            } else {
                killedPlayer = killTarget;
                killedPlayer.isAlive = false;
                this.ghosts.push(killedPlayer);

                console.log(
                    `[MAFIA DEATH] ${killedPlayer.username} ` +
                    `[${killedPlayer.letter}] ${killedPlayer.id}`
                );
            }
        }

        // ========================================================
        // DOCTOR STRIKE
        // ========================================================

        const doctor = this.players.find(
            player =>
                player.role === 'Doctor' &&
                player.isAlive
        );

        if (doctor && saveTarget) {
            const savedCorrectly =
                killTarget &&
                this.canonicalizeIdentity(saveTarget.id) ===
                this.canonicalizeIdentity(killTarget.id);

            if (!savedCorrectly) {
                doctor.strikes++;

                await this.client.sendMessage(
                    doctor.id,
                    `*MISSED SAVE*\n\n` +
                    "Your protection target was not the Mafia's target.\n" +
                    `Doctor strikes: *${doctor.strikes}/3*`
                );

                if (doctor.strikes >= 3) {
                    doctor.role = 'Villager';

                    await this.client.sendMessage(
                        doctor.id,
                        '*MEDICAL LICENSE REVOKED*\n\n' +
                        'Three failed saves have exhausted your authority.\n' +
                        'You are now a *Villager*.'
                    );
                }
            }
        }

        // ========================================================
        // MORNING MESSAGE
        // ========================================================

        let morningMessage =
            '*THE SUN RISES...*\n\n';

        if (killedPlayer) {
            morningMessage +=
                `*Tragic news:* ${killedPlayer.username} ` +
                'was found eliminated during the night.\n\n';
        } else if (doctorSaved) {
            morningMessage +=
                '*Miraculous survival!*\n\n' +
                'Someone was attacked during the night, but the victim survived thanks to medical attention.\n\n';
        } else {
            morningMessage +=
                '*No one was eliminated last night.*\n\n';
        }

        let medicalReport;

        if (!killTarget) {
            medicalReport =
                'Medical intervention: *No confirmed attack was recorded.*';
        } else if (doctorSaved) {
            medicalReport =
                'Medical intervention: *SUCCESSFUL.*';
        } else {
            medicalReport =
                'Medical intervention: *FAILED TO PREVENT THE ATTACK.*';
        }

        const detectiveReport =
            this.nightActions.investigate
                ? 'Investigative efforts: *A lead was pursued during the night.*'
                : 'Investigative efforts: *No confirmed investigative activity was recorded.*';

        morningMessage +=
            `${medicalReport}\n${detectiveReport}`;

        await this.client.sendMessage(
            channelId,
            morningMessage
        );

        if (await this.checkWinCondition(channelId)) {
            return;
        }

        await this.startVotingPhase(channelId);
    }

    // ============================================================
    // DAY VOTING
    // ============================================================

    async startVotingPhase(channelId) {
        if (!this.gameStarted) return;

        this.votingActive = true;
        this.nightActive = false;
        this.votes.clear();

        await this.client.sendMessage(
            channelId,
            '*DAY PHASE BEGINS*\n\n' +
            'The survivors gather to analyze the clues and debate who can be trusted.\n\n' +
            'Vote using:\n' +
            '`!vote @username`\n\n' +
            'Ghosts cannot vote.\n' +
            'You have *5 minutes* of open floor discussion and deliberation.'
        );

        this.voteTimer = setTimeout(async () => {
            if (
                !this.gameStarted ||
                !this.votingActive
            ) {
                return;
            }

            try {
                await this.endVotingPhase(channelId);
            } catch (error) {
                console.error(
                    'Mafia voting error:',
                    error
                );
            }
        }, 300000);
    }

    // ============================================================
    // CAST VOTE
    // ============================================================

    castVote(user, targetUser, channelId) {
        if (!this.gameStarted) {
            return '❌ There is no active Mafia Case.';
        }

        if (!this.votingActive) {
            return 'Voting is not active right now.';
        }

        if (channelId !== this.channelId) {
            return '❌ This is not the active Mafia Case chat.';
        }

        const voter =
            this.getPlayerById(user.id);

        if (!voter) {
            return '❌ You are not registered in this Mafia Case.';
        }

        if (!voter.isAlive) {
            return '👻 Ghosts cannot vote!';
        }

        const target =
            this.getPlayerById(targetUser.id);

        if (!target) {
            return '❌ That player is not registered in this Mafia Case.';
        }

        if (!target.isAlive) {
            return '❌ You can only vote for a living player.';
        }

        if (
            this.canonicalizeIdentity(target.id) ===
            this.canonicalizeIdentity(voter.id)
        ) {
            return '❌ You cannot vote for yourself.';
        }

        this.votes.set(
            this.canonicalizeIdentity(voter.id),
            this.canonicalizeIdentity(target.id)
        );

        return `*${voter.username}* has cast their vote.`;
    }

    // ============================================================
    // END VOTING
    // ============================================================

    async endVotingPhase(channelId) {
        if (
            !this.gameStarted ||
            !this.votingActive
        ) {
            return;
        }

        if (this.voteTimer) {
            clearTimeout(this.voteTimer);
            this.voteTimer = null;
        }

        this.votingActive = false;

        const tally = new Map();

        for (const player of this.getAlivePlayers()) {
            tally.set(
                this.canonicalizeIdentity(player.id),
                0
            );
        }

        for (const [voterId, targetId] of this.votes.entries()) {
            const voter = this.getPlayerById(voterId);
            const target = this.getPlayerById(targetId);

            if (
                voter &&
                voter.isAlive &&
                target &&
                target.isAlive
            ) {
                const cleanTargetId =
                    this.canonicalizeIdentity(target.id);

                tally.set(
                    cleanTargetId,
                    (tally.get(cleanTargetId) || 0) + 1
                );
            }
        }

        let tallyMessage =
            '*VOTING TALLY*\n\n';

        for (const player of this.getAlivePlayers()) {
            const votes =
                tally.get(
                    this.canonicalizeIdentity(player.id)
                ) || 0;

            tallyMessage +=
                `${player.username}: *${votes}*\n`;
        }

        await this.client.sendMessage(
            channelId,
            tallyMessage
        );

        if (this.votes.size === 0) {
            await this.client.sendMessage(
                channelId,
                '*NO VOTES WERE CAST.*\n\n' +
                'Indecision paralyzes the town. Nobody is executed today.\n' +
                'The Mafia remains hidden.\n\n' +
                'Night is falling again...'
            );

            await this.startNightPhase(channelId);
            return;
        }

        const highestVotes =
            Math.max(...Array.from(tally.values()));

        const candidates =
            this.getAlivePlayers().filter(
                player =>
                    (tally.get(
                        this.canonicalizeIdentity(player.id)
                    ) || 0) === highestVotes
            );

        if (candidates.length > 1) {
            const names =
                candidates
                    .map(player => player.username)
                    .join(', ');

            await this.client.sendMessage(
                channelId,
                `*DEADLOCK!*\n\n` +
                `The vote resulted in a tie between:\n*${names}*\n\n` +
                'No one can agree on a consensus, so no one is executed today.\n' +
                'The city enters another night.'
            );

            await this.startNightPhase(channelId);
            return;
        }

        const suspect = candidates[0];

        if (suspect.role === 'Mafia') {
            suspect.isAlive = false;
            this.ghosts.push(suspect);

            await this.client.sendMessage(
                channelId,
                `*THE VERDICT*\n\n` +
                `The village accused *${suspect.username}*...\n\n` +
                'The evidence held true.\n' +
                `*${suspect.username} was the MAFIA.*\n\n` +
                '*THE TOWN WINS!*'
            );

            await this.checkWinCondition(channelId);
            return;
        }

        suspect.isAlive = false;
        this.ghosts.push(suspect);

        await this.client.sendMessage(
            channelId,
            `*THE VERDICT*\n\n` +
            `The village accused *${suspect.username}*...\n\n` +
            '❌ *INNOCENT.*\n\n' +
            'A tragic mistake! An innocent citizen was cast out.\n' +
            'The Mafia slips deeper into the shadows.\n\n' +
            'Night falls once again...'
        );

        if (await this.checkWinCondition(channelId)) {
            return;
        }

        await this.startNightPhase(channelId);
    }
}

module.exports = {
    // ============================================================
    // START
    // ============================================================

    startMafiaLobby: async (chatId, client, MessageMedia) => {
        if (
            global.activeMafiaGame &&
            (
                global.activeMafiaGame.inLobby ||
                global.activeMafiaGame.gameStarted
            )
        ) {
            await client.sendMessage(
                chatId,
                'A Mafia Case is already running.'
            );
            return;
        }

        global.activeMafiaGame =
            new MafiaGame(client, MessageMedia);

        return global.activeMafiaGame.startLobby(chatId);
    },

    // ============================================================
    // JOIN
    // ============================================================

    joinMafiaLobby: (
        chatId,
        senderId,
        userName,
        contact
    ) => {
        if (
            !global.activeMafiaGame ||
            !global.activeMafiaGame.inLobby
        ) {
            return null;
        }

        return global.activeMafiaGame.joinGame(
            {
                id: senderId,
                username: userName,
                ...(contact || {})
            },
            chatId
        );
    },

    // ============================================================
    // NIGHT ACTION
    // ============================================================

    handleNightAction: async (
        senderId,
        command,
        targetLetter,
        contact
    ) => {
        if (!global.activeMafiaGame) {
            return;
        }

        return global.activeMafiaGame.handleNightAction(
            {
                id: senderId,
                ...(contact || {})
            },
            command,
            targetLetter
        );
    },

    // ============================================================
    // VOTE
    // ============================================================

    castVote: (
        chatId,
        senderId,
        targetJid,
        targetName,
        targetContact
    ) => {
        if (!global.activeMafiaGame) {
            return '❌ No active Mafia Case.';
        }

        return global.activeMafiaGame.castVote(
            {
                id: senderId
            },
            {
                id: targetJid,
                username: targetName || 'Target',
                ...(targetContact || {})
            },
            chatId
        );
    },

    // ============================================================
    // END
    // ============================================================

    endMafiaGame: async (chatId) => {
        if (!global.activeMafiaGame) {
            return '❌ There is no active Mafia game or lobby running right now.';
        }

        return global.activeMafiaGame.forceEndGame(chatId);
    }
};