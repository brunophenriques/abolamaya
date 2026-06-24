const db = require('../server/db');

function sendUserMessage(username, message) {
  const normalizedUsername = String(username || '').trim().replace(/^@/, '');
  const normalizedMessage = String(message || '').trim();

  if (!normalizedUsername) throw new Error('Indica o username do destinatario.');
  if (!normalizedMessage) throw new Error('Indica a mensagem.');
  if (normalizedMessage.length > 500) throw new Error('A mensagem nao pode exceder 500 caracteres.');

  const user = db.prepare(
    'SELECT id, username FROM users WHERE username = ? COLLATE NOCASE'
  ).get(normalizedUsername);
  if (!user) throw new Error(`Utilizador "${normalizedUsername}" nao encontrado.`);

  const result = db.prepare(`
    INSERT INTO notifications (user_id, type, title, body)
    VALUES (?, 'admin_message', 'Mensagem do 67Machine', ?)
  `).run(user.id, normalizedMessage);

  return { notificationId: result.lastInsertRowid, username: user.username };
}

if (require.main === module) {
  const [username, ...messageParts] = process.argv.slice(2);

  try {
    const result = sendUserMessage(username, messageParts.join(' '));
    console.log(`Mensagem enviada para @${result.username} (notificacao #${result.notificationId}).`);
  } catch (error) {
    console.error(`Erro: ${error.message}`);
    console.error('Uso: npm run message-user -- <username> "<mensagem>"');
    process.exitCode = 1;
  }
}

module.exports = { sendUserMessage };
