const router   = require('express').Router();
const db       = require('../db');
const { auth } = require('../middleware/auth');
const { createNotification } = require('./notifications');
const { checkAchievements }  = require('../middleware/achievements');

const USER_COLS = `u.id, u.username, u.display_name, u.avatar_color, u.is_admin`;

// GET /api/friends — friends list + pending requests
router.get('/', auth, (req, res) => {
  const me = req.user.id;

  const friends = db.prepare(`
    SELECT ${USER_COLS}, f.id AS fid, f.created_at AS since
    FROM friends f
    JOIN users u ON u.id = CASE WHEN f.requester_id=? THEN f.addressee_id ELSE f.requester_id END
    WHERE (f.requester_id=? OR f.addressee_id=?) AND f.status='accepted'
    ORDER BY u.display_name
  `).all(me, me, me).map(r => ({ ...r, is_admin: !!r.is_admin }));

  const incoming = db.prepare(`
    SELECT ${USER_COLS}, f.id AS fid, f.created_at
    FROM friends f JOIN users u ON u.id=f.requester_id
    WHERE f.addressee_id=? AND f.status='pending'
    ORDER BY f.created_at DESC
  `).all(me).map(r => ({ ...r, is_admin: !!r.is_admin }));

  const outgoing = db.prepare(`
    SELECT ${USER_COLS}, f.id AS fid, f.created_at
    FROM friends f JOIN users u ON u.id=f.addressee_id
    WHERE f.requester_id=? AND f.status='pending'
    ORDER BY f.created_at DESC
  `).all(me).map(r => ({ ...r, is_admin: !!r.is_admin }));

  res.json({ friends, incoming, outgoing });
});

// POST /api/friends/request  { username }
router.post('/request', auth, (req, res) => {
  const { username } = req.body;
  if (!username) return res.status(400).json({ error: 'Username obrigatório' });

  const target = db.prepare('SELECT id FROM users WHERE username=?').get(username.toLowerCase());
  if (!target)              return res.status(404).json({ error: 'Utilizador não encontrado' });
  if (target.id === req.user.id) return res.status(400).json({ error: 'Não te podes adicionar a ti próprio' });

  const existing = db.prepare(`
    SELECT status FROM friends
    WHERE (requester_id=? AND addressee_id=?) OR (requester_id=? AND addressee_id=?)
  `).get(req.user.id, target.id, target.id, req.user.id);

  if (existing?.status === 'accepted') return res.status(409).json({ error: 'Já são amigos' });
  if (existing?.status === 'pending')  return res.status(409).json({ error: 'Pedido já pendente' });

  const friendRow = db.prepare(`INSERT INTO friends (requester_id,addressee_id) VALUES (?,?)`).run(req.user.id, target.id);

  // Notify the addressee — store friend request ID in body for inline accept
  const me = db.prepare('SELECT username, display_name FROM users WHERE id=?').get(req.user.id);
  createNotification(target.id, {
    type:  'friend_request',
    title: `${me.display_name || me.username} enviou-te um pedido de amizade`,
    link:  `/profile.html?u=${me.username}`,
    body:  String(friendRow.lastInsertRowid),
  });

  res.json({ ok: true });
});

// POST /api/friends/:id/accept
router.post('/:id/accept', auth, (req, res) => {
  const row = db.prepare(
    `SELECT id, requester_id FROM friends WHERE id=? AND addressee_id=? AND status='pending'`
  ).get(req.params.id, req.user.id);
  if (!row) return res.status(404).json({ error: 'Pedido não encontrado' });

  db.prepare(`UPDATE friends SET status='accepted', updated_at=datetime('now') WHERE id=?`)
    .run(req.params.id);

  // Notify the requester
  const me = db.prepare('SELECT username FROM users WHERE id=?').get(req.user.id);
  createNotification(row.requester_id, {
    type:  'friend_accepted',
    title: `${me?.username} aceitou o teu pedido de amizade`,
    link:  `/profile.html?u=${me?.username}`,
  });

  // Check first_friend achievement for both
  checkAchievements(db, req.user.id);
  checkAchievements(db, row.requester_id);

  res.json({ ok: true });
});

// POST /api/friends/:id/reject
router.post('/:id/reject', auth, (req, res) => {
  db.prepare(`DELETE FROM friends WHERE id=? AND addressee_id=? AND status='pending'`)
    .run(req.params.id, req.user.id);
  res.json({ ok: true });
});

// DELETE /api/friends/:id — unfriend
router.delete('/:id', auth, (req, res) => {
  db.prepare(
    `DELETE FROM friends WHERE id=? AND (requester_id=? OR addressee_id=?) AND status='accepted'`
  ).run(req.params.id, req.user.id, req.user.id);
  res.json({ ok: true });
});

// GET /api/friends/leaderboard — rank self + friends
router.get('/leaderboard', auth, (req, res) => {
  const me = req.user.id;
  const fids = db.prepare(`
    SELECT CASE WHEN requester_id=? THEN addressee_id ELSE requester_id END AS fid
    FROM friends WHERE (requester_id=? OR addressee_id=?) AND status='accepted'
  `).all(me, me, me).map(r => r.fid);

  const ids = [me, ...fids];
  const ph  = ids.map(() => '?').join(',');

  const rows = db.prepare(`
    SELECT u.id, u.username, u.display_name, u.avatar_color, u.avatar_url, u.is_admin,
      COALESCE(mp.pts,0)              AS match_points,
      COALESCE(gp.gp,0)              AS group_points,
      COALESCE(mp.pts,0)+COALESCE(gp.gp,0) AS total_points,
      COALESCE(mp.cnt,0)             AS predictions_made,
      COALESCE(mp.correct,0)        AS correct_predictions
    FROM users u
    LEFT JOIN (
      SELECT user_id,
        SUM(COALESCE(points_earned,0)) pts, COUNT(*) cnt,
        SUM(CASE WHEN points_earned>=1 THEN 1 ELSE 0 END) correct
      FROM match_predictions GROUP BY user_id
    ) mp ON mp.user_id=u.id
    LEFT JOIN (SELECT user_id, SUM(points_earned) gp FROM group_points GROUP BY user_id) gp
           ON gp.user_id=u.id
    WHERE u.id IN (${ph})
    ORDER BY total_points DESC, match_points DESC, u.username
  `).all(...ids);

  res.json(rows.map((r, i) => ({
    ...r,
    is_admin: !!r.is_admin,
    rank:     i + 1,
    accuracy: r.predictions_made > 0
      ? Math.round((r.correct_predictions / r.predictions_made) * 100) : 0,
  })));
});

module.exports = router;
