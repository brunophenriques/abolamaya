// Auto-settle WC match predictions from scraped Soccerway results.
// Called after each scraper run (scheduler) and on-demand via POST /api/admin/auto-settle.
//
// Logic:
//   1. Find WC matches that are not yet 'finished' but whose date has passed.
//   2. Look in team_results for a scraped result on the same date with both teams matching.
//   3. Mark the WC match as finished and score any unsettled predictions (points_earned IS NULL).
//      Already-settled predictions are not touched — no double-scoring.

function norm(s) {
  return (s || '').toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]/g, '');
}

function teamsMatch(dbTeam, scrapedTeam) {
  const a = norm(dbTeam), b = norm(scrapedTeam);
  return a === b || a.includes(b) || b.includes(a);
}

const { checkAchievements } = require('./middleware/achievements');

function autoSettleFromScrape(db) {
  // Only matches past their date that haven't been settled yet
  const pending = db.prepare(`
    SELECT id, match_date, home_team, away_team
    FROM   matches
    WHERE  status != 'finished'
    AND    match_date < date('now', '+1 day')
  `).all();

  if (!pending.length) return { settled: 0, skipped: 0 };

  let settled = 0, skipped = 0;

  for (const m of pending) {
    // Find a scraped result for the same date that has both teams
    const candidates = db.prepare(`
      SELECT home_team, away_team, home_score, away_score
      FROM   team_results
      WHERE  match_date = ?
    `).all(m.match_date);

    const found = candidates.find(r =>
      teamsMatch(m.home_team, r.home_team) &&
      teamsMatch(m.away_team, r.away_team)
    );

    if (!found) { skipped++; continue; }

    // Mark WC match as finished with scraped score
    db.prepare(`
      UPDATE matches
      SET    home_score=?, away_score=?, status='finished'
      WHERE  id=?
    `).run(found.home_score, found.away_score, m.id);

    // Score predictions — points_earned IS NULL guard prevents double-scoring
    const actualResult = Math.sign(found.home_score - found.away_score);
    const scored = db.prepare(`
      UPDATE match_predictions
      SET    points_earned = CASE
               WHEN home_score=? AND away_score=? THEN 3
               WHEN (CASE WHEN home_score>away_score THEN 1
                          WHEN home_score=away_score THEN 0
                          ELSE -1 END) = ? THEN 1
               ELSE 0
             END,
             updated_at = datetime('now')
      WHERE  match_id=? AND points_earned IS NULL
    `).run(found.home_score, found.away_score, actualResult, m.id);

    db.prepare(`
      INSERT INTO settlement_log (match_id, settled_by, home_score, away_score, predictions_scored)
      VALUES (?, 'auto', ?, ?, ?)
    `).run(m.id, found.home_score, found.away_score, scored.changes);

    // Award achievements for all users with predictions on this match
    const affected = db.prepare('SELECT DISTINCT user_id FROM match_predictions WHERE match_id=? AND points_earned IS NOT NULL').all(m.id);
    for (const { user_id } of affected) checkAchievements(db, user_id);

    console.log(`[settle] ${m.home_team} ${found.home_score}–${found.away_score} ${m.away_team} (match ${m.id}) settled`);
    settled++;
  }

  if (settled) console.log(`[settle] ${settled} match(es) auto-settled`);
  return { settled, skipped };
}

module.exports = { autoSettleFromScrape };
