const fs = require('fs');

const {
    getUser,
    addCoins,
    addXP,
    readDB,
    writeDB
} = require('../database/db');

class MafiaGame {

    constructor(client, MessageMedia) {

        this.client = client;
        this.MessageMedia = MessageMedia;

        this.inLobby = false;
        this.gameStarted = false;
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

        this.votes = new Map();

        this.votingActive = false;
        this.nightActive = false;

        this.lobbyTimer = null;
        this.nightTimer = null;
        this.voteTimer = null;

        this.endingGame = false;

        this.gameNumber =
            Math.floor(
                100000 +
                Math.random() * 900000
            );

        // ========================================================
        // IDENTITY ALIASES
        // ========================================================

        // Maps WhatsApp identities such as:
        // 2547xxxxxxx@c.us
        // 123456789@lid
        // to one canonical player identity.
        this.identityAliases = new Map();
    }

    sleep(ms) {
        return new Promise(
            resolve => setTimeout(resolve, ms)
        );
    }

    // ============================================================
    // JID / ID NORMALIZATION
    // ============================================================

    normalizeJid(jid) {
        if (!jid) {
            return null;
        }

        let clean =
            String(jid)
                .trim();

        if (clean.includes('_')) {
            clean =
                clean.split('_')[0];
        }

        return clean;
    }

    normalizePhoneNumber(number) {
        if (!number) {
            return null;
        }

        const clean =
            String(number)
                .trim()
                .replace(/[^\d]/g, '');

        return clean || null;
    }

    // ============================================================
    // REGISTER IDENTITY ALIAS
    // ============================================================

    registerIdentityAlias(identity, canonicalId) {

        if (!identity || !canonicalId) {
            return;
        }

        const cleanCanonical =
            this.normalizeJid(
                canonicalId
            );

        if (!cleanCanonical) {
            return;
        }

        const aliases = [];

        if (typeof identity === 'string') {
            aliases.push(identity);
        }

        if (typeof identity === 'object') {

            if (identity.id) {

                if (
                    typeof identity.id === 'string'
                ) {
                    aliases.push(
                        identity.id
                    );
                } else if (
                    identity.id._serialized
                ) {
                    aliases.push(
                        identity.id._serialized
                    );
                }
            }

            if (identity._serialized) {
                aliases.push(
                    identity._serialized
                );
            }

            if (identity.number) {

                const number =
                    this.normalizePhoneNumber(
                        identity.number
                    );

                if (number) {
                    aliases.push(
                        `${number}@c.us`
                    );
                }
            }
        }

        aliases.push(
            cleanCanonical
        );

        for (const alias of aliases) {

            const cleanAlias =
                this.normalizeJid(alias);

            if (!cleanAlias) {
                continue;
            }

            this.identityAliases.set(
                cleanAlias,
                cleanCanonical
            );
        }

        console.log(
            `[IDENTITY ALIAS] Registered aliases for ${cleanCanonical}:`,
            aliases
                .filter(Boolean)
                .map(alias =>
                    this.normalizeJid(alias)
                )
        );
    }

    // ============================================================
    // CANONICALIZE IDENTITY
    // ============================================================

    canonicalizeIdentity(identity) {

        if (!identity) {
            return null;
        }

        // ========================================================
        // OBJECT / CONTACT
        // ========================================================

        if (
            typeof identity === 'object'
        ) {

            let canonical = null;

            if (identity.number) {

                const number =
                    this.normalizePhoneNumber(
                        identity.number
                    );

                if (number) {
                    canonical =
                        `${number}@c.us`;
                }
            }

            if (!canonical && identity._serialized) {

                canonical =
                    this.canonicalizeIdentity(
                        identity._serialized
                    );
            }

            if (
                !canonical &&
                identity.id
            ) {

                if (
                    typeof identity.id === 'string'
                ) {
                    canonical =
                        this.canonicalizeIdentity(
                            identity.id
                        );
                } else if (
                    identity.id._serialized
                ) {
                    canonical =
                        this.canonicalizeIdentity(
                            identity.id._serialized
                        );
                }
            }

            if (canonical) {

                this.registerIdentityAlias(
                    identity,
                    canonical
                );

                return canonical;
            }

            return null;
        }

        // ========================================================
        // STRING ID
        // ========================================================

        let clean =
            this.normalizeJid(identity);

        if (!clean) {
            return null;
        }

        if (
            this.identityAliases.has(clean)
        ) {
            return this.identityAliases.get(
                clean
            );
        }

        if (
            clean.endsWith('@c.us')
        ) {

            const number =
                this.normalizePhoneNumber(
                    clean.split('@')[0]
                );

            if (number) {

                const canonical =
                    `${number}@c.us`;

                this.registerIdentityAlias(
                    clean,
                    canonical
                );

                return canonical;
            }

            return clean;
        }

        if (
            clean.endsWith('@lid')
        ) {
            return clean;
        }

        const number =
            this.normalizePhoneNumber(
                clean
            );

        if (number) {

            const canonical =
                `${number}@c.us`;

            this.registerIdentityAlias(
                clean,
                canonical
            );

            return canonical;
        }

        return clean;
    }

    // ============================================================
    // REMEMBER CONTACT
    // ============================================================

    rememberContact(contact) {

        if (!contact) {
            return null;
        }

        const canonical =
            this.canonicalizeIdentity(
                contact
            );

        if (!canonical) {
            return null;
        }

        this.registerIdentityAlias(
            contact,
            canonical
        );

        return canonical;
    }

    // ============================================================
    // PLAYER LOOKUPS
    // ============================================================

    getPlayerById(id) {

        const normalizedId =
            this.canonicalizeIdentity(
                id
            );

        if (!normalizedId) {
            return null;
        }

        const found =
            this.players.find(
                player => {

                    const playerId =
                        this.canonicalizeIdentity(
                            player.id
                        );

                    if (
                        playerId ===
                        normalizedId
                    ) {
                        return true;
                    }

                    if (
                        player.identities &&
                        player.identities.has(
                            normalizedId
                        )
                    ) {
                        return true;
                    }

                    return false;
                }
            );

        return found || null;
    }

    getPlayerByLetter(letter) {

        if (!letter) {
            return null;
        }

        const cleanLetter =
            String(letter)
                .trim()
                .replace(/[\[\]]/g, '')
                .toUpperCase();

        return (
            this.players.find(
                player =>
                    player.letter ===
                    cleanLetter
            ) || null
        );
    }

    getAlivePlayers() {
        return this.players.filter(
            player =>
                player.isAlive
        );
    }

    getAliveNonMafiaPlayers() {
        return this.players.filter(
            player =>
                player.isAlive &&
                player.role !== 'Mafia'
        );
    }

    getMafia() {
        return (
            this.players.find(
                player =>
                    player.role === 'Mafia' &&
                    player.isAlive
            ) || null
        );
    }

    // ============================================================
    // DEBUG
    // ============================================================

    getPlayerIdentity(player) {

        if (!player) {
            return 'Unknown';
        }

        return (
            `[${player.letter}] ` +
            `${player.username} ` +
            `(${player.id})`
        );
    }

    // ============================================================
    // TIMERS
    // ============================================================

    clearTimers() {

        if (this.lobbyTimer) {

            clearTimeout(
                this.lobbyTimer
            );

            this.lobbyTimer = null;
        }

        if (this.nightTimer) {

            clearTimeout(
                this.nightTimer
            );

            this.nightTimer = null;
        }

        if (this.voteTimer) {

            clearTimeout(
                this.voteTimer
            );

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

        this.identityAliases.clear();

        this.endingGame = false;
    }

    // ============================================================
    // FORCE END
    // ============================================================

    async forceEndGame(channelId) {

        if (
            !this.gameStarted &&
            !this.inLobby
        ) {
            return (
                '❌ There is no active Mafia game ' +
                'or lobby running right now.'
            );
        }

        this.clearTimers();

        this.votingActive = false;
        this.nightActive = false;

        this.gameStarted = false;
        this.inLobby = false;

        try {

            await this.client.sendMessage(
                channelId,
                '🛑 *MAFIA GAME TERMINATED.*\n\n' +
                'The current match has been forcefully stopped.'
            );

        } catch (error) {

            console.error(
                '[MAFIA] Failed to send force-stop message:',
                error
            );
        }

        this.resetGameState();

        if (
            global.activeMafiaGame === this
        ) {
            global.activeMafiaGame = null;
        }

        return null;
    }

    // ============================================================
    // WIN CONDITION
    // ============================================================

    async checkWinCondition(channelId) {

        if (
            !this.gameStarted ||
            this.endingGame
        ) {
            return true;
        }

        const alivePlayers =
            this.getAlivePlayers();

        const mafia =
            this.getMafia();

        if (!mafia) {

            await this.endGame(
                channelId,
                'town',
                '*VICTORY!*\n\n' +
                'The Mafia has been eliminated. ' +
                'The city is finally safe!'
            );

            return true;
        }

        const nonMafiaAlive =
            this.getAliveNonMafiaPlayers();

        if (
            alivePlayers.length <= 2 ||
            nonMafiaAlive.length <= 1
        ) {

            await this.endGame(
                channelId,
                'mafia',
                '*MAFIA VICTORY!*\n\n' +
                'The Mafia has gained control of ' +
                'the remaining city survivors.\n\n' +
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

            const user =
                getUser(
                    player.id,
                    player.username
                );

            if (result === 'win') {

                const coins =
                    player.originalRole === 'Mafia'
                        ? 250
                        : 150;

                const xp =
                    player.originalRole === 'Mafia'
                        ? 200
                        : 175;

                addCoins(
                    player.id,
                    coins
                );

                addXP(
                    player.id,
                    xp,
                    player.username
                );

                user.wins =
                    (user.wins || 0) + 1;

            } else {

                addCoins(
                    player.id,
                    25
                );

                addXP(
                    player.id,
                    50,
                    player.username
                );

                user.losses =
                    (user.losses || 0) + 1;
            }

            const db =
                readDB();

            db[player.id] =
                user;

            writeDB(db);

            console.log(
                `[MAFIA REWARD] ${player.username} ` +
                `| result=${result} ` +
                `| role=${player.originalRole}`
            );

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

    async endGame(
        channelId,
        winner,
        message
    ) {

        if (
            this.endingGame
        ) {
            return;
        }

        if (
            !this.gameStarted &&
            !this.inLobby
        ) {
            return;
        }

        this.endingGame = true;

        this.clearTimers();

        this.votingActive = false;
        this.nightActive = false;

        for (
            const player of this.players
        ) {

            const isWinner =
                (
                    winner === 'mafia' &&
                    player.originalRole === 'Mafia'
                ) ||
                (
                    winner === 'town' &&
                    player.originalRole !== 'Mafia'
                );

            this.awardPlayer(
                player,
                isWinner
                    ? 'win'
                    : 'loss'
            );
        }

        this.gameStarted = false;
        this.inLobby = false;

        try {

            await this.client.sendMessage(
                channelId,
                `${message}\n\n` +
                '*PROJECT MAFIA CASE GAME OVER*'
            );

        } catch (error) {

            console.error(
                '[MAFIA] Failed to send game-over message:',
                error
            );
        }

        let finalRoster =
            '*FINAL CASE FILE*\n\n';

        for (
            const player of this.players
        ) {

            const status =
                player.isAlive
                    ? 'Alive'
                    : 'Ghost';

            finalRoster +=
                `[${player.letter}] ` +
                `${player.username} - ` +
                `*${player.originalRole}* ` +
                `(${status})\n`;
        }

        finalRoster +=
            '\nRewards have been added to the players\' Chaos profiles.';

        try {

            await this.client.sendMessage(
                channelId,
                finalRoster
            );

        } catch (error) {

            console.error(
                '[MAFIA] Failed to send final roster:',
                error
            );
        }

        this.resetGameState();

        if (
            global.activeMafiaGame === this
        ) {
            global.activeMafiaGame = null;
        }
    }

    // ============================================================
    // START LOBBY
    // ============================================================

    async startLobby(channelId) {

        if (
            this.inLobby ||
            this.gameStarted
        ) {

            return this.client.sendMessage(
                channelId,
                'A Mafia Case is already active. ' +
                'Finish the current investigation first.'
            );
        }

        this.inLobby = true;
        this.gameStarted = false;

        this.channelId = channelId;

        this.players = [];
        this.ghosts = [];

        this.votes.clear();

        this.identityAliases.clear();

        // Extract bot's own phone number for the wa.me link
        const botNumber = this.client.info?.wid?.user || '';
        const botDmLink = botNumber ? `https://wa.me/${botNumber}` : 'the bot\'s private chat';

        await this.client.sendMessage(
            channelId,
            '*PROJECT MAFIA CASE*\n\n' +
            'Welcome to the investigation. ' +
            'Take your time, talk, and prepare.\n\n' +
            '⚠️ *REQUIRED BEFORE JOINING:* ⚠️\n' +
            `1. Click here to send a DM to the bot first: ${botDmLink}\n` +
            '2. Send any message (e.g., `hi` or `!ping`) to activate private role delivery.\n' +
            '3. Return here and type `!joinmafia` to enter the case!\n\n' +
            'Registration is open for *2 minutes*.\n\n' +
            'Minimum players: *4*\n' +
            'Mafia: *1*\n' +
            'Doctor: *1*\n' +
            'Detective: *1*\n' +
            'Everyone else: *Villagers*\n\n' +
            'Once registration closes, secret roles will be assigned privately.'
        );

        try {

            const rulesPath =
                './rules.pdf';

            if (
                fs.existsSync(
                    rulesPath
                )
            ) {

                const pdfMedia =
                    this.MessageMedia.fromFilePath(
                        rulesPath
                    );

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

        try {

            const mp3Path =
                './briefing.mp3';

            const oggPath =
                './briefing.ogg';

            let audioPath = null;

            if (
                fs.existsSync(mp3Path)
            ) {

                audioPath =
                    mp3Path;

            } else if (
                fs.existsSync(oggPath)
            ) {

                audioPath =
                    oggPath;
            }

            if (audioPath) {

                await this.sleep(
                    1000
                );

                const audioMedia =
                    this.MessageMedia.fromFilePath(
                        audioPath
                    );

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

        this.lobbyTimer =
            setTimeout(
                async () => {

                    if (!this.inLobby) {
                        return;
                    }

                    try {

                        await this.startGame(
                            channelId
                        );

                    } catch (error) {

                        console.error(
                            'Mafia lobby timer error:',
                            error
                        );
                    }

                },
                120000
            );
    }

    // ============================================================
    // JOIN MAFIA
    // ============================================================

    async joinGame(
        user,
        channelId
    ) {

        if (!this.inLobby) {
            return null;
        }

        if (
            this.channelId !== channelId
        ) {
            return null;
        }

        console.log(
            '[MAFIA JOIN] Raw user:',
            JSON.stringify(
                user,
                null,
                2
            )
        );

        const permanentJid =
            this.canonicalizeIdentity(
                user
            );

        if (!permanentJid) {

            return (
                '❌ Could not identify your WhatsApp account.'
            );
        }

        const existingPlayer =
            this.getPlayerById(
                permanentJid
            );

        if (existingPlayer) {

            return (
                `*${existingPlayer.username}*, ` +
                'you are already registered for this case!\n\n' +
                `Your identifier is *[${existingPlayer.letter}]*.`
            );
        }

        const letters =
            'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

        if (
            this.players.length >=
            letters.length
        ) {

            return (
                'The case roster is full.'
            );
        }

        const assignedLetter =
            letters[
                this.players.length
            ];

        const identities =
            new Set();

        const addIdentity =
            value => {

                if (!value) {
                    return;
                }

                const normalized =
                    this.normalizeJid(
                        value
                    );

                if (
                    normalized
                ) {
                    identities.add(
                        normalized
                    );
                }
            };

        addIdentity(
            permanentJid
        );

        if (
            user.id
        ) {

            if (
                typeof user.id === 'string'
            ) {

                addIdentity(
                    user.id
                );

            } else if (
                user.id._serialized
            ) {

                addIdentity(
                    user.id._serialized
                );
            }
        }

        if (
            user._serialized
        ) {

            addIdentity(
                user._serialized
            );
        }

        if (
            user.number
        ) {

            const number =
                this.normalizePhoneNumber(
                    user.number
                );

            if (number) {

                addIdentity(
                    `${number}@c.us`
                );
            }
        }

        const player = {

            id: permanentJid,

            username:
                user.username ||
                user.pushname ||
                user.name ||
                'Unknown Player',

            tag:
                user.tag ||
                '',

            letter:
                assignedLetter,

            role:
                'Villager',

            originalRole:
                'Villager',

            isAlive:
                true,

            strikes:
                0,

            identities
        };

        for (
            const identity of identities
        ) {

            this.registerIdentityAlias(
                identity,
                permanentJid
            );
        }

        // ========================================================
        // DM ACCESS CHECK (GUARDRAIL)
        // ========================================================
        const canDm = await this.resolvePrivateChat(player);
        if (!canDm) {
            const botNumber = this.client.info?.wid?.user || '';
            const botDmLink = botNumber ? `https://wa.me/${botNumber}` : 'the bot\'s private chat';

            return (
                `❌ *${player.username}*, I cannot send you private messages!\n\n` +
                `Please open a direct chat with the bot first: ${botDmLink}\n` +
                'Send a quick message (like `hi` or `!ping`), then try `!joinmafia` again.'
            );
        }

        this.players.push(
            player
        );

        console.log(
            `[MAFIA JOIN] ✓ Player registered | ` +
            `username=${player.username} | ` +
            `letter=[${player.letter}] | ` +
            `canonical=${player.id}`
        );

        console.log(
            `[MAFIA JOIN] Known identities:`,
            [...player.identities]
        );

        return (
            `*${player.username}* has joined the case!\n\n` +
            `Secret identifier: *[${assignedLetter}]*`
        );
    }

    // ============================================================
    // RESOLVE PRIVATE CHAT
    // ============================================================

    async resolvePrivateChat(
        player
    ) {

        const candidates =
            [];

        if (player.id) {
            candidates.push(
                player.id
            );
        }

        if (
            player.identities
        ) {

            for (
                const identity of
                player.identities
            ) {

                candidates.push(
                    identity
                );
            }
        }

        const uniqueCandidates =
            [
                ...new Set(
                    candidates
                        .filter(Boolean)
                        .map(
                            value =>
                                this.normalizeJid(
                                    value
                                )
                        )
                )
            ];

        console.log(
            `[MAFIA DM] Resolving private chat for ` +
            `${player.username} [${player.letter}]`
        );

        console.log(
            `[MAFIA DM] Candidates:`,
            uniqueCandidates
        );

        for (
            const candidate of
            uniqueCandidates
        ) {

            try {

                const contact =
                    await this.client.getContactById(
                        candidate
                    );

                if (contact) {

                    this.rememberContact(
                        contact
                    );

                    const contactId =
                        contact.id?._serialized ||
                        contact._serialized ||
                        candidate;

                    console.log(
                        `[MAFIA DM] Contact resolved | ` +
                        `${player.username} -> ${contactId}`
                    );

                    try {

                        const chat =
                            await contact.getChat();

                        if (chat) {

                            console.log(
                                `[MAFIA DM] Private chat resolved | ` +
                                `${player.username} -> ${chat.id?._serialized || chat.id}`
                            );

                            return {
                                contact,
                                chat,
                                chatId:
                                    chat.id?._serialized ||
                                    chat.id ||
                                    contactId
                            };
                        }

                    } catch (chatError) {

                        console.log(
                            `[MAFIA DM] getChat failed for ${candidate}:`,
                            chatError.message
                        );

                        return {
                            contact,
                            chat: null,
                            chatId: contactId
                        };
                    }
                }

            } catch (error) {

                console.log(
                    `[MAFIA DM] Could not resolve ${candidate} for ${player.username}:`,
                    error.message
                );
            }
        }

        return null;
    }

    // ============================================================
    // SEND ROLE DM
    // ============================================================

    async sendRoleDM(
        player,
        roleMessage
    ) {

        const resolved =
            await this.resolvePrivateChat(
                player
            );

        if (!resolved) {

            console.error(
                `[MAFIA DM] ❌ Could not resolve private chat for ` +
                `${player.username} [${player.letter}]`
            );

            return false;
        }

        try {

            const destination =
                resolved.chatId;

            await this.client.sendMessage(
                destination,
                roleMessage
            );

            console.log(
                `[MAFIA DM] ✓ ROLE DM SENT | ` +
                `${player.username} [${player.letter}] | ` +
                `destination=${resolved.chatId}`
            );

            return true;

        } catch (error) {

            console.error(
                `[MAFIA DM] ❌ ROLE DM FAILED | ` +
                `${player.username} [${player.letter}]`,
                error
            );

            return false;
        }
    }

    // ============================================================
    // START GAME
    // ============================================================

    async startGame(channelId) {

        if (!this.inLobby) {
            return;
        }

        this.clearTimers();

        if (
            this.players.length < 4
        ) {

            await this.client.sendMessage(
                channelId,
                '*REGISTRATION CLOSED.*\n\n' +
                `Only *${this.players.length}* player(s) registered.\n` +
                'At least *4* players are required.\n\n' +
                '❌ The Mafia Case has been canceled.'
            );

            this.resetGameState();

            if (
                global.activeMafiaGame
            ) {
                global.activeMafiaGame =
                    null;
            }

            return;
        }

        this.inLobby = false;
        this.gameStarted = true;

        this.channelId =
            channelId;

        this.endingGame = false;

        this.players.forEach(
            player => {

                player.role =
                    'Villager';

                player.originalRole =
                    'Villager';

                player.isAlive =
                    true;

                player.strikes =
                    0;
            }
        );

        // ========================================================
        // DYNAMIC ROLE ASSIGNMENT
        // ========================================================

        const rolePool = ['Mafia', 'Doctor', 'Detective'];
        while (rolePool.length < this.players.length) {
            rolePool.push('Villager');
        }

        // Shuffle roles
        for (let i = rolePool.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [rolePool[i], rolePool[j]] = [rolePool[j], rolePool[i]];
        }

        // Assign shuffled roles to players
        this.players.forEach((player, index) => {
            player.role = rolePool[index];
            player.originalRole = rolePool[index];
        });

        // ========================================================
        // CASE ROSTER
        // ========================================================

        let roster =
            '*CASE ROSTER & IDENTIFIERS*\n\n';

        this.players.forEach(
            player => {

                roster +=
                    `*[${player.letter}]* ` +
                    `${player.username}\n`;
            }
        );

        // ========================================================
        // PRIVATE ROLE DMS
        // ========================================================

        const failedDMs =
            [];

        for (
            const player of
            this.players
        ) {

            let roleMessage =
                '*PROJECT MAFIA CASE*\n\n' +
                'Your secret role is:\n' +
                `*${player.originalRole}*\n\n` +
                `${roster}\n`;

            if (
                player.originalRole ===
                'Mafia'
            ) {

                roleMessage +=
                    '*NIGHT ACTION*\n' +
                    'Use:\n' +
                    '`!kill [Letter]`\n\n' +
                    'Choose one living player to eliminate silently.';

            } else if (
                player.originalRole ===
                'Doctor'
            ) {

                roleMessage +=
                    '*NIGHT ACTION*\n' +
                    'Use:\n' +
                    '`!save [Letter]`\n\n' +
                    'Try to protect the Mafia\'s target.\n' +
                    'You have *3 strikes* before your medical license is revoked.';

            } else if (
                player.originalRole ===
                'Detective'
            ) {

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

            const sent =
                await this.sendRoleDM(
                    player,
                    roleMessage
                );

            if (!sent) {

                failedDMs.push(
                    player
                );
            }

            // Small delay to prevent socket timeouts or spam flag triggers during batch DMs
            await this.sleep(500);
        }

        if (
            failedDMs.length > 0
        ) {

            let failedMessage =
                '⚠️ *PRIVATE ROLE DELIVERY WARNING*\n\n' +
                'The Mafia Case could not deliver a private role message to:\n\n';

            failedDMs.forEach(
                player => {

                    failedMessage +=
                        `• *${player.username}* [${player.letter}]\n`;
                }
            );

            failedMessage +=
                '\nThe game will continue, but those players may need to check their private chat with the bot.';

            await this.client.sendMessage(
                channelId,
                failedMessage
            );

            console.error(
                '[MAFIA DM] Failed role delivery:',
                failedDMs.map(
                    player =>
                        `${player.username} [${player.letter}]`
                )
            );

        } else {

            console.log(
                '[MAFIA DM] ✓ All role DMs delivered successfully.'
            );
        }

        await this.client.sendMessage(
            channelId,
            '*REGISTRATION CLOSED*\n\n' +
            'The roles have been assigned privately. ' +
            'Take your time to read your DMs.\n' +
            'The city is going to sleep...\n\n' +
            'Mafia: choose your target carefully.\n' +
            'Doctor: choose who you think is under attack.\n' +
            'Detective: investigate a suspect.\n\n' +
            'Night actions must be submitted before the 5-minute night timer expires.'
        );

        await this.startNightPhase(
            channelId
        );
    }

    // ============================================================
    // NIGHT PHASE
    // ============================================================

    async startNightPhase(
        channelId
    ) {

        if (
            !this.gameStarted ||
            this.endingGame
        ) {
            return;
        }

        if (
            await this.checkWinCondition(
                channelId
            )
        ) {
            return;
        }

        console.log(
            `[NIGHT PHASE] Starting night | ` +
            `game=${this.gameNumber} | ` +
            `alive=${this.getAlivePlayers().length}`
        );

        this.players.forEach(
            player => {

                console.log(
                    `[ROSTER] ` +
                    `${player.username} ` +
                    `[${player.letter}] | ` +
                    `role=${player.role} | ` +
                    `originalRole=${player.originalRole} | ` +
                    `alive=${player.isAlive} | ` +
                    `id=${player.id}`
                );
            }
        );

        this.nightActive =
            true;

        this.votingActive =
            false;

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
            'Shadows stretch across the city. ' +
            'Complete silence takes over...\n\n' +
            'Mafia: execute your strike (`!kill [Letter]`).\n' +
            'Doctor: protect someone (`!save [Letter]`).\n' +
            'Detective: gather evidence (`!investigate [Letter]`).\n\n' +
            'You have *5 minutes* of deep night to scheme in secret.'
        );

        this.nightTimer =
            setTimeout(
                async () => {

                    if (
                        !this.gameStarted ||
                        !this.nightActive
                    ) {
                        return;
                    }

                    try {

                        await this.resolveNight(
                            channelId
                        );

                    } catch (error) {

                        console.error(
                            'Mafia night resolution error:',
                            error
                        );
                    }

                },
                300000
            );
    }

    // ============================================================
    // EARLY NIGHT RESOLUTION CHECK
    // ============================================================

    checkAutoResolveNight() {

        if (!this.gameStarted || !this.nightActive) {
            return;
        }

        const aliveMafia = this.getMafia();
        const aliveDoctor = this.players.find(
            p => p.role === 'Doctor' && p.isAlive
        );
        const aliveDetective = this.players.find(
            p => p.role === 'Detective' && p.isAlive
        );

        const mafiaDone = !aliveMafia || !!this.nightActions.kill;
        const doctorDone = !aliveDoctor || !!this.nightActions.save;
        const detectiveDone = !aliveDetective || !!this.nightActions.investigate;

        if (mafiaDone && doctorDone && detectiveDone) {

            console.log('[MAFIA NIGHT] All actions submitted early. Resolving night...');

            this.resolveNight(this.channelId);
        }
    }

    // ============================================================
    // NIGHT ACTION HANDLER
    // ============================================================

    async handleNightAction(
        user,
        command,
        targetLetter
    ) {

        console.log(
            `[NIGHT ACTION] Received | ` +
            `command=${command} | ` +
            `target=${targetLetter} | ` +
            `user=${JSON.stringify(user)}`
        );

        let cleanUserId =
            this.canonicalizeIdentity(
                user
            );

        if (
            user &&
            typeof user === 'object'
        ) {

            const remembered =
                this.rememberContact(
                    user
                );

            if (remembered) {
                cleanUserId =
                    remembered;
            }
        }

        if (!cleanUserId) {
            return;
        }

        console.log(
            `[MAFIA NIGHT] Sender canonical ID: ${cleanUserId}`
        );

        if (
            !this.gameStarted ||
            !this.nightActive
        ) {

            try {

                await this.client.sendMessage(
                    cleanUserId,
                    '❌ *Night actions are not available right now.*\n\n' +
                    'Night actions can only be used during the Night phase of an active game.'
                );

            } catch (error) {

                console.error(
                    '[MAFIA NIGHT] Could not send inactive-night reply:',
                    error
                );
            }

            return;
        }

        const player =
            this.getPlayerById(
                cleanUserId
            );

        console.log(
            `[MAFIA NIGHT] Player resolved:`,
            player
                ? `${player.username} [${player.letter}] ROLE=${player.role}`
                : 'NO PLAYER'
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

        command =
            String(command || '')
                .toLowerCase()
                .replace(/^!/, '')
                .trim();

        if (
            ![
                'kill',
                'save',
                'investigate'
            ].includes(command)
        ) {
            return;
        }

        const requiredRole =
            command === 'kill'
                ? 'Mafia'
                : command === 'save'
                    ? 'Doctor'
                    : 'Detective';

        if (
            player.role !== requiredRole
        ) {

            await this.client.sendMessage(
                cleanUserId,
                `❌ You are not the ${requiredRole}.`
            );

            return;
        }

        const target =
            this.getPlayerByLetter(
                targetLetter
            );

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
            this.canonicalizeIdentity(
                target.id
            ) === cleanUserId
        ) {

            await this.client.sendMessage(
                cleanUserId,
                '❌ You cannot target yourself.'
            );

            return;
        }

        console.log(
            `[MAFIA ACTION] ` +
            `${player.username} [${player.letter}] ` +
            `-> !${command} ` +
            `[${target.letter}] ${target.username}`
        );

        if (
            command === 'kill'
        ) {

            if (
                this.nightActions.kill
            ) {

                await this.client.sendMessage(
                    cleanUserId,
                    'Your Mafia target has already been locked for this night.'
                );

                return;
            }

            this.nightActions.kill =
                target;

            this.nightActionUsers.kill =
                player.id;

            await this.client.sendMessage(
                cleanUserId,
                '*TARGET LOCKED*\n\n' +
                `[${target.letter}] ${target.username} ` +
                'has been marked for elimination silently.'
            );

            this.checkAutoResolveNight();

            return;
        }

        if (
            command === 'save'
        ) {

            if (
                this.nightActions.save
            ) {

                await this.client.sendMessage(
                    cleanUserId,
                    'Your save has already been submitted for this night.'
                );

                return;
            }

            this.nightActions.save =
                target;

            this.nightActionUsers.save =
                player.id;

            await this.client.sendMessage(
                cleanUserId,
                '*PROTECTION ATTEMPT SUBMITTED*\n\n' +
                `You are protecting [${target.letter}] ${target.username}.\n\n` +
                'The result will be revealed at sunrise.'
            );

            this.checkAutoResolveNight();

            return;
        }

        if (
            command === 'investigate'
        ) {

            if (
                this.nightActions.investigate
            ) {

                await this.client.sendMessage(
                    cleanUserId,
                    'Your investigation has already been submitted for this night.'
                );

                return;
            }

            this.nightActions.investigate =
                target;

            this.nightActionUsers.investigate =
                player.id;

            if (
                target.role === 'Mafia'
            ) {

                await this.client.sendMessage(
                    cleanUserId,
                    '*INVESTIGATION SUCCESSFUL*\n\n' +
                    `[${target.letter}] ${target.username} ` +
                    '*IS THE MAFIA.*\n\n' +
                    'You found the trail.'
                );

            } else {

                player.strikes++;

                await this.client.sendMessage(
                    cleanUserId,
                    '*INVESTIGATION FAILED*\n\n' +
                    `[${target.letter}] ${target.username} is innocent.\n\n` +
                    `Detective strikes: *${player.strikes}/3*`
                );

                if (
                    player.strikes >= 3
                ) {

                    player.role =
                        'Villager';

                    await this.client.sendMessage(
                        cleanUserId,
                        '*BADGE REVOKED*\n\n' +
                        'Three false leads have destroyed your credibility.\n' +
                        'You are now a *Villager* for the remainder of the case.'
                    );
                }
            }

            this.checkAutoResolveNight();

            return;
        }
    }

    // ============================================================
    // RESOLVE NIGHT
    // ============================================================

    async resolveNight(
        channelId
    ) {

        if (
            !this.gameStarted ||
            !this.nightActive
        ) {
            return;
        }

        if (
            this.nightTimer
        ) {

            clearTimeout(
                this.nightTimer
            );

            this.nightTimer =
                null;
        }

        this.nightActive =
            false;

        const killTarget =
            this.nightActions.kill;

        const saveTarget =
            this.nightActions.save;

        let killedPlayer =
            null;

        let doctorSaved =
            false;

        if (killTarget) {

            if (
                saveTarget &&
                this.canonicalizeIdentity(
                    saveTarget.id
                ) ===
                this.canonicalizeIdentity(
                    killTarget.id
                )
            ) {

                doctorSaved =
                    true;

            } else {

                killedPlayer =
                    killTarget;

                killedPlayer.isAlive =
                    false;

                this.ghosts.push(
                    killedPlayer
                );

                console.log(
                    `[MAFIA DEATH] ` +
                    `${killedPlayer.username} ` +
                    `[${killedPlayer.letter}]`
                );
            }
        }

        const doctor =
            this.players.find(
                player =>
                    player.role === 'Doctor' &&
                    player.isAlive
            );

        if (
            doctor &&
            saveTarget
        ) {

            const savedCorrectly =
                killTarget &&
                this.canonicalizeIdentity(
                    saveTarget.id
                ) ===
                this.canonicalizeIdentity(
                    killTarget.id
                );

            if (
                !savedCorrectly
            ) {

                doctor.strikes++;

                await this.client.sendMessage(
                    doctor.id,
                    '*MISSED SAVE*\n\n' +
                    'Your protection target was not the Mafia\'s target.\n' +
                    `Doctor strikes: *${doctor.strikes}/3*`
                );

                if (
                    doctor.strikes >= 3
                ) {

                    doctor.role =
                        'Villager';

                    await this.client.sendMessage(
                        doctor.id,
                        '*MEDICAL LICENSE REVOKED*\n\n' +
                        'Three failed saves have exhausted your authority.\n' +
                        'You are now a *Villager*.'
                    );
                }
            }
        }

        let morningMessage =
            '*THE SUN RISES...*\n\n';

        if (
            killedPlayer
        ) {

            morningMessage +=
                `*Tragic news:* ${killedPlayer.username} ` +
                'was found eliminated during the night.\n\n';

        } else if (
            doctorSaved
        ) {

            morningMessage +=
                '*Miraculous survival!*\n\n' +
                'Someone was attacked during the night, ' +
                'but the victim survived thanks to medical attention.\n\n';

        } else {

            morningMessage +=
                '*No one was eliminated last night.*\n\n';
        }

        let medicalReport;

        if (!killTarget) {

            medicalReport =
                'Medical intervention: ' +
                '*No confirmed attack was recorded.*';

        } else if (
            doctorSaved
        ) {

            medicalReport =
                'Medical intervention: ' +
                '*SUCCESSFUL.*';

        } else {

            medicalReport =
                'Medical intervention: ' +
                '*FAILED TO PREVENT THE ATTACK.*';
        }

        const detectiveReport =
            this.nightActions.investigate
                ? 'Investigative efforts: *A lead was pursued during the night.*'
                : 'Investigative efforts: *No confirmed investigative activity was recorded.*';

        morningMessage +=
            `${medicalReport}\n` +
            `${detectiveReport}`;

        await this.client.sendMessage(
            channelId,
            morningMessage
        );

        if (
            await this.checkWinCondition(
                channelId
            )
        ) {
            return;
        }

        await this.startVotingPhase(
            channelId
        );
    }

    // ============================================================
    // DAY VOTING
    // ============================================================

    async startVotingPhase(
        channelId
    ) {

        if (
            !this.gameStarted ||
            this.endingGame
        ) {
            return;
        }

        this.votingActive =
            true;

        this.nightActive =
            false;

        this.votes.clear();

        await this.client.sendMessage(
            channelId,
            '*DAY PHASE BEGINS*\n\n' +
            'The survivors gather to analyze the clues ' +
            'and debate who can be trusted.\n\n' +
            'Vote using:\n' +
            '`!vote @username`\n\n' +
            'Ghosts cannot vote.\n' +
            'You have *5 minutes* of open floor discussion and deliberation.'
        );

        this.voteTimer =
            setTimeout(
                async () => {

                    if (
                        !this.gameStarted ||
                        !this.votingActive
                    ) {
                        return;
                    }

                    try {

                        await this.endVotingPhase(
                            channelId
                        );

                    } catch (error) {

                        console.error(
                            'Mafia voting error:',
                            error
                        );
                    }

                },
                300000
            );
    }

    // ============================================================
    // CAST VOTE
    // ============================================================

    castVote(
        user,
        targetUser,
        channelId
    ) {

        if (
            !this.gameStarted
        ) {
            return (
                '❌ There is no active Mafia Case.'
            );
        }

        if (
            !this.votingActive
        ) {
            return (
                '❌ Voting is not active right now.'
            );
        }

        if (
            channelId !== this.channelId
        ) {
            return (
                '❌ This is not the active Mafia Case chat.'
            );
        }

        const voter =
            this.getPlayerById(
                user?.id ||
                user
            );

        if (!voter) {

            return (
                '❌ You are not registered in this Mafia Case.'
            );
        }

        if (
            !voter.isAlive
        ) {

            return (
                '👻 Ghosts cannot vote!'
            );
        }

        const target =
            this.getPlayerById(
                targetUser?.id ||
                targetUser
            );

        if (!target) {

            return (
                '❌ That player is not registered in this Mafia Case.'
            );
        }

        if (
            !target.isAlive
        ) {

            return (
                '❌ You can only vote for a living player.'
            );
        }

        if (
            this.canonicalizeIdentity(
                target.id
            ) ===
            this.canonicalizeIdentity(
                voter.id
            )
        ) {

            return (
                '❌ You cannot vote for yourself.'
            );
        }

        const voterId =
            this.canonicalizeIdentity(
                voter.id
            );

        const targetId =
            this.canonicalizeIdentity(
                target.id
            );

        this.votes.set(
            voterId,
            targetId
        );

        console.log(
            `[VOTE] ${voter.username} ` +
            `-> ${target.username}`
        );

        return (
            `*${voter.username}* has cast their vote.`
        );
    }

    // ============================================================
    // END VOTING
    // ============================================================

    async endVotingPhase(
        channelId
    ) {

        if (
            !this.gameStarted ||
            !this.votingActive
        ) {
            return;
        }

        if (
            this.voteTimer
        ) {

            clearTimeout(
                this.voteTimer
            );

            this.voteTimer =
                null;
        }

        this.votingActive =
            false;

        const tally =
            new Map();

        for (
            const player of
            this.getAlivePlayers()
        ) {

            tally.set(
                this.canonicalizeIdentity(
                    player.id
                ),
                0
            );
        }

        let validVoteCount =
            0;

        for (
            const [
                voterId,
                targetId
            ]
            of this.votes.entries()
        ) {

            const voter =
                this.getPlayerById(
                    voterId
                );

            const target =
                this.getPlayerById(
                    targetId
                );

            if (
                voter &&
                voter.isAlive &&
                target &&
                target.isAlive
            ) {

                const cleanTargetId =
                    this.canonicalizeIdentity(
                        target.id
                    );

                tally.set(
                    cleanTargetId,
                    (
                        tally.get(
                            cleanTargetId
                        ) || 0
                    ) + 1
                );

                validVoteCount++;
            }
        }

        let tallyMessage =
            '*VOTING TALLY*\n\n';

        for (
            const player of
            this.getAlivePlayers()
        ) {

            const votes =
                tally.get(
                    this.canonicalizeIdentity(
                        player.id
                    )
                ) || 0;

            tallyMessage +=
                `${player.username}: *${votes}*\n`;
        }

        await this.client.sendMessage(
            channelId,
            tallyMessage
        );

        if (
            validVoteCount === 0
        ) {

            await this.client.sendMessage(
                channelId,
                '*NO VALID VOTES WERE CAST.*\n\n' +
                'Indecision paralyzes the town. ' +
                'Nobody is executed today.\n' +
                'The Mafia remains hidden.\n\n' +
                'Night is falling again...'
            );

            await this.startNightPhase(
                channelId
            );

            return;
        }

        const highestVotes =
            Math.max(
                ...Array.from(
                    tally.values()
                )
            );

        const candidates =
            this.getAlivePlayers().filter(
                player =>
                    (
                        tally.get(
                            this.canonicalizeIdentity(
                                player.id
                            )
                        ) || 0
                    ) === highestVotes
            );

        if (
            candidates.length > 1
        ) {

            const names =
                candidates
                    .map(
                        player =>
                            player.username
                    )
                    .join(', ');

            await this.client.sendMessage(
                channelId,
                `*DEADLOCK!*\n\n` +
                `The vote resulted in a tie between:\n` +
                `*${names}*\n\n` +
                'No one can agree on a consensus, ' +
                'so no one is executed today.\n' +
                'The city enters another night.'
            );

            await this.startNightPhase(
                channelId
            );

            return;
        }

        const suspect =
            candidates[0];

        suspect.isAlive =
            false;

        this.ghosts.push(
            suspect
        );

        if (
            suspect.originalRole ===
            'Mafia'
        ) {

            await this.client.sendMessage(
                channelId,
                `*THE VERDICT*\n\n` +
                `The village accused *${suspect.username}*...\n\n` +
                'The evidence held true.\n' +
                `*${suspect.username} was the MAFIA.*\n\n` +
                '*THE TOWN WINS!*'
            );

            await this.checkWinCondition(
                channelId
            );

            return;
        }

        await this.client.sendMessage(
            channelId,
            `*THE VERDICT*\n\n` +
            `The village accused *${suspect.username}*...\n\n` +
            '❌ *INNOCENT.*\n\n' +
            'A tragic mistake! An innocent citizen was cast out.\n' +
            'The Mafia slips deeper into the shadows.\n\n' +
            'Night falls once again...'
        );

        if (
            await this.checkWinCondition(
                channelId
            )
        ) {
            return;
        }

        await this.startNightPhase(
            channelId
        );
    }
}

module.exports = {

    // ============================================================
    // START
    // ============================================================

    startMafiaLobby:
        async (
            chatId,
            client,
            MessageMedia
        ) => {

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
                new MafiaGame(
                    client,
                    MessageMedia
                );

            return global.activeMafiaGame.startLobby(
                chatId
            );
        },

    // ============================================================
    // JOIN
    // ============================================================

    joinMafiaLobby:
        async (
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

            return await global.activeMafiaGame.joinGame(
                {
                    id:
                        senderId,

                    username:
                        userName,

                    ...(contact || {})
                },
                chatId
            );
        },

    // ============================================================
    // NIGHT ACTION
    // ============================================================

    handleNightAction:
        async (
            senderId,
            command,
            targetLetter,
            contact
        ) => {

            if (
                !global.activeMafiaGame
            ) {
                return;
            }

            return global.activeMafiaGame.handleNightAction(
                {
                    id:
                        senderId,

                    ...(contact || {})
                },
                command,
                targetLetter
            );
        },

    // ============================================================
    // VOTE
    // ============================================================

    castVote:
        (
            chatId,
            senderId,
            targetJid,
            targetName,
            targetContact
        ) => {

            if (
                !global.activeMafiaGame
            ) {

                return (
                    '❌ No active Mafia Case.'
                );
            }

            return global.activeMafiaGame.castVote(
                {
                    id:
                        senderId
                },
                {
                    id:
                        targetJid,

                    username:
                        targetName ||
                        'Target',

                    ...(targetContact || {})
                },
                chatId
            );
        },

    // ============================================================
    // END
    // ============================================================

    endMafiaGame:
        async (
            chatId
        ) => {

            if (
                !global.activeMafiaGame
            ) {

                return (
                    '❌ There is no active Mafia game ' +
                    'or lobby running right now.'
                );
            }

            return global.activeMafiaGame.forceEndGame(
                chatId
            );
        }
};