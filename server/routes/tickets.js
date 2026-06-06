const router = require('express').Router();
const db     = require('../db');
const { auth, requireAdmin, optionalAuth } = require('../middleware/auth');
const { logEvent } = require('../logs');

const VALID_CATEGORIES = ['wrong_result','wrong_player_stat','login_issue','prediction_issue','visual_bug','other'];
const VALID_STATUSES   = ['open','reviewing','resolved'];

// POST /api/tickets — submit a report (auth optional)
router.post('/', optionalAuth, (req, res) => {
  const { category, title, description, page_url, reference } = req.body;
  if (!VALID_CATEGORIES.includes(category)) return res.status(400).json({ error: 'Categoria inválida.' });
  if (!title?.trim())                return res.status(400).json({ error: 'Título obrigatório.' });
  if (!description?.trim())          return res.status(400).json({ error: 'Descrição obrigatória.' });
  if (title.length > 150)            return res.status(400).json({ error: 'Título demasiado longo.' });
  if (description.length > 5000)     return res.status(400).json({ error: 'Descrição demasiado longa (máx. 5000 chars).' });

  const result = db.prepare(`
    INSERT INTO tickets (user_id, category, title, description, page_url, reference)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    req.user?.id ?? null,
    category,
    title.trim(),
    description.trim(),
    page_url?.trim() || null,
    reference?.trim() || null
  );

  logEvent({
    category:  'ticket',
    message:   `Ticket criado: [${category}] ${title.trim()}`,
    actorId:   req.user?.id ?? null,
    actorName: req.user?.username ?? 'anónimo',
    metadata:  { ticket_id: result.lastInsertRowid, category, title: title.trim() },
  });

  res.json({ id: result.lastInsertRowid, message: 'Ticket enviado, obrigado!' });
});

// GET /api/tickets/admin — list all tickets (admin only)
router.get('/admin', auth, requireAdmin, (req, res) => {
  const status = req.query.status;
  const filtered = VALID_STATUSES.includes(status);
  const tickets = filtered
    ? db.prepare(`SELECT t.*, u.username, u.display_name FROM tickets t LEFT JOIN users u ON u.id = t.user_id WHERE t.status = ? ORDER BY t.created_at DESC LIMIT 200`).all(status)
    : db.prepare(`SELECT t.*, u.username, u.display_name FROM tickets t LEFT JOIN users u ON u.id = t.user_id ORDER BY t.created_at DESC LIMIT 200`).all();
  res.json(tickets);
});

// PATCH /api/tickets/admin/:id/status — update ticket status (admin only)
router.patch('/admin/:id/status', auth, requireAdmin, (req, res) => {
  const { status } = req.body;
  if (!VALID_STATUSES.includes(status)) return res.status(400).json({ error: 'Estado inválido.' });
  const info = db.prepare(
    `UPDATE tickets SET status=?, updated_at=datetime('now') WHERE id=?`
  ).run(status, req.params.id);
  if (info.changes === 0) return res.status(404).json({ error: 'Ticket não encontrado.' });
  logEvent({
    category:  'ticket',
    message:   `Estado do ticket #${req.params.id} alterado para "${status}"`,
    actorId:   req.user.id,
    actorName: req.user.username,
    metadata:  { ticket_id: parseInt(req.params.id), status },
  });
  res.json({ ok: true });
});

module.exports = router;
