const router  = require('express').Router();
const bcrypt  = require('bcryptjs');
const db      = require('../db');
const { auth } = require('../middleware/auth');
const { getUserAchievements } = require('../middleware/achievements');

// ── Shared stats helper ───────────────────────────────────────────────────────
function userStats(userId) {
  const mp = db.prepare(`
    SELECT
      COUNT(*)                                                      AS total,
      SUM(CASE WHEN points_earned >= 1 THEN 1 ELSE 0 END)          AS correct,
      SUM(CASE WHEN points_earned  = 3 THEN 1 ELSE 0 END)          AS exact,
      COALESCE(SUM(points_earned), 0)                               AS match_pts
    FROM match_predictions WHERE user_id = ?
  `).get(userId);

  const gp = db.prepare(
    `SELECT COALESCE(SUM(points_earned),0) AS gp FROM group_points WHERE user_id=?`
  ).get(userId);

  const total_points = (mp.match_pts || 0) + (gp.gp || 0);

  const { rank } = db.prepare(`
    SELECT COUNT(*)+1 AS rank FROM (
      SELECT u.id,
        COALESCE(SUM(mp2.points_earned),0) + COALESCE(gp2.gp,0) AS tp
      FROM users u
      LEFT JOIN match_predictions mp2 ON mp2.user_id = u.id
      LEFT JOIN (SELECT user_id, SUM(points_earned) gp FROM group_points GROUP BY user_id) gp2
             ON gp2.user_id = u.id
      WHERE u.id != ?
      GROUP BY u.id
    ) WHERE tp > ?
  `).get(userId, total_points);

  return {
    total_predictions:   mp.total   || 0,
    correct_predictions: mp.correct || 0,
    exact_predictions:   mp.exact   || 0,
    match_points:        mp.match_pts || 0,
    group_points:        gp.gp || 0,
    total_points,
    rank,
    accuracy: mp.total > 0 ? Math.round((mp.correct / mp.total) * 100) : 0,
  };
}

// GET /api/profile/:username
router.get('/:username', auth, (req, res) => {
  const u = db.prepare(`
    SELECT id, username, display_name, bio, avatar_color, avatar_url, is_admin, created_at
    FROM users WHERE username=?
  `).get(req.params.username.toLowerCase());
  if (!u) return res.status(404).json({ error: 'Utilizador não encontrado' });

  res.json({
    user:         { ...u, is_admin: !!u.is_admin },
    stats:        userStats(u.id),
    achievements: getUserAchievements(db, u.id),
  });
});

// GET /api/profile/:username/history
router.get('/:username/history', auth, (req, res) => {
  const u = db.prepare('SELECT id FROM users WHERE username=?').get(req.params.username.toLowerCase());
  if (!u) return res.status(404).json({ error: 'Utilizador não encontrado' });

  const predictions = db.prepare(`
    SELECT
      mp.match_id, mp.home_score AS pred_home, mp.away_score AS pred_away,
      mp.points_earned, mp.updated_at,
      m.home_team, m.away_team, m.home_flag, m.away_flag,
      m.home_score AS actual_home, m.away_score AS actual_away,
      m.match_date, m.group_id, m.status
    FROM match_predictions mp
    JOIN matches m ON m.id = mp.match_id
    WHERE mp.user_id = ?
    ORDER BY m.match_date DESC, m.id DESC
    LIMIT 30
  `).all(u.id);

  res.json({ predictions });
});

// PATCH /api/profile/me — update display_name and bio
router.patch('/me', auth, (req, res) => {
  const { display_name, bio } = req.body;
  const sets = [], vals = [];
  if (display_name !== undefined) { sets.push('display_name=?'); vals.push(String(display_name).trim().slice(0, 50) || null); }
  if (bio         !== undefined) { sets.push('bio=?');          vals.push(String(bio).trim().slice(0, 300) || null); }
  if (!sets.length) return res.json({ ok: true });

  db.prepare(`UPDATE users SET ${sets.join(',')} WHERE id=?`).run(...vals, req.user.id);
  res.json({ ok: true });
});

// PATCH /api/profile/me/password — change password
router.patch('/me/password', auth, async (req, res) => {
  const { current_password, new_password } = req.body;
  if (!current_password || !new_password)
    return res.status(400).json({ error: 'Campos obrigatórios' });
  if (new_password.length < 6)
    return res.status(400).json({ error: 'Nova palavra-passe: mínimo 6 caracteres' });

  const row = db.prepare('SELECT password_hash FROM users WHERE id=?').get(req.user.id);
  if (!(await bcrypt.compare(current_password, row.password_hash)))
    return res.status(401).json({ error: 'Palavra-passe atual incorreta' });

  const hash = await bcrypt.hash(new_password, 10);
  db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(hash, req.user.id);
  res.json({ ok: true });
});

// PATCH /api/profile/me/privacy — update privacy settings
router.patch('/me/privacy', auth, (req, res) => {
  const { profile_public, history_public } = req.body;
  const sets = [], vals = [];
  if (profile_public !== undefined) { sets.push('profile_public=?'); vals.push(profile_public ? 1 : 0); }
  if (history_public !== undefined) { sets.push('history_public=?'); vals.push(history_public ? 1 : 0); }
  if (!sets.length) return res.json({ ok: true });
  db.prepare(`UPDATE users SET ${sets.join(',')} WHERE id=?`).run(...vals, req.user.id);
  res.json({ ok: true });
});

// PATCH /api/profile/me/username — change username
router.patch('/me/username', auth, (req, res) => {
  const { username } = req.body;
  if (!username) return res.status(400).json({ error: 'Username obrigatório' });
  if (!/^[a-z0-9_]{3,20}$/.test(username.toLowerCase()))
    return res.status(400).json({ error: 'Username: 3–20 chars, só letras, números e _' });

  try {
    db.prepare('UPDATE users SET username=? WHERE id=?').run(username.toLowerCase(), req.user.id);
    res.json({ ok: true });
  } catch (e) {
    if (e.message.includes('UNIQUE')) return res.status(409).json({ error: 'Username já em uso' });
    throw e;
  }
});

module.exports = router;
