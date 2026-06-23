const path = require('path');

const ROOT_DIR = path.resolve(__dirname, '..');
const PUBLIC_DIR = path.join(ROOT_DIR, 'public');
const DATA_DIR = path.join(ROOT_DIR, 'data');

module.exports = {
  ROOT_DIR,
  PUBLIC_DIR,
  DATA_DIR,
  DATABASE_PATH: path.resolve(process.env.DB_PATH || path.join(ROOT_DIR, 'abolamaya.db')),
  AVATARS_DIR: path.resolve(process.env.AVATARS_DIR || path.join(PUBLIC_DIR, 'img', 'avatars')),
  DEBUG_SCREENSHOTS_DIR: path.join(ROOT_DIR, 'debug-screenshots'),
};
