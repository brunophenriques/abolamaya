const router   = require('express').Router();
const db       = require('../db');
const { auth } = require('../middleware/auth');
const { getGlobalLeaderboard, getLobbyLeaderboard } = require('../leaderboardData');

// GET /api/leaderboard
router.get('/', auth, (req, res) => {
  res.json(getGlobalLeaderboard(db));
});

// GET /api/leaderboard/lobby/:id
router.get('/lobby/:id', auth, (req, res) => {
  const isMember = db.prepare('SELECT 1 FROM lobby_members WHERE lobby_id=? AND user_id=?')
    .get(req.params.id, req.user.id);
  if (!isMember) return res.status(403).json({ error: 'Não és membro desta sala' });

  res.json(getLobbyLeaderboard(db, req.params.id));
});

module.exports = router;
