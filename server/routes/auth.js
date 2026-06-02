const router = require('express').Router();
const bcrypt = require('bcryptjs');
const jwt    = require('jsonwebtoken');
const db     = require('../db');
const { JWT_SECRET } = require('../config');

function makeToken(user) {
  return jwt.sign(
    { id: user.id, username: user.username, is_admin: !!user.is_admin },
    JWT_SECRET,
    { expiresIn: '30d' }
  );
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
    const r = db.prepare(
      'INSERT INTO users (username, display_name, email, password_hash) VALUES (?,?,?,?)'
    ).run(username.toLowerCase(), display_name || username, email.toLowerCase(), hash);
    const user = db.prepare('SELECT id,username,display_name,is_admin FROM users WHERE id=?').get(r.lastInsertRowid);
    res.json({ token: makeToken(user), user: { ...user, is_admin: !!user.is_admin } });
  } catch (e) {
    if (e.message.includes('UNIQUE'))
      return res.status(409).json({ error: 'Email ou username já em uso' });
    res.status(500).json({ error: e.message });
  }
});

// POST /api/auth/login
router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Preenche todos os campos' });

  const user = db.prepare('SELECT * FROM users WHERE email=?').get(email.toLowerCase());
  if (!user || !(await bcrypt.compare(password, user.password_hash)))
    return res.status(401).json({ error: 'Email ou palavra-passe incorretos' });

  const { password_hash, ...safe } = user;
  res.json({ token: makeToken(user), user: { ...safe, is_admin: !!user.is_admin } });
});

module.exports = router;
