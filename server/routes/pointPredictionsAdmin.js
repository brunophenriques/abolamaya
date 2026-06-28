const router = require('express').Router();
const db = require('../db');
const { auth, requireAdmin } = require('../middleware/auth');
const { checkAchievements } = require('../middleware/achievements');
const {
  getBooleanSetting,
  listPredictions,
  predictionRows,
  presentPrediction,
  resolvePrediction,
  setSetting,
  syncExpiredPredictions,
  validatePredictionInput,
} = require('../services/pointPredictions');

router.use(auth, requireAdmin);

function handleError(res, error) {
  res.status(error.status || 500).json({
    error: error.status ? error.message : 'Erro interno. Tenta novamente mais tarde.',
  });
}

router.get('/dashboard', (req, res) => {
  syncExpiredPredictions();
  const voteCounts = db.prepare(`
    SELECT
      SUM(CASE WHEN choice='yes' THEN 1 ELSE 0 END) AS yes,
      SUM(CASE WHEN choice='no' THEN 1 ELSE 0 END) AS no,
      SUM(CASE WHEN choice='later' THEN 1 ELSE 0 END) AS later,
      COUNT(*) AS total
    FROM prediction_feature_votes
  `).get();
  res.json({
    settings: {
      enabled: getBooleanSetting('point_predictions_enabled'),
      community_vote_open: getBooleanSetting('prediction_community_vote_open'),
      beta_mode: getBooleanSetting('point_predictions_beta_mode'),
    },
    community_vote: {
      yes: Number(voteCounts.yes || 0),
      no: Number(voteCounts.no || 0),
      later: Number(voteCounts.later || 0),
      total: Number(voteCounts.total || 0),
    },
    predictions: listPredictions(),
  });
});

router.patch('/settings', (req, res) => {
  const allowed = {
    enabled: 'point_predictions_enabled',
    community_vote_open: 'prediction_community_vote_open',
    beta_mode: 'point_predictions_beta_mode',
  };
  for (const [inputKey, settingKey] of Object.entries(allowed)) {
    if (typeof req.body[inputKey] === 'boolean') {
      setSetting(settingKey, req.body[inputKey] ? 'true' : 'false');
    }
  }
  res.json({ ok: true });
});

router.post('/', (req, res) => {
  try {
    const input = validatePredictionInput(req.body);
    const status = req.body.status === 'open' ? 'open' : 'draft';
    if (status === 'open' && new Date(input.closes_at).getTime() <= Date.now()) {
      return res.status(400).json({ error: 'A deadline tem de estar no futuro.' });
    }
    const result = db.prepare(`
      INSERT INTO point_predictions
        (question,category,status,closes_at,created_by)
      VALUES (?,?,?,?,?)
    `).run(input.question, input.category, status, input.closes_at, req.user.id);
    const row = predictionRows().find(item => item.id === Number(result.lastInsertRowid));
    res.status(201).json(presentPrediction(row));
  } catch (error) {
    handleError(res, error);
  }
});

router.patch('/:id', (req, res) => {
  try {
    const id = Number(req.params.id);
    const existing = db.prepare('SELECT * FROM point_predictions WHERE id=?').get(id);
    if (!existing) return res.status(404).json({ error: 'Previsão não encontrada.' });
    if (['resolved', 'void'].includes(existing.status)) {
      return res.status(409).json({ error: 'Não podes editar uma previsão finalizada.' });
    }
    const input = validatePredictionInput({
      question: req.body.question ?? existing.question,
      category: req.body.category ?? existing.category,
      closes_at: req.body.closes_at ?? existing.closes_at,
    });
    const requestedStatus = req.body.status;
    const status = requestedStatus === 'open' ? 'open'
      : requestedStatus === 'draft' ? 'draft'
      : existing.status;
    if (status === 'open' && new Date(input.closes_at).getTime() <= Date.now()) {
      return res.status(400).json({ error: 'A deadline tem de estar no futuro.' });
    }
    db.prepare(`
      UPDATE point_predictions
      SET question=?,category=?,status=?,closes_at=?,updated_at=datetime('now')
      WHERE id=?
    `).run(input.question, input.category, status, input.closes_at, id);
    const row = predictionRows().find(item => item.id === id);
    res.json(presentPrediction(row));
  } catch (error) {
    handleError(res, error);
  }
});

router.post('/:id/close', (req, res) => {
  const changed = db.prepare(`
    UPDATE point_predictions SET status='locked',updated_at=datetime('now')
    WHERE id=? AND status='open'
  `).run(Number(req.params.id));
  if (!changed.changes) return res.status(409).json({ error: 'A previsão não está aberta.' });
  res.json({ ok: true });
});

router.get('/:id/resolve-preview', (req, res) => {
  syncExpiredPredictions();
  const id = Number(req.params.id);
  const row = predictionRows().find(item => item.id === id);
  if (!row) return res.status(404).json({ error: 'Previsão não encontrada.' });
  if (['resolved', 'void'].includes(row.status)) {
    return res.status(409).json({ error: 'Esta previsão já foi resolvida.' });
  }
  const result = String(req.query.result || '');
  if (!['yes', 'no', 'void'].includes(result)) {
    return res.status(400).json({ error: 'Resultado inválido.' });
  }
  const prediction = presentPrediction(row);
  const winners = result === 'yes' ? prediction.yes_votes
    : result === 'no' ? prediction.no_votes
    : 0;
  const payout = winners ? Math.ceil(prediction.pool_total / winners) : 0;
  const totalPaid = result === 'void' ? prediction.pool_total : payout * winners;
  res.json({
    ...prediction,
    selected_result: result,
    winner_count: winners,
    payout_per_winner: payout,
    total_paid: totalPaid,
    inflation: result === 'void' ? 0 : Math.max(0, totalPaid - prediction.pool_total),
  });
});

router.get('/:id/votes', (req, res) => {
  const id = Number(req.params.id);
  const prediction = db.prepare('SELECT id, question FROM point_predictions WHERE id=?').get(id);
  if (!prediction) return res.status(404).json({ error: 'PrevisÃ£o nÃ£o encontrada.' });

  const votes = db.prepare(`
    SELECT v.choice, v.created_at, v.updated_at,
      u.id AS user_id, u.username, u.display_name, u.avatar_color, u.avatar_url
    FROM point_prediction_votes v
    JOIN users u ON u.id=v.user_id
    WHERE v.prediction_id=?
    ORDER BY v.choice DESC, datetime(v.created_at) ASC, u.username
  `).all(id);

  res.json({ prediction, votes });
});

router.post('/:id/resolve', (req, res) => {
  try {
    const id = Number(req.params.id);
    const voters = db.prepare('SELECT DISTINCT user_id FROM point_prediction_votes WHERE prediction_id=?').all(id);
    const summary = resolvePrediction(id, String(req.body.result || ''));
    setImmediate(() => {
      for (const { user_id } of voters) checkAchievements(db, user_id);
    });
    res.json({ ok: true, ...summary });
  } catch (error) {
    handleError(res, error);
  }
});

module.exports = router;
