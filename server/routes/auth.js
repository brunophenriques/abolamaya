const router     = require('express').Router();
const bcrypt     = require('bcryptjs');
const jwt        = require('jsonwebtoken');
const crypto     = require('crypto');
const rateLimit  = require('express-rate-limit');
const db         = require('../db');
const { JWT_SECRET } = require('../config');
const { sendPasswordReset } = require('../email');

const forgotLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiados pedidos de recuperação. Tenta novamente em 1 hora.' },
});

const resetLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiadas tentativas. Tenta novamente em 1 hora.' },
});

function makeToken(user) {
  return jwt.sign(
    { id: user.id, username: user.username, is_admin: !!user.is_admin },
    JWT_SECRET,
    { expiresIn: '30d' }
  );
}

function genAvatarColor(str) {
  const palette = ['#E61D25','#2A398D','#3CAC3B','#f5a623','#8b5cf6','#06b6d4','#f97316','#ec4899','#10b981','#a855f7'];
  let h = 0;
  for (let i = 0; i < str.length; i++) h = Math.imul(31, h) + str.charCodeAt(i) | 0;
  return palette[Math.abs(h) % palette.length];
}

// POST /api/auth/register
router.post('/register', async (req, res) => {
  const { username, display_name, email, password } = req.body;
  if (!username || !email || !password)
    return res.status(400).json({ error: 'Campos obrigatórios em falta' });
  if (!/^[a-z0-9_]{3,20}$/.test(username.toLowerCase()))
    return res.status(400).json({ error: 'Username: 3–20 chars, só letras, números e _' });
  if (password.length < 6)
    return res.status(400).json({ error: 'Palavra-passe mínimo 6 caracteres' });

  try {
    const hash = await bcrypt.hash(password, 10);
    const uname = username.toLowerCase();
    const color = genAvatarColor(uname);
    const r = db.prepare(
      'INSERT INTO users (username, display_name, email, password_hash, avatar_color) VALUES (?,?,?,?,?)'
    ).run(uname, display_name || username, email.toLowerCase(), hash, color);
    const user = db.prepare('SELECT id,username,display_name,is_admin,avatar_color FROM users WHERE id=?').get(r.lastInsertRowid);
    res.json({ token: makeToken(user), user: { ...user, is_admin: !!user.is_admin } });
  } catch (e) {
    if (e.message.includes('UNIQUE'))
      return res.status(409).json({ error: 'Email ou username já em uso' });
    console.error('[auth/register]', e.message);
    res.status(500).json({ error: 'Erro interno. Tenta novamente mais tarde.' });
  }
});

// POST /api/auth/login
router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Preenche todos os campos' });

  const user = db.prepare('SELECT * FROM users WHERE email=?').get(email.toLowerCase());
  if (!user || !(await bcrypt.compare(password, user.password_hash)))
    return res.status(401).json({ error: 'Email ou palavra-passe incorretos' });
  if (user.banned)
    return res.status(403).json({ error: 'Conta suspensa. Contacta a administração.' });

  const { password_hash, ...safe } = user;
  res.json({ token: makeToken(user), user: { ...safe, is_admin: !!user.is_admin } });
});

// POST /api/auth/forgot-password
router.post('/forgot-password', forgotLimiter, async (req, res) => {
  const GENERIC = 'Se existir uma conta com esse email, enviámos um link de recuperação.';
  const email = (req.body.email || '').toLowerCase().trim();
  if (!email) return res.json({ message: GENERIC });

  try {
    const user = db.prepare('SELECT id FROM users WHERE email=?').get(email);
    if (user) {
      db.prepare('DELETE FROM password_reset_tokens WHERE user_id=? AND used_at IS NULL').run(user.id);

      const token     = crypto.randomBytes(32).toString('hex');
      const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
      const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();

      db.prepare(
        'INSERT INTO password_reset_tokens (user_id, token_hash, expires_at) VALUES (?,?,?)'
      ).run(user.id, tokenHash, expiresAt);

      // Fire-and-forget — never block the response on SMTP delivery
      sendPasswordReset(email, token).catch(err =>
        console.error('[forgot-password] email failed:', err.message)
      );
    }
  } catch (e) {
    console.error('[forgot-password]', e.message);
  }

  // Always respond immediately — never reveal whether the account exists
  res.json({ message: GENERIC });
});

// POST /api/auth/reset-password
router.post('/reset-password', resetLimiter, async (req, res) => {
  const { token, newPassword } = req.body;
  if (!token || !newPassword)
    return res.status(400).json({ error: 'Dados em falta.' });
  if (typeof newPassword !== 'string' || newPassword.length < 6)
    return res.status(400).json({ error: 'A nova password deve ter mínimo 6 caracteres.' });

  try {
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const row = db.prepare(`
      SELECT * FROM password_reset_tokens
      WHERE token_hash=? AND used_at IS NULL AND expires_at > datetime('now')
    `).get(tokenHash);

    if (!row) return res.status(400).json({ error: 'Link inválido ou expirado. Pede um novo.' });

    const hash = await bcrypt.hash(newPassword, 10);

    db.transaction(() => {
      db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(hash, row.user_id);
      db.prepare(`UPDATE password_reset_tokens SET used_at=datetime('now') WHERE id=?`).run(row.id);
      // Clean up all remaining tokens for this user
      db.prepare('DELETE FROM password_reset_tokens WHERE user_id=? AND id!=?').run(row.user_id, row.id);
    })();

    res.json({ ok: true, message: 'Password atualizada com sucesso.' });
  } catch (e) {
    console.error('[reset-password]', e.message);
    res.status(500).json({ error: 'Erro interno. Tenta novamente.' });
  }
});

module.exports = router;
