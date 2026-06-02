const router = require('express').Router();
const db     = require('../db');
const { auth } = require('../middleware/auth');

const LB_QUERY = `
  SELECT u.id, u.username, u.display_name,
    COALESCE(mp.pts, 0) AS match_points,
    COALESCE(gp.pts, 0) AS group_points,
    COALESCE(mp.pts,0) + COALESCE(gp.pts,0) AS total_points,
    COALESCE(mp.cnt, 0) AS predictions_made
  FROM users u
  LEFT JOIN (
    SELECT user_id, SUM(COALESCE(points_earned,0)) pts, COUNT(*) cnt
    FROM match_predictions GROUP BY user_id
  ) mp ON mp.user_id = u.id
  LEFT JOIN (
    SELECT user_id, SUM(COALESCE(points_earned,0)) pts
    FROM group_points GROUP BY user_id
  ) gp ON gp.user_id = u.id
`;

// GET /api/leaderboard
router.get('/', auth, (req, res) => {
  res.json(db.prepare(LB_QUERY + ' ORDER BY total_points DESC, match_points DESC, u.username').all());
});

// GET /api/leaderboard/lobby/:id
router.get('/lobby/:id', auth, (req, res) => {
  const isMember = db.prepare('SELECT 1 FROM lobby_members WHERE lobby_id=? AND user_id=?').get(req.params.id, req.user.id);
  if (!isMember) return res.status(403).json({ error: 'Não és membro desta sala' });

  res.json(
    db.prepare(`
      ${LB_QUERY}
      JOIN lobby_members lm ON lm.user_id = u.id AND lm.lobby_id = ?
      ORDER BY total_points DESC, match_points DESC, u.username
    `).all(req.params.id)
  );
});

module.exports = router;
