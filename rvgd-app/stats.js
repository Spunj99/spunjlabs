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

// All-time stats across tournaments. Players are matched by name, games by gameId
// (falling back to the name). Places, not points, are compared, since scoring varies.
export function computeGlobal(tours) {
  const key = n => String(n || '').trim().toUpperCase();
  const gid = g => String(g.gameId ?? g.rawgId ?? 'n-' + key(g.name));
  const P = {}, G = {}, finishes = [];
  const get = name => (P[name] ||= { name, tournaments: 0, titles: 0, games: 0, wins: 0, lasts: 0, placeSum: 0, byGame: {} });

  for (const t of tours) {
    const names = Object.fromEntries((t.players || []).map(p => [p.id, key(p.name)]));
    Object.values(names).forEach(n => get(n).tournaments++);
    const valid = t.games.filter(g => (g.placings || []).length === 4 && g.placings.every(id => names[id]));
    if (t.status === 'complete' && valid.length) {
      const st = computeStandings(t.players, valid, t.scoring || {});
      // Joint champions (level on points) each get the title.
      const champs = st.table.filter(r => r.pos === 0).map(r => names[r.id]);
      champs.forEach(c => get(c).titles++);
      // How tightly the whole field finished: gap from 1st to last, per game, normalised by the
      // per-game points spread (3 for old 1-4 place scoring, 4 for 10/8/7/6) so scoring systems compare.
      const pts = (t.scoring || {}).points || [10, 8, 7, 6];
      const first = st.table[0], last = st.table[st.table.length - 1];
      const spread = Math.abs(first.points - last.points);
      finishes.push({
        number: t.number, subtitle: t.subtitle, games: valid.length, spread,
        first: { name: names[first.id], points: first.points }, last: { name: names[last.id], points: last.points },
        closeness: spread / ((Math.abs(pts[0] - pts[3]) || 1) * valid.length),
      });
    }
    for (const g of valid) {
      const place = {};
      g.placings.forEach((id, i) => { place[names[id]] = placeOf(g, i); });
      const last = Math.max(...Object.values(place));
      const id = gid(g);
      const gg = (G[id] ||= { name: g.name, cover: '', plays: 0, tours: new Set() });
      gg.plays++; gg.tours.add(t.id); if (g.cover) gg.cover = g.cover;
      for (const [n, r] of Object.entries(place)) {
        const s = get(n);
        s.games++; s.placeSum += r + 1;
        if (r === 0) s.wins++;
        if (r === last) s.lasts++;
        const b = (s.byGame[id] ||= { name: g.name, cover: '', plays: 0, placeSum: 0, wins: 0 });
        b.plays++; b.placeSum += r + 1; if (r === 0) b.wins++; if (g.cover) b.cover = g.cover;
      }
    }
  }

  // Best / weakest game: average finish over games played at least twice (once, if nothing repeats).
  const players = Object.values(P).filter(p => p.games).map(p => {
    const list = Object.values(p.byGame).map(b => ({ ...b, avg: b.placeSum / b.plays }));
    const pool = list.some(b => b.plays >= 2) ? list.filter(b => b.plays >= 2) : list;
    const best = [...pool].sort((a, b) => a.avg - b.avg || b.plays - a.plays || b.wins - a.wins)[0] || null;
    const worst = [...pool].sort((a, b) => b.avg - a.avg || b.plays - a.plays || a.wins - b.wins)[0] || null;
    return { ...p, avg: p.placeSum / p.games, winRate: p.wins / p.games, best, worst: worst === best ? null : worst };
  }).sort((a, b) => b.titles - a.titles || b.winRate - a.winRate || a.avg - b.avg);

  const mostPlayed = Object.values(G).sort((a, b) => b.plays - a.plays || b.tours.size - a.tours.size).slice(0, 5)
    .map(g => ({ ...g, tours: g.tours.size }));
  return {
    players, mostPlayed,
    // Closest finish: tightest whole field (every tournament that shares the record, most recent first).
    closest: finishes.filter(f => f.closeness === Math.min(...finishes.map(x => x.closeness))).sort((a, b) => b.number - a.number),
    tournaments: tours.length, games: tours.reduce((a, t) => a + t.games.length, 0),
  };
}
