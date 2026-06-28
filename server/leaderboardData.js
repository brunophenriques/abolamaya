const LB_QUERY = `
  SELECT u.id, u.username, u.display_name, u.avatar_color, u.avatar_url, u.is_admin,
    COALESCE(mp.pts,     0) AS match_points,
    COALESCE(gp.pts,     0) AS group_points,
    COALESCE(pp.pts,     0) AS community_points,
    COALESCE(mp.pts, 0) + COALESCE(gp.pts, 0) + COALESCE(pp.pts, 0) AS total_points,
    EXISTS(SELECT 1 FROM point_predictions LIMIT 1) AS community_points_visible,
    COALESCE(mp.cnt,      0) AS predictions_made,
    COALESCE(mp.settled,  0) AS settled,
    COALESCE(mp.correct,  0) AS correct_predictions,
    COALESCE(mp.exact,    0) AS exact_predictions,
    rs.prev_rank
  FROM users u
  LEFT JOIN (
    SELECT user_id,
      SUM(COALESCE(points_earned,0))                                  AS pts,
      COUNT(*)                                                        AS cnt,
      SUM(CASE WHEN points_earned IS NOT NULL THEN 1 ELSE 0 END)     AS settled,
      SUM(CASE WHEN points_earned >= 1 THEN 1 ELSE 0 END)            AS correct,
      SUM(CASE WHEN points_earned  = 3 THEN 1 ELSE 0 END)            AS exact
    FROM match_predictions GROUP BY user_id
  ) mp ON mp.user_id = u.id
  LEFT JOIN (
    SELECT user_id, SUM(COALESCE(points_earned,0)) AS pts
    FROM group_points GROUP BY user_id
  ) gp ON gp.user_id = u.id
  LEFT JOIN (
    SELECT user_id, SUM(amount) AS pts
    FROM point_transactions WHERE type!='admin_adjustment' GROUP BY user_id
  ) pp ON pp.user_id = u.id
  LEFT JOIN rank_snapshots rs ON rs.user_id = u.id
`;

const LB_ORDER = ' ORDER BY total_points DESC, exact_predictions ASC, match_points DESC, u.username';

function enrich(rows) {
  return rows.map((r, i) => ({
    ...r,
    is_admin: !!r.is_admin,
    rank:     i + 1,
    accuracy: r.settled > 0
      ? Math.round((r.correct_predictions / r.settled) * 100) : 0,
  }));
}

function getGlobalLeaderboard(db, { limit = null } = {}) {
  const sql = LB_QUERY + LB_ORDER + (limit ? ' LIMIT ?' : '');
  const rows = limit ? db.prepare(sql).all(limit) : db.prepare(sql).all();
  return enrich(rows);
}

function getLobbyLeaderboard(db, lobbyId) {
  return enrich(
    db.prepare(`
      ${LB_QUERY}
      JOIN lobby_members lm ON lm.user_id=u.id AND lm.lobby_id=?
      ${LB_ORDER}
    `).all(lobbyId)
  );
}

module.exports = { getGlobalLeaderboard, getLobbyLeaderboard };
