// Calculate group standings from predicted match scores using FIFA 2026 rules
// matches: [{id, home_team, away_team}, ...]
// preds:   {match_id: {home_score, away_score}, ...}
// Returns array of team objects sorted by predicted standing
function calcStandings(matches, preds) {
  const createTeamStats = name => ({ name, p:0, w:0, d:0, l:0, gf:0, ga:0, pts:0 });
  const teamNames = [...new Set(matches.flatMap(m => [m.home_team, m.away_team]))];
  const results = [];

  for (const m of matches) {
    const pred = preds[m.id];
    if (!pred) continue;
    const hg = Number(pred.home_score), ag = Number(pred.away_score);
    if (!Number.isInteger(hg) || !Number.isInteger(ag) || hg < 0 || ag < 0) continue;
    results.push({ home_team:m.home_team, away_team:m.away_team, home_score:hg, away_score:ag });
  }

  const buildStats = (names, matchResults) => {
    const stats = Object.fromEntries(names.map(name => [name, createTeamStats(name)]));

    for (const result of matchResults) {
      const H = stats[result.home_team], A = stats[result.away_team];
      const hg = result.home_score, ag = result.away_score;
      H.p++; A.p++;
      H.gf += hg; H.ga += ag;
      A.gf += ag; A.ga += hg;

      if (hg > ag)       { H.w++; H.pts += 3; A.l++; }
      else if (hg === ag){ H.d++; H.pts++; A.d++; A.pts++; }
      else               { A.w++; A.pts += 3; H.l++; }
    }

    return stats;
  };

  const rankTiedTeams = teams => {
    if (teams.length < 2) return teams;
    const tiedNames = new Set(teams.map(team => team.name));
    const headToHead = buildStats(
      [...tiedNames],
      results.filter(result => tiedNames.has(result.home_team) && tiedNames.has(result.away_team))
    );

    return [...teams].sort((a, b) => {
      const ah = headToHead[a.name], bh = headToHead[b.name];
      if (bh.pts !== ah.pts) return bh.pts - ah.pts;
      if ((bh.gf-bh.ga) !== (ah.gf-ah.ga)) return (bh.gf-bh.ga) - (ah.gf-ah.ga);
      if (bh.gf !== ah.gf) return bh.gf - ah.gf;
      if ((b.gf-b.ga) !== (a.gf-a.ga)) return (b.gf-b.ga) - (a.gf-a.ga);
      if (b.gf !== a.gf) return b.gf - a.gf;
      // Fair-play and FIFA ranking data are not available in predictions.
      return a.name.localeCompare(b.name);
    });
  };

  const pointsGroups = new Map();
  for (const team of Object.values(buildStats(teamNames, results))) {
    if (!pointsGroups.has(team.pts)) pointsGroups.set(team.pts, []);
    pointsGroups.get(team.pts).push(team);
  }

  return [...pointsGroups.keys()]
    .sort((a, b) => b - a)
    .flatMap(points => rankTiedTeams(pointsGroups.get(points)));
}

// Compare predicted vs actual standings, 1 point per correct position
function compareStandings(predicted, actual) {
  let pts = 0;
  for (let i = 0; i < Math.min(predicted.length, actual.length, 4); i++) {
    const pName = typeof predicted[i] === 'string' ? predicted[i] : predicted[i].name;
    const aName = typeof actual[i]    === 'string' ? actual[i]    : actual[i].name;
    if (pName === aName) pts++;
  }
  return pts;
}

// Render a compact standings table (7 cols) into a container element
function renderStandingsTable(teams, container) {
  if (!teams.length) { container.innerHTML = '<p class="muted" style="font-size:.82rem;padding:8px 0">Insere resultados para ver a tabela.</p>'; return; }
  const rows = teams.map((t, i) => `
    <tr>
      <td class="pos">${i+1}</td>
      <td class="team-name">${t.name}</td>
      <td>${t.p}</td>
      <td>${t.w}</td>
      <td>${t.d}</td>
      <td>${t.l}</td>
      <td class="pts-cell">${t.pts}</td>
    </tr>`).join('');
  container.innerHTML = `
    <table class="standings-table">
      <thead>
        <tr><th>#</th><th>Equipa</th><th>J</th><th>V</th><th>E</th><th>D</th><th>Pts</th></tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>`;
}
