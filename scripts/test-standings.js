const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { calcStandings: calcServerStandings } = require('../server/standings');

const browserContext = vm.createContext({});
const browserSource = fs.readFileSync(
  path.join(__dirname, '..', 'public', 'js', 'scoring.js'),
  'utf8'
);
vm.runInContext(browserSource, browserContext);
const calcBrowserStandings = browserContext.calcStandings;

function makeFixture(results) {
  const matches = results.map(([home, away, homeScore, awayScore], index) => ({
    id: index + 1,
    home_team: home,
    away_team: away,
  }));
  const predictions = Object.fromEntries(results.map(([, , homeScore, awayScore], index) => [
    index + 1,
    { home_score: homeScore, away_score: awayScore },
  ]));
  return { matches, predictions };
}

function assertOrder(results, expectedOrder) {
  const { matches, predictions } = makeFixture(results);
  const serverOrder = calcServerStandings(matches, predictions).map(team => team.name);
  const browserOrder = Array.from(
    calcBrowserStandings(matches, predictions),
    team => team.name
  );

  assert.deepEqual(serverOrder, expectedOrder);
  assert.deepEqual(browserOrder, expectedOrder);
}

assertOrder([
  ['A', 'C', 5, 0],
  ['B', 'A', 1, 0],
  ['B', 'D', 0, 4],
], ['D', 'B', 'A', 'C']);

assertOrder([
  ['A', 'B', 1, 0],
  ['B', 'C', 3, 0],
  ['C', 'A', 2, 0],
  ['A', 'D', 10, 0],
  ['B', 'D', 1, 0],
  ['C', 'D', 1, 0],
], ['B', 'C', 'A', 'D']);

assertOrder([
  ['A', 'B', 1, 0],
  ['B', 'C', 1, 0],
  ['C', 'A', 1, 0],
  ['A', 'D', 5, 0],
  ['B', 'D', 3, 0],
  ['C', 'D', 1, 0],
], ['A', 'B', 'C', 'D']);

console.log('Standings tiebreak tests passed.');
