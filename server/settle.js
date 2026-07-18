// Auto-settle WC match predictions from scraped Soccerway results.
// Knockout draws are intentionally skipped because the scraper only provides a
// scoreline; the admin must choose who advanced.

const { checkAchievements } = require('./middleware/achievements');
const { isKnockoutMatch, knockoutWinnerFromScore, advanceKnockoutTeams, scorePrediction } = require('./knockout');

function norm(s) {
  return (s || '').toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, '');
}

function teamsMatch(dbTeam, scrapedTeam) {
  const a = norm(dbTeam), b = norm(scrapedTeam);
  return a === b || a.includes(b) || b.includes(a);
}

function scoreKnockoutPredictions(db, match, found, winnerTeam) {
  const predictions = db.prepare(`
    SELECT id, home_score, away_score, predicted_winner
    FROM match_predictions
    WHERE match_id=? AND points_earned IS NULL
  `).all(match.id);
  const updatePoints = db.prepare("UPDATE match_predictions SET points_earned=?, updated_at=datetime('now') WHERE id=?");

  let scored = 0;
  db.transaction(() => {
    for (const prediction of predictions) {
      updatePoints.run(scorePrediction(match, prediction, found.home_score, found.away_score, winnerTeam), prediction.id);
      scored++;
    }
  })();
  return scored;
}

function scoreGroupPredictions(db, match, found) {
  const actualResult = Math.sign(found.home_score - found.away_score);
  return db.prepare(`
    UPDATE match_predictions
    SET points_earned = CASE
      WHEN home_score=? AND away_score=? THEN 3
      WHEN (CASE WHEN home_score>away_score THEN 1 WHEN home_score=away_score THEN 0 ELSE -1 END)=? THEN 1
      ELSE 0
    END, updated_at=datetime('now')
    WHERE match_id=? AND points_earned IS NULL
  `).run(found.home_score, found.away_score, actualResult, match.id).changes;
}

function autoSettleFromScrape(db) {
  const pending = db.prepare(`
    SELECT *
    FROM matches
    WHERE status != 'finished'
      AND match_date < date('now', '+1 day')
  `).all();

  if (!pending.length) return { settled: 0, skipped: 0 };

  let settled = 0, skipped = 0;

  for (const match of pending) {
    const candidates = db.prepare(`
      SELECT home_team, away_team, home_score, away_score
      FROM team_results
      WHERE match_date = ?
    `).all(match.match_date);

    const found = candidates.find(result =>
      teamsMatch(match.home_team, result.home_team) &&
      teamsMatch(match.away_team, result.away_team)
    );

    if (!found) { skipped++; continue; }

    const winnerTeam = isKnockoutMatch(match)
      ? knockoutWinnerFromScore(match, found.home_score, found.away_score, null)
      : null;

    if (isKnockoutMatch(match) && !winnerTeam) {
      console.log(`[settle] skipped KO draw: ${match.home_team} ${found.home_score}-${found.away_score} ${match.away_team} (match ${match.id}) needs manual winner`);
      skipped++;
      continue;
    }

    db.prepare(`
      UPDATE matches
      SET home_score=?, away_score=?, winner_team=?, status='finished'
      WHERE id=?
    `).run(found.home_score, found.away_score, winnerTeam, match.id);

    const scored = isKnockoutMatch(match)
      ? scoreKnockoutPredictions(db, match, found, winnerTeam)
      : scoreGroupPredictions(db, match, found);

    if (isKnockoutMatch(match)) advanceKnockoutTeams(db, match, winnerTeam);

    db.prepare(`
      INSERT INTO settlement_log (match_id, settled_by, home_score, away_score, winner_team, predictions_scored)
      VALUES (?, 'auto', ?, ?, ?, ?)
    `).run(match.id, found.home_score, found.away_score, winnerTeam, scored);

    const affected = db.prepare('SELECT DISTINCT user_id FROM match_predictions WHERE match_id=? AND points_earned IS NOT NULL').all(match.id);
    for (const { user_id } of affected) checkAchievements(db, user_id);

    console.log(`[settle] ${match.home_team} ${found.home_score}-${found.away_score} ${match.away_team} (match ${match.id}) settled`);
    settled++;
  }

  if (settled) console.log(`[settle] ${settled} match(es) auto-settled`);
  return { settled, skipped };
}

module.exports = { autoSettleFromScrape };
