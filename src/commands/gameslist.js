function getGamesList() {
  return `🎮 *CHAOS GAMES*
━━━━━━━━━━━━━━━━━━━━━━━

*Lobby commands*
• Country Rebus — solve emoji clues to name the country. Open with \`!rebus\`
• Wordle — guess the shared 5-letter word. Open with \`!wordle\`
• Word Chain — take turns with words starting at the last letter. Open with \`!wordchain\`
• Scrambled Word — race to unscramble each word. Open with \`!scramble\`
• Word Forge — build words from a private rack and rule. Open with \`!wordforge\`
• Mafia — discuss, vote, and use secret roles. Open with \`!mafia\`

*How play works*
1. The person who opens a lobby becomes its host and must also join as a player.
2. Players use that game’s join command shown in the lobby.
3. The host starts or stops the game with the commands shown in the lobby.
4. Only one game can run in a group at a time. Lobbies stay open until the host starts or stops them.

*Game commands*
• Rebus: \`!joinrebus\`, \`!rguess <answer>\`, \`!hint\`, \`!stoprebus\`
• Wordle: \`!join\`, \`!startwordle\`, \`!stopwordle\`
• Word Chain: \`!wjoin\`, \`!startwordchain\`, \`!stopwordchain\`
• Scramble: \`!joinscramble\`, \`!scramblehint\`, \`!startscramble\`, \`!stopscramble\`
• Word Forge: \`!joinforge\`, \`!startforge\`, \`!stopforge\`
• Mafia: \`!joinmafia\`, host: \`!startmafia\` / \`!stopmafia\`; vote with \`!vote\` and use assigned night actions in DM.

Type \`!menu\` for the command center.`;
}

module.exports = { getGamesList };