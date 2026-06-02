const Database = require('better-sqlite3');
const path = require('path');

const db = new Database(path.join(__dirname, '..', 'abolamaya.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ── Schema version (increment when fixtures/columns change) ──────────────────
const SCHEMA_VERSION = 3;

db.exec(`
  CREATE TABLE IF NOT EXISTS schema_version (v INTEGER NOT NULL);

  CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    username      TEXT    UNIQUE NOT NULL,
    display_name  TEXT,
    email         TEXT    UNIQUE NOT NULL,
    password_hash TEXT    NOT NULL,
    is_admin      INTEGER DEFAULT 0,
    created_at    TEXT    DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS match_predictions (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id       INTEGER NOT NULL REFERENCES users(id)   ON DELETE CASCADE,
    match_id      INTEGER NOT NULL,
    home_score    INTEGER NOT NULL,
    away_score    INTEGER NOT NULL,
    points_earned INTEGER,
    created_at    TEXT DEFAULT (datetime('now')),
    updated_at    TEXT DEFAULT (datetime('now')),
    UNIQUE(user_id, match_id)
  );

  CREATE TABLE IF NOT EXISTS group_points (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    group_id        TEXT    NOT NULL,
    predicted_order TEXT    NOT NULL,
    actual_order    TEXT,
    points_earned   INTEGER DEFAULT 0,
    calculated_at   TEXT,
    UNIQUE(user_id, group_id)
  );

  CREATE TABLE IF NOT EXISTS lobbies (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT    NOT NULL,
    invite_code TEXT    UNIQUE NOT NULL,
    created_by  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at  TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS lobby_members (
    lobby_id  INTEGER NOT NULL REFERENCES lobbies(id) ON DELETE CASCADE,
    user_id   INTEGER NOT NULL REFERENCES users(id)   ON DELETE CASCADE,
    joined_at TEXT DEFAULT (datetime('now')),
    PRIMARY KEY (lobby_id, user_id)
  );
`);

// ── Migrate matches table when version changes ───────────────────────────────
const currentVersion = (db.prepare('SELECT v FROM schema_version').get() || {}).v || 0;

if (currentVersion < SCHEMA_VERSION) {
  db.exec('DROP TABLE IF EXISTS matches');
  db.exec(`
    CREATE TABLE matches (
      id         INTEGER PRIMARY KEY,
      group_id   TEXT    NOT NULL,
      home_team  TEXT    NOT NULL,
      away_team  TEXT    NOT NULL,
      home_flag  TEXT    NOT NULL,
      away_flag  TEXT    NOT NULL,
      match_date TEXT    NOT NULL,  -- PT local date (YYYY-MM-DD)
      match_time TEXT    NOT NULL,  -- PT local time (HH:MM)
      venue      TEXT    NOT NULL,
      home_score INTEGER,
      away_score INTEGER,
      status     TEXT    DEFAULT 'scheduled'
    );
  `);

  // All dates and times are in Portuguese local time (WEST = UTC+1 in June)
  // Format: [id, group, home, away, home_flag, away_flag, date, time, venue]
  const fixtures = [
    // ── GROUP A ──────────────────────────────────────────────────────────────
    [1, 'A','Mexico','South Africa','🇲🇽','🇿🇦','2026-06-11','20:00','Estadio Azteca, Mexico City'],
    [2, 'A','Korea Republic','Czechia','🇰🇷','🇨🇿','2026-06-12','03:00','Estadio Akron, Guadalajara'],
    [3, 'A','Czechia','South Africa','🇨🇿','🇿🇦','2026-06-18','17:00','Mercedes-Benz Stadium, Atlanta'],
    [4, 'A','Mexico','Korea Republic','🇲🇽','🇰🇷','2026-06-19','02:00','Estadio Akron, Guadalajara'],
    [5, 'A','Czechia','Mexico','🇨🇿','🇲🇽','2026-06-25','02:00','Estadio Azteca, Mexico City'],
    [6, 'A','South Africa','Korea Republic','🇿🇦','🇰🇷','2026-06-25','02:00','Estadio BBVA, Monterrey'],
    // ── GROUP B ──────────────────────────────────────────────────────────────
    [7, 'B','Canada','Bosnia and Herzegovina','🇨🇦','🇧🇦','2026-06-12','20:00','BMO Field, Toronto'],
    [8, 'B','Qatar','Switzerland','🇶🇦','🇨🇭','2026-06-13','20:00',"Levi's Stadium, San Francisco"],
    [9, 'B','Switzerland','Bosnia and Herzegovina','🇨🇭','🇧🇦','2026-06-18','20:00','SoFi Stadium, Los Angeles'],
    [10,'B','Canada','Qatar','🇨🇦','🇶🇦','2026-06-18','23:00','BC Place, Vancouver'],
    [11,'B','Switzerland','Canada','🇨🇭','🇨🇦','2026-06-24','20:00','BC Place, Vancouver'],
    [12,'B','Bosnia and Herzegovina','Qatar','🇧🇦','🇶🇦','2026-06-24','20:00','Lumen Field, Seattle'],
    // ── GROUP C ──────────────────────────────────────────────────────────────
    [13,'C','Brazil','Morocco','🇧🇷','🇲🇦','2026-06-13','23:00','MetLife Stadium, New York/New Jersey'],
    [14,'C','Haiti','Scotland','🇭🇹','🏴󠁧󠁢󠁳󠁣󠁴󠁿','2026-06-14','02:00','Gillette Stadium, Boston'],
    [15,'C','Scotland','Morocco','🏴󠁧󠁢󠁳󠁣󠁴󠁿','🇲🇦','2026-06-19','23:00','Gillette Stadium, Boston'],
    [16,'C','Brazil','Haiti','🇧🇷','🇭🇹','2026-06-20','01:30','Lincoln Financial Field, Philadelphia'],
    [17,'C','Scotland','Brazil','🏴󠁧󠁢󠁳󠁣󠁴󠁿','🇧🇷','2026-06-24','23:00','Hard Rock Stadium, Miami'],
    [18,'C','Morocco','Haiti','🇲🇦','🇭🇹','2026-06-24','23:00','Mercedes-Benz Stadium, Atlanta'],
    // ── GROUP D ──────────────────────────────────────────────────────────────
    [19,'D','USA','Paraguay','🇺🇸','🇵🇾','2026-06-13','02:00','SoFi Stadium, Los Angeles'],
    [20,'D','Australia','Türkiye','🇦🇺','🇹🇷','2026-06-14','05:00','BC Place, Vancouver'],
    [21,'D','USA','Australia','🇺🇸','🇦🇺','2026-06-19','20:00','Lumen Field, Seattle'],
    [22,'D','Türkiye','Paraguay','🇹🇷','🇵🇾','2026-06-20','04:00',"Levi's Stadium, San Francisco"],
    [23,'D','Türkiye','USA','🇹🇷','🇺🇸','2026-06-26','03:00','SoFi Stadium, Los Angeles'],
    [24,'D','Paraguay','Australia','🇵🇾','🇦🇺','2026-06-26','03:00',"Levi's Stadium, San Francisco"],
    // ── GROUP E ──────────────────────────────────────────────────────────────
    [25,'E','Germany','Curaçao','🇩🇪','🇨🇼','2026-06-14','18:00','NRG Stadium, Houston'],
    [26,'E',"Côte d'Ivoire",'Ecuador','🇨🇮','🇪🇨','2026-06-15','00:00','Lincoln Financial Field, Philadelphia'],
    [27,'E','Germany',"Côte d'Ivoire",'🇩🇪','🇨🇮','2026-06-20','21:00','BMO Field, Toronto'],
    [28,'E','Ecuador','Curaçao','🇪🇨','🇨🇼','2026-06-21','01:00','Arrowhead Stadium, Kansas City'],
    [29,'E','Ecuador','Germany','🇪🇨','🇩🇪','2026-06-25','21:00','MetLife Stadium, New York/New Jersey'],
    [30,'E','Curaçao',"Côte d'Ivoire",'🇨🇼','🇨🇮','2026-06-25','21:00','Lincoln Financial Field, Philadelphia'],
    // ── GROUP F ──────────────────────────────────────────────────────────────
    [31,'F','Netherlands','Japan','🇳🇱','🇯🇵','2026-06-14','21:00','AT&T Stadium, Dallas'],
    [32,'F','Sweden','Tunisia','🇸🇪','🇹🇳','2026-06-15','03:00','Estadio BBVA, Monterrey'],
    [33,'F','Netherlands','Sweden','🇳🇱','🇸🇪','2026-06-20','18:00','NRG Stadium, Houston'],
    [34,'F','Tunisia','Japan','🇹🇳','🇯🇵','2026-06-21','05:00','Estadio BBVA, Monterrey'],
    [35,'F','Japan','Sweden','🇯🇵','🇸🇪','2026-06-26','00:00','AT&T Stadium, Dallas'],
    [36,'F','Tunisia','Netherlands','🇹🇳','🇳🇱','2026-06-26','00:00','Arrowhead Stadium, Kansas City'],
    // ── GROUP G ──────────────────────────────────────────────────────────────
    [37,'G','Belgium','Egypt','🇧🇪','🇪🇬','2026-06-15','20:00','Lumen Field, Seattle'],
    [38,'G','IR Iran','New Zealand','🇮🇷','🇳🇿','2026-06-16','02:00','SoFi Stadium, Los Angeles'],
    [39,'G','Belgium','IR Iran','🇧🇪','🇮🇷','2026-06-21','20:00','SoFi Stadium, Los Angeles'],
    [40,'G','New Zealand','Egypt','🇳🇿','🇪🇬','2026-06-22','02:00','BC Place, Vancouver'],
    [41,'G','Egypt','IR Iran','🇪🇬','🇮🇷','2026-06-27','04:00','Lumen Field, Seattle'],
    [42,'G','New Zealand','Belgium','🇳🇿','🇧🇪','2026-06-27','04:00','BC Place, Vancouver'],
    // ── GROUP H ──────────────────────────────────────────────────────────────
    [43,'H','Spain','Cabo Verde','🇪🇸','🇨🇻','2026-06-15','17:00','Mercedes-Benz Stadium, Atlanta'],
    [44,'H','Saudi Arabia','Uruguay','🇸🇦','🇺🇾','2026-06-15','23:00','Hard Rock Stadium, Miami'],
    [45,'H','Spain','Saudi Arabia','🇪🇸','🇸🇦','2026-06-21','17:00','Mercedes-Benz Stadium, Atlanta'],
    [46,'H','Uruguay','Cabo Verde','🇺🇾','🇨🇻','2026-06-21','23:00','Hard Rock Stadium, Miami'],
    [47,'H','Cabo Verde','Saudi Arabia','🇨🇻','🇸🇦','2026-06-27','01:00','NRG Stadium, Houston'],
    [48,'H','Uruguay','Spain','🇺🇾','🇪🇸','2026-06-27','01:00','Estadio Akron, Guadalajara'],
    // ── GROUP I ──────────────────────────────────────────────────────────────
    [49,'I','France','Senegal','🇫🇷','🇸🇳','2026-06-16','20:00','MetLife Stadium, New York/New Jersey'],
    [50,'I','Iraq','Norway','🇮🇶','🇳🇴','2026-06-16','23:00','Gillette Stadium, Boston'],
    [51,'I','France','Iraq','🇫🇷','🇮🇶','2026-06-22','22:00','Lincoln Financial Field, Philadelphia'],
    [52,'I','Norway','Senegal','🇳🇴','🇸🇳','2026-06-23','01:00','MetLife Stadium, New York/New Jersey'],
    [53,'I','Norway','France','🇳🇴','🇫🇷','2026-06-26','20:00','Gillette Stadium, Boston'],
    [54,'I','Senegal','Iraq','🇸🇳','🇮🇶','2026-06-26','20:00','BMO Field, Toronto'],
    // ── GROUP J ──────────────────────────────────────────────────────────────
    [55,'J','Argentina','Algeria','🇦🇷','🇩🇿','2026-06-17','02:00','Arrowhead Stadium, Kansas City'],
    [56,'J','Austria','Jordan','🇦🇹','🇯🇴','2026-06-17','05:00',"Levi's Stadium, San Francisco"],
    [57,'J','Argentina','Austria','🇦🇷','🇦🇹','2026-06-22','18:00','AT&T Stadium, Dallas'],
    [58,'J','Jordan','Algeria','🇯🇴','🇩🇿','2026-06-23','04:00',"Levi's Stadium, San Francisco"],
    [59,'J','Algeria','Austria','🇩🇿','🇦🇹','2026-06-28','03:00','Arrowhead Stadium, Kansas City'],
    [60,'J','Jordan','Argentina','🇯🇴','🇦🇷','2026-06-28','03:00','AT&T Stadium, Dallas'],
    // ── GROUP K ──────────────────────────────────────────────────────────────
    [61,'K','Portugal','Congo DR','🇵🇹','🇨🇩','2026-06-17','18:00','NRG Stadium, Houston'],
    [62,'K','Uzbekistan','Colombia','🇺🇿','🇨🇴','2026-06-18','03:00','Estadio Azteca, Mexico City'],
    [63,'K','Portugal','Uzbekistan','🇵🇹','🇺🇿','2026-06-23','18:00','NRG Stadium, Houston'],
    [64,'K','Colombia','Congo DR','🇨🇴','🇨🇩','2026-06-24','03:00','Estadio Akron, Guadalajara'],
    [65,'K','Colombia','Portugal','🇨🇴','🇵🇹','2026-06-28','00:30','Hard Rock Stadium, Miami'],
    [66,'K','Congo DR','Uzbekistan','🇨🇩','🇺🇿','2026-06-28','00:30','Mercedes-Benz Stadium, Atlanta'],
    // ── GROUP L ──────────────────────────────────────────────────────────────
    [67,'L','England','Croatia','🏴󠁧󠁢󠁥󠁮󠁧󠁿','🇭🇷','2026-06-17','21:00','AT&T Stadium, Dallas'],
    [68,'L','Ghana','Panama','🇬🇭','🇵🇦','2026-06-18','00:00','BMO Field, Toronto'],
    [69,'L','England','Ghana','🏴󠁧󠁢󠁥󠁮󠁧󠁿','🇬🇭','2026-06-23','21:00','Gillette Stadium, Boston'],
    [70,'L','Panama','Croatia','🇵🇦','🇭🇷','2026-06-24','00:00','BMO Field, Toronto'],
    [71,'L','Panama','England','🇵🇦','🏴󠁧󠁢󠁥󠁮󠁧󠁿','2026-06-27','22:00','MetLife Stadium, New York/New Jersey'],
    [72,'L','Croatia','Ghana','🇭🇷','🇬🇭','2026-06-27','22:00','Lincoln Financial Field, Philadelphia'],
  ];

  const ins = db.prepare(
    'INSERT INTO matches (id,group_id,home_team,away_team,home_flag,away_flag,match_date,match_time,venue) VALUES (?,?,?,?,?,?,?,?,?)'
  );
  db.transaction(() => fixtures.forEach(f => ins.run(...f)))();

  db.prepare('DELETE FROM schema_version').run();
  db.prepare('INSERT INTO schema_version VALUES (?)').run(SCHEMA_VERSION);
  console.log(`✅ Base de dados v${SCHEMA_VERSION}: 72 jogos inseridos.`);
}

module.exports = db;
