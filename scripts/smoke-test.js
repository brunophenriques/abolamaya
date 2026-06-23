const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const rootDir = path.resolve(__dirname, '..');
const port = 32000 + (process.pid % 1000);
const baseUrl = `http://127.0.0.1:${port}`;
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'abolamaya-smoke-'));
const dbPath = path.join(tempDir, 'smoke.db');
let output = '';

const server = spawn(process.execPath, ['server/index.js'], {
  cwd: rootDir,
  env: {
    ...process.env,
    PORT: String(port),
    DB_PATH: dbPath,
    SKIP_STARTUP_SCRAPE: 'true',
    JWT_SECRET: process.env.JWT_SECRET || 'smoke-test-secret-with-at-least-32-characters',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
  windowsHide: true,
});

server.stdout.on('data', chunk => { output += chunk; });
server.stderr.on('data', chunk => { output += chunk; });

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

async function request(url, options = {}) {
  return fetch(baseUrl + url, { redirect: 'manual', ...options });
}

async function waitForServer() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (server.exitCode !== null) {
      throw new Error(`Server exited before the test started.\n${output}`);
    }
    try {
      const response = await request('/api/matches');
      if (response.status === 200) return;
    } catch {}
    await wait(100);
  }
  throw new Error(`Timed out while starting the server.\n${output}`);
}

async function expectStatus(url, expectedStatus) {
  const response = await request(url);
  assert.strictEqual(response.status, expectedStatus, `${url} returned ${response.status}`);
  return response;
}

async function run() {
  await waitForServer();

  const pages = [
    '/', '/dashboard', '/predict', '/leaderboard', '/lobby', '/admin',
    '/helper', '/settings', '/support', '/about', '/information', '/terms',
    '/profile', '/team', '/point-predictions', '/reset-password', '/forgot-password', '/404',
  ];
  for (const page of pages) await expectStatus(page, 200);

  await expectStatus('/oauth.html', 200);
  await expectStatus('/css/style.css', 200);
  await expectStatus('/js/api.js', 200);
  await expectStatus('/img/logo.png', 200);
  await expectStatus('/data/squads/portugal.json', 200);
  await expectStatus('/favicon.ico', 200);
  await expectStatus('/api/matches', 200);

  const redirect = await expectStatus('/profile.html?u=test', 301);
  assert.strictEqual(redirect.headers.get('location'), '/profile?u=test');

  const missingApi = await expectStatus('/api/does-not-exist', 404);
  assert.match(missingApi.headers.get('content-type') || '', /application\/json/);

  await expectStatus('/server/index.js', 404);
  await expectStatus('/package.json', 404);
  await expectStatus('/.env', 404);

  console.log(`Smoke test OK: ${pages.length} pages, assets, API, redirects, and private files.`);
}

async function cleanup() {
  if (server.exitCode === null && server.signalCode === null) {
    const closed = new Promise(resolve => server.once('close', resolve));
    server.kill();
    await closed;
  }
  fs.rmSync(tempDir, {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 100,
  });
}

run()
  .catch(error => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  })
  .finally(cleanup)
  .catch(error => {
    console.error(`Smoke test cleanup failed: ${error.message}`);
    process.exitCode = 1;
  });
