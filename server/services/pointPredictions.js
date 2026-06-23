const db = require('../db');

const VALID_CHOICES = new Set(['yes', 'no']);
const VALID_CATEGORIES = new Set(['match', 'player', 'group', 'world_cup', 'other']);
const FINAL_STATUSES = new Set(['resolved', 'void']);

function getSetting(key, fallback = null) {
  return db.prepare('SELECT value FROM site_settings WHERE key=?').get(key)?.value ?? fallback;
}

function getBooleanSetting(key) {
  return getSetting(key, 'false') === 'true';
}

function setSetting(key, value) {
  db.prepare(`
    INSERT INTO site_settings (key,value,updated_at) VALUES (?,?,datetime('now'))
    ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=datetime('now')
  `).run(key, String(value));
}

function syncExpiredPredictions() {
  db.prepare(`
    UPDATE point_predictions
    SET status='locked',updated_at=datetime('now')
    WHERE status='open' AND datetime(closes_at) <= datetime('now')
  `).run();
}

function predictionRows({ userId = null, statuses = null } = {}) {
  syncExpiredPredictions();
  const filters = [];
  const params = [];
  if (statuses?.length) {
    filters.push(`p.status IN (${statuses.map(() => '?').join(',')})`);
    params.push(...statuses);
  }
  const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
  return db.prepare(`
    SELECT p.*,
      SUM(CASE WHEN v.choice='yes' THEN 1 ELSE 0 END) AS yes_votes,
      SUM(CASE WHEN v.choice='no' THEN 1 ELSE 0 END) AS no_votes,
      COUNT(v.id) AS current_pool,
      ${userId ? 'MAX(CASE WHEN v.user_id=? THEN v.choice END)' : 'NULL'} AS user_vote
    FROM point_predictions p
    LEFT JOIN point_prediction_votes v ON v.prediction_id=p.id
    ${where}
    GROUP BY p.id
    ORDER BY
      CASE p.status WHEN 'open' THEN 0 WHEN 'locked' THEN 1 WHEN 'draft' THEN 2 ELSE 3 END,
      datetime(p.closes_at) ASC, p.id DESC
  `).all(...(userId ? [userId] : []), ...params);
}

function presentPrediction(row) {
  const yesVotes = Number(row.yes_votes || 0);
  const noVotes = Number(row.no_votes || 0);
  const pool = FINAL_STATUSES.has(row.status)
    ? Number(row.pool_total ?? yesVotes + noVotes)
    : yesVotes + noVotes;
  const percent = count => pool ? Math.round((count / pool) * 1000) / 10 : 0;
  const odds = count => count ? Math.round((pool / count) * 100) / 100 : null;
  const payout = count => count ? Math.ceil(pool / count) : null;

  return {
    id: row.id,
    question: row.question,
    category: row.category,
    status: row.status,
    closes_at: row.closes_at,
    result: row.result,
    created_at: row.created_at,
    resolved_at: row.resolved_at,
    yes_votes: yesVotes,
    no_votes: noVotes,
    pool_total: pool,
    yes_percent: percent(yesVotes),
    no_percent: percent(noVotes),
    yes_odds: odds(yesVotes),
    no_odds: odds(noVotes),
    yes_payout: payout(yesVotes),
    no_payout: payout(noVotes),
    user_vote: row.user_vote || null,
    winner_count: row.winner_count,
    payout_per_winner: row.payout_per_winner,
    total_paid: row.total_paid,
    inflation: row.inflation,
  };
}

function listPredictions(options) {
  return predictionRows(options).map(presentPrediction);
}

function requireOpenPrediction(predictionId) {
  syncExpiredPredictions();
  const prediction = db.prepare('SELECT * FROM point_predictions WHERE id=?').get(predictionId);
  if (!prediction) {
    const error = new Error('Previsão não encontrada.');
    error.status = 404;
    throw error;
  }
  if (prediction.status !== 'open' || new Date(prediction.closes_at).getTime() <= Date.now()) {
    const error = new Error('Esta previsão já está fechada.');
    error.status = 409;
    throw error;
  }
  return prediction;
}

const castVote = db.transaction((predictionId, userId, choice) => {
  if (!getBooleanSetting('point_predictions_enabled')) {
    const error = new Error('O sistema de previsões com pontos está desativado.');
    error.status = 403;
    throw error;
  }
  if (!VALID_CHOICES.has(choice)) {
    const error = new Error('Escolha inválida.');
    error.status = 400;
    throw error;
  }
  requireOpenPrediction(predictionId);

  const existing = db.prepare(
    'SELECT id,choice FROM point_prediction_votes WHERE prediction_id=? AND user_id=?'
  ).get(predictionId, userId);
  if (existing) {
    if (existing.choice !== choice) {
      db.prepare(`
        UPDATE point_prediction_votes
        SET choice=?,updated_at=datetime('now')
        WHERE id=?
      `).run(choice, existing.id);
    }
    return;
  }

  const debit = db.prepare(`
    UPDATE users SET points_balance=points_balance-1
    WHERE id=? AND points_balance>=1
  `).run(userId);
  if (!debit.changes) {
    const error = new Error('Não tens pontos disponíveis para votar.');
    error.status = 409;
    throw error;
  }

  db.prepare(`
    INSERT INTO point_prediction_votes (prediction_id,user_id,choice) VALUES (?,?,?)
  `).run(predictionId, userId, choice);
  db.prepare(`
    INSERT INTO point_transactions (user_id,prediction_id,amount,type)
    VALUES (?,?,?,'stake')
  `).run(userId, predictionId, -1);
});

const cancelVote = db.transaction((predictionId, userId) => {
  if (!getBooleanSetting('point_predictions_enabled')) {
    const error = new Error('O sistema de previsões com pontos está desativado.');
    error.status = 403;
    throw error;
  }
  requireOpenPrediction(predictionId);
  const removed = db.prepare(
    'DELETE FROM point_prediction_votes WHERE prediction_id=? AND user_id=?'
  ).run(predictionId, userId);
  if (!removed.changes) {
    const error = new Error('Não tens voto nesta previsão.');
    error.status = 404;
    throw error;
  }
  db.prepare('UPDATE users SET points_balance=points_balance+1 WHERE id=?').run(userId);
  db.prepare(`
    INSERT INTO point_transactions (user_id,prediction_id,amount,type)
    VALUES (?,?,?,'refund')
  `).run(userId, predictionId, 1);
});

const resolvePrediction = db.transaction((predictionId, result) => {
  syncExpiredPredictions();
  const prediction = db.prepare('SELECT * FROM point_predictions WHERE id=?').get(predictionId);
  if (!prediction) {
    const error = new Error('Previsão não encontrada.');
    error.status = 404;
    throw error;
  }
  if (FINAL_STATUSES.has(prediction.status)) {
    const error = new Error('Esta previsão já foi resolvida.');
    error.status = 409;
    throw error;
  }
  if (!['yes', 'no', 'void'].includes(result)) {
    const error = new Error('Resultado inválido.');
    error.status = 400;
    throw error;
  }

  const votes = db.prepare(
    'SELECT user_id,choice FROM point_prediction_votes WHERE prediction_id=?'
  ).all(predictionId);
  const pool = votes.length;

  if (result === 'void') {
    const credit = db.prepare('UPDATE users SET points_balance=points_balance+1 WHERE id=?');
    const transaction = db.prepare(`
      INSERT INTO point_transactions (user_id,prediction_id,amount,type)
      VALUES (?,?,1,'refund')
    `);
    for (const vote of votes) {
      credit.run(vote.user_id);
      transaction.run(vote.user_id, predictionId);
    }
    db.prepare(`
      UPDATE point_predictions SET
        status='void',result=NULL,resolved_at=datetime('now'),updated_at=datetime('now'),
        pool_total=?,winner_count=0,payout_per_winner=0,total_paid=?,inflation=0
      WHERE id=? AND status NOT IN ('resolved','void')
    `).run(pool, pool, predictionId);
    return { pool_total: pool, winner_count: 0, payout_per_winner: 0, total_paid: pool, inflation: 0 };
  }

  const winners = votes.filter(vote => vote.choice === result);
  const payout = winners.length ? Math.ceil(pool / winners.length) : 0;
  const totalPaid = payout * winners.length;
  const credit = db.prepare('UPDATE users SET points_balance=points_balance+? WHERE id=?');
  const transaction = db.prepare(`
    INSERT INTO point_transactions (user_id,prediction_id,amount,type)
    VALUES (?,?,?,'payout')
  `);
  for (const winner of winners) {
    credit.run(payout, winner.user_id);
    transaction.run(winner.user_id, predictionId, payout);
  }
  const inflation = Math.max(0, totalPaid - pool);
  db.prepare(`
    UPDATE point_predictions SET
      status='resolved',result=?,resolved_at=datetime('now'),updated_at=datetime('now'),
      pool_total=?,winner_count=?,payout_per_winner=?,total_paid=?,inflation=?
    WHERE id=? AND status NOT IN ('resolved','void')
  `).run(result, pool, winners.length, payout, totalPaid, inflation, predictionId);
  return {
    pool_total: pool,
    winner_count: winners.length,
    payout_per_winner: payout,
    total_paid: totalPaid,
    inflation,
  };
});

function validatePredictionInput({ question, category, closes_at }) {
  const normalizedQuestion = String(question || '').trim();
  if (normalizedQuestion.length < 5 || normalizedQuestion.length > 240) {
    const error = new Error('A pergunta deve ter entre 5 e 240 caracteres.');
    error.status = 400;
    throw error;
  }
  if (!VALID_CATEGORIES.has(category)) {
    const error = new Error('Categoria inválida.');
    error.status = 400;
    throw error;
  }
  const closeDate = new Date(closes_at);
  if (!Number.isFinite(closeDate.getTime())) {
    const error = new Error('Deadline inválida.');
    error.status = 400;
    throw error;
  }
  return { question: normalizedQuestion, category, closes_at: closeDate.toISOString() };
}

module.exports = {
  cancelVote,
  castVote,
  getBooleanSetting,
  getSetting,
  listPredictions,
  predictionRows,
  presentPrediction,
  resolvePrediction,
  setSetting,
  syncExpiredPredictions,
  validatePredictionInput,
};
