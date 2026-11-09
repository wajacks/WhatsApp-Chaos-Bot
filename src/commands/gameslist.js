function getGamesList() {
  return `🎮 *CHAOS GAMES*
━━━━━━━━━━━━━━━━━━━━━━━

*Open a game*
Use !play in a group and reply with the number of your chosen game.
Only one game lobby can be open in a group at a time.

*Lobby controls*
• The host is added automatically when the lobby opens.
• Reply JOIN or !JOIN to the lobby message to join.
• The host replies START or !START to begin, or STOP or !STOP to close the lobby.

*Available games*
• Country Rebus — solve emoji clues.
• Wordle — guess the shared five-letter word.
• Word Chain — take turns with words starting at the last letter.
• Scrambled Word — race to unscramble each word.
• Word Forge — build words from a private rack.
• Number Run — guess with higher or lower clues.
• Truth Hunt — judge each claim in DM.
• Mafia — discuss, vote, and use secret roles.

Type !menu for the command center.`;
}

module.exports = { getGamesList };
