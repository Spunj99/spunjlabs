// RVGD scoring. Pure functions only: standings are always derived from the
// ordered game list, never stored, so editing an old game re-flows everything.

// lowWins: totals are summed finishing places and the lowest total wins (used by
// older tournaments, with points [1, 2, 3, 4]). The Wack Chip only applies when high wins.
export const DEFAULT_SCORING = { points: [10, 8, 7, 6], wackChip: false, lowWins: false };

// 0-based finishing place of the player at index i of a game's placings.
// ranks (imported results) allows ties; team games are winners then losers.
export const placeOf = (g, i) => g.ranks ? g.ranks[i] : g.team ? (i < g.winners ? 0 : 1) : i;

// Who takes the Wack Chip when several players are level last overall:
// 1. the current holder keeps it if they're among them;
// 2. otherwise whoever finished lower in the game just played;
// 3. still level: whoever was lower at the most recent earlier point their totals differed
//    (snaps = totals after each previous game, oldest first);
// 4. level all the way back: the first listed.
export function pickChipHolder(tied, holder, placeIn, snaps) {
  if (tied.includes(holder)) return holder;
  return [...tied].sort((a, b) => {
    const byGame = placeIn(b) - placeIn(a);
    if (byGame) return byGame;
    for (let i = snaps.length - 1; i >= 0; i--) {
      const diff = snaps[i][a] - snaps[i][b];
      if (diff) return diff; // lower total first
    }
    return 0;
  })[0];
}

export function computeStandings(players, games, scoring = DEFAULT_SCORING) {
  const pts = scoring.points || DEFAULT_SCORING.points;
  const low = !!scoring.lowWins;
  const wack = !!scoring.wackChip && !low;
  const ids = players.map(p => p.id);
  const tot = Object.fromEntries(ids.map(id => [id, { id, base: 0, bonus: 0, points: 0, places: [0, 0, 0, 0], played: 0 }]));

  let holder = null, held = 0;
  const perGame = {};
  const snaps = []; // running totals after each game, for chip tie-breaks

  for (const g of games) {
    const pl = g.placings || [];
    const bad = pl.length !== 4 || pl.some(id => !tot[id])
      || (g.team && !g.ranks && !(g.winners >= 1 && g.winners <= 3))
      || (g.ranks && (g.ranks.length !== 4 || g.ranks.some(r => !(r >= 0 && r <= 3))));
    if (bad) { perGame[g.id] = { bonus: null, holder, value: held }; continue; }

    pl.forEach((id, i) => {
      const r = placeOf(g, i), t = tot[id];
      t.base += pts[r] || 0; t.places[r]++; t.played++;
    });

    // The chip pays out at the end of every game it is held: +1, +2, +3...
    let bonus = null;
    if (wack && holder) {
      held++;
      tot[holder].bonus += held;
      bonus = { player: holder, amount: held };
    }
    ids.forEach(id => { tot[id].points = tot[id].base + tot[id].bonus; });

    // Whoever is last overall now holds the chip. A new holder starts at 0.
    if (wack) {
      const min = Math.min(...ids.map(id => tot[id].points));
      const tied = ids.filter(id => tot[id].points === min);
      const placeIn = id => placeOf(g, pl.indexOf(id));
      const last = pickChipHolder(tied, holder, placeIn, snaps);
      if (last !== holder) { holder = last; held = 0; }
    }
    snaps.push(Object.fromEntries(ids.map(id => [id, tot[id].points])));
    perGame[g.id] = { bonus, holder, value: held };
  }

  const table = ids.map(id => tot[id]).sort((a, b) =>
    (low ? a.points - b.points : b.points - a.points) ||
    b.places[0] - a.places[0] || b.places[1] - a.places[1] || b.places[2] - a.places[2]);
  // Level on points = same position; the next player takes the next one (2nd, 2nd, 3rd).
  // Wins only decide the display order within a shared position.
  table.forEach((t, i) => { t.pos = i && t.points === table[i - 1].points ? table[i - 1].pos : (i && table[i - 1].pos + 1); });

  return {
    table,
    perGame,
    chip: wack && holder ? { holder, value: held, next: held + 1 } : null,
  };
}

// Run with ?selftest in the page; results go to the console.
export function selfTest() {
  const results = [];
  const check = (name, cond) => results.push({ name, ok: !!cond });
  const g = (id, placings) => ({ id, placings });
  const on = points => ({ points, wackChip: true });
  const pts = (r, id) => r.table.find(t => t.id === id).points;

  // Base points, chip off.
  const J = ['j', 'a', 'b', 'c'].map(id => ({ id }));
  let r = computeStandings(J, [g(1, ['a', 'b', 'c', 'j'])], { points: [10, 8, 7, 6], wackChip: false });
  check('base points 10/8/7/6', r.table.map(t => t.points).join() === '10,8,7,6');
  check('no chip when toggle off', r.chip === null && r.perGame[1].bonus === null);

  // Johnny: picks up the chip at +0, then it pays +1, then +2.
  const jg = [g(1, ['a', 'b', 'c', 'j'])];
  r = computeStandings(J, jg, on([10, 8, 7, 6]));
  check('johnny handed chip at 0', r.chip.holder === 'j' && r.chip.value === 0 && r.chip.next === 1);
  jg.push(g(2, ['a', 'b', 'c', 'j']));
  r = computeStandings(J, jg, on([10, 8, 7, 6]));
  check('game 2 pays johnny +1', r.perGame[2].bonus.player === 'j' && r.perGame[2].bonus.amount === 1);
  jg.push(g(3, ['c', 'b', 'a', 'j']));
  r = computeStandings(J, jg, on([10, 8, 7, 6]));
  check('game 3 pays johnny +2', r.perGame[3].bonus.amount === 2 && pts(r, 'j') === 21);
  check('johnny bonus total 3', r.table.find(t => t.id === 'j').bonus === 3);

  // Lifted out of last: chip passes on and resets to 0.
  const Q = ['x', 'y', 'z', 'w'].map(id => ({ id }));
  r = computeStandings(Q, [g(1, ['z', 'w', 'x', 'y']), g(2, ['z', 'w', 'y', 'x'])], on([10, 9, 7, 6]));
  check('y holds after game 1', r.perGame[1].holder === 'y');
  check('y +1 lifts them out, x takes chip at 0', pts(r, 'y') === 14 && pts(r, 'x') === 13 && r.chip.holder === 'x' && r.chip.value === 0);

  // Holder still last keeps it and the value climbs.
  r = computeStandings(Q, [g(1, ['z', 'w', 'x', 'y']), g(2, ['z', 'w', 'x', 'y'])], on([10, 9, 8, 7]));
  check('holder keeps while last', r.chip.holder === 'y' && r.chip.value === 1);

  // Holder tied for last keeps it.
  r = computeStandings(Q, [g(1, ['z', 'w', 'x', 'y']), g(2, ['z', 'x', 'y', 'w'])], on([10, 9, 8, 6]));
  check('holder tied for last keeps chip', pts(r, 'y') === 15 && pts(r, 'w') === 15 && r.chip.holder === 'y' && r.chip.value === 1);

  // Tie with no current holder: lower finisher in the latest game takes it.
  r = computeStandings(Q, [g(1, ['z', 'w', 'x', 'y'])], on([10, 9, 8, 8]));
  check('tie goes to lower finisher', r.chip.holder === 'y');

  // Ranking tiebreak: equal points, more wins first.
  r = computeStandings(Q, [g(1, ['x', 'y', 'z', 'w']), g(2, ['z', 'w', 'y', 'x'])], { points: [10, 8, 8, 6], wackChip: false });
  check('tiebreak by wins', pts(r, 'x') === 16 && pts(r, 'y') === 16 && r.table[1].id === 'x');

  // Team game: winners get 1st points, losers 2nd points.
  r = computeStandings(Q, [{ id: 1, team: true, winners: 2, placings: ['x', 'y', 'z', 'w'] }], on([10, 8, 7, 6]));
  check('team 2v2 scores 10/10/8/8', [pts(r, 'x'), pts(r, 'y'), pts(r, 'z'), pts(r, 'w')].join() === '10,10,8,8');
  check('team places counted as 1st/2nd', r.table.find(t => t.id === 'z').places.join() === '0,1,0,0');
  check('team tie for last gives chip to a loser', ['z', 'w'].includes(r.chip.holder));
  r = computeStandings(Q, [{ id: 1, team: true, winners: 1, placings: ['x', 'y', 'z', 'w'] }], on([10, 8, 7, 6]));
  check('team 1v3', pts(r, 'x') === 10 && pts(r, 'w') === 8);

  // Chip tie-breaks for players level last overall.
  const placeAll = id => ({ y: 3, z: 3 })[id] ?? 0; // y and z joint last in the latest game
  check('chip tie: holder keeps it', pickChipHolder(['y', 'z'], 'z', placeAll, []) === 'z');
  check('chip tie: lower in latest game', pickChipHolder(['y', 'z'], 'w', id => ({ y: 3, z: 2 })[id], []) === 'y');
  check('chip tie: lower when last different', pickChipHolder(['y', 'z'], 'w', placeAll, [{ y: 8, z: 7 }, { y: 14, z: 14 }]) === 'z');
  check('chip tie: looks back past level games', pickChipHolder(['y', 'z'], null, placeAll, [{ y: 6, z: 8 }, { y: 12, z: 12 }, { y: 20, z: 20 }]) === 'y');

  // Tied places (imported results) and lowest-total-wins scoring.
  const low = { points: [1, 2, 3, 4], wackChip: true, lowWins: true };
  r = computeStandings(Q, [{ id: 1, placings: ['w', 'z', 'x', 'y'], ranks: [0, 1, 2, 2] }, g(2, ['x', 'y', 'z', 'w'])], low);
  check('tied 3rd scores 3 each', pts(r, 'x') === 4 && pts(r, 'y') === 5 && pts(r, 'z') === 5 && pts(r, 'w') === 5);
  check('lowest total ranks first', r.table[0].id === 'x');
  check('tie on total broken by wins', r.table[1].id === 'w');
  check('no chip when lowest wins', r.chip === null);

  // Level totals share a standings position, and the next player follows on.
  r = computeStandings(Q, [{ id: 1, placings: ['x', 'y', 'z', 'w'], ranks: [0, 1, 2, 3] }, { id: 2, placings: ['y', 'x', 'w', 'z'], ranks: [0, 1, 2, 3] }],
    { points: [1, 2, 3, 4], lowWins: true });
  check('tied totals share a position', r.table.map(t => `${t.id}${t.pos}`).join() === 'x0,y0,z1,w1');
  r = computeStandings(Q, [g(1, ['x', 'y', 'z', 'w'])], { points: [10, 8, 8, 6] });
  check('next player follows on after a tie', r.table.map(t => t.pos).join() === '0,1,1,2');

  // Editing an earlier game re-flows the chip history.
  const e = [g(1, ['x', 'y', 'z', 'w']), g(2, ['x', 'y', 'z', 'w'])];
  const before = computeStandings(Q, e, on([10, 8, 7, 6]));
  e[0] = g(1, ['w', 'y', 'z', 'x']);
  const after = computeStandings(Q, e, on([10, 8, 7, 6]));
  check('edit re-flows chip', before.perGame[1].holder === 'w' && after.perGame[1].holder === 'x' && after.perGame[2].bonus.player === 'x');

  const failed = results.filter(c => !c.ok);
  console.table(results);
  console.log(failed.length ? `SELFTEST FAIL: ${failed.map(f => f.name).join(', ')}` : `SELFTEST PASS (${results.length})`);
  return failed.length === 0;
}
