const router = require('express').Router();
const db     = require('../db');
const { auth, requireAdmin } = require('../middleware/auth');
const { autoSettleFromScrape } = require('../settle');

// Shared standings calculation (mirrors js/scoring.js)
function calcStandings(matches, preds) {
  const stats = {};
  for (const m of matches) {
    for (const t of [m.home_team, m.away_team]) {
      if (!stats[t]) stats[t] = { name:t, p:0, w:0, d:0, l:0, gf:0, ga:0, pts:0 };
    }
  }
  for (const m of matches) {
    const p = preds[m.id];
    if (!p) continue;
    const hg = p.home_score, ag = p.away_score;
    if (typeof hg !== 'number' || typeof ag !== 'number') continue;
    const H = stats[m.home_team], A = stats[m.away_team];
    H.p++; A.p++;
    H.gf += hg; H.ga += ag; A.gf += ag; A.ga += hg;
    if (hg > ag)       { H.w++; H.pts += 3; A.l++; }
    else if (hg === ag){ H.d++; H.pts++;    A.d++; A.pts++; }
    else               { A.w++; A.pts += 3; H.l++; }
  }
  return Object.values(stats).sort((a,b) => {
    if (b.pts !== a.pts)               return b.pts - a.pts;
    if ((b.gf-b.ga) !== (a.gf-a.ga))  return (b.gf-b.ga) - (a.gf-a.ga);
    if (b.gf !== a.gf)                 return b.gf - a.gf;
    return a.name.localeCompare(b.name);
  });
}

// POST /api/admin/result  { match_id, home_score, away_score }
router.post('/result', auth, requireAdmin, (req, res) => {
  const { match_id, home_score, away_score } = req.body;
  if (typeof home_score !== 'number' || typeof away_score !== 'number' || home_score < 0 || away_score < 0)
    return res.status(400).json({ error: 'Marcador inválido' });

  db.prepare("UPDATE matches SET home_score=?,away_score=?,status='finished' WHERE id=?")
    .run(home_score, away_score, match_id);

  const actualResult = Math.sign(home_score - away_score);
  db.prepare(`
    UPDATE match_predictions
    SET points_earned = CASE
      WHEN home_score=? AND away_score=? THEN 3
      WHEN (CASE WHEN home_score>away_score THEN 1 WHEN home_score=away_score THEN 0 ELSE -1 END)=? THEN 1
      ELSE 0
    END, updated_at=datetime('now')
    WHERE match_id=?
  `).run(home_score, away_score, actualResult, match_id);

  res.json({ ok: true });
});

// POST /api/admin/group/:group_id/points
router.post('/group/:group_id/points', auth, requireAdmin, (req, res) => {
  const { group_id } = req.params;
  const matches = db.prepare('SELECT * FROM matches WHERE group_id=?').all(group_id);

  if (matches.some(m => m.status !== 'finished'))
    return res.status(400).json({ error: 'Nem todos os jogos estão terminados' });

  // Actual standings
  const actualPreds = {};
  for (const m of matches) actualPreds[m.id] = { home_score: m.home_score, away_score: m.away_score };
  const actualOrder = calcStandings(matches, actualPreds).map(t => t.name);

  // All predictions for this group
  const matchIds = matches.map(m => m.id);
  const allPreds = db.prepare(
    `SELECT user_id,match_id,home_score,away_score FROM match_predictions WHERE match_id IN (${matchIds.map(()=>'?').join(',')})`
  ).all(...matchIds);

  const byUser = {};
  for (const p of allPreds) {
    if (!byUser[p.user_id]) byUser[p.user_id] = {};
    byUser[p.user_id][p.match_id] = { home_score: p.home_score, away_score: p.away_score };
  }

  const upsert = db.prepare(`
    INSERT INTO group_points (user_id,group_id,predicted_order,actual_order,points_earned,calculated_at)
    VALUES (?,?,?,?,?,datetime('now'))
    ON CONFLICT(user_id,group_id) DO UPDATE SET
      predicted_order=excluded.predicted_order, actual_order=excluded.actual_order,
      points_earned=excluded.points_earned, calculated_at=excluded.calculated_at
  `);

  let count = 0;
  db.transaction(() => {
    for (const [uid, preds] of Object.entries(byUser)) {
      const predOrder = calcStandings(matches, preds).map(t => t.name);
      let pts = 0;
      for (let i = 0; i < 4; i++) if (predOrder[i] === actualOrder[i]) pts++;
      upsert.run(parseInt(uid), group_id, JSON.stringify(predOrder), JSON.stringify(actualOrder), pts);
      count++;
    }
  })();

  res.json({ ok: true, count, actual_order: actualOrder });
});

// POST /api/admin/auto-settle
// Matches past WC fixtures against scraped team_results and scores unsettled predictions.
router.post('/auto-settle', auth, requireAdmin, (req, res) => {
  const result = autoSettleFromScrape(db);
  res.json({ ok: true, ...result });
});

module.exports = router;
