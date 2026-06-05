const Database = require('better-sqlite3');
const path     = require('path');
const fs       = require('fs');

const srcPath  = path.resolve(__dirname, '..', 'abolamaya.db');
const outPath  = path.resolve(__dirname, '..', 'data', 'player_national_stats_export.json');

const db   = new Database(srcPath, { readonly: true });
const rows = db.prepare('SELECT * FROM player_national_stats').all();
db.close();

fs.writeFileSync(outPath, JSON.stringify(rows, null, 2), 'utf8');
console.log(`✅  Exported ${rows.length} rows → ${outPath}`);
