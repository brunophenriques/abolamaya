const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const Database = require('better-sqlite3');
const { chromium } = require('playwright');

const rootDir = path.resolve(__dirname, '..');
const port = 33500 + (process.pid % 1000);
const baseUrl = `http://127.0.0.1:${port}`;
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'abolamaya-points-'));
const dbPath = path.join(tempDir, 'test.db');
let output = '';

const server = spawn(process.execPath, ['server/index.js'], {
  cwd: rootDir,
  env: {
    ...process.env,
    PORT: String(port),
    DB_PATH: dbPath,
    SKIP_STARTUP_SCRAPE: 'true',
    JWT_SECRET: 'point-predictions-test-secret-with-32-characters',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
  windowsHide: true,
});
server.stdout.on('data', chunk => { output += chunk; });
server.stderr.on('data', chunk => { output += chunk; });

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

async function api(method, url, { token, body } = {}) {
  const response = await fetch(baseUrl + url, {
    method,
    redirect: 'manual',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : {};
  return { response, data };
}

async function waitForServer() {
  for (let i = 0; i < 60; i += 1) {
    if (server.exitCode !== null) throw new Error(`Server exited early.\n${output}`);
    try {
      const { response } = await api('GET', '/api/point-predictions/status');
      if (response.status === 200) return;
    } catch {}
    await wait(100);
  }
  throw new Error(`Server startup timeout.\n${output}`);
}

async function register(name) {
  const { response, data } = await api('POST', '/api/auth/register', {
    body: {
      username: name,
      display_name: name,
      email: `${name}@example.com`,
      password: 'secret12',
    },
  });
  assert.strictEqual(response.status, 200, JSON.stringify(data));
  return data;
}

async function setAdmin(username) {
  const db = new Database(dbPath);
  db.prepare('UPDATE users SET is_admin=1 WHERE username=?').run(username);
  db.close();
}

async function setBalance(username, balance) {
  const db = new Database(dbPath);
  db.prepare('UPDATE users SET points_balance=? WHERE username=?').run(balance, username);
  db.close();
}

async function getBalance(username) {
  const db = new Database(dbPath, { readonly: true });
  const balance = db.prepare('SELECT points_balance FROM users WHERE username=?').get(username).points_balance;
  db.close();
  return balance;
}

async function createPrediction(adminToken, question) {
  const { response, data } = await api('POST', '/api/admin/point-predictions', {
    token: adminToken,
    body: {
      question,
      category: 'match',
      status: 'open',
      closes_at: new Date(Date.now() + 3600000).toISOString(),
    },
  });
  assert.strictEqual(response.status, 201, JSON.stringify(data));
  return data;
}

async function run() {
  await waitForServer();

  let result = await api('GET', '/api/point-predictions/status');
  assert.strictEqual(result.data.enabled, false);
  assert.strictEqual(result.data.community_vote_open, false);
  assert.strictEqual(result.data.should_prompt, false);

  result = await api('POST', '/api/point-predictions/1/vote', { body: { choice: 'yes' } });
  assert.strictEqual(result.response.status, 401);

  const admin = await register('pointsadmin');
  const alice = await register('pointsalice');
  const bob = await register('pointsbob');
  const carol = await register('pointscarol');
  const empty = await register('pointsempty');
  await setAdmin(admin.user.username);

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto(baseUrl);
  await page.evaluate(token => localStorage.setItem('abm_token', token), alice.token);
  await page.goto(`${baseUrl}/dashboard`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(200);
  assert.strictEqual(await page.locator('#pointCommunityVote').count(), 0);

  result = await api('GET', '/api/admin/point-predictions/dashboard', { token: alice.token });
  assert.strictEqual(result.response.status, 403);

  result = await api('PATCH', '/api/admin/point-predictions/settings', {
    token: admin.token,
    body: { community_vote_open: true },
  });
  assert.strictEqual(result.response.status, 200);

  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(200);
  assert.strictEqual(await page.locator('#pointCommunityVote').count(), 1);
  await browser.close();

  result = await api('GET', '/api/point-predictions/status', { token: alice.token });
  assert.strictEqual(result.data.should_prompt, true);
  result = await api('POST', '/api/point-predictions/community-vote', {
    token: alice.token,
    body: { choice: 'later' },
  });
  assert.strictEqual(result.response.status, 200);
  result = await api('GET', '/api/point-predictions/status', { token: alice.token });
  assert.strictEqual(result.data.should_prompt, true);
  result = await api('POST', '/api/point-predictions/community-vote', {
    token: alice.token,
    body: { choice: 'yes' },
  });
  assert.strictEqual(result.response.status, 200);
  result = await api('GET', '/api/point-predictions/status', { token: alice.token });
  assert.strictEqual(result.data.should_prompt, false);

  result = await api('PATCH', '/api/admin/point-predictions/settings', {
    token: admin.token,
    body: { enabled: true },
  });
  assert.strictEqual(result.response.status, 200);

  const editable = await createPrediction(admin.token, 'Teste de voto editável?');
  await setBalance(empty.user.username, 0);
  result = await api('POST', `/api/point-predictions/${editable.id}/vote`, {
    token: empty.token,
    body: { choice: 'yes' },
  });
  assert.strictEqual(result.response.status, 409);

  const aliceStart = await getBalance(alice.user.username);
  result = await api('POST', `/api/point-predictions/${editable.id}/vote`, {
    token: alice.token,
    body: { choice: 'yes' },
  });
  assert.strictEqual(result.response.status, 200);
  assert.strictEqual(await getBalance(alice.user.username), aliceStart - 1);
  result = await api('POST', `/api/point-predictions/${editable.id}/vote`, {
    token: alice.token,
    body: { choice: 'no' },
  });
  assert.strictEqual(result.response.status, 200);
  assert.strictEqual(await getBalance(alice.user.username), aliceStart - 1);
  result = await api('DELETE', `/api/point-predictions/${editable.id}/vote`, { token: alice.token });
  assert.strictEqual(result.response.status, 200);
  assert.strictEqual(await getBalance(alice.user.username), aliceStart);

  const expired = await createPrediction(admin.token, 'Teste de deadline?');
  const db = new Database(dbPath);
  db.prepare("UPDATE point_predictions SET closes_at=datetime('now','-1 minute') WHERE id=?").run(expired.id);
  db.close();
  result = await api('POST', `/api/point-predictions/${expired.id}/vote`, {
    token: alice.token,
    body: { choice: 'yes' },
  });
  assert.strictEqual(result.response.status, 409);

  const payout = await createPrediction(admin.token, 'Teste de payout ceil?');
  for (const [token, choice] of [[alice.token,'yes'], [bob.token,'yes'], [carol.token,'no']]) {
    result = await api('POST', `/api/point-predictions/${payout.id}/vote`, { token, body: { choice } });
    assert.strictEqual(result.response.status, 200);
  }
  result = await api('POST', `/api/admin/point-predictions/${payout.id}/resolve`, {
    token: admin.token,
    body: { result: 'yes' },
  });
  assert.strictEqual(result.response.status, 200);
  assert.strictEqual(result.data.pool_total, 3);
  assert.strictEqual(result.data.winner_count, 2);
  assert.strictEqual(result.data.payout_per_winner, 2);
  assert.strictEqual(result.data.total_paid, 4);
  assert.strictEqual(result.data.inflation, 1);
  result = await api('POST', `/api/admin/point-predictions/${payout.id}/resolve`, {
    token: admin.token,
    body: { result: 'yes' },
  });
  assert.strictEqual(result.response.status, 409);

  const voided = await createPrediction(admin.token, 'Teste de anulação?');
  const bobBeforeVoid = await getBalance(bob.user.username);
  result = await api('POST', `/api/point-predictions/${voided.id}/vote`, {
    token: bob.token,
    body: { choice: 'no' },
  });
  assert.strictEqual(result.response.status, 200);
  result = await api('POST', `/api/admin/point-predictions/${voided.id}/resolve`, {
    token: admin.token,
    body: { result: 'void' },
  });
  assert.strictEqual(result.response.status, 200);
  assert.strictEqual(await getBalance(bob.user.username), bobBeforeVoid);

  console.log('Point predictions integration OK: defaults, auth, voting, deadline, payout, void, idempotency.');
}

async function cleanup() {
  if (server.exitCode === null && server.signalCode === null) {
    const closed = new Promise(resolve => server.once('close', resolve));
    server.kill();
    await closed;
  }
  fs.rmSync(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}

run()
  .catch(error => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  })
  .finally(cleanup)
  .catch(error => {
    console.error(`Cleanup failed: ${error.message}`);
    process.exitCode = 1;
  });
