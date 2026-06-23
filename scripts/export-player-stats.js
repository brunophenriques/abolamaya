const Database = require('better-sqlite3');
const path     = require('path');
const fs       = require('fs');
const { DATA_DIR, ROOT_DIR } = require('../server/paths');

const srcPath  = path.join(ROOT_DIR, 'abolamaya.db');
const outPath  = path.join(DATA_DIR, 'player_national_stats_export.json');

const db   = new Database(srcPath, { readonly: true });
const rows = db.prepare('SELECT * FROM player_national_stats').all();
db.close();

fs.writeFileSync(outPath, JSON.stringify(rows, null, 2), 'utf8');
console.log(`✅  Exported ${rows.length} rows → ${outPath}`);
