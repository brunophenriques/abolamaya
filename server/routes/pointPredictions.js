const router = require('express').Router();
const db = require('../db');
const { auth, optionalAuth } = require('../middleware/auth');
const copy = require('../pointPredictionsCopy');
const {
  cancelVote,
  castVote,
  getBooleanSetting,
  listPredictions,
} = require('../services/pointPredictions');

function handleError(res, error) {
  res.status(error.status || 500).json({
    error: error.status ? error.message : 'Erro interno. Tenta novamente mais tarde.',
  });
}

router.get('/status', optionalAuth, (req, res) => {
  const enabled = getBooleanSetting('point_predictions_enabled');
  const communityVoteOpen = getBooleanSetting('prediction_community_vote_open');
  const betaMode = getBooleanSetting('point_predictions_beta_mode');
  const response = {
    enabled,
    community_vote_open: communityVoteOpen,
    beta_mode: betaMode,
    should_prompt: false,
    community_vote_choice: null,
    copy,
  };

  if (req.user) {
    const vote = db.prepare(
      'SELECT choice FROM prediction_feature_votes WHERE user_id=?'
    ).get(req.user.id);
    response.community_vote_choice = vote?.choice || null;
    response.should_prompt = communityVoteOpen && (!vote || vote.choice === 'later');
  }
  res.json(response);
});

router.post('/community-vote', auth, (req, res) => {
  if (!getBooleanSetting('prediction_community_vote_open')) {
    return res.status(409).json({ error: 'A votação comunitária está fechada.' });
  }
  const choice = String(req.body.choice || '');
  if (!['yes', 'no', 'later'].includes(choice)) {
    return res.status(400).json({ error: 'Resposta inválida.' });
  }
  const existing = db.prepare(
    'SELECT choice FROM prediction_feature_votes WHERE user_id=?'
  ).get(req.user.id);
  if (existing && existing.choice !== 'later') {
    return res.status(409).json({ error: 'Já respondeste a esta votação.' });
  }
  db.prepare(`
    INSERT INTO prediction_feature_votes (user_id,choice)
    VALUES (?,?)
    ON CONFLICT(user_id) DO UPDATE SET choice=excluded.choice,updated_at=datetime('now')
  `).run(req.user.id, choice);
  res.json({ ok: true, choice });
});

router.get('/', auth, (req, res) => {
  if (!getBooleanSetting('point_predictions_enabled')) {
    return res.status(403).json({ error: 'O sistema de previsões com pontos está desativado.' });
  }
  const user = db.prepare('SELECT points_balance FROM users WHERE id=?').get(req.user.id);
  const predictions = listPredictions({
    userId: req.user.id,
    statuses: ['open', 'locked', 'resolved', 'void'],
  });
  res.json({
    balance: user?.points_balance || 0,
    predictions,
  });
});

router.post('/:id/vote', auth, (req, res) => {
  try {
    castVote(Number(req.params.id), req.user.id, String(req.body.choice || ''));
    const balance = db.prepare('SELECT points_balance FROM users WHERE id=?').get(req.user.id).points_balance;
    res.json({ ok: true, balance });
  } catch (error) {
    handleError(res, error);
  }
});

router.delete('/:id/vote', auth, (req, res) => {
  try {
    cancelVote(Number(req.params.id), req.user.id);
    const balance = db.prepare('SELECT points_balance FROM users WHERE id=?').get(req.user.id).points_balance;
    res.json({ ok: true, balance });
  } catch (error) {
    handleError(res, error);
  }
});

module.exports = router;
