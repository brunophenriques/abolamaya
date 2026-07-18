function isKnockoutMatch(match) {
  return match && match.group_id === 'KO';
}

function isPlaceholderTeam(name) {
  return /grupo|group|^w\d+|^ru\d+|^\d+[a-z]?$/i.test(String(name || '').trim());
}

function knockoutWinnerFromScore(match, homeScore, awayScore, selectedWinner) {
  if (homeScore > awayScore) return match.home_team;
  if (awayScore > homeScore) return match.away_team;
  return selectedWinner || null;
}

function advanceKnockoutTeams(db, match, winnerTeam) {
  if (match.next_match_id && match.next_slot) {
    const slotColumn = match.next_slot === 'away' ? 'away_team' : 'home_team';
    const flagColumn = match.next_slot === 'away' ? 'away_flag' : 'home_flag';
    const winnerFlag = winnerTeam === match.home_team ? match.home_flag : match.away_flag;
    db.prepare(`UPDATE matches SET ${slotColumn}=?, ${flagColumn}=? WHERE id=?`)
      .run(winnerTeam, winnerFlag, match.next_match_id);
  }

  // The semi-final losers play match 103. They do not follow next_match_id,
  // which points to the final, so populate the third-place fixture explicitly.
  if (match.id === 101 || match.id === 102) {
    const loserTeam = winnerTeam === match.home_team ? match.away_team : match.home_team;
    const loserFlag = winnerTeam === match.home_team ? match.away_flag : match.home_flag;
    const slotColumn = match.id === 101 ? 'home_team' : 'away_team';
    const flagColumn = match.id === 101 ? 'home_flag' : 'away_flag';
    db.prepare(`UPDATE matches SET ${slotColumn}=?, ${flagColumn}=? WHERE id=103`)
      .run(loserTeam, loserFlag);
  }
}

function scorePrediction(match, prediction, actualHome, actualAway, actualWinner) {
  if (isKnockoutMatch(match)) {
    const predictedWinner = knockoutWinnerFromScore(
      match,
      prediction.home_score,
      prediction.away_score,
      prediction.predicted_winner
    );
    const exact = prediction.home_score === actualHome && prediction.away_score === actualAway;
    const result =
      Math.sign(prediction.home_score - prediction.away_score) === Math.sign(actualHome - actualAway);
    const winner = predictedWinner && actualWinner && predictedWinner === actualWinner;
    return (exact ? 3 : result ? 1 : 0) + (winner ? 1 : 0);
  }

  const actualResult = Math.sign(actualHome - actualAway);
  if (prediction.home_score === actualHome && prediction.away_score === actualAway) return 3;
  return Math.sign(prediction.home_score - prediction.away_score) === actualResult ? 1 : 0;
}

module.exports = {
  isKnockoutMatch,
  isPlaceholderTeam,
  knockoutWinnerFromScore,
  advanceKnockoutTeams,
  scorePrediction,
};
