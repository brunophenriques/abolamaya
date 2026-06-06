const router = require('express').Router();
const db     = require('../db');
const { auth } = require('../middleware/auth');
const { PREDICTION_DEADLINE } = require('../config');
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
router.post('/predictions', auth, (req, res) => {
  if (Date.now() > PREDICTION_DEADLINE.getTime())
    return res.status(403).json({ error: 'Previsões encerradas' });

  const { predictions } = req.body;
  if (!Array.isArray(predictions) || !predictions.length)
    return res.status(400).json({ error: 'Array de previsões inválido' });

  const upsert = db.prepare(`
    INSERT INTO match_predictions (user_id, match_id, home_score, away_score, updated_at)
    VALUES (?, ?, ?, ?, datetime('now'))
    ON CONFLICT(user_id, match_id) DO UPDATE
      SET home_score=excluded.home_score, away_score=excluded.away_score, updated_at=excluded.updated_at
  `);

  try {
    db.transaction(() => {
      for (const p of predictions) {
        if (p.home_score < 0 || p.away_score < 0) throw new Error('Marcador inválido');
        upsert.run(req.user.id, p.match_id, p.home_score, p.away_score);
      }
    })();
    res.json({ ok: true, count: predictions.length });
    // Check prediction-related achievements async (don't block response)
    setImmediate(() => checkAchievements(db, req.user.id));
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

module.exports = router;
