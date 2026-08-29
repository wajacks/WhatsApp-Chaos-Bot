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
    this.gameNumber = Math.floor(100000 + Math.random() * 900000);
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  getPlayerById(id) {
    return this.players.find(p => p.id === id);
  }

  getAlivePlayers() {
    return this.players.filter(p => p.isAlive);
  }

  getAliveNonMafiaPlayers() {
    return this.players.filter(p => p.isAlive && p.role !== 'Mafia');
  }

  getMafia() {
    return this.players.find(p => p.role === 'Mafia' && p.isAlive);
  }

  getPlayerByLetter(letter) {
    if (!letter) return null;
    return this.players.find(
      p => p.letter === String(letter).trim().toUpperCase()
    );
  }

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
      '🛑 **MAFIA GAME TERMINATED.** The current match has been forcefully stopped.'
    );

    this.resetGameState();

    if (global.activeMafiaGame === this) {
      global.activeMafiaGame = null;
    }

    return null;
  }

  async checkWinCondition(channelId) {
    if (!this.gameStarted) {
      return true;
    }

    const alivePlayers = this.getAlivePlayers();
    const mafia = this.getMafia();

    if (!mafia) {
      await this.endGame(
        channelId,
        'town',
        '*VICTORY!*\n\nThe Mafia has been eliminated. The city is finally safe!'
      );
      return true;
    }

    const nonMafiaAlive = this.getAliveNonMafiaPlayers();
    if (alivePlayers.length <= 2 || (mafia && nonMafiaAlive.length <= 1)) {
      await this.endGame(
        channelId,
        'mafia',
        '*MAFIA VICTORY!*\n\nThe Mafia has gained control of the remaining city survivors.\n\nThe case is closed... and the Mafia walks free.'
      );
      return true;
    }

    return false;
  }

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
        const coins = 25;
        const xp = 50;
        addCoins(player.id, coins);
        addXP(player.id, xp, player.username);
        user.losses = (user.losses || 0) + 1;
      }
      const db = readDB();
      db[player.id] = getUser(player.id, player.username);
      writeDB(db);
    } catch (error) {
      console.error(`Failed to award Mafia result to ${player.username}:`, error);
    }
  }

  async endGame(channelId, winner, message) {
    if (!this.gameStarted && !this.inLobby) {
      return;
    }

    this.clearTimers();
    this.votingActive = false;
    this.nightActive = false;

    for (const player of this.players) {
      const isWinner =
        (winner === 'mafia' && player.role === 'Mafia') ||
        (winner === 'town' && player.role !== 'Mafia');
      if (isWinner) {
        this.awardPlayer(player, 'win');
      } else {
        this.awardPlayer(player, 'loss');
      }
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
      finalRoster += `[${player.letter}] ${player.username} - *${player.role}* (${status})\n`;
    }
    finalRoster += '\nRewards have been added to the players\' Chaos profiles.';

    await this.client.sendMessage(channelId, finalRoster);
    this.resetGameState();
    
    if (global.activeMafiaGame === this) {
      global.activeMafiaGame = null;
    }
  }

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

    try {
      const rulesPath = './rules.pdf';
      if (fs.existsSync(rulesPath)) {
        const pdfMedia = this.MessageMedia.fromFilePath(rulesPath);
        await this.client.sendMessage(
          channelId,
          pdfMedia,
          { caption: '*Case File & Official Rules*\nReview the investigation rules before the case begins.' }
        );
      }
    } catch (error) {
      console.error('Could not send rules.pdf:', error);
    }

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
        const audioMedia = this.MessageMedia.fromFilePath(audioPath);
        await this.client.sendMessage(
          channelId,
          audioMedia,
          { caption: '*Audio Dispatch*\nDetective briefing incoming...' }
        );
      }
    } catch (error) {
      console.error('Could not send Mafia briefing:', error.message);
    }

    // 2 Minutes Lobby Timer (120,000 ms)
    this.lobbyTimer = setTimeout(async () => {
      if (!this.inLobby) {
        return;
      }
      try {
        await this.startGame(channelId);
      } catch (error) {
        console.error('Mafia lobby timer error:', error);
      }
    }, 120000);
  }

  joinGame(user, channelId) {
    if (!this.inLobby) {
      return null;
    }
    
    if (this.channelId !== channelId) {
      return null;
    }

    if (this.players.some(p => p.id === user.id)) {
      return `*${user.username}*, you are already registered for this case!`;
    }

    const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    if (this.players.length >= letters.length) {
      return 'The case roster is full.';
    }

    const assignedLetter = letters[this.players.length];
    this.players.push({
      id: user.id,
      username: user.username || 'Unknown Player',
      tag: user.tag || '',
      letter: assignedLetter,
      role: 'Villager',
      isAlive: true,
      strikes: 0
    });

    return `*${user.username}* has joined the case!\nSecret identifier: *[${assignedLetter}]*`;
  }

  async startGame(channelId) {
    if (!this.inLobby) {
      return;
    }

    this.clearTimers();
    if (this.players.length < 4) {
      await this.client.sendMessage(
        channelId,
        '*Registration closed.*\n\n' +
        `Only *${this.players.length}* player(s) registered.\n` +
        'At least *4 players* are required.\n\n' +
        'X The Mafia Case has been canceled.'
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
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }

    shuffled[0].role = 'Mafia';
    shuffled[1].role = 'Doctor';
    shuffled[2].role = 'Detective';

    let roster = '*CASE ROSTER & IDENTIFIERS*\n\n';
    this.players.forEach(player => {
      roster += `*[${player.letter}]* ${player.username}\n`;
    });

    for (const player of this.players) {
      let roleMessage =
        '*PROJECT MAFIA CASE*\n\n' +
        'Your secret role is:\n' +
        `*${player.role}*\n\n` +
        `${roster}\n`;

      if (player.role === 'Mafia') {
        roleMessage += '*NIGHT ACTION*\nUse:\n`!kill [Letter]`\n\nChoose one living player to eliminate silently.';
      } else if (player.role === 'Doctor') {
        roleMessage += '*NIGHT ACTION*\nUse:\n`!save [Letter]`\n\nTry to protect the Mafia\'s target.\nYou have *3 strikes* before your medical license is revoked.';
      } else if (player.role === 'Detective') {
        roleMessage += '*NIGHT ACTION*\nUse:\n`!investigate [Letter]`\n\nInvestigate one living player.\nYou have *3 strikes* before your badge is revoked.';
      } else {
        roleMessage += '*VILLAGER*\nYou have no night action.\nListen carefully, discuss clues, and vote wisely during the day.';
      }

      try {
        await this.client.sendMessage(player.id, roleMessage);
      } catch (error) {
        console.error(`Failed to send Mafia role DM to ${player.username}:`, error);
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

  async startNightPhase(channelId) {
    if (!this.gameStarted) {
      return;
    }

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

    // 5 Minutes Night Timer (300,000 ms)
    this.nightTimer = setTimeout(async () => {
      if (!this.gameStarted || !this.nightActive) {
        return;
      }
      try {
        await this.resolveNight(channelId);
      } catch (error) {
        console.error('Mafia night resolution error:', error);
      }
    }, 300000);
  }

  async handleNightAction(user, command, targetLetter) {
    if (!this.gameStarted || !this.nightActive) {
      return;
    }

    const userId = typeof user === 'string' ? user : user?.id;
    if (!userId) {
      return;
    }

    const player = this.getPlayerById(userId);
    if (!player || !player.isAlive) {
      await this.client.sendMessage(userId, 'You cannot perform night actions.');
      return;
    }

    command = String(command || '').toLowerCase().replace(/^!/, '');
    if (!['kill', 'save', 'investigate'].includes(command)) {
      return;
    }

    const target = this.getPlayerByLetter(targetLetter);
    if (!target || !target.isAlive) {
      await this.client.sendMessage(
        userId,
        'Invalid letter or that player is already dead.\nCheck your case roster.'
      );
      return;
    }

    if (target.id === player.id) {
      await this.client.sendMessage(userId, 'You cannot target yourself.');
      return;
    }

    if (command === 'kill') {
      if (player.role !== 'Mafia') {
        await this.client.sendMessage(userId, 'X You are not the Mafia.');
        return;
      }
      if (this.nightActions.kill) {
        await this.client.sendMessage(userId, 'Your Mafia target has already been locked for this night.');
        return;
      }
      this.nightActions.kill = target;
      this.nightActionUsers.kill = player.id;
      await this.client.sendMessage(
        userId,
        `*TARGET LOCKED*\n\n[${target.letter}] ${target.username} has been marked for elimination.`
      );
      return;
    }

    if (command === 'save') {
      if (player.role !== 'Doctor') {
        await this.client.sendMessage(userId, 'X You are not the Doctor.');
        return;
      }
      if (this.nightActions.save) {
        await this.client.sendMessage(userId, 'Your save has already been submitted for this night.');
        return;
      }
      this.nightActions.save = target;
      this.nightActionUsers.save = player.id;
      await this.client.sendMessage(
        userId,
        `*PROTECTION ATTEMPT SUBMITTED*\n\nYou are protecting [${target.letter}] ${target.username}.\n\nThe result will be revealed at sunrise.`
      );
      return;
    }

    if (command === 'investigate') {
      if (player.role !== 'Detective') {
        await this.client.sendMessage(userId, 'X You are not the Detective.');
        return;
      }
      if (this.nightActions.investigate) {
        await this.client.sendMessage(userId, 'Your investigation has already been submitted for this night.');
        return;
      }
      this.nightActions.investigate = target;
      this.nightActionUsers.investigate = player.id;

      if (target.role === 'Mafia') {
        await this.client.sendMessage(
          userId,
          `*INVESTIGATION SUCCESSFUL*\n\n[${target.letter}] ${target.username} *IS CONNECTED TO THE MAFIA.*\n\nYou found the trail.`
        );
      } else {
        player.strikes++;
        await this.client.sendMessage(
          userId,
          `*INVESTIGATION FAILED*\n\n[${target.letter}] ${target.username} is innocent.\n\nDetective strikes: *${player.strikes}/3*`
        );
        if (player.strikes >= 3) {
          player.role = 'Villager';
          await this.client.sendMessage(
            userId,
            '*BADGE REVOKED*\n\nThree false leads have destroyed your credibility.\nYou are now a *Villager* for the remainder of the case.'
          );
        }
      }
      return;
    }
  }

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
      if (saveTarget && saveTarget.id === killTarget.id) {
        doctorSaved = true;
      } else {
        killedPlayer = killTarget;
        killedPlayer.isAlive = false;
        this.ghosts.push(killedPlayer);
      }
    }

    const doctor = this.players.find(p => p.role === 'Doctor' && p.isAlive);
    if (doctor && saveTarget) {
      if (!killTarget || saveTarget.id !== killTarget.id) {
        doctor.strikes++;
        await this.client.sendMessage(
          doctor.id,
          `*MISSED SAVE*\n\nYour protection target was not the Mafia's target.\nDoctor strikes: *${doctor.strikes}/3*`
        );
        if (doctor.strikes >= 3) {
          doctor.role = 'Villager';
          await this.client.sendMessage(
            doctor.id,
            '*MEDICAL LICENSE REVOKED*\n\nThree failed saves have exhausted your authority.\nYou are now a *Villager*.'
          );
        }
      }
    }

    let morningMessage = '*THE SUN RISES...*\n\n';
    if (killedPlayer) {
      morningMessage += `*Tragic news:* ${killedPlayer.username} was found eliminated during the night.\n\n`;
    } else if (doctorSaved) {
      morningMessage += '***Miraculous survival!*\n\nSomeone was attacked during the night, but the victim survived thanks to medical attention.\n\n';
    } else {
      morningMessage += '*No one was eliminated last night.*\n\n';
    }

    let medicalReport;
    if (!killTarget) {
      medicalReport = 'Medical intervention: *No confirmed attack was recorded.*';
    } else if (doctorSaved) {
      medicalReport = 'Medical intervention: *SUCCESSFUL.*';
    } else {
      medicalReport = 'Medical intervention: *FAILED TO PREVENT THE ATTACK.*';
    }

    const detectiveReport = this.nightActions.investigate
      ? 'Investigative efforts: *A lead was pursued during the night.*'
      : 'Investigative efforts: *No confirmed investigative activity was recorded.*';

    morningMessage += `${medicalReport}\n${detectiveReport}`;

    await this.client.sendMessage(channelId, morningMessage);

    if (await this.checkWinCondition(channelId)) {
      return;
    }

    await this.startVotingPhase(channelId);
  }

  async startVotingPhase(channelId) {
    if (!this.gameStarted) {
      return;
    }

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

    // 5 Minutes Voting Timer (300,000 ms)
    this.voteTimer = setTimeout(async () => {
      if (!this.gameStarted || !this.votingActive) {
        return;
      }
      try {
        await this.endVotingPhase(channelId);
      } catch (error) {
        console.error('Mafia voting error:', error);
      }
    }, 300000);
  }

  castVote(user, targetUser, channelId) {
    if (!this.gameStarted) {
      return 'X There is no active Mafia Case.';
    }
    if (!this.votingActive) {
      return 'Voting is not active right now.';
    }
    if (channelId !== this.channelId) {
      return 'This is not the active Mafia Case chat.';
    }

    const voter = this.getPlayerById(user.id);
    if (!voter || !voter.isAlive) {
      return 'Ghosts cannot vote!';
    }

    const target = this.getPlayerById(targetUser.id);
    if (!target || !target.isAlive) {
      return 'You can only vote for a living player.';
    }

    if (target.id === voter.id) {
      return 'You cannot vote for yourself.';
    }

    this.votes.set(voter.id, target.id);
    return `*${voter.username}* has cast their vote.`;
  }

  async endVotingPhase(channelId) {
    if (!this.gameStarted || !this.votingActive) {
      return;
    }

    if (this.voteTimer) {
      clearTimeout(this.voteTimer);
      this.voteTimer = null;
    }
    this.votingActive = false;

    const tally = new Map();
    for (const player of this.getAlivePlayers()) {
      tally.set(player.id, 0);
    }

    for (const [voterId, targetId] of this.votes.entries()) {
      const voter = this.getPlayerById(voterId);
      const target = this.getPlayerById(targetId);
      if (voter && voter.isAlive && target && target.isAlive) {
        tally.set(target.id, (tally.get(target.id) || 0) + 1);
      }
    }

    let tallyMessage = '*VOTING TALLY*\n\n';
    for (const player of this.getAlivePlayers()) {
      const votes = tally.get(player.id) || 0;
      tallyMessage += `${player.username}: *${votes}*\n`;
    }

    await this.client.sendMessage(channelId, tallyMessage);

    if (this.votes.size === 0) {
      await this.client.sendMessage(
        channelId,
        '*NO VOTES WERE CAST.*\n\n' +
        'Indecision paralyzes the town. Nobody is executed today.\n' +
        'The Mafia remains hidden.\n\n' +
        'Night is falling again....'
      );
      await this.startNightPhase(channelId);
      return;
    }

    const highestVotes = Math.max(...Array.from(tally.values()));
    const candidates = this.getAlivePlayers().filter(
      player => (tally.get(player.id) || 0) === highestVotes
    );

    if (candidates.length > 1) {
      const names = candidates.map(p => p.username).join(', ');
      await this.client.sendMessage(
        channelId,
        `*DEADLOCK!*\n\nThe vote resulted in a tie between:\n*${names}*\n\nNo one can agree on a consensus, so no one is executed today.\nThe city enters another night.`
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
        `*THE VERDICT*\n\nThe village accused *${suspect.username}*...\n\nThe evidence held true.\n*${suspect.username} was the MAFIA.*\n\n*THE TOWN WINS!*`
      );
      await this.checkWinCondition(channelId);
      return;
    }

    await this.client.sendMessage(
      channelId,
      `*THE VERDICT*\n\nThe village accused *${suspect.username}*...\n\nX *INNOCENT.*\n\nA tragic mistake! An innocent citizen was cast out.\nThe Mafia slips deeper into the shadows.\n\nNight falls once again...`
    );

    if (await this.checkWinCondition(channelId)) {
      return;
    }

    await this.startNightPhase(channelId);
  }
}

module.exports = {
  startMafiaLobby: async (chatId, client, MessageMedia) => {
    if (global.activeMafiaGame && (global.activeMafiaGame.inLobby || global.activeMafiaGame.gameStarted)) {
      await client.sendMessage(chatId, 'A Mafia Case is already running.');
      return;
    }
    global.activeMafiaGame = new MafiaGame(client, MessageMedia);
    return global.activeMafiaGame.startLobby(chatId);
  },
  joinMafiaLobby: (chatId, senderId, userName) => {
    if (!global.activeMafiaGame || !global.activeMafiaGame.inLobby) {
      return null;
    }
    return global.activeMafiaGame.joinGame({
      id: senderId,
      username: userName
    }, chatId);
  },
  endMafiaGame: async (chatId) => {
    if (!global.activeMafiaGame) {
      return '❌ There is no active Mafia game or lobby running right now.';
    }
    return global.activeMafiaGame.forceEndGame(chatId);
  },
  handleNightAction: async (senderId, command, targetLetter) => {
    if (!global.activeMafiaGame) {
      return;
    }
    return global.activeMafiaGame.handleNightAction(senderId, command, targetLetter);
  },
  castVote: (chatId, senderId, targetJid, targetName) => {
    if (!global.activeMafiaGame) {
      return 'X No active Mafia Case.';
    }
    return global.activeMafiaGame.castVote(
      { id: senderId },
      { id: targetJid, username: targetName || 'Target' },
      chatId
    );
  }
};