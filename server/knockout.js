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
  scorePrediction,
};
