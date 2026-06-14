const router = require('express').Router();
const db     = require('../db');
const { auth } = require('../middleware/auth');
const { checkAchievements } = require('../middleware/achievements');

// GET /api/matches
router.get('/', (req, res) => {
  res.json(db.prepare('SELECT * FROM matches ORDER BY id').all());
});

// GET /api/matches/predictions  — current user's predictions
router.get('/predictions', auth, (req, res) => {
  res.json(
    db.prepare('SELECT match_id,home_score,away_score,points_earned FROM match_predictions WHERE user_id=?')
      .all(req.user.id)
  );
});

// GET /api/matches/:id/popular  — prediction distribution for a match
router.get('/:id/popular', auth, (req, res) => {
  const id = parseInt(req.params.id);
  if (!id) return res.status(400).json({ error: 'ID inválido' });

  const total = db.prepare('SELECT COUNT(*) AS n FROM match_predictions WHERE match_id=?').get(id).n;
  if (!total) return res.json({ total: 0, top_score: null, result_split: null });

  const top = db.prepare(`
    SELECT home_score, away_score, COUNT(*) AS cnt
    FROM match_predictions WHERE match_id=?
    GROUP BY home_score, away_score
    ORDER BY cnt DESC LIMIT 1
  `).get(id);

  const split = db.prepare(`
    SELECT
      SUM(CASE WHEN home_score > away_score THEN 1 ELSE 0 END) AS home_wins,
      SUM(CASE WHEN home_score = away_score THEN 1 ELSE 0 END) AS draws,
      SUM(CASE WHEN home_score < away_score THEN 1 ELSE 0 END) AS away_wins
    FROM match_predictions WHERE match_id=?
  `).get(id);

  res.json({
    total,
    top_score: top ? { home: top.home_score, away: top.away_score, count: top.cnt } : null,
    result_split: {
      home: { count: split.home_wins, pct: Math.round(split.home_wins * 100 / total) },
      draw: { count: split.draws,     pct: Math.round(split.draws     * 100 / total) },
      away: { count: split.away_wins, pct: Math.round(split.away_wins * 100 / total) },
    },
  });
});

// POST /api/matches/predictions  — upsert batch
// Each match locks 5 minutes before kickoff (match_date + match_time in PT = UTC+1).
// Locked matches in the batch are silently skipped; valid ones are saved.
router.post('/predictions', auth, (req, res) => {
  const { predictions } = req.body;
  if (!Array.isArray(predictions) || !predictions.length)
    return res.status(400).json({ error: 'Array de previsões inválido' });

  const ids = predictions.map(p => p.match_id);
  const ph  = ids.map(() => '?').join(',');
  const matchRows = db.prepare(`SELECT id, match_date, match_time FROM matches WHERE id IN (${ph})`).all(...ids);
  const matchMap  = Object.fromEntries(matchRows.map(m => [m.id, m]));

  const upsert = db.prepare(`
    INSERT INTO match_predictions (user_id, match_id, home_score, away_score, updated_at)
    VALUES (?, ?, ?, ?, datetime('now'))
    ON CONFLICT(user_id, match_id) DO UPDATE
      SET home_score=excluded.home_score, away_score=excluded.away_score, updated_at=excluded.updated_at
  `);

  let saved = 0;
  try {
    db.transaction(() => {
      for (const p of predictions) {
        if (p.home_score < 0 || p.away_score < 0) throw new Error('Marcador inválido');
        const m = matchMap[p.match_id];
        if (!m) throw new Error('Jogo não encontrado');
        const kickoff = new Date(`${m.match_date}T${m.match_time}:00+01:00`).getTime();
        const isException = m.match_date === '2026-06-11' && m.match_time === '20:00';
        const lockAt = isException ? kickoff + 600000 : kickoff - 300000;
        if (Date.now() >= lockAt) continue; // locked — skip silently
        upsert.run(req.user.id, p.match_id, p.home_score, p.away_score);
        saved++;
      }
    })();
    res.json({ ok: true, count: saved });
    setImmediate(() => checkAchievements(db, req.user.id));
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

module.exports = router;
