function getGamesList() {
  return `🎮 **[G A M E  M O D E S ]** 🎮
━━━━━━━━━━━━━━━━━━━━━━━

🧩 **1. Country Rebus**
• Guess the hidden country from puzzle clues!
• Commands: \`!rebus\`, \`!joinrebus\` (or \`guesscountry\`), \`!steal @user\`

🟩 **2. Wordle**
• Work together to guess the secret 5-letter word!
• Commands: \`!wordle\`, \`!join\`, \`!stopwordle\`

🔗 **3. Word Chain**
• Turn-based word game! Each word must start with the last letter of the previous word.
• Commands: \`!wordchain\`, \`!wjoin\`, \`!startwordchain\`, \`!stopwordchain\`
• Host opens the lobby with \`!wordchain\`
• Players join with \`!wjoin\`
• Host starts the match with \`!startwordchain\`
• Minimum 2 players
• Each player has 10 seconds to submit a valid word

🔀 **4. Scrambled Word**
• Race to unscramble the word before the timer ends!
• Commands: \`!scramble\`, \`!joinscramble\`, \`!scramblehint\`, \`!stopscramble\`
• Fast solves, streaks, automatic hints, and special rounds earn more points.

⚒️ **5. Word Forge**
• Build a valid word from your private letter rack while obeying your private round rule.
• Commands: `!wordforge`, `!joinforge`, `!startforge`, `!stopforge`
• 90-second rounds, anonymous 10-second break boards, then a full final reveal.

🕵️ **6. Mafia (Case Game)**
• Social deduction chaos! Unmask the killer or survive the night.
• Commands: \`!mafia\` (or \`!startmafia\`), \`!joinmafia\`, \`stopmafia\`, \`!vote @user\`
• *(Night actions are handled via private message DM to the bot: \`!kill\`, \`!save\`, \`!investigate\`)*

━━━━━━━━━━━━━━━━━━━━━━━
*Gather your friends and start a lobby!*`;
}

module.exports = { getGamesList };
