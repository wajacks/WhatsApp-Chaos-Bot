function getGamesList() {
  return `🎮 **[G A M E  M O D E S ]** 🎮
━━━━━━━━━━━━━━━━━━━━━━━

🧩 **1. Country Rebus**
• Guess the hidden country from puzzle clues!
• Commands: \`!rebus\`, \`!joinrebus\` (or \`guesscountry\`), \`!steal @user\`

🟩 **2. Wordle**
• Work together to guess the secret 5-letter word!
• Commands: \`!wordle\`, \`!join\`, \`!stopwordle\`

🕵️ **3. Mafia (Case Game)**
• Social deduction chaos! Unmask the killer or survive the night.
• Commands: \`!mafia\` (or \`!startmafia\`), \`!joinmafia\`, \`stopmafia\`, \`!vote @user\`
• *(Night actions are handled via private message DM to the bot: \`!kill\`, \`!save\`, \`!investigate\`)*

━━━━━━━━━━━━━━━━━━━━━━━
*Gather your friends and start a lobby!*`;
}

module.exports = { getGamesList };