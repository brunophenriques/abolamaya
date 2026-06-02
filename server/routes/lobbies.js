const router = require('express').Router();
const db     = require('../db');
const { auth } = require('../middleware/auth');

// GET /api/lobbies
router.get('/', auth, (req, res) => {
  res.json(db.prepare(`
    SELECT l.*,
      (SELECT COUNT(*) FROM lobby_members WHERE lobby_id=l.id) AS member_count
    FROM lobbies l
    JOIN lobby_members lm ON lm.lobby_id=l.id AND lm.user_id=?
    ORDER BY l.created_at DESC
  `).all(req.user.id));
});

// POST /api/lobbies
router.post('/', auth, (req, res) => {
  const name = (req.body.name || '').trim();
  if (!name) return res.status(400).json({ error: 'Nome é obrigatório' });

  const code = Math.random().toString(36).slice(2,8).toUpperCase();
  const r = db.prepare('INSERT INTO lobbies (name,invite_code,created_by) VALUES (?,?,?)').run(name, code, req.user.id);
  db.prepare('INSERT INTO lobby_members (lobby_id,user_id) VALUES (?,?)').run(r.lastInsertRowid, req.user.id);
  res.json(db.prepare('SELECT * FROM lobbies WHERE id=?').get(r.lastInsertRowid));
});

// POST /api/lobbies/join
router.post('/join', auth, (req, res) => {
  const code = (req.body.code || '').trim().toUpperCase();
  if (!code) return res.status(400).json({ error: 'Código é obrigatório' });

  const lobby = db.prepare('SELECT * FROM lobbies WHERE invite_code=?').get(code);
  if (!lobby) return res.status(404).json({ error: 'Código inválido' });

  db.prepare('INSERT OR IGNORE INTO lobby_members (lobby_id,user_id) VALUES (?,?)').run(lobby.id, req.user.id);
  res.json(lobby);
});

// GET /api/lobbies/:id/members
router.get('/:id/members', auth, (req, res) => {
  const lobby = db.prepare('SELECT * FROM lobbies WHERE id=?').get(req.params.id);
  if (!lobby) return res.status(404).json({ error: 'Sala não encontrada' });

  const isMember = db.prepare('SELECT 1 FROM lobby_members WHERE lobby_id=? AND user_id=?').get(req.params.id, req.user.id);
  if (!isMember) return res.status(403).json({ error: 'Sem acesso' });

  const members = db.prepare(`
    SELECT u.id, u.username, u.display_name
    FROM lobby_members lm
    JOIN users u ON u.id = lm.user_id
    WHERE lm.lobby_id = ?
    ORDER BY lm.joined_at ASC
  `).all(req.params.id);

  res.json({ members, created_by: lobby.created_by });
});

// DELETE /api/lobbies/:id/members/:userId  (kick — creator only)
router.delete('/:id/members/:userId', auth, (req, res) => {
  const lobby = db.prepare('SELECT * FROM lobbies WHERE id=?').get(req.params.id);
  if (!lobby) return res.status(404).json({ error: 'Sala não encontrada' });
  if (lobby.created_by !== req.user.id) return res.status(403).json({ error: 'Sem permissão' });

  const targetId = parseInt(req.params.userId);
  if (targetId === req.user.id) return res.status(400).json({ error: 'Não podes expulsar-te a ti próprio' });

  db.prepare('DELETE FROM lobby_members WHERE lobby_id=? AND user_id=?').run(req.params.id, targetId);
  res.json({ ok: true });
});

// DELETE /api/lobbies/:id
router.delete('/:id', auth, (req, res) => {
  const lobby = db.prepare('SELECT * FROM lobbies WHERE id=?').get(req.params.id);
  if (!lobby) return res.status(404).json({ error: 'Sala não encontrada' });
  if (lobby.created_by !== req.user.id) return res.status(403).json({ error: 'Sem permissão' });
  db.prepare('DELETE FROM lobbies WHERE id=?').run(req.params.id);
  res.json({ ok: true });
});

// POST /api/lobbies/:id/leave
router.post('/:id/leave', auth, (req, res) => {
  db.prepare('DELETE FROM lobby_members WHERE lobby_id=? AND user_id=?').run(req.params.id, req.user.id);
  res.json({ ok: true });
});

module.exports = router;
