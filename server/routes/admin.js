const router = require('express').Router();
const db     = require('../db');
const { auth, requireAdmin } = require('../middleware/auth');
const { autoSettleFromScrape } = require('../settle');
const { logEvent } = require('../logs');

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

  logEvent({
    category:  'admin',
    message:   `Pontos do Grupo ${group_id} calculados para ${count} utilizadores (ordem real: ${actualOrder.join(', ')})`,
    actorId:   req.user.id,
    actorName: req.user.username,
    metadata:  { group_id, count, actual_order: actualOrder },
  });

  res.json({ ok: true, count, actual_order: actualOrder });
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
    SELECT u.id, u.username, u.display_name, u.email, u.is_admin, u.banned, u.created_at,
           COUNT(DISTINCT p.id) AS predictions,
           COUNT(DISTINCT t.id) AS ticket_count
    FROM users u
    LEFT JOIN match_predictions p ON p.user_id = u.id
    LEFT JOIN tickets t ON t.user_id = u.id
    GROUP BY u.id
    ORDER BY u.created_at DESC
  `).all();
  res.json(users.map(u => ({ ...u, is_admin: !!u.is_admin, banned: !!u.banned })));
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
