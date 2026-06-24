// Stateless OAuth2 — no passport, no sessions.
// State param is a short-lived JWT to prevent CSRF.
// Flow: /api/auth/{provider} → provider → /api/auth/{provider}/callback → /oauth.html?token=xxx

const router     = require('express').Router();
const jwt        = require('jsonwebtoken');
const db         = require('../db');
const { JWT_SECRET, OAUTH } = require('../config');

// ── Helpers ───────────────────────────────────────────────────────────────────

function genAvatarColor(str) {
  const p = ['#E61D25','#2A398D','#3CAC3B','#f5a623','#8b5cf6','#06b6d4','#f97316','#ec4899'];
  let h = 0;
  for (let i = 0; i < str.length; i++) h = Math.imul(31, h) + str.charCodeAt(i) | 0;
  return p[Math.abs(h) % p.length];
}

function makeToken(user) {
  return jwt.sign(
    { id: user.id, username: user.username, is_admin: !!user.is_admin },
    JWT_SECRET,
    { expiresIn: '30d' }
  );
}

// Generate a unique username from a base (appends numbers until unique)
function uniqueUsername(base) {
  const clean = (base || 'user').toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 16) || 'user';
  if (!db.prepare('SELECT 1 FROM users WHERE username=?').get(clean)) return clean;
  for (let i = 2; i < 9999; i++) {
    const candidate = `${clean}${i}`;
    if (!db.prepare('SELECT 1 FROM users WHERE username=?').get(candidate)) return candidate;
  }
  return `${clean}${Date.now()}`;
}

// Find existing user by OAuth provider, or create new one
function findOrCreateOAuthUser(provider, providerId, { email, name, avatarUrl }) {
  // 1. Already linked
  const link = db.prepare('SELECT user_id FROM user_oauth WHERE provider=? AND provider_id=?')
    .get(provider, providerId);
  if (link) return db.prepare('SELECT * FROM users WHERE id=?').get(link.user_id);

  // 2. Existing user with same email → link the account
  let user = email
    ? db.prepare('SELECT * FROM users WHERE email=?').get(email.toLowerCase())
    : null;

  // 3. Create new user
  if (!user) {
    const username = uniqueUsername(name ? name.split(' ')[0] : email?.split('@')[0]);
    const color    = genAvatarColor(username);
    const r = db.prepare(`
      INSERT INTO users (username, display_name, email, password_hash, avatar_color, avatar_url)
      VALUES (?, ?, ?, 'oauth', ?, ?)
    `).run(username, name || username, email?.toLowerCase() || null, color, avatarUrl || null);
    user = db.prepare('SELECT * FROM users WHERE id=?').get(r.lastInsertRowid);
  }

  // Link provider
  db.prepare('INSERT OR IGNORE INTO user_oauth (user_id, provider, provider_id, email) VALUES (?,?,?,?)')
    .run(user.id, provider, providerId, email || null);

  return user;
}

function oauthError(res, msg) {
  return res.redirect(`/oauth.html?error=${encodeURIComponent(msg)}`);
}

// ── Google ────────────────────────────────────────────────────────────────────

router.get('/google', (req, res) => {
  if (!OAUTH.GOOGLE_CLIENT_ID) return res.status(501).json({ error: 'Google OAuth não configurado' });
  const state = jwt.sign({ p: 'google' }, JWT_SECRET, { expiresIn: '10m' });
  const params = new URLSearchParams({
    client_id:     OAUTH.GOOGLE_CLIENT_ID,
    redirect_uri:  OAUTH.GOOGLE_REDIRECT,
    response_type: 'code',
    scope:         'openid email profile',
    state,
  });
  res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
});

router.get('/google/callback', async (req, res) => {
  const { code, state, error } = req.query;
  if (error) return oauthError(res, error);
  try { jwt.verify(state, JWT_SECRET); } catch { return oauthError(res, 'Estado inválido'); }

  try {
    // Exchange code for tokens
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id:     OAUTH.GOOGLE_CLIENT_ID,
        client_secret: OAUTH.GOOGLE_CLIENT_SECRET,
        redirect_uri:  OAUTH.GOOGLE_REDIRECT,
        grant_type:    'authorization_code',
      }),
    });
    const tokens = await tokenRes.json();
    if (!tokenRes.ok) return oauthError(res, tokens.error_description || 'Erro Google OAuth');

    // Get user profile
    const infoRes  = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    const info = await infoRes.json();

    const user  = findOrCreateOAuthUser('google', info.id, {
      email:     info.email,
      name:      info.name,
      avatarUrl: info.picture,
    });
    const token = makeToken(user);
    res.redirect(`/oauth.html?token=${token}`);
  } catch (err) {
    console.error('[oauth]', err.message); oauthError(res, 'Erro ao autenticar. Tenta novamente mais tarde.');
  }
});

// ── GitHub ────────────────────────────────────────────────────────────────────

router.get('/github', (req, res) => {
  if (!OAUTH.GITHUB_CLIENT_ID) return res.status(501).json({ error: 'GitHub OAuth não configurado' });
  const state = jwt.sign({ p: 'github' }, JWT_SECRET, { expiresIn: '10m' });
  const params = new URLSearchParams({
    client_id:    OAUTH.GITHUB_CLIENT_ID,
    redirect_uri: OAUTH.GITHUB_REDIRECT,
    scope:        'read:user user:email',
    state,
  });
  res.redirect(`https://github.com/login/oauth/authorize?${params}`);
});

router.get('/github/callback', async (req, res) => {
  const { code, state, error } = req.query;
  if (error) return oauthError(res, error);
  try { jwt.verify(state, JWT_SECRET); } catch { return oauthError(res, 'Estado inválido'); }

  try {
    const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body:    JSON.stringify({
        client_id:     OAUTH.GITHUB_CLIENT_ID,
        client_secret: OAUTH.GITHUB_CLIENT_SECRET,
        code,
        redirect_uri:  OAUTH.GITHUB_REDIRECT,
      }),
    });
    const tokens = await tokenRes.json();
    if (tokens.error) return oauthError(res, tokens.error_description || tokens.error);

    const [infoRes, emailsRes] = await Promise.all([
      fetch('https://api.github.com/user', {
        headers: { Authorization: `Bearer ${tokens.access_token}`, 'User-Agent': 'ABolaM' },
      }),
      fetch('https://api.github.com/user/emails', {
        headers: { Authorization: `Bearer ${tokens.access_token}`, 'User-Agent': 'ABolaM' },
      }),
    ]);
    const info   = await infoRes.json();
    const emails = await emailsRes.json();
    const primaryEmail = (Array.isArray(emails) ? emails : [])
      .find(e => e.primary && e.verified)?.email || info.email;

    const user  = findOrCreateOAuthUser('github', String(info.id), {
      email:     primaryEmail,
      name:      info.name || info.login,
      avatarUrl: info.avatar_url,
    });
    res.redirect(`/oauth.html?token=${makeToken(user)}`);
  } catch (err) {
    console.error('[oauth]', err.message); oauthError(res, 'Erro ao autenticar. Tenta novamente mais tarde.');
  }
});

module.exports = router;
