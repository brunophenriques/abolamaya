const db = require('./db');

/**
 * Write an event to system_logs.
 * @param {object} opts
 * @param {string} opts.category  - e.g. 'scraper', 'settle', 'admin', 'ticket', 'auth'
 * @param {string} opts.message   - human-readable description
 * @param {'info'|'warning'|'error'} [opts.severity='info']
 * @param {number|null} [opts.actorId]   - user id performing the action (nullable)
 * @param {string|null} [opts.actorName] - username or label for display
 * @param {object|null} [opts.metadata]  - any extra JSON data
 */
function logEvent({ category, message, severity = 'info', actorId = null, actorName = null, metadata = null }) {
  try {
    db.prepare(`
      INSERT INTO system_logs (category, message, severity, actor_id, actor_name, metadata)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      category,
      message,
      severity,
      actorId  ?? null,
      actorName ?? null,
      metadata  ? JSON.stringify(metadata) : null
    );
  } catch (e) {
    console.error('[logs] Failed to write system log:', e.message);
  }
}

module.exports = { logEvent };
