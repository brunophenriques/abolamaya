const Database = require('better-sqlite3');
const { DATABASE_PATH } = require('./paths');
const { knockoutWinnerFromScore, scorePrediction } = require('./knockout');

const db = new Database(DATABASE_PATH);
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

  CREATE TABLE IF NOT EXISTS team_results (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    team_code        TEXT    NOT NULL,
    team_name        TEXT    NOT NULL,
    match_date       TEXT    NOT NULL,
    competition      TEXT    DEFAULT '',
    home_team        TEXT    NOT NULL,
    away_team        TEXT    NOT NULL,
    home_score       INTEGER NOT NULL,
    away_score       INTEGER NOT NULL,
    result_for_team  TEXT    NOT NULL,
    soccerway_url    TEXT    DEFAULT '',
    scraped_at       TEXT    NOT NULL,
    UNIQUE(team_code, match_date, home_team, away_team)
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

// Non-breaking column/table additions — idempotent
try { db.exec(`ALTER TABLE team_results ADD COLUMN team_is_home INTEGER`); } catch {}
try { db.exec(`ALTER TABLE users ADD COLUMN bio TEXT`); } catch {}
try { db.exec(`ALTER TABLE users ADD COLUMN avatar_color TEXT`); } catch {}
try { db.exec(`ALTER TABLE users ADD COLUMN avatar_url TEXT`); } catch {}
try { db.exec(`ALTER TABLE users ADD COLUMN profile_public INTEGER DEFAULT 1`); } catch {}
try { db.exec(`ALTER TABLE users ADD COLUMN history_public INTEGER DEFAULT 1`); } catch {}
try { db.exec(`ALTER TABLE users ADD COLUMN banned INTEGER DEFAULT 0`); } catch {}
try { db.exec(`ALTER TABLE users ADD COLUMN is_helper INTEGER DEFAULT 0`); } catch {}
try { db.exec(`ALTER TABLE matches ADD COLUMN stage TEXT DEFAULT 'group'`); } catch {}
try { db.exec(`ALTER TABLE matches ADD COLUMN bracket_slot TEXT`); } catch {}
try { db.exec(`ALTER TABLE matches ADD COLUMN next_match_id INTEGER`); } catch {}
try { db.exec(`ALTER TABLE matches ADD COLUMN next_slot TEXT`); } catch {}
try { db.exec(`ALTER TABLE matches ADD COLUMN winner_team TEXT`); } catch {}
try { db.exec(`ALTER TABLE match_predictions ADD COLUMN predicted_winner TEXT`); } catch {}
try { db.exec(`ALTER TABLE settlement_log ADD COLUMN winner_team TEXT`); } catch {}

const knockoutFixtures = [
  [73, 'South Africa', 'Canada', '🇿🇦', '🇨🇦', '2026-06-28', '20:00', 'Los Angeles Stadium', 'R32-1', 90, 'home'],
  [74, 'Germany', 'Paraguay', '🇩🇪', '🇵🇾', '2026-06-29', '21:30', 'Boston Stadium', 'R32-2', 89, 'home'],
  [75, 'Netherlands', 'Morocco', '🇳🇱', '🇲🇦', '2026-06-30', '02:00', 'Estadio Monterrey', 'R32-3', 90, 'away'],
  [76, 'Brazil', 'Japan', '🇧🇷', '🇯🇵', '2026-06-29', '17:00', 'Houston Stadium', 'R32-4', 91, 'home'],
  [77, 'France', 'Sweden', '🇫🇷', '🇸🇪', '2026-06-30', '22:00', 'New York New Jersey Stadium', 'R32-5', 89, 'away'],
  [78, "Côte d'Ivoire", 'Norway', '🇨🇮', '🇳🇴', '2026-06-30', '20:00', 'Dallas Stadium', 'R32-6', 91, 'away'],
  [79, 'Mexico', '3.º Grupo C/E/F/H/I', '🇲🇽', '⬜', '2026-07-01', '03:00', 'Mexico City Stadium', 'R32-7', 92, 'home'],
  [80, '1.º Grupo L', '3.º Grupo E/H/I/J/K', '⬜', '⬜', '2026-07-01', '20:00', 'Atlanta Stadium', 'R32-8', 92, 'away'],
  [81, 'USA', 'Bosnia and Herzegovina', '🇺🇸', '🇧🇦', '2026-07-02', '01:00', 'San Francisco Bay Area Stadium', 'R32-9', 94, 'home'],
  [82, 'Belgium', '3.º Grupo A/E/H/I/J', '🇧🇪', '⬜', '2026-07-01', '21:00', 'Seattle Stadium', 'R32-10', 94, 'away'],
  [83, '2.º Grupo K', '2.º Grupo L', '⬜', '⬜', '2026-07-03', '00:00', 'Toronto Stadium', 'R32-11', 93, 'home'],
  [84, 'Spain', '2.º Grupo J', '🇪🇸', '⬜', '2026-07-02', '20:00', 'Los Angeles Stadium', 'R32-12', 93, 'away'],
  [85, 'Switzerland', '3.º Grupo E/F/G/I/J', '🇨🇭', '⬜', '2026-07-03', '02:00', 'BC Place Vancouver', 'R32-13', 96, 'home'],
  [86, 'Argentina', 'Cabo Verde', '🇦🇷', '🇨🇻', '2026-07-03', '20:00', 'Miami Stadium', 'R32-14', 95, 'home'],
  [87, '1.º Grupo K', '3.º Grupo D/E/I/J/L', '⬜', '⬜', '2026-07-03', '23:00', 'Kansas City Stadium', 'R32-15', 96, 'away'],
  [88, 'Australia', 'Egypt', '🇦🇺', '🇪🇬', '2026-07-03', '20:00', 'Dallas Stadium', 'R32-16', 95, 'away'],
  [89, 'W74', 'W77', '⬜', '⬜', '2026-07-04', '22:00', 'Round of 16', 'R16-1', 97, 'home'],
  [90, 'W73', 'W75', '⬜', '⬜', '2026-07-04', '18:00', 'Round of 16', 'R16-2', 97, 'away'],
  [91, 'W76', 'W78', '⬜', '⬜', '2026-07-05', '21:00', 'Round of 16', 'R16-3', 99, 'home'],
  [92, 'W79', 'W80', '⬜', '⬜', '2026-07-06', '01:00', 'Round of 16', 'R16-4', 99, 'away'],
  [93, 'W83', 'W84', '⬜', '⬜', '2026-07-06', '20:00', 'Round of 16', 'R16-5', 98, 'home'],
  [94, 'W81', 'W82', '⬜', '⬜', '2026-07-07', '00:00', 'Round of 16', 'R16-6', 98, 'away'],
  [95, 'W86', 'W88', '⬜', '⬜', '2026-07-07', '17:00', 'Round of 16', 'R16-7', 100, 'home'],
  [96, 'W85', 'W87', '⬜', '⬜', '2026-07-07', '21:00', 'Round of 16', 'R16-8', 100, 'away'],
  [97, 'W89', 'W90', '⬜', '⬜', '2026-07-09', '21:00', 'Quarter-final', 'QF-1', 101, 'home'],
  [98, 'W93', 'W94', '⬜', '⬜', '2026-07-10', '20:00', 'Quarter-final', 'QF-2', 101, 'away'],
  [99, 'W91', 'W92', '⬜', '⬜', '2026-07-11', '22:00', 'Quarter-final', 'QF-3', 102, 'home'],
  [100, 'W95', 'W96', '⬜', '⬜', '2026-07-12', '02:00', 'Quarter-final', 'QF-4', 102, 'away'],
  [101, 'W97', 'W98', '⬜', '⬜', '2026-07-14', '20:00', 'Semi-final', 'SF-1', 104, 'home'],
  [102, 'W99', 'W100', '⬜', '⬜', '2026-07-15', '20:00', 'Semi-final', 'SF-2', 104, 'away'],
  [103, 'RU101', 'RU102', '⬜', '⬜', '2026-07-18', '22:00', 'Play-off for third place', 'THIRD', null, null],
  [104, 'W101', 'W102', '⬜', '⬜', '2026-07-19', '20:00', 'Final', 'FINAL', null, null],
];

const insertKnockout = db.prepare(`
  INSERT OR IGNORE INTO matches
    (id, group_id, home_team, away_team, home_flag, away_flag, match_date, match_time, venue, stage, bracket_slot, next_match_id, next_slot)
  VALUES (?, 'KO', ?, ?, ?, ?, ?, ?, ?, 'round32', ?, ?, ?)
`);
db.transaction(() => knockoutFixtures.forEach(f => insertKnockout.run(...f)))();

db.exec(`
  CREATE TABLE IF NOT EXISTS user_oauth (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    provider    TEXT NOT NULL,
    provider_id TEXT NOT NULL,
    email       TEXT,
    created_at  TEXT DEFAULT (datetime('now')),
    UNIQUE(provider, provider_id)
  );

  CREATE TABLE IF NOT EXISTS user_achievements (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type       TEXT NOT NULL,
    earned_at  TEXT DEFAULT (datetime('now')),
    UNIQUE(user_id, type)
  );

  CREATE TABLE IF NOT EXISTS notifications (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type       TEXT NOT NULL,
    title      TEXT NOT NULL,
    body       TEXT,
    link       TEXT,
    read       INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
  );
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS friends (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    requester_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    addressee_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status       TEXT NOT NULL DEFAULT 'pending',
    created_at   TEXT DEFAULT (datetime('now')),
    updated_at   TEXT DEFAULT (datetime('now')),
    UNIQUE(requester_id, addressee_id),
    CHECK(requester_id != addressee_id)
  );

  CREATE TABLE IF NOT EXISTS settlement_log (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    match_id            INTEGER NOT NULL,
    settled_by          TEXT NOT NULL,
    home_score          INTEGER NOT NULL,
    away_score          INTEGER NOT NULL,
    predictions_scored  INTEGER DEFAULT 0,
    settled_at          TEXT DEFAULT (datetime('now'))
  );
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS player_national_stats (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    team_slug           TEXT NOT NULL,
    team_code           TEXT NOT NULL,
    player_name         TEXT NOT NULL,
    player_url          TEXT NOT NULL UNIQUE,
    soccerway_player_id TEXT,
    shirt_number        INTEGER,
    appearances         INTEGER,
    minutes             INTEGER,
    goals               INTEGER,
    assists             INTEGER,
    yellow_cards        INTEGER,
    red_cards           INTEGER,
    saves_pct           TEXT,
    clean_sheets        INTEGER,
    senior_stats        TEXT,
    scraped_at          TEXT NOT NULL
  )
`);
// Idempotent additions for existing installs
try { db.exec(`ALTER TABLE player_national_stats ADD COLUMN soccerway_player_id TEXT`); } catch {}
try { db.exec(`ALTER TABLE player_national_stats ADD COLUMN shirt_number INTEGER`); } catch {}
try { db.exec(`ALTER TABLE player_national_stats ADD COLUMN senior_stats TEXT`); } catch {}

db.exec(`
  CREATE TABLE IF NOT EXISTS password_reset_tokens (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash TEXT    NOT NULL UNIQUE,
    expires_at TEXT    NOT NULL,
    used_at    TEXT,
    created_at TEXT    DEFAULT (datetime('now'))
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS system_logs (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    category   TEXT NOT NULL,
    message    TEXT NOT NULL,
    severity   TEXT NOT NULL DEFAULT 'info',
    actor_id   INTEGER REFERENCES users(id) ON DELETE SET NULL,
    actor_name TEXT,
    metadata   TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_system_logs_created  ON system_logs(created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_system_logs_category ON system_logs(category);
  CREATE INDEX IF NOT EXISTS idx_system_logs_severity ON system_logs(severity);
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS tickets (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     INTEGER REFERENCES users(id) ON DELETE SET NULL,
    category    TEXT NOT NULL,
    title       TEXT NOT NULL,
    description TEXT NOT NULL,
    page_url    TEXT,
    reference   TEXT,
    status      TEXT NOT NULL DEFAULT 'open',
    created_at  TEXT DEFAULT (datetime('now')),
    updated_at  TEXT DEFAULT (datetime('now'))
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS rank_snapshots (
    user_id    INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    prev_rank  INTEGER NOT NULL,
    snapped_at TEXT DEFAULT (datetime('now'))
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS site_settings (
    key        TEXT PRIMARY KEY,
    value      TEXT NOT NULL,
    updated_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS prediction_feature_votes (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    choice     TEXT NOT NULL CHECK(choice IN ('yes','no','later')),
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS point_predictions (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    question          TEXT NOT NULL,
    category          TEXT NOT NULL DEFAULT 'other'
                      CHECK(category IN ('match','player','group','world_cup','other')),
    status            TEXT NOT NULL DEFAULT 'draft'
                      CHECK(status IN ('draft','open','locked','resolved','void')),
    closes_at         TEXT NOT NULL,
    result            TEXT CHECK(result IN ('yes','no') OR result IS NULL),
    created_by        INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at        TEXT DEFAULT (datetime('now')),
    updated_at        TEXT DEFAULT (datetime('now')),
    resolved_at       TEXT,
    pool_total        INTEGER,
    winner_count      INTEGER,
    payout_per_winner INTEGER,
    total_paid        INTEGER,
    inflation         INTEGER
  );

  CREATE TABLE IF NOT EXISTS point_prediction_votes (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    prediction_id INTEGER NOT NULL REFERENCES point_predictions(id) ON DELETE CASCADE,
    user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    choice        TEXT NOT NULL CHECK(choice IN ('yes','no')),
    created_at    TEXT DEFAULT (datetime('now')),
    updated_at    TEXT DEFAULT (datetime('now')),
    UNIQUE(prediction_id, user_id)
  );

  CREATE TABLE IF NOT EXISTS point_transactions (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    prediction_id INTEGER REFERENCES point_predictions(id) ON DELETE SET NULL,
    amount        INTEGER NOT NULL,
    type          TEXT NOT NULL
                  CHECK(type IN ('stake','payout','refund','admin_adjustment')),
    created_at    TEXT DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_point_predictions_status
    ON point_predictions(status, closes_at);
  CREATE INDEX IF NOT EXISTS idx_point_prediction_votes_prediction
    ON point_prediction_votes(prediction_id, choice);
  CREATE INDEX IF NOT EXISTS idx_point_transactions_user
    ON point_transactions(user_id, created_at DESC);
`);

[
  ['point_predictions_enabled', 'false'],
  ['prediction_community_vote_open', 'false'],
  ['point_predictions_beta_mode', 'false'],
].forEach(([key, value]) => {
  db.prepare('INSERT OR IGNORE INTO site_settings (key,value) VALUES (?,?)').run(key, value);
});

// Legacy cleanup: the first implementation used an artificial 10-point wallet.
// Real availability is now derived from match + group + community transaction points.
const legacyPointWallet = db.prepare(
  "SELECT 1 FROM site_settings WHERE key='point_predictions_initial_balance'"
).get();
if (legacyPointWallet) {
  try { db.prepare('UPDATE users SET points_balance=0').run(); } catch {}
  db.prepare("DELETE FROM site_settings WHERE key='point_predictions_initial_balance'").run();
}

// Migrate duplicate achievement types → canonical replacements, then delete old rows.
// first_prediction → primeiro_sangue, exact_score → nostradamus,
// perfect_group → oraculo, first_friend → primeiro_amigo
[
  ['first_prediction', 'primeiro_sangue'],
  ['exact_score',      'nostradamus'],
  ['perfect_group',    'oraculo'],
  ['first_friend',     'primeiro_amigo'],
].forEach(([oldType, newType]) => {
  db.prepare(`
    INSERT OR IGNORE INTO user_achievements (user_id, type, earned_at)
    SELECT user_id, ?, earned_at FROM user_achievements WHERE type=?
  `).run(newType, oldType);
  db.prepare(`DELETE FROM user_achievements WHERE type=?`).run(oldType);
});

// Remove rank achievements that were awarded when everyone had 0 points.
// Safe to run every startup: points only go up, so 0-point users never earned these legitimately.
const cleaned = db.prepare(`
  DELETE FROM user_achievements
  WHERE type IN ('top_100','top_25','top_10','rei_da_colina')
  AND user_id IN (
    SELECT id FROM users
    WHERE COALESCE((SELECT SUM(points_earned) FROM match_predictions WHERE user_id=users.id AND points_earned IS NOT NULL),0)
        + COALESCE((SELECT SUM(points_earned) FROM group_points       WHERE user_id=users.id),0) < 1
  )
`).run();
if (cleaned.changes > 0) console.log(`[db] Limpeza: ${cleaned.changes} rank achievement(s) inválido(s) removido(s).`);

// Also remove associated notifications for those achievements
db.prepare(`
  DELETE FROM notifications
  WHERE type='achievement'
  AND (title LIKE '%Top 100%' OR title LIKE '%Top 25%' OR title LIKE '%Top 10%' OR title LIKE '%Rei da Colina%')
  AND user_id IN (
    SELECT id FROM users
    WHERE COALESCE((SELECT SUM(points_earned) FROM match_predictions WHERE user_id=users.id AND points_earned IS NOT NULL),0)
        + COALESCE((SELECT SUM(points_earned) FROM group_points       WHERE user_id=users.id),0) < 1
  )
`).run();

// Repair knockout prediction points that may have been scored by the old group-stage rule.
// Knockout scoring is: exact score/result up to 3 pts + qualified team 1 pt.
try {
  const finishedKo = db.prepare(`
    SELECT * FROM matches
    WHERE group_id='KO'
      AND status='finished'
      AND home_score IS NOT NULL
      AND away_score IS NOT NULL
  `).all();
  const predictionsForMatch = db.prepare(`
    SELECT id, home_score, away_score, predicted_winner, points_earned
    FROM match_predictions
    WHERE match_id=?
  `);
  const updatePredictionPoints = db.prepare(`
    UPDATE match_predictions
    SET points_earned=?, updated_at=datetime('now')
    WHERE id=?
  `);

  let repairedKoPoints = 0;
  db.transaction(() => {
    for (const match of finishedKo) {
      const actualWinner = match.winner_team ||
        knockoutWinnerFromScore(match, match.home_score, match.away_score, null);
      if (!actualWinner) continue;
      for (const prediction of predictionsForMatch.all(match.id)) {
        const points = scorePrediction(match, prediction, match.home_score, match.away_score, actualWinner);
        if (prediction.points_earned !== points) {
          updatePredictionPoints.run(points, prediction.id);
          repairedKoPoints++;
        }
      }
    }
  })();
  if (repairedKoPoints > 0) console.log(`[db] KO points repaired: ${repairedKoPoints} prediction(s).`);
} catch (e) {
  console.warn('[db] KO points repair skipped:', e.message);
}

module.exports = db;
