function createTeamStats(name) {
  return { name, p: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, pts: 0 };
}

function applyResult(stats, result) {
  const home = stats[result.home_team];
  const away = stats[result.away_team];
  const { home_score: homeScore, away_score: awayScore } = result;

  home.p++;
  away.p++;
  home.gf += homeScore;
  home.ga += awayScore;
  away.gf += awayScore;
  away.ga += homeScore;

  if (homeScore > awayScore) {
    home.w++;
    home.pts += 3;
    away.l++;
  } else if (homeScore === awayScore) {
    home.d++;
    home.pts++;
    away.d++;
    away.pts++;
  } else {
    away.w++;
    away.pts += 3;
    home.l++;
  }
}

function buildStats(teamNames, results) {
  const stats = Object.fromEntries(teamNames.map(name => [name, createTeamStats(name)]));
  for (const result of results) applyResult(stats, result);
  return stats;
}

function rankTiedTeams(teams, results) {
  if (teams.length < 2) return teams;

  const tiedNames = new Set(teams.map(team => team.name));
  const headToHeadResults = results.filter(result =>
    tiedNames.has(result.home_team) && tiedNames.has(result.away_team)
  );
  const headToHead = buildStats([...tiedNames], headToHeadResults);

  return [...teams].sort((a, b) => {
    const aHead = headToHead[a.name];
    const bHead = headToHead[b.name];
    const headPoints = bHead.pts - aHead.pts;
    if (headPoints) return headPoints;

    const headGoalDifference = (bHead.gf - bHead.ga) - (aHead.gf - aHead.ga);
    if (headGoalDifference) return headGoalDifference;

    const headGoals = bHead.gf - aHead.gf;
    if (headGoals) return headGoals;

    const overallGoalDifference = (b.gf - b.ga) - (a.gf - a.ga);
    if (overallGoalDifference) return overallGoalDifference;

    const overallGoals = b.gf - a.gf;
    if (overallGoals) return overallGoals;

    // Fair-play and FIFA ranking data are not available in predictions.
    return a.name.localeCompare(b.name);
  });
}

function calcStandings(matches, predictions) {
  const teamNames = [...new Set(matches.flatMap(match => [match.home_team, match.away_team]))];
  const results = [];

  for (const match of matches) {
    const prediction = predictions[match.id];
    if (!prediction) continue;

    const homeScore = Number(prediction.home_score);
    const awayScore = Number(prediction.away_score);
    if (!Number.isInteger(homeScore) || !Number.isInteger(awayScore) || homeScore < 0 || awayScore < 0) continue;

    results.push({
      home_team: match.home_team,
      away_team: match.away_team,
      home_score: homeScore,
      away_score: awayScore,
    });
  }

  const overallStats = Object.values(buildStats(teamNames, results));
  const pointsGroups = new Map();

  for (const team of overallStats) {
    if (!pointsGroups.has(team.pts)) pointsGroups.set(team.pts, []);
    pointsGroups.get(team.pts).push(team);
  }

  return [...pointsGroups.keys()]
    .sort((a, b) => b - a)
    .flatMap(points => rankTiedTeams(pointsGroups.get(points), results));
}

module.exports = { calcStandings };
