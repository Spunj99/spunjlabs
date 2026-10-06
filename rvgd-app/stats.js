// Tournament stats and trivia. Pure: derived from players, ordered games and scoring.
import { computeStandings, placeOf } from './score.js';

export function computeStats(players, games, scoring) {
  const ids = players.map(p => p.id);
  const low = !!scoring.lowWins;
  const valid = games.filter(g => (g.placings || []).length === 4 && g.placings.every(id => ids.includes(id)));

  // Finishing place (0-based) of each player in each game, and that game's last place.
  const rows = valid.map(g => {
    const place = {};
    g.placings.forEach((id, i) => { place[id] = placeOf(g, i); });
    return { g, place, last: Math.max(...Object.values(place)) };
  });

  // Running totals after each game, and who led (higher is better unless lowWins).
  const history = [];
  for (let n = 1; n <= valid.length; n++) {
    const st = computeStandings(players, valid.slice(0, n), scoring);
    const pts = Object.fromEntries(st.table.map(t => [t.id, t.points]));
    const best = low ? Math.min(...Object.values(pts)) : Math.max(...Object.values(pts));
    history.push({ pts, leaders: ids.filter(id => pts[id] === best) });
  }

  const per = Object.fromEntries(ids.map(id => [id, {
    wins: 0, lasts: 0, placeSum: 0, played: 0, ledFor: 0,
    winStreak: { n: 0, from: 0, to: 0 }, slump: { n: 0, from: 0, to: 0 },
    picks: 0, pickWins: 0, teamPlayed: 0, teamWins: 0,
  }]));
  const run = Object.fromEntries(ids.map(id => [id, { win: 0, dry: 0 }]));
  const longest = (rec, n, i) => { if (n > rec.n) Object.assign(rec, { n, from: i - n + 2, to: i + 1 }); };

  rows.forEach(({ g, place, last }, i) => {
    // The previous game's loser(s) picked this one.
    const prev = rows[i - 1];
    const pickers = prev ? ids.filter(id => prev.place[id] === prev.last) : [];
    ids.forEach(id => {
      const s = per[id], r = run[id], won = place[id] === 0;
      s.played++; s.placeSum += place[id] + 1;
      if (won) s.wins++;
      if (place[id] === last) s.lasts++;
      if (g.team) { s.teamPlayed++; if (won) s.teamWins++; }
      if (pickers.includes(id)) { s.picks++; if (won) s.pickWins++; }
      r.win = won ? r.win + 1 : 0;
      r.dry = won ? 0 : r.dry + 1;
      longest(s.winStreak, r.win, i);
      longest(s.slump, r.dry, i);
      if (history[i].leaders.includes(id)) s.ledFor++;
    });
  });

  // Lead changes: the sole leader differs from the previous sole leader.
  let leadChanges = 0, prevLeader = null;
  history.forEach(h => {
    if (h.leaders.length !== 1) return;
    if (prevLeader && h.leaders[0] !== prevLeader) leadChanges++;
    prevLeader = h.leaders[0];
  });

  // Head-to-head: the most one-sided pairing.
  let rivalry = null;
  ids.forEach(a => ids.forEach(b => {
    if (a >= b) return;
    let aw = 0, bw = 0;
    rows.forEach(({ place }) => { if (place[a] < place[b]) aw++; else if (place[b] < place[a]) bw++; });
    const [w, l, wn, ln] = aw >= bw ? [a, b, aw, bw] : [b, a, bw, aw];
    if (wn + ln && (!rivalry || wn - ln > rivalry.wins - rivalry.losses)) rivalry = { winner: w, loser: l, wins: wn, losses: ln };
  }));

  // Wack Chip: longest hold and biggest single payout, from the scoring engine's per-game record.
  let chip = null;
  if (scoring.wackChip && !low) {
    const st = computeStandings(players, valid, scoring);
    let hold = { player: null, n: 0 }, cur = { player: null, n: 0 }, payout = null, total = 0;
    valid.forEach(g => {
      const pg = st.perGame[g.id];
      if (pg.bonus) {
        total += pg.bonus.amount;
        if (!payout || pg.bonus.amount > payout.amount) payout = { ...pg.bonus, game: g.name };
      }
      cur = pg.holder === cur.player ? { player: cur.player, n: cur.n + 1 } : { player: pg.holder, n: 1 };
      if (cur.player && cur.n > hold.n) hold = { ...cur };
    });
    chip = { hold, payout, total };
  }

  // Players with the best value for a stat (ties share it).
  const top = (fn, min = false) => {
    const vals = ids.map(id => fn(per[id], id));
    const best = min ? Math.min(...vals) : Math.max(...vals);
    return { ids: ids.filter((_, i) => vals[i] === best), value: best };
  };

  return { games: rows.length, history, per, leadChanges, rivalry, chip, top };
}
