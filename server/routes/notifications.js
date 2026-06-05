const router   = require('express').Router();
const db       = require('../db');
const { auth } = require('../middleware/auth');

// GET /api/notifications — latest 30 notifications for the current user
router.get('/', auth, (req, res) => {
  const rows = db.prepare(`
    SELECT id, type, title, body, link, read, created_at
    FROM notifications
    WHERE user_id = ?
    ORDER BY created_at DESC
    LIMIT 30
  `).all(req.user.id);

  const unread = rows.filter(r => !r.read).length;
  res.json({ notifications: rows, unread });
});

// PATCH /api/notifications/read-all — mark all as read
router.patch('/read-all', auth, (req, res) => {
  db.prepare(`UPDATE notifications SET read=1 WHERE user_id=?`).run(req.user.id);
  res.json({ ok: true });
});

// PATCH /api/notifications/:id/read — mark one as read
router.patch('/:id/read', auth, (req, res) => {
  db.prepare(`UPDATE notifications SET read=1 WHERE id=? AND user_id=?`)
    .run(req.params.id, req.user.id);
  res.json({ ok: true });
});

// Helper (used by other routes, not an HTTP endpoint) to create a notification
function createNotification(userId, { type, title, body = null, link = null }) {
  db.prepare(`
    INSERT INTO notifications (user_id, type, title, body, link)
    VALUES (?, ?, ?, ?, ?)
  `).run(userId, type, title, body, link);
}

module.exports = router;
module.exports.createNotification = createNotification;
