const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'abolamaya-message-'));
process.env.DB_PATH = path.join(tempDir, 'message.db');

const db = require('../server/db');
const { sendUserMessage } = require('./message-user');

try {
  const user = db.prepare(`
    INSERT INTO users (username, email, password_hash)
    VALUES ('message_test', 'message-test@example.com', 'not-used')
  `).run();

  const sent = sendUserMessage('@MESSAGE_TEST', 'A tua previsao foi anulada. Brincadeira.');
  assert.equal(sent.username, 'message_test');

  const notification = db.prepare(`
    SELECT user_id, type, title, body, read
    FROM notifications
    WHERE id = ?
  `).get(sent.notificationId);

  assert.deepEqual(notification, {
    user_id: Number(user.lastInsertRowid),
    type: 'admin_message',
    title: 'Mensagem do 67Machine',
    body: 'A tua previsao foi anulada. Brincadeira.',
    read: 0,
  });
  assert.throws(() => sendUserMessage('missing_user', 'Ola'), /nao encontrado/);

  console.log('Targeted user message test passed.');
} finally {
  db.close();
  fs.rmSync(tempDir, { recursive: true, force: true });
}
