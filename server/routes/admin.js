const router = require('express').Router();
const db     = require('../db');
const { auth, requireAdmin, requireHelper } = require('../middleware/auth');
const { autoSettleFromScrape } = require('../settle');
const { logEvent } = require('../logs');
const { checkAchievements, awardGroupStageTop10Achievements } = require('../middleware/achievements');
const { calcStandings } = require('../standings');
const { isKnockoutMatch, knockoutWinnerFromScore, scorePrediction } = require('../knockout');

// GET /api/admin/stats — dashboard overview
router.get('/stats', auth, requireAdmin, (req, res) => {
  const users        = db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
  const predictions  = db.prepare('SELECT COUNT(*) AS n FROM match_predictions').get().n;
  const settled      = db.prepare('SELECT COUNT(*) AS n FROM match_predictions WHERE points_earned IS NOT NULL').get().n;
  const matches      = db.prepare('SELECT COUNT(*) AS n FROM matches').get().n;
  const finished     = db.prepare(`SELECT COUNT(*) AS n FROM matches WHERE status='finished'`).get().n;
  const scrapeCount  = db.prepare('SELECT COUNT(DISTINCT team_code) AS n FROM team_results').get().n;
  const lastScrape   = db.prepare('SELECT MAX(scraped_at) AS t FROM team_results').get().t;
  const recentLogs   = db.prepare(
    'SELECT * FROM settlement_log ORDER BY settled_at DESC LIMIT 10'
  ).all();

  res.json({ users, predictions, settled, matches, finished, scrapeCount, lastScrape, recentLogs });
});

function snapshotRanks() {
  const rows = db.prepare(`
    SELECT u.id,
      COALESCE(mp.pts,0) + COALESCE(gp.pts,0) + COALESCE(pp.pts,0) AS total,
      COALESCE(mp.exact,0) AS exact,
      COALESCE(mp.pts,0) AS match_pts
    FROM users u
    LEFT JOIN (
      SELECT user_id,
        SUM(COALESCE(points_earned,0)) pts,
        SUM(CASE WHEN points_earned=3 THEN 1 ELSE 0 END) exact
      FROM match_predictions GROUP BY user_id
    ) mp ON mp.user_id=u.id
    LEFT JOIN (SELECT user_id, SUM(COALESCE(points_earned,0)) pts FROM group_points GROUP BY user_id) gp ON gp.user_id=u.id
    LEFT JOIN (SELECT user_id, SUM(amount) pts FROM point_transactions WHERE type!='admin_adjustment' GROUP BY user_id) pp ON pp.user_id=u.id
    WHERE (u.banned IS NULL OR u.banned=0)
    ORDER BY total DESC, exact ASC, match_pts DESC, u.username
  `).all();
  const snap = db.prepare(`
    INSERT INTO rank_snapshots (user_id, prev_rank) VALUES (?,?)
    ON CONFLICT(user_id) DO UPDATE SET prev_rank=excluded.prev_rank, snapped_at=datetime('now')
  `);
  db.transaction(() => rows.forEach((r, i) => snap.run(r.id, i + 1)))();
}

// POST /api/admin/resnapshot  { exclude_match_id }
// Re-takes the "before this match" rank snapshot by temporarily nulling a match's points.
// Use when a result was accidentally submitted twice (second run overwrites the snapshot).
router.post('/resnapshot', auth, requireAdmin, (req, res) => {
  const { exclude_match_id } = req.body;
  if (!exclude_match_id) return res.status(400).json({ error: 'exclude_match_id obrigatório' });

  db.transaction(() => {
    // Temporarily clear points for this match
    db.prepare('UPDATE match_predictions SET points_earned=NULL WHERE match_id=?').run(exclude_match_id);

    // Snapshot ranks as they were before this match
    const rows = db.prepare(`
      SELECT u.id,
        COALESCE(mp.pts,0) + COALESCE(gp.pts,0) + COALESCE(pp.pts,0) AS total,
        COALESCE(mp.exact,0) AS exact,
        COALESCE(mp.pts,0) AS match_pts
      FROM users u
      LEFT JOIN (
        SELECT user_id,
          SUM(COALESCE(points_earned,0)) pts,
          SUM(CASE WHEN points_earned=3 THEN 1 ELSE 0 END) exact
        FROM match_predictions GROUP BY user_id
      ) mp ON mp.user_id=u.id
      LEFT JOIN (SELECT user_id, SUM(COALESCE(points_earned,0)) pts FROM group_points GROUP BY user_id) gp ON gp.user_id=u.id
      LEFT JOIN (SELECT user_id, SUM(amount) pts FROM point_transactions WHERE type!='admin_adjustment' GROUP BY user_id) pp ON pp.user_id=u.id
      WHERE (u.banned IS NULL OR u.banned=0)
      ORDER BY total DESC, exact ASC, match_pts DESC, u.username
    `).all();
    const snap = db.prepare(`
      INSERT INTO rank_snapshots (user_id, prev_rank) VALUES (?,?)
      ON CONFLICT(user_id) DO UPDATE SET prev_rank=excluded.prev_rank, snapped_at=datetime('now')
    `);
    rows.forEach((r, i) => snap.run(r.id, i + 1));

    // Restore correct points
    const matchRow = db.prepare('SELECT home_score, away_score FROM matches WHERE id=?').get(exclude_match_id);
    if (matchRow && matchRow.home_score != null) {
      const actual = Math.sign(matchRow.home_score - matchRow.away_score);
      db.prepare(`
        UPDATE match_predictions
        SET points_earned = CASE
          WHEN home_score=? AND away_score=? THEN 3
          WHEN (CASE WHEN home_score>away_score THEN 1 WHEN home_score=away_score THEN 0 ELSE -1 END)=? THEN 1
          ELSE 0
        END
        WHERE match_id=?
      `).run(matchRow.home_score, matchRow.away_score, actual, exclude_match_id);
    }
  })();

  const matchRow = db.prepare('SELECT home_team, away_team FROM matches WHERE id=?').get(exclude_match_id);
  logEvent({
    category: 'admin',
    message: `Snapshot de ranks corrigido (excluindo jogo #${exclude_match_id}: ${matchRow?.home_team} vs ${matchRow?.away_team})`,
    actorId: req.user.id, actorName: req.user.username,
    metadata: { exclude_match_id },
  });

  res.json({ ok: true });
});

// POST /api/admin/result  { match_id, home_score, away_score, winner_team? }
router.post('/result', auth, requireHelper, (req, res) => {
  const { match_id, home_score, away_score, winner_team } = req.body;
  if (typeof home_score !== 'number' || typeof away_score !== 'number' || home_score < 0 || away_score < 0)
    return res.status(400).json({ error: 'Marcador invalido' });

  const matchRow = db.prepare('SELECT * FROM matches WHERE id=?').get(match_id);
  if (!matchRow) return res.status(404).json({ error: 'Jogo nao encontrado' });

  const actualWinner = isKnockoutMatch(matchRow)
    ? knockoutWinnerFromScore(matchRow, home_score, away_score, winner_team)
    : null;
  if (isKnockoutMatch(matchRow) && home_score === away_score && !actualWinner) {
    return res.status(400).json({ error: 'Em eliminatorias, se o resultado aos 120 for empate tens de escolher quem passa.' });
  }

  snapshotRanks();

  db.prepare("UPDATE matches SET home_score=?,away_score=?,winner_team=?,status='finished' WHERE id=?")
    .run(home_score, away_score, actualWinner, match_id);

  const predictions = db.prepare('SELECT id,home_score,away_score,predicted_winner FROM match_predictions WHERE match_id=?').all(match_id);
  const updatePoints = db.prepare("UPDATE match_predictions SET points_earned=?, updated_at=datetime('now') WHERE id=?");
  let scoredCount = 0;
  db.transaction(() => {
    for (const prediction of predictions) {
      updatePoints.run(scorePrediction(matchRow, prediction, home_score, away_score, actualWinner), prediction.id);
      scoredCount++;
    }
  })();

  db.prepare(`
    INSERT INTO settlement_log (match_id, settled_by, home_score, away_score, winner_team, predictions_scored)
    VALUES (?, 'admin', ?, ?, ?, ?)
  `).run(match_id, home_score, away_score, actualWinner, scoredCount);

  if (isKnockoutMatch(matchRow) && actualWinner && matchRow.next_match_id && matchRow.next_slot) {
    const slotColumn = matchRow.next_slot === 'away' ? 'away_team' : 'home_team';
    const flagColumn = matchRow.next_slot === 'away' ? 'away_flag' : 'home_flag';
    const winnerFlag = actualWinner === matchRow.home_team ? matchRow.home_flag : matchRow.away_flag;
    db.prepare(`UPDATE matches SET ${slotColumn}=?, ${flagColumn}=? WHERE id=?`)
      .run(actualWinner, winnerFlag, matchRow.next_match_id);
  }

  logEvent({
    category:  'admin',
    message:   `Resultado introduzido: ${matchRow.home_team} ${home_score}-${away_score} ${matchRow.away_team} (${scoredCount} previsoes pontuadas)`,
    actorId:   req.user.id,
    actorName: req.user.username,
    metadata:  { match_id, home_score, away_score, winner_team: actualWinner, predictions_scored: scoredCount },
  });

  setImmediate(() => {
    const affected = db.prepare('SELECT DISTINCT user_id FROM match_predictions WHERE match_id=? AND points_earned IS NOT NULL').all(match_id);
    for (const { user_id } of affected) checkAchievements(db, user_id);
  });

  res.json({ ok: true, winner_team: actualWinner });
});

// PATCH /api/admin/matches/:id/teams
router.patch('/matches/:id/teams', auth, requireHelper, (req, res) => {
  const id = parseInt(req.params.id);
  const { home_team, away_team, home_flag = '', away_flag = '', match_date, match_time, venue } = req.body;
  if (!home_team || !away_team) return res.status(400).json({ error: 'Equipas obrigatorias' });
  db.prepare(`
    UPDATE matches
    SET home_team=?, away_team=?, home_flag=?, away_flag=?,
        match_date=COALESCE(?, match_date),
        match_time=COALESCE(?, match_time),
        venue=COALESCE(?, venue)
    WHERE id=?
  `).run(home_team, away_team, home_flag, away_flag, match_date || null, match_time || null, venue || null, id);
  res.json({ ok: true });
});

// Legacy result route kept below but shadowed by the knockout-aware route above.
// POST /api/admin/result  { match_id, home_score, away_score }
router.post('/result', auth, requireHelper, (req, res) => {
  const { match_id, home_score, away_score } = req.body;
  if (typeof home_score !== 'number' || typeof away_score !== 'number' || home_score < 0 || away_score < 0)
    return res.status(400).json({ error: 'Marcador inválido' });

  snapshotRanks();

  db.prepare("UPDATE matches SET home_score=?,away_score=?,status='finished' WHERE id=?")
    .run(home_score, away_score, match_id);

  const actualResult = Math.sign(home_score - away_score);
  const scored = db.prepare(`
    UPDATE match_predictions
    SET points_earned = CASE
      WHEN home_score=? AND away_score=? THEN 3
      WHEN (CASE WHEN home_score>away_score THEN 1 WHEN home_score=away_score THEN 0 ELSE -1 END)=? THEN 1
      ELSE 0
    END, updated_at=datetime('now')
    WHERE match_id=?
  `).run(home_score, away_score, actualResult, match_id);

  db.prepare(`
    INSERT INTO settlement_log (match_id, settled_by, home_score, away_score, predictions_scored)
    VALUES (?, 'admin', ?, ?, ?)
  `).run(match_id, home_score, away_score, scored.changes);

  const matchRow = db.prepare('SELECT home_team,away_team FROM matches WHERE id=?').get(match_id);
  logEvent({
    category:  'admin',
    message:   matchRow
      ? `Resultado introduzido: ${matchRow.home_team} ${home_score}–${away_score} ${matchRow.away_team} (${scored.changes} previsões pontuadas)`
      : `Resultado introduzido: jogo #${match_id} ${home_score}–${away_score} (${scored.changes} previsões pontuadas)`,
    actorId:   req.user.id,
    actorName: req.user.username,
    metadata:  { match_id, home_score, away_score, predictions_scored: scored.changes },
  });

  // Check achievements for all users with settled predictions for this match
  setImmediate(() => {
    const affected = db.prepare('SELECT DISTINCT user_id FROM match_predictions WHERE match_id=? AND points_earned IS NOT NULL').all(match_id);
    for (const { user_id } of affected) checkAchievements(db, user_id);
  });

  res.json({ ok: true });
});

// POST /api/admin/group/:group_id/points
router.post('/group-stage/top10-achievements', auth, requireHelper, (req, res) => {
  const top10 = awardGroupStageTop10Achievements(db, { replace: true });
  if (top10.length) {
    logEvent({
      category:  'admin',
      message:   `Achievements de Top 10 da fase de grupos recalculados (${top10.length} utilizadores)`,
      actorId:   req.user.id,
      actorName: req.user.username,
      metadata:  { awarded: top10 },
    });
  }
  res.json({ ok: true, count: top10.length, awarded: top10 });
});

router.post('/group/:group_id/points', auth, requireHelper, (req, res) => {
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

  const eligibleEntries = Object.entries(byUser)
    .map(([uid, preds]) => ({
      uid,
      preds,
      predicted_count: matchIds.filter(id => preds[id]).length,
    }))
    .filter(entry => entry.predicted_count >= 3);

  let count = 0, capped = 0;
  db.transaction(() => {
    db.prepare('DELETE FROM group_points WHERE group_id=?').run(group_id);
    for (const { uid, preds, predicted_count } of eligibleEntries) {
      const predOrder = calcStandings(matches, preds).map(t => t.name);
      let pts = 0;
      for (let i = 0; i < 4; i++) if (predOrder[i] === actualOrder[i]) pts++;
      const cappedPts = predicted_count <= 4 ? Math.min(pts, 3) : pts;
      if (cappedPts !== pts) capped++;
      pts = cappedPts;
      upsert.run(parseInt(uid), group_id, JSON.stringify(predOrder), JSON.stringify(actualOrder), pts);
      count++;
    }
  })();

  // Check group/rank achievements for all users who got group points
  setImmediate(() => {
    for (const { uid } of eligibleEntries) checkAchievements(db, parseInt(uid));
    const top10 = awardGroupStageTop10Achievements(db);
    if (top10.length) {
      logEvent({
        category:  'admin',
        message:   `Achievements de Top 10 da fase de grupos atribuidos (${top10.length} utilizadores)`,
        actorId:   req.user.id,
        actorName: req.user.username,
        metadata:  { awarded: top10 },
      });
    }
  });

  logEvent({
    category:  'admin',
    message:   `Pontos do Grupo ${group_id} calculados para ${count} utilizadores elegiveis (ordem real: ${actualOrder.join(', ')})`,
    actorId:   req.user.id,
    actorName: req.user.username,
    metadata:  {
      group_id,
      count,
      capped,
      skipped_incomplete: Object.keys(byUser).length - count,
      actual_order: actualOrder,
    },
  });

  res.json({
    ok: true,
    count,
    capped,
    skipped_incomplete: Object.keys(byUser).length - count,
    actual_order: actualOrder,
  });
});

// POST /api/admin/auto-settle
router.post('/auto-settle', auth, requireAdmin, (req, res) => {
  const result = autoSettleFromScrape(db);
  logEvent({
    category:  'settle',
    message:   `Auto-settle manual: ${result.settled} jogo(s) liquidado(s), ${result.skipped} ignorado(s)`,
    actorId:   req.user.id,
    actorName: req.user.username,
    metadata:  result,
  });
  res.json({ ok: true, ...result });
});

// GET /api/admin/users — list all users
router.get('/users', auth, requireAdmin, (req, res) => {
  const users = db.prepare(`
    SELECT u.id, u.username, u.display_name, u.email, u.is_admin, u.is_helper, u.banned, u.created_at,
           COUNT(DISTINCT p.id) AS predictions,
           COUNT(DISTINCT t.id) AS ticket_count
    FROM users u
    LEFT JOIN match_predictions p ON p.user_id = u.id
    LEFT JOIN tickets t ON t.user_id = u.id
    GROUP BY u.id
    ORDER BY u.created_at DESC
  `).all();
  res.json(users.map(u => ({ ...u, is_admin: !!u.is_admin, is_helper: !!u.is_helper, banned: !!u.banned })));
});

// PATCH /api/admin/users/:id/ban — toggle ban
router.patch('/users/:id/ban', auth, requireAdmin, (req, res) => {
  const id = parseInt(req.params.id);
  if (id === req.user.id) return res.status(400).json({ error: 'Não podes suspender a tua própria conta.' });
  const user = db.prepare('SELECT banned, is_admin FROM users WHERE id=?').get(id);
  if (!user) return res.status(404).json({ error: 'Utilizador não encontrado.' });
  if (user.is_admin) return res.status(400).json({ error: 'Não podes suspender outro admin.' });
  const newBanned = user.banned ? 0 : 1;
  const targetUser = db.prepare('SELECT username FROM users WHERE id=?').get(id);
  db.prepare('UPDATE users SET banned=? WHERE id=?').run(newBanned, id);
  logEvent({
    category:  'admin',
    message:   newBanned
      ? `Utilizador @${targetUser?.username} (#${id}) suspenso`
      : `Utilizador @${targetUser?.username} (#${id}) reativado`,
    actorId:   req.user.id,
    actorName: req.user.username,
    metadata:  { target_user_id: id, banned: !!newBanned },
  });
  res.json({ ok: true, banned: !!newBanned });
});

// PATCH /api/admin/users/:id/helper — toggle helper role
router.patch('/users/:id/helper', auth, requireAdmin, (req, res) => {
  const id = parseInt(req.params.id);
  if (id === req.user.id) return res.status(400).json({ error: 'Não podes alterar o teu próprio role.' });
  const user = db.prepare('SELECT is_admin, is_helper, username FROM users WHERE id=?').get(id);
  if (!user) return res.status(404).json({ error: 'Utilizador não encontrado.' });
  if (user.is_admin) return res.status(400).json({ error: 'Admins não podem ser helpers.' });
  const newHelper = user.is_helper ? 0 : 1;
  db.prepare('UPDATE users SET is_helper=? WHERE id=?').run(newHelper, id);
  logEvent({
    category:  'admin',
    message:   newHelper
      ? `@${user.username} (#${id}) promovido a helper`
      : `@${user.username} (#${id}) removido de helper`,
    actorId:   req.user.id,
    actorName: req.user.username,
    metadata:  { target_user_id: id, is_helper: !!newHelper },
  });
  res.json({ ok: true, is_helper: !!newHelper });
});

// DELETE /api/admin/users/:id — delete account
router.delete('/users/:id', auth, requireAdmin, (req, res) => {
  const id = parseInt(req.params.id);
  if (id === req.user.id) return res.status(400).json({ error: 'Não podes apagar a tua própria conta.' });
  const user = db.prepare('SELECT is_admin, username FROM users WHERE id=?').get(id);
  if (!user) return res.status(404).json({ error: 'Utilizador não encontrado.' });
  if (user.is_admin) return res.status(400).json({ error: 'Não podes apagar outro admin.' });
  db.prepare('DELETE FROM users WHERE id=?').run(id);
  logEvent({
    category:  'admin',
    severity:  'warning',
    message:   `Conta apagada: @${user.username} (#${id})`,
    actorId:   req.user.id,
    actorName: req.user.username,
    metadata:  { deleted_user_id: id, deleted_username: user.username },
  });
  res.json({ ok: true });
});

// GET /api/admin/logs — paginated system log viewer
router.get('/logs', auth, requireAdmin, (req, res) => {
  const { category, severity, limit = 100, offset = 0 } = req.query;
  const VALID_CATS = ['scraper','settle','admin','ticket','auth'];
  const VALID_SEV  = ['info','warning','error'];

  const conditions = [];
  const params     = [];

  if (category && VALID_CATS.includes(category)) { conditions.push('category=?'); params.push(category); }
  if (severity && VALID_SEV.includes(severity))   { conditions.push('severity=?'); params.push(severity); }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const rows  = db.prepare(
    `SELECT id, category, message, severity, actor_id, actor_name, metadata, created_at
     FROM system_logs ${where}
     ORDER BY created_at DESC
     LIMIT ? OFFSET ?`
  ).all(...params, Math.min(parseInt(limit) || 100, 500), parseInt(offset) || 0);

  const total = db.prepare(`SELECT COUNT(*) AS n FROM system_logs ${where}`).get(...params).n;

  res.json({ logs: rows, total });
});

module.exports = router;
