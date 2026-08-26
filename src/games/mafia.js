// mafia.js - Custom Case-Solving Mafia Game for Node.js Chat Bot
const fs = require('fs');

class MafiaGame {
    constructor(client, MessageMedia) {
        this.client = client;
        this.MessageMedia = MessageMedia;
        this.inLobby = false;
        this.gameStarted = false;
        this.players = []; // Array of { id, username, letter, role, isAlive, strikes }
        this.ghosts = [];
        this.nightActions = { kill: null, save: null, investigate: null };
        this.votes = new Map(); // voterId -> targetId
        this.votingActive = false;
    }

    // 1. Start Lobby with 1-Minute Timer, PDF, and Voice Note
    async startLobby(channelId) {
        this.inLobby = true;
        this.players = [];
        this.ghosts = [];
        this.gameStarted = false;
        
        await this.client.sendMessage(channelId, "🎮 **Mafia Case Game Started!** Type `!join` within **1 minute** to register for the investigation.");

        // Send Rules PDF if it exists in the project root
        try {
            if (fs.existsSync('./rules.pdf')) {
                const pdfMedia = this.MessageMedia.fromFilePath('./rules.pdf');
                await this.client.sendMessage(channelId, pdfMedia, {
                    caption: "📄 **Case File & Official Rules:** Review how to play, use your letter codes, and survive the night."
                });
            }
        } catch (err) {
            console.error("Could not send rules.pdf:", err);
        }

        // Send Voice Note / Audio Briefing safely with a small async delay to prevent Puppeteer timeouts
        try {
          if (fs.existsSync('./briefing.mp3') || fs.existsSync('./briefing.ogg')) {
              const audioPath = fs.existsSync('./briefing.mp3') ? './briefing.mp3' : './briefing.ogg';
              
              // Brief pause to let Puppeteer settle before pushing media bytes
              await new Promise(resolve => setTimeout(resolve, 1000));

              const audioMedia = this.MessageMedia.fromFilePath(audioPath);
              await this.client.sendMessage(channelId, audioMedia, { 
                  caption: "🎙️ **Audio Dispatch:** Detective briefing incoming..."
              });
          }
      } catch (err) {
          console.error("Could not send audio briefing due to protocol/timeout limit, skipping audio:", err.message);
      }

        // Automatically close registration and start game after 1 minute (60,000 ms)
        setTimeout(async () => {
            if (this.inLobby) {
                await this.startGame(channelId);
            }
        }, 60000);
    }

    // 2. Player Registration & Letter Assignment
    joinGame(user, channelId) {
        if (!this.inLobby) return "No active registration lobby right now. Wait for a new game.";
        if (this.players.some(p => p.id === user.id)) return `${user.username}, you are already registered!`;

        const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
        const assignedLetter = letters[this.players.length % letters.length];

        this.players.push({
            id: user.id,
            username: user.username,
            tag: user.tag, // e.g. @username
            letter: assignedLetter,
            role: 'Villager', // default
            isAlive: true,
            strikes: 0
        });

        return `✅ **${user.username}** has joined the case! Assigned identifier: **[${assignedLetter}]**`;
    }

    // 3. Assign Roles & Send Private Letters via WhatsApp DMs
    async startGame(channelId) {
        if (!this.inLobby) return;
        this.inLobby = false;

        if (this.players.length < 4) {
            await this.client.sendMessage(channelId, "⚠️ Registration closed. You need at least 4 players to start the Mafia case game! Game canceled.");
            return;
        }

        this.gameStarted = true;

        // Shuffle players and assign roles
        const shuffled = [...this.players].sort(() => 0.5 - Math.random());
        shuffled[0].role = 'Mafia';
        shuffled[1].role = 'Doctor';
        shuffled[2].role = 'Detective';
        // Rest remain 'Villager'

        // Build the directory reference list
        let roster = "📋 **Case Roster & Identifiers:**\n";
        this.players.forEach(p => {
            roster += `• **[${p.letter}]** - ${p.username}\n`;
        });

        // Notify each player privately with their role and the roster
        for (const p of this.players) {
            let roleMsg = `🕵️ **Your Mafia Case Role:** **${p.role}**\n\n${roster}\n`;
            if (p.role === 'Mafia') roleMsg += "🌙 Night Action: Use `!kill [Letter]` in DM to eliminate someone.";
            if (p.role === 'Doctor') roleMsg += "🌙 Night Action: Use `!save [Letter]` in DM to protect someone (Immune to Mafia, max 3 fails before demotion).";
            if (p.role === 'Detective') roleMsg += "🌙 Night Action: Use `!investigate [Letter]` in DM to check if they are Mafia (max 3 fails before demotion).";
            if (p.role === 'Villager') roleMsg += "🌙 You are a regular Villager. Sleep tight and help investigate during the day!";
            
            try {
                await this.client.sendMessage(p.id, roleMsg);
            } catch (err) {
                console.error(`Failed to send DM to ${p.username}:`, err);
            }
        }

        await this.client.sendMessage(channelId, "⏱️ **Registration closed!** 🌑 **Night falls over the city...** Secret roles have been assigned via DM. Special roles, check your private messages!");
        this.startNightPhase(channelId);
    }

    startNightPhase(channelId) {
        this.nightActions = { kill: null, save: null, investigate: null };
        if (channelId) {
            this.client.sendMessage(channelId, "🌙 **Night falls...** Special roles, submit your actions via private DM using your letter codes (`!kill`, `!save`, `!investigate`).");
        }
    }

    // 4. Handle Private Night Commands (Using Letters)
    async handleNightAction(user, command, targetLetter) {
        if (!this.gameStarted) return;
        const player = this.players.find(p => p.id === user.id || p.id === user);
        const userId = player ? player.id : user;

        if (!player || !player.isAlive) {
            await this.client.sendMessage(userId, "You cannot act right now.");
            return;
        }

        const target = this.players.find(p => p.letter === targetLetter.toUpperCase() && p.isAlive);
        if (!target) {
            await this.client.sendMessage(userId, "Invalid letter or player is already dead. Check your roster list.");
            return;
        }

        if (command === 'kill' && player.role === 'Mafia') {
            this.nightActions.kill = target;
            await this.client.sendMessage(userId, `🎯 Target locked: [${target.letter}] ${target.username}.`);
        } else if (command === 'save' && player.role === 'Doctor') {
            this.nightActions.save = target;
            await this.client.sendMessage(userId, `🛡️ You are attempting to protect: [${target.letter}] ${target.username}.`);
        } else if (command === 'investigate' && player.role === 'Detective') {
            this.nightActions.investigate = target;
            
            if (target.role === 'Mafia') {
                await this.client.sendMessage(userId, `✅ **Investigation Successful!** [${target.letter}] ${target.username} is connected to the Mafia!`);
            } else {
                player.strikes++;
                await this.client.sendMessage(userId, `❌ **Investigation Failed.** [${target.letter}] ${target.username} is innocent. (Strikes: ${player.strikes}/3)`);
                if (player.strikes >= 3) {
                    player.role = 'Villager';
                    await this.client.sendMessage(userId, "⚠️ Your badge has been revoked due to too many failed leads! You are now a regular Villager.");
                }
            }
        }
    }

    // 5. Morning Resolution & Anonymous Public Feeds
    async resolveNight(channelId) {
        let killedPlayer = null;
        let docSaved = false;

        // Check Doctor Save vs Mafia Kill
        if (this.nightActions.kill) {
            if (this.nightActions.kill === this.nightActions.save) {
                docSaved = true;
            } else {
                killedPlayer = this.nightActions.kill;
                killedPlayer.isAlive = false;
                this.ghosts.push(killedPlayer);
                this.players = this.players.filter(p => p.id !== killedPlayer.id);
            }
        }

        // Check Doctor Fired Logic
        const doctor = this.players.find(p => p.role === 'Doctor');
        if (doctor && this.nightActions.save && this.nightActions.save !== this.nightActions.kill) {
            doctor.strikes++;
            if (doctor.strikes >= 3) {
                doctor.role = 'Villager';
                await this.client.sendMessage(doctor.id, "⚠️ Your medical license has been suspended due to too many incorrect saves! You are now a regular Villager.");
            }
        }

        // Public Announcements
        let morningMsg = "☀️ **The Sun Rises...**\n";
        if (killedPlayer) {
            morningMsg += `💀 Tragic news: **${killedPlayer.username}** was found eliminated during the night!\n`;
        } else {
            morningMsg += `✨ Miraculously, no one died last night!\n`;
        }

        morningMsg += `🔍 *City Report:* Medical intervention was ${docSaved ? "successful" : "ineffective"} last night, and investigative efforts recorded updates.\n`;
        await this.client.sendMessage(channelId, morningMsg);

        // Start Day Voting Phase
        this.startVotingPhase(channelId);
    }

    // 6. Public Voting Phase (2 Minutes)
    startVotingPhase(channelId) {
        this.votes.clear();
        this.votingActive = true;
        this.client.sendMessage(channelId, "⚖️ **Day Phase Begins!** Debate amongst yourselves. Living players must cast your vote using `!vote @username` within **2 minutes**.");

        setTimeout(() => {
            this.endVotingPhase(channelId);
        }, 120000); // 2 minutes
    }

    castVote(user, targetUser, channelId) {
        if (!this.votingActive) return "Voting is not active right now.";
        const voter = this.players.find(p => p.id === user.id);
        if (!voter) return "Ghosts cannot vote!";

        const target = this.players.find(p => p.id === targetUser.id && p.isAlive);
        if (!target) return "You can only vote for living players using a valid tag.";

        this.votes.set(voter.id, target.id);
        return `🗳️ **${user.username}** has cast their vote.`;
    }

    // 7. Tally Results & Win Check
    async endVotingPhase(channelId) {
        this.votingActive = false;

        const tally = {};
        this.players.forEach(p => tally[p.id] = { username: p.username, role: p.role, count: 0 });

        this.votes.forEach(targetId => {
            if (tally[targetId]) tally[targetId].count++;
        });

        let tallyMsg = "📊 **Voting Tally Results:**\n";
        let maxVotes = 0;
        let suspectToTest = null;

        Object.values(tally).forEach(item => {
            tallyMsg += `• **${item.username}**: ${item.count} votes against them\n`;
            if (item.count > maxVotes) {
                maxVotes = item.count;
                suspectToTest = item;
            }
        });

        await this.client.sendMessage(channelId, tallyMsg);

        if (suspectToTest && maxVotes > 0) {
            // Check if the most voted person is actually the Mafia
            if (suspectToTest.role === 'Mafia') {
                await this.client.sendMessage(channelId, `⚖️ The village has accused **${suspectToTest.username}**... and it is **TRUE!** They are the Mafia!\n\n🎉 **VICTORY!** The village successfully solved the case and eliminated the Mafia! The town is safe.`);
                this.gameStarted = false;
            } else {
                await this.client.sendMessage(channelId, `❌ The village accused **${suspectToTest.username}**, but they are **innocent**! No one is executed today, and the Mafia slips away deeper into the shadows.\n\n🌙 **Moving to the next night...**`);
                // Loop back to the next night phase
                this.startNightPhase(channelId);
            }
        } else {
            await this.client.sendMessage(channelId, "⚠️ No votes were cast! Moving to the next night...");
            this.startNightPhase(channelId);
        }
    }

}

module.exports = {
  startMafiaLobby: (chatId, client, MessageMedia) => {
      global.activeMafiaGame = new MafiaGame(client, MessageMedia);
      return global.activeMafiaGame.startLobby(chatId);
  },
  joinMafiaLobby: (chatId, senderId, userName) => {
      if (global.activeMafiaGame) {
          // Pass an object matching what joinGame(user, channelId) expects
          return global.activeMafiaGame.joinGame({ id: senderId, username: userName }, chatId);
      }
      return null;
  },
  handleNightAction: async (senderId, command, targetLetter) => {
      if (global.activeMafiaGame) {
          return await global.activeMafiaGame.handleNightAction(senderId, command, targetLetter);
      }
  },
  castVote: (chatId, senderId, targetJid, targetName) => {
      if (global.activeMafiaGame) {
          // Pass objects matching what castVote(user, targetUser, channelId) expects
          return global.activeMafiaGame.castVote(
              { id: senderId }, 
              { id: targetJid, username: targetName || 'Target' }, 
              chatId
          );
      }
      return "No active Mafia game voting session.";
  }
};