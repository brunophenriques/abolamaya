// Tornar um utilizador admin
// Uso: npm run make-admin -- <username>
const db = require('../server/db');
const username = process.argv[2];
if (!username) { console.error('Uso: npm run make-admin -- <username>'); process.exit(1); }
const r = db.prepare('UPDATE users SET is_admin=1 WHERE username=?').run(username.toLowerCase());
if (r.changes === 0) { console.error(`Utilizador "${username}" não encontrado.`); process.exit(1); }
console.log(`✅ ${username} é agora admin.`);
