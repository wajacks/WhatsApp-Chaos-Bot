function getGamesList() {
  return `🎮 *CHAOS GAMES*
━━━━━━━━━━━━━━━━━━━━━━━

*Open a game*
Use !play in a group, choose a game from the list, then invite players to its lobby.
Only one game lobby can be open in a group at a time.

*Lobby controls*
• Use !startgame to start the open game.
• Use !stopgame to close the current game; each game keeps its existing permission rules.
• Game-specific start and stop commands remain available as aliases.
• Join with the command shown in the lobby message.

*Available games*
• Country Rebus — solve emoji clues; join with !joinrebus.
• Wordle — guess the shared five-letter word; join with !join.
• Word Chain — take turns with words starting at the last letter; join with !wjoin.
• Scrambled Word — race to unscramble each word; join with !joinscramble.
• Word Forge — build words from a private rack; join with !joinforge.
• Number Run — guess with higher/lower clues; join with !joinnumberrun.
• Truth Hunt — judge each claim in DM; join with !jointruth.
• Mafia — discuss, vote, and use secret roles; join with !joinmafia.

Type !menu for the command center.`;
}

module.exports = { getGamesList };
