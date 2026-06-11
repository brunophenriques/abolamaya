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

// POST /api/matches/predictions  — upsert batch
// Each match locks 15 minutes before kickoff (match_date + match_time in PT = UTC+1).
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
        const kickoff = new Date(`${m.match_date}T${m.match_time}:00+01:00`);
        if (Date.now() >= kickoff.getTime() - 900000) continue; // locked — skip silently
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
