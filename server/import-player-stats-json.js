const Database = require('better-sqlite3');
const path     = require('path');
const fs       = require('fs');

const destPath = path.resolve(process.env.DB_PATH || path.join(__dirname, '..', 'abolamaya.db'));
const srcPath  = path.resolve(__dirname, '..', 'data', 'player_national_stats_export.json');

if (!fs.existsSync(srcPath)) {
  console.error(`❌  Export file not found: ${srcPath}`);
  console.error('    Run npm run export:player-stats first.');
  process.exit(1);
}

const rows = JSON.parse(fs.readFileSync(srcPath, 'utf8'));
console.log(`Source : ${srcPath} (${rows.length} rows)`);
console.log(`Dest   : ${destPath}`);

if (!rows.length) {
  console.log('Nothing to import.');
  process.exit(0);
}

const db   = new Database(destPath);
const cols = Object.keys(rows[0]);
const insert = db.prepare(
  `INSERT OR REPLACE INTO player_national_stats (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`
);

db.transaction(() => {
  db.prepare('DELETE FROM player_national_stats').run();
  for (const row of rows) insert.run(...cols.map(c => row[c]));
})();

db.close();
console.log(`✅  Imported ${rows.length} rows into player_national_stats.`);
