const Database = require('better-sqlite3');
const path     = require('path');

const srcPath  = path.resolve(__dirname, '..', 'abolamaya.db');
const destPath = path.resolve(process.env.DB_PATH || path.join(__dirname, '..', 'abolamaya.db'));

if (srcPath === destPath) {
  console.error('❌  Source and destination are the same file — set DB_PATH to the production DB path.');
  process.exit(1);
}

console.log(`Source : ${srcPath}`);
console.log(`Dest   : ${destPath}`);

const src  = new Database(srcPath,  { readonly: true });
const dest = new Database(destPath);

const rows = src.prepare('SELECT * FROM player_national_stats').all();
console.log(`Rows to import: ${rows.length}`);

if (!rows.length) {
  console.log('Nothing to import.');
  src.close();
  dest.close();
  process.exit(0);
}

const cols    = Object.keys(rows[0]);
const placeholders = cols.map(() => '?').join(', ');
const insert  = dest.prepare(
  `INSERT OR REPLACE INTO player_national_stats (${cols.join(', ')}) VALUES (${placeholders})`
);

dest.transaction(() => {
  dest.prepare('DELETE FROM player_national_stats').run();
  for (const row of rows) insert.run(...cols.map(c => row[c]));
})();

console.log(`✅  Imported ${rows.length} rows into player_national_stats.`);

src.close();
dest.close();
