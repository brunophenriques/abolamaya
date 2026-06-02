// Calculate group standings from predicted match scores using FIFA rules
// matches: [{id, home_team, away_team}, ...]
// preds:   {match_id: {home_score, away_score}, ...}
// Returns array of team objects sorted by predicted standing
function calcStandings(matches, preds) {
  const stats = {};

  for (const m of matches) {
    for (const t of [m.home_team, m.away_team]) {
      if (!stats[t]) stats[t] = { name:t, p:0, w:0, d:0, l:0, gf:0, ga:0, pts:0 };
    }
  }

  for (const m of matches) {
    const pred = preds[m.id];
    if (!pred) continue;
    const hg = parseInt(pred.home_score), ag = parseInt(pred.away_score);
    if (isNaN(hg) || isNaN(ag) || hg < 0 || ag < 0) continue;

    const H = stats[m.home_team], A = stats[m.away_team];
    H.p++; A.p++;
    H.gf += hg; H.ga += ag;
    A.gf += ag; A.ga += hg;

    if (hg > ag)      { H.w++; H.pts += 3; A.l++; }
    else if (hg === ag){ H.d++; H.pts += 1; A.d++; A.pts += 1; }
    else               { A.w++; A.pts += 3; H.l++; }
  }

  return Object.values(stats).sort((a, b) => {
    if (b.pts !== a.pts)               return b.pts - a.pts;
    if ((b.gf-b.ga) !== (a.gf-a.ga))  return (b.gf-b.ga) - (a.gf-a.ga);
    if (b.gf !== a.gf)                 return b.gf - a.gf;
    return a.name.localeCompare(b.name);
  });
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
