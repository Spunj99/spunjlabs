import { createStore } from './store.js';
import { computeStandings, placeOf, DEFAULT_SCORING, selfTest } from './score.js';
import { computeStats, computeGlobal, computeGameBook } from './stats.js';

// ---- config: paste from Firebase console > Project settings > Your apps ----
// These are public identifiers, not secrets. Security comes from firestore.rules.
// Leave apiKey empty to run in local demo mode.
const FIREBASE_CONFIG = {
  apiKey: 'AIzaSyBZcIXpWFScQtMBHub-tpNtXeDPVSaPA_g',
  authDomain: 'rvgd-101026.firebaseapp.com',
  projectId: 'rvgd-101026',
  appId: '1:964478178587:web:2c3e38372733a952592fbe',
};

// AI pundit: a Cloudflare Worker (Workers AI, free tier) that turns the tournament summary into a
// paragraph of commentary. It only answers requests from https://spunjlabs.com.
const PUNDIT_URL = 'https://rvgd-pundit.spunjlabs.workers.dev';

const COLORS = ['#ffd43a', '#70ceff', '#ff5c8a', '#6dff9b'];
const PLACE = ['1ST', '2ND', '3RD', '4TH'];
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const BASE = location.pathname;

// ---------- pixel icons ----------
function px(map, cls = '') {
  const h = map.length, w = map[0].length;
  let r = '';
  map.forEach((row, y) => {
    for (let x = 0; x < w;) {
      const ch = row[x];
      if (ch === '.') { x++; continue; }
      let n = 1;
      while (row[x + n] === ch) n++;
      r += `<rect x="${x}" y="${y}" width="${n}" height="1"${ch === 'w' ? ' fill="#fff" fill-opacity=".7"' : ''}/>`;
      x += n;
    }
  });
  return `<svg class="px ${cls}" viewBox="0 0 ${w} ${h}" fill="currentColor" aria-hidden="true">${r}</svg>`;
}
const TROPHY = ['XXXXXXXXXXXX', 'X.XwXXXXXX.X', 'X.XwXXXXXX.X', '.X.XXXXXX.X.', '..XXXXXXXX..', '...XXXXXX...', '.....XX.....', '.....XX.....', '....XXXX....', '...XXXXXX...', '...XXXXXX...'];
const SKULL = ['..XXXXXX..', '.XXXXXXXX.', 'XXXXXXXXXX', 'XX..XX..XX', 'XX..XX..XX', 'XXXXXXXXXX', '.XXX..XXX.', '..XXXXXX..', '..X.XX.X..'];
const LOCK = ['..XXXXXX..', '.XX....XX.', '.X......X.', '.X......X.', 'XXXXXXXXXX', 'XXXXXXXXXX', 'XXXX..XXXX', 'XXXX..XXXX', 'XXXXXXXXXX', 'XXXXXXXXXX'];
const UNLOCK = ['..XXXXXX..', '.XX....XX.', '.X......X.', '.X........', 'XXXXXXXXXX', 'XXXXXXXXXX', 'XXXX..XXXX', 'XXXX..XXXX', 'XXXXXXXXXX', 'XXXXXXXXXX'];
// Bar chart icon for the stats button.
const CHART = ['.........X', '.........X', '......X..X', '......X..X', '...X..X..X', '...X..X..X', 'X..X..X..X', 'X..X..X..X', 'XXXXXXXXXX'];
const ARROW = ['....X.....', '...XX.....', '..XXX.....', '.XXXXXXXXX', 'XXXXXXXXXX', '.XXXXXXXXX', '..XXX.....', '...XX.....', '....X.....'];
// Up = oldest game first, down = newest first.
const SORT_UP = ['...X...', '..XXX..', '.XXXXX.', 'XXXXXXX'];
const SORT_DOWN = [...SORT_UP].reverse();
const CAMERA = ['...XXX....', 'XXXXXXXXXX', 'X........X', 'X...XX...X', 'X..X..X..X', 'X..X..X..X', 'X...XX...X', 'X........X', 'XXXXXXXXXX'];
const PAD = ['..XXXXXXXXX..', '.XXXXXXXXXXX.', 'XXX.XXXXX.XXX', 'XX...XXX.X.XX', 'XXX.XXXXX.XXX', 'XXXXXXXXXXXXX', 'XXXX.....XXXX', '.XX.......XX.'];
const MIC = ['..XXX..', '.XXXXX.', '.XXXXX.', '.XXXXX.', 'X.XXX.X', 'X.....X', '.XXXXX.', '...X...', '..XXX..'];
const WHEEL = ['..XXXXX..', '.X..X..X.', 'X.X.X.X.X', 'X..XXX..X', 'XXXXXXXXX', 'X..XXX..X', 'X.X.X.X.X', '.X..X..X.', '..XXXXX..'];
const placeIcon = i => i < 3 ? px(TROPHY, ['gold', 'silver', 'bronze'][i]) : px(SKULL, 'wood');
const chipIcon = () => `<svg class="px chip" viewBox="0 0 16 16" aria-hidden="true" shape-rendering="crispEdges"><circle cx="8" cy="8" r="7.5" fill="#e8642a"/><circle cx="8" cy="8" r="5.2" fill="#7c2d10"/>${[0, 1, 2, 3, 4, 5, 6, 7].map(i => { const a = i * Math.PI / 4; return `<rect x="${(8 + 6.3 * Math.cos(a) - .6).toFixed(1)}" y="${(8 + 6.3 * Math.sin(a) - .6).toFixed(1)}" width="1.2" height="1.2" fill="#7c2d10"/>`; }).join('')}<rect x="5" y="6" width="1.2" height="4" fill="#fff"/><rect x="9.8" y="6" width="1.2" height="4" fill="#fff"/><rect x="6.2" y="8.6" width="1.2" height="1.4" fill="#fff"/><rect x="8.6" y="8.6" width="1.2" height="1.4" fill="#fff"/><rect x="7.4" y="7.4" width="1.2" height="1.4" fill="#fff"/></svg>`;

// Archive order: tournament number, or seq for numberless exhibitions (e.g. 10.5).
const sortKey = t => t.seq ?? t.number ?? 0;
// Average finishing place (1-4) as a rating: 100% = always 1st, 0% = always last.
const rating = avg => `${Math.round((4 - avg) / 3 * 100)}%`;
const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const fmtDate = d => { const [y, m, day] = String(d).split('-'); return m ? `${+day} ${MONTHS[m - 1]} ${y}` : esc(d); };

function roman(n) {
  const m = [[1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'], [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']];
  let s = '';
  for (const [v, r] of m) while (n >= v) { s += r; n -= v; }
  return s;
}

// ---------- state ----------
let store;
let unsub = [];
const S = { t: null, tour: null, games: [], st: null, editable: false, seen: null, flash: null };
let pool = null;
// Per-viewer table order preference; storage can be unavailable (private mode etc).
let newestFirst = false;
try { newestFirst = localStorage.getItem('rvgd-newest-first') === '1'; } catch {}
// Photo galleries only show on devices that have unlocked scoring (any tournament) or admin.
let trusted = false;
try { trusted = localStorage.getItem('rvgd-trusted') === '1'; } catch {}
function markTrusted() {
  if (trusted) return;
  trusted = true;
  try { localStorage.setItem('rvgd-trusted', '1'); } catch {}
  if (S.tour) renderChrome();
}
// gallery/index.json lists the photos per folder (rvgd-<number>); built by gallery/build-gallery.ps1.
let galleryIndex = {};
const galleryKey = () => `rvgd-${S.tour?.number ?? S.t}`;
const photos = () => galleryIndex[galleryKey()] || [];
fetch('rvgd-app/gallery/index.json', { cache: 'no-cache' }).then(r => r.ok ? r.json() : {}).catch(() => ({}))
  .then(x => { galleryIndex = x || {}; if (S.tour) renderChrome(); });

// ---------- boot ----------
$('#homeBtn').innerHTML = px(ARROW);
$('#standingsBtn').innerHTML = px(TROPHY);
$('#statsBtn').innerHTML = px(CHART);
$('#wheelBtn').innerHTML = px(WHEEL);
$('#galleryBtn').innerHTML = px(CAMERA);
$('#gamesBtn').innerHTML = px(PAD);
init();

async function init() {
  try {
    store = await createStore(new URLSearchParams(location.search).has('demo') ? null : FIREBASE_CONFIG);
  } catch (e) {
    $('#view').innerHTML = `<div class="empty"><p>COULD NOT CONNECT.<br>CHECK YOUR SIGNAL AND RELOAD.</p></div>`;
    return;
  }
  if (new URLSearchParams(location.search).has('selftest')) { const ok = selfTest(); toast(ok ? 'SELFTEST PASS' : 'SELFTEST FAIL - SEE CONSOLE', !ok); }
  addEventListener('popstate', () => transition(route));
  document.addEventListener('click', e => {
    const a = e.target.closest('a[data-nav]');
    if (!a || e.metaKey || e.ctrlKey) return;
    e.preventDefault();
    document.querySelectorAll('dialog[open]').forEach(closeSheet); // e.g. a record tile in the stats sheet
    go(a.getAttribute('href'));
  });
  route();
}

function go(url) {
  history.pushState(null, '', url);
  transition(route);
}
function transition(fn) {
  if (document.startViewTransition && !matchMedia('(prefers-reduced-motion: reduce)').matches) document.startViewTransition(fn);
  else fn();
}

function route() {
  unsub.forEach(f => f());
  unsub = [];
  const t = new URLSearchParams(location.search).get('t');
  return t ? showTournament(t.replace(/[^a-z0-9-]/gi, '')) : showArchive();
}

// ---------- archive ----------
async function showArchive() {
  Object.assign(S, { t: null, tour: null, games: [], st: null });
  document.title = 'RVGD | SpunjLabs';
  $('#barTitle').innerHTML = `<span class="t1">RVGD</span><span class="t2">Retro Video Games Day</span>`;
  ['#homeBtn', '#wheelBtn', '#galleryBtn', '#lockBtn', '#standingsBtn', '#addBtn'].forEach(s => $(s).hidden = true);
  $('#statsBtn').hidden = false;
  $('#gamesBtn').hidden = false;
  $('.bar').classList.add('no-tab'); // no trophy tab on the archive, so use the full width
  let list;
  try { list = await store.listTournaments(); }
  catch { $('#view').innerHTML = `<div class="empty"><p>COULD NOT LOAD TOURNAMENTS.</p></div>`; return; }
  $('#view').innerHTML = `
    <div class="hero"><h1>RETRO<br>VIDEO GAMES<br>DAY</h1><p>&#9654; SELECT TOURNAMENT<span class="blink">_</span></p></div>
    ${store.demo ? `<div class="banner"><span class="pill demo">DEMO MODE &middot; SAVED ON THIS DEVICE ONLY</span></div>` : ''}
    <ul class="cards">${list.map(t => `
      <li><a class="card${t.status === 'complete' ? '' : ' live-card'}" data-nav href="${BASE}?t=${esc(t.id)}">
        <span class="num">${t.number ? roman(t.number) : 'EX'}</span>
        <span class="meta"><h2>${esc(t.title || 'RVGD ' + roman(t.number))}${t.subtitle ? ': ' + esc(t.subtitle) : ''}</h2>
        ${t.date ? `<small class="date">${fmtDate(t.date)}</small>` : ''}
        <p>${t.status === 'complete'
          ? `${px(TROPHY, 'gold')} ${esc(t.champion || '?')}${t.gameCount ? ` &middot; ${t.gameCount} games` : ''}`
          : `<span class="live">LIVE</span>`}${t.exhibition ? ' <span class="exh">EXHIBITION</span>' : ''}</p></span>
      </a></li>`).join('') || '<li class="empty"><p>NO TOURNAMENTS YET</p></li>'}
    </ul>
    <p class="foot"><button class="btn" id="newBtn" type="button">+ NEW TOURNAMENT</button></p>
    <p class="foot"><a href="./">SPUNJLABS.COM</a> &middot; GAME ART FROM <a href="https://en.wikipedia.org" target="_blank" rel="noopener">WIKIPEDIA</a></p>`;
  $('#newBtn').onclick = async () => { if (await requireAdmin()) openAdmin(null); };
}

// ---------- tournament ----------
function showTournament(t) {
  $('.bar').classList.remove('no-tab');
  Object.assign(S, { t, tour: null, games: [], st: null, seen: null, editable: false });
  $('#homeBtn').href = BASE;
  $('#homeBtn').setAttribute('data-nav', '');
  $('#homeBtn').hidden = false;
  $('#gamesBtn').hidden = true;
  $('#view').innerHTML = `<p class="loading">LOADING<span class="blink">_</span></p>`;
  let gotTour = false;
  unsub.push(store.watchTournament(t, tour => {
    gotTour = true;
    S.tour = tour;
    if (!tour) {
      $('#barTitle').innerHTML = `<span class="t1">RVGD${/^\d+$/.test(t) ? ' ' + roman(+t) : ''}</span>`;
      ['#statsBtn', '#wheelBtn', '#galleryBtn', '#lockBtn', '#standingsBtn', '#addBtn'].forEach(s => $(s).hidden = true);
      $('#view').innerHTML = `<div class="empty"><p class="big">?</p><p>TOURNAMENT NOT FOUND</p></div>`;
      return;
    }
    renderTournament();
  }));
  unsub.push(store.watchGames(t, games => {
    S.games = games;
    if (gotTour && S.tour) renderTournament();
  }));
  store.isEditor(t).then(ok => { if (ok) markTrusted(); if (S.t === t) { S.editable = ok; renderChrome(); } });
}

const live = () => S.tour?.status !== 'complete';
const players = () => (S.tour?.players || []).map((p, i) => ({ ...p, color: COLORS[i % 4] }));
const pById = id => players().find(p => p.id === id);
const scoring = () => ({ ...DEFAULT_SCORING, ...(S.tour?.scoring || {}) });

function renderChrome() {
  const tr = S.tour;
  if (!tr) return;
  const title = tr.title || `RVGD ${roman(tr.number)}`;
  document.title = `${title} | SpunjLabs`;
  $('#barTitle').innerHTML = `<span class="t1${title.length > 12 ? ' long' : ''}">${esc(title)}</span>${tr.subtitle ? `<span class="t2">${esc(tr.subtitle)}</span>` : ''}`;
  $('#standingsBtn').hidden = false;
  $('#statsBtn').hidden = false;
  $('#wheelBtn').hidden = !live();
  $('#galleryBtn').hidden = live() || !trusted || !photos().length;
  const lock = $('#lockBtn');
  lock.hidden = !live();
  lock.innerHTML = px(S.editable ? UNLOCK : LOCK);
  lock.classList.toggle('on', S.editable);
  lock.setAttribute('aria-label', S.editable ? 'Scoring unlocked' : 'Unlock scoring');
  $('#addBtn').hidden = !live();
}

function renderTournament() {
  renderChrome();
  const ps = players();
  const st = S.st = computeStandings(ps, S.games, scoring());
  const last = S.games[S.games.length - 1];
  // Loser picks next; after a team game, the losing team does.
  const lastRank = last ? Math.max(...(last.placings || []).map((_, i) => placeOf(last, i))) : -1;
  const pickers = (last?.placings || []).filter((_, i) => placeOf(last, i) === lastRank).map(pById).filter(Boolean);
  const chipP = st.chip && pById(st.chip.holder);
  // Players level on points share a position; everyone in position 0 is a (joint) champion.
  const groups = [];
  if (!live()) st.table.forEach(r => { (groups[r.pos] ||= []).push(r); });
  const champ = groups[0] && { name: groups[0].map(r => pById(r.id)?.name).join(' & '), joint: groups[0].length > 1 };

  const pc = p => p ? `style="--pc:${p.color}"` : '';
  const isNew = id => S.seen && !S.seen.has(id);
  const rows = S.games.map((g, i) => {
    const pg = st.perGame[g.id] || {};
    const cls = isNew(g.id) ? ' new' : g.id === S.flash ? ' flash' : '';
    return `<button class="row${cls}" type="button" data-id="${esc(g.id)}" ${live() ? '' : 'disabled'} aria-label="Game ${i + 1}: ${esc(g.name)}">
      <div class="g">${g.cover ? `<img class="cv" src="${esc(g.cover)}" alt="" loading="lazy" decoding="async">` : ''}<span class="gt"><i>#${i + 1}${g.team ? ' &middot; TEAM' : ''}</i><span>${esc(g.name)}</span></span></div>
      ${[0, 1, 2, 3].map(k => {
        // Team games stack each team in the 1st and 2nd columns.
        const ids = (g.placings || []).filter((_, j) => placeOf(g, j) === k);
        const cell = ids.map(id => {
          const p = pById(id);
          const b = pg.bonus && pg.bonus.player === id ? `<span class="chipb">${chipIcon()}+${pg.bonus.amount}</span>` : '';
          return `<span class="nm" ${pc(p)}>${esc(p?.name || '?')}</span>${b}`;
        }).join('') || `<span class="nm dim">-</span>`;
        return `<div class="c${k === 0 ? ' p1' : ''}${ids.length > 1 ? ' multi' : ''}">${cell}</div>`;
      }).join('')}
    </button>`;
  });
  const rowsHtml = (newestFirst ? rows.reverse() : rows).join('');

  $('#view').innerHTML = `
    ${champ ? `<div class="champ"><small>&#9733; ${champ.joint ? 'JOINT CHAMPIONS' : 'CHAMPION'} &#9733;</small><strong>${esc(champ.name)}</strong>
      <p class="runners">${groups.slice(1).map((g, i) => g && `${PLACE[i + 1]} ${g.map(r => `<b style="color:${pById(r.id).color}">${esc(pById(r.id).name)}</b>`).join(' &amp; ')} ${g[0].points}`).filter(Boolean).join(' &middot; ')}</p></div>` : ''}
    <div class="banner">
      ${live() && pickers.length ? `<span class="pill next"><span class="blink">&#9654;</span>${pickers.map(p => `<b style="color:${p.color}">${esc(p.name)}</b>`).join(' OR ')} ${pickers.length > 1 ? 'PICK' : 'PICKS'} NEXT</span>` : ''}
      ${chipP ? `<span class="pill wack" title="Wack Chip: ${esc(chipP.name)} gets +${st.chip.next} after the next game">${chipIcon()}<span>WACK <b style="color:${chipP.color}">${esc(chipP.name)}</b> +${st.chip.next}</span></span>` : ''}
      ${store.demo ? `<span class="pill demo">DEMO MODE</span>` : ''}    </div>
    <div class="tbl" role="table" aria-label="Results">
      <div class="row head" role="row"><div><button class="sort" id="sortBtn" type="button" aria-label="Order: ${newestFirst ? 'newest' : 'oldest'} first. Tap to flip">GAME ${px(newestFirst ? SORT_DOWN : SORT_UP)}</button></div>${PLACE.map((p, i) => `<div>${placeIcon(i)}${i === 3 ? p : ''}</div>`).join('')}</div>
      ${rowsHtml || `<div class="empty"><p class="big">${px(TROPHY)}</p><p>NO GAMES YET.<br>${live() ? 'PRESS + ADD GAME TO START' : ''}</p></div>`}
    </div>`;

  // Oldest game is at the top, so bring a newly added row into view at the bottom.
  if (S.seen && S.games.some(g => !S.seen.has(g.id))) { pulseTab(); $('#view .row.new')?.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
  S.seen = new Set(S.games.map(g => g.id));
  S.flash = null;
  if ($('#standingsSheet').open) renderStandings();
  if ($('#statsSheet').open) renderStats();
}

function pulseTab() {
  const b = $('#standingsBtn');
  b.classList.remove('pulse');
  void b.offsetWidth;
  b.classList.add('pulse');
}

$('#view').addEventListener('click', async e => {
  if (e.target.closest('#sortBtn')) {
    newestFirst = !newestFirst;
    try { localStorage.setItem('rvgd-newest-first', newestFirst ? '1' : '0'); } catch {}
    renderTournament();
    $('#view .tbl')?.classList.add('flip');
    return;
  }
  const row = e.target.closest('button.row');
  if (!row || !live()) return;
  const g = S.games.find(x => x.id === row.dataset.id);
  if (g && await requireEditor()) openGame(g);
});
$('#addBtn').onclick = async () => { if (await requireEditor()) openGame(null); };
$('#lockBtn').onclick = async () => {
  if (S.editable) toast('SCORING UNLOCKED ON THIS DEVICE');
  else if (await requireEditor()) toast('UNLOCKED! READY PLAYER ONE');
};
$('#standingsBtn').onclick = () => {
  renderStandings();
  openSheet($('#standingsSheet'));
  if ($('#punditBtn')) refreshPunditUses(S.t);
};
$('#statsBtn').onclick = () => { if (!S.t) return openGlobal(); renderStats(); openSheet($('#statsSheet')); };

// ---------- sheets ----------
function openSheet(d) {
  d.classList.remove('closing');
  if (!d.open) d.showModal();
}
function closeSheet(d) {
  if (!d.open || d.classList.contains('closing')) return;
  d.classList.add('closing');
  let done = false;
  const fin = () => { if (done) return; done = true; d.removeEventListener('animationend', onEnd); d.classList.remove('closing'); d.close(); };
  const onEnd = e => { if (e.target === d) fin(); };
  d.addEventListener('animationend', onEnd);
  setTimeout(fin, 300);
}
document.querySelectorAll('dialog.sheet').forEach(d => {
  d.addEventListener('cancel', e => { e.preventDefault(); closeSheet(d); });
  d.addEventListener('click', e => { if (e.target === d || e.target.closest('[data-close]')) closeSheet(d); });
});

// ---------- wheel: random 1v1 draw ----------
// Each spin picks a player and takes them off the wheel; picks pair up in order
// (1st v 2nd, 3rd v 4th), and the last two left are paired automatically.
const W = { left: [], picks: [], rot: 0, busy: false, landed: -1 };
const rnd = () => crypto.getRandomValues(new Uint32Array(1))[0] / 2 ** 32;
const wheelDone = () => W.left.length < 2 || (W.left.length === 2 && W.picks.length % 2 === 0);

function openWheel() { resetWheel(); openSheet($('#wheelSheet')); }
function resetWheel() {
  if (W.busy) return;
  Object.assign(W, { left: players(), picks: [], rot: 0, landed: -1 });
  drawWheel();
  renderDraw();
}
function drawWheel() {
  const g = $('#wheelRot'), n = W.left.length, seg = 360 / n;
  // Angles run clockwise from the pointer at the top.
  const pt = (deg, r) => { const a = deg * Math.PI / 180; return `${(r * Math.sin(a)).toFixed(2)} ${(-r * Math.cos(a)).toFixed(2)}`; };
  g.innerHTML = W.left.map((p, i) => {
    const a0 = i * seg, mid = a0 + seg / 2;
    const path = n === 1 ? `<circle class="wheel-seg" r="100" fill="${p.color}"/>`
      : `<path class="wheel-seg" d="M0 0 L${pt(a0, 100)} A100 100 0 ${seg > 180 ? 1 : 0} 1 ${pt(a0 + seg, 100)} Z" fill="${p.color}"/>`;
    const fs = Math.min(14, 76 / Math.max(p.name.length, 1));
    return `<g class="${i === W.landed ? 'win' : ''}">${path}<text class="wheel-txt" font-size="${fs.toFixed(1)}" text-anchor="middle" dominant-baseline="central" transform="rotate(${mid - 90}) translate(58 0)">${esc(p.name)}</text></g>`;
  }).join('') + '<circle class="wheel-rim" r="101"/>';
  g.classList.toggle('landed', W.landed >= 0);
  g.style.transition = 'none';
  g.style.transform = `rotate(${W.rot}deg)`;
}
function renderDraw() {
  const order = wheelDone() ? [...W.picks, ...W.left] : W.picks;
  const name = p => p ? `<b style="color:${p.color}">${esc(p.name)}</b>` : '<b class="dim">?</b>';
  const matches = [];
  for (let i = 0; i < order.length; i += 2) matches.push(order.slice(i, i + 2));
  $('#wheelDraw').innerHTML = matches.map((m, i) => `<li><small>MATCH ${i + 1}</small>${name(m[0])}<span class="v">VS</span>${name(m[1])}</li>`).join('');
  const last = W.picks[W.picks.length - 1];
  $('#wheelPick').innerHTML = last ? `<span class="blink">&#9654;</span> ${name(last)}` : 'SPIN FOR THE FIRST PLAYER';
  $('#wheelSpin').disabled = wheelDone();
  $('#wheelSpin').innerHTML = wheelDone() ? 'ALL DRAWN' : 'SPIN &#9654;';
}
function spinWheel() {
  if (W.busy || wheelDone()) return;
  W.busy = true;
  if (W.landed >= 0) { W.left.splice(W.landed, 1); W.landed = -1; W.rot = 0; drawWheel(); }
  const g = $('#wheelRot'), n = W.left.length, seg = 360 / n, i = Math.floor(rnd() * n);
  // Land somewhere inside segment i (not on an edge), after five full turns.
  const target = (i + 0.15 + rnd() * 0.7) * seg;
  W.rot += 360 * 5 + (((-target - W.rot) % 360) + 360) % 360;
  const dur = matchMedia('(prefers-reduced-motion: reduce)').matches ? 300 : 4200;
  void g.getBoundingClientRect();
  g.style.transition = `transform ${dur}ms cubic-bezier(.12,.8,.18,1)`;
  g.style.transform = `rotate(${W.rot}deg)`;
  $('#wheelPick').innerHTML = '<span class="blink">SPINNING...</span>';
  $('#wheelSpin').disabled = true;
  setTimeout(() => {
    W.busy = false;
    W.picks.push(W.left[i]);
    W.landed = i;
    g.querySelectorAll(':scope > g').forEach((s, k) => s.classList.toggle('win', k === i));
    g.classList.add('landed');
    // Keep the drawn player on the wheel until the next spin, but count them as picked.
    const rest = W.left.filter((_, k) => k !== i);
    const done = rest.length < 2 || (rest.length === 2 && W.picks.length % 2 === 0);
    if (done) { W.left = rest; W.landed = -1; }
    renderDraw();
    navigator.vibrate?.([20, 60, 20]);
  }, dur + 50);
}
$('#wheelBtn').onclick = openWheel;
$('#wheelSpin').onclick = spinWheel;
$('#wheel').onclick = spinWheel;
$('#wheelReset').onclick = resetWheel;

// ---------- bookie odds (for fun) ----------
// Rates each player on recent form (latest tournaments count most) plus game win rate,
// turns that into a share of the market with a bookie's overround, and snaps it to a
// familiar fractional price. Largely nonsense, by design.
const PRICES = ['1/5', '1/4', '1/3', '2/5', '1/2', '4/6', '4/5', 'EVS', '6/4', '2/1', '5/2', '3/1', '7/2', '4/1', '9/2', '5/1', '6/1', '7/1', '8/1', '10/1', '12/1', '14/1', '16/1', '20/1', '25/1', '33/1', '50/1', '66/1', '100/1'];
const priceValue = s => s === 'EVS' ? 1 : s.split('/').reduce((a, b) => a / b);
function fakeOdds(ps) {
  const FINISH = [4, 2, 1, 0.3];
  const strength = ps.map(p => {
    const form = p.form.length ? p.form.reduce((a, f, i) => a + (i + 1) * (FINISH[f.pos - 1] ?? 0), 0) / p.form.reduce((a, _, i) => a + i + 1, 0) : 0.3;
    // Fewer than five events: regress towards an average outsider.
    const seen = Math.min(p.form.length, 5) / 5;
    return Math.max(0.05, (form * seen + 0.8 * (1 - seen)) + 3 * p.winRate);
  });
  const sq = strength.map(r => r * r), total = sq.reduce((a, b) => a + b, 0);
  return sq.map(s => {
    const chance = Math.min(0.95, (s / total) * 1.18); // 18% overround
    const want = 1 / chance - 1;
    return PRICES.reduce((best, p) => Math.abs(Math.log(priceValue(p) / want)) < Math.abs(Math.log(priceValue(best) / want)) ? p : best);
  });
}

// ---------- photo gallery ----------
// A paged grid of thumbnails (swipe or arrows, 9 a page); tapping one opens a full-screen
// viewer that also swipes. Both are horizontal scroll-snap strips, so swiping is native.
const PER_PAGE = 9;
const photoUrl = (kind, f) => `rvgd-app/gallery/${encodeURIComponent(galleryKey())}/${kind}/${encodeURIComponent(f)}`;
const stripIndex = el => Math.round(el.scrollLeft / Math.max(el.clientWidth, 1));
const stripTo = (el, i, smooth) => el.scrollTo({ left: i * el.clientWidth, behavior: smooth ? 'smooth' : 'instant' });

function openGallery() {
  const list = photos();
  const pages = [];
  for (let i = 0; i < list.length; i += PER_PAGE) pages.push(list.slice(i, i + PER_PAGE));
  $('#galleryTitle').innerHTML = `GALLERY <small class="gsub">${list.length} PHOTO${list.length === 1 ? '' : 'S'}</small>`;
  $('#gPages').innerHTML = pages.map((pg, p) => `<div class="gpage">${pg.map((f, k) => {
    const i = p * PER_PAGE + k;
    return `<button class="gthumb" type="button" data-photo="${i}" aria-label="Photo ${i + 1}"><img src="${photoUrl('_thumb', f)}" alt="" loading="${p ? 'lazy' : 'eager'}" decoding="async"></button>`;
  }).join('')}</div>`).join('');
  $('#gNav').hidden = pages.length < 2;
  openSheet($('#gallerySheet'));
  requestAnimationFrame(() => { stripTo($('#gPages'), 0); galleryNav(); });
}
function galleryNav() {
  const el = $('#gPages'), n = el.children.length, i = stripIndex(el);
  $('#gCount').textContent = `PAGE ${i + 1} / ${n}`;
  $('#gPrev').disabled = i === 0;
  $('#gNext').disabled = i >= n - 1;
}
$('#galleryBtn').onclick = openGallery;
$('#gPages').addEventListener('scroll', galleryNav, { passive: true });
$('#gPrev').onclick = () => stripTo($('#gPages'), stripIndex($('#gPages')) - 1, true);
$('#gNext').onclick = () => stripTo($('#gPages'), stripIndex($('#gPages')) + 1, true);
$('#gPages').addEventListener('click', e => {
  const b = e.target.closest('[data-photo]');
  if (b) openViewer(+b.dataset.photo);
});

function openViewer(start) {
  const v = $('#viewer'), strip = $('#vStrip'), list = photos();
  strip.innerHTML = list.map((f, i) => `<div class="vslide"><img src="${photoUrl('_web', f)}" alt="Photo ${i + 1} of ${list.length}" loading="${Math.abs(i - start) <= 1 ? 'eager' : 'lazy'}" decoding="async"></div>`).join('');
  v.showModal();
  requestAnimationFrame(() => { stripTo(strip, start); viewerNav(); });
}
function viewerNav() {
  const strip = $('#vStrip'), n = strip.children.length, i = stripIndex(strip);
  $('#vCount').textContent = `${i + 1} / ${n}`;
  $('#vPrev').disabled = i === 0;
  $('#vNext').disabled = i >= n - 1;
}
$('#vStrip').addEventListener('scroll', viewerNav, { passive: true });
$('#vPrev').onclick = () => stripTo($('#vStrip'), stripIndex($('#vStrip')) - 1, true);
$('#vNext').onclick = () => stripTo($('#vStrip'), stripIndex($('#vStrip')) + 1, true);
$('#vClose').onclick = () => $('#viewer').close();
// Keyboard arrows page the grid, or step through photos when the viewer is open.
document.addEventListener('keydown', e => {
  if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
  const el = $('#viewer').open ? $('#vStrip') : $('#gallerySheet').open ? $('#gPages') : null;
  if (!el) return;
  e.preventDefault();
  stripTo(el, stripIndex(el) + (e.key === 'ArrowLeft' ? -1 : 1), true);
});

// ---------- PIN ----------
function askPin(kind) {
  const d = $('#pinSheet'), input = $('#pinInput'), err = $('#pinErr');
  $('#pinTitle').textContent = kind === 'admin' ? 'ADMIN PIN' : 'INSERT PIN';
  $('#pinHint').textContent = kind === 'admin' ? 'Enter the admin PIN to manage tournaments.' : 'Enter the tournament PIN to start scoring on this device.';
  input.value = '';
  err.textContent = '';
  openSheet(d);
  input.focus();
  return new Promise(resolve => {
    const form = $('#pinForm');
    const submit = async e => {
      e.preventDefault();
      err.textContent = 'CHECKING...';
      const ok = kind === 'admin' ? await store.adminUnlock(input.value.trim()) : await store.unlock(S.t, input.value.trim());
      if (ok) { finish(true); closeSheet(d); return; }
      err.textContent = 'WRONG PIN. TRY AGAIN.';
      form.classList.remove('shake'); void form.offsetWidth; form.classList.add('shake');
      input.select();
    };
    const onClose = () => finish(false);
    const finish = v => { form.removeEventListener('submit', submit); d.removeEventListener('close', onClose); resolve(v); };
    form.addEventListener('submit', submit);
    d.addEventListener('close', onClose);
  });
}
async function requireEditor() {
  if (S.editable) return true;
  if (await askPin('editor')) { S.editable = true; markTrusted(); renderChrome(); return true; }
  return false;
}
let isAdmin = false;
async function requireAdmin() {
  if (isAdmin || (isAdmin = await store.isAdmin())) return markTrusted(), true;
  if ((isAdmin = await askPin('admin'))) markTrusted();
  return isAdmin;
}

// ---------- add / edit game ----------
let draft = null;
const searchInput = $('#searchInput');

function openGame(g) {
  draft = g
    ? { id: g.id, game: { gameId: g.gameId ?? g.rawgId, name: g.name, cover: g.cover, year: g.year, platforms: g.platforms }, team: !!g.team && !g.ranks, placings: g.team && !g.ranks ? (g.placings || []).slice(0, g.winners) : [...(g.placings || [])], ties: [0, 1, 2, 3].map(i => !!g.ranks && i > 0 && g.ranks[i] === g.ranks[i - 1]) }
    : { id: null, game: null, team: false, placings: [], ties: [false, false, false, false] };
  $('#deleteBtn').hidden = !g;
  $('#deleteBtn').classList.remove('armed');
  $('#deleteBtn').textContent = 'DELETE';
  openSheet($('#gameSheet'));
  if (g) showStep('place');
  else {
    showStep('search');
    searchInput.value = '';
    shownKeys = new Set();
    lastRemote = [];
    searchInput.focus();
    runSearch('');
  }
}

function showStep(step, back) {
  const isSearch = step === 'search';
  const show = isSearch ? $('#stepSearch') : $('#stepPlace');
  $('#stepSearch').hidden = !isSearch;
  $('#stepPlace').hidden = isSearch;
  $('#gameSheet').classList.toggle('tall', isSearch);
  $('#gameSheetTitle').textContent = isSearch ? 'SELECT GAME' : draft.id ? 'EDIT RESULT' : 'WHO WON?';
  show.classList.remove('enter', 'back');
  void show.offsetWidth;
  show.classList.add(back ? 'back' : 'enter');
  if (!isSearch) renderPlace();
}

// search
const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
const wikiCache = new Map();
let searchTimer, searchCtl, lastResults = [];

async function localGames() {
  if (!pool) pool = await store.loadPool();
  const map = new Map();
  [...S.games].reverse().forEach(g => map.set(String(g.gameId ?? g.rawgId ?? norm(g.name)), { gameId: g.gameId ?? g.rawgId, name: g.name, cover: g.cover, year: g.year, platforms: g.platforms, local: true }));
  // Skip pool entries whose name is already listed (e.g. an old alias renamed to the full title).
  const names = new Set([...map.values()].map(g => norm(g.name)));
  pool.forEach(p => {
    if (map.has(String(p.id)) || names.has(norm(p.name))) return;
    names.add(norm(p.name));
    map.set(String(p.id), { gameId: p.id, name: p.name, cover: p.cover, year: p.year, platforms: p.platforms, local: true });
  });
  return [...map.values()];
}

searchInput.addEventListener('input', () => {
  clearTimeout(searchTimer);
  const q = searchInput.value;
  runLocal(q);
  searchTimer = setTimeout(() => runSearch(q), 400);
});
searchInput.addEventListener('keydown', e => {
  if (e.key === 'Enter') { e.preventDefault(); ($('#results button:not([data-custom])') || $('#results button'))?.click(); }
  if (e.key === 'ArrowDown') { e.preventDefault(); $('#results button')?.focus(); }
});
$('#results').addEventListener('keydown', e => {
  if (!['ArrowDown', 'ArrowUp'].includes(e.key)) return;
  e.preventDefault();
  const btns = [...document.querySelectorAll('#results button')];
  const i = btns.indexOf(document.activeElement) + (e.key === 'ArrowDown' ? 1 : -1);
  (i < 0 ? searchInput : btns[Math.min(i, btns.length - 1)]).focus();
});

async function runLocal(q) {
  const n = norm(q);
  const loc = (await localGames()).filter(g => !n || norm(g.name).includes(n)).slice(0, n ? 8 : 12);
  // While the next online search is pending, keep showing the previous online results
  // that still match, so the list doesn't empty and refill on every keystroke.
  renderResults(q, loc, n ? withoutLocal(loc, lastRemote.filter(g => norm(g.name).includes(n))) : []);
  return loc;
}

let lastRemote = [];
const withoutLocal = (loc, remote) => {
  const have = new Set(loc.map(g => String(g.gameId ?? norm(g.name))));
  const names = new Set(loc.map(g => norm(g.name) + g.year));
  return remote.filter(g => !have.has(String(g.gameId)) && !names.has(norm(g.name) + g.year));
};

async function runSearch(q) {
  const loc = await runLocal(q);
  const n = norm(q);
  if (n.length < 2) { lastRemote = []; renderResults(q, loc, []); return; }
  searchCtl?.abort();
  searchCtl = new AbortController();
  let remote = wikiCache.get(n);
  if (!remote) {
    $('.search').classList.add('busy');
    try {
      remote = await wikiSearch(q, searchCtl.signal);
      wikiCache.set(n, remote);
    } catch (e) {
      if (e.name === 'AbortError') return;
      remote = [];
    } finally {
      if (searchInput.value === q) $('.search').classList.remove('busy');
    }
  }
  if (searchInput.value !== q) return;
  lastRemote = remote;
  renderResults(q, loc, withoutLocal(loc, remote));
}

// Wikipedia: title autocomplete (good ordering) plus a full-text search limited to
// articles with a video game infobox (catches partial words mid-title). Both are
// keyless and CORS-enabled. pilicense=any is needed to get non-free box art.
async function wikiSearch(q, signal) {
  const api = params => fetch('https://en.wikipedia.org/w/api.php?' + new URLSearchParams({
    action: 'query', format: 'json', formatversion: '2', origin: '*', redirects: '1',
    prop: 'pageimages|description', piprop: 'thumbnail', pithumbsize: '240', pilicense: 'any', ...params,
  }), { signal }).then(r => r.json()).then(j => (j.query?.pages || []).sort((a, b) => a.index - b.index));
  const clean = q.replace(/[^\p{L}\p{N}' ]+/gu, ' ').trim();
  const [prefix, full] = await Promise.all([
    api({ generator: 'prefixsearch', gpssearch: q.trim(), gpslimit: '12' }),
    api({ generator: 'search', gsrsearch: `${clean}* hastemplate:"Infobox video game"`, gsrlimit: '10', gsrnamespace: '0' }),
  ]);
  const seen = new Set();
  return [...prefix.filter(p => /game/i.test(p.description || '')), ...full]
    .filter(p => !seen.has(p.pageid) && seen.add(p.pageid))
    .slice(0, 12)
    .map(p => {
      const desc = p.description || '';
      const year = +(desc.match(/\b(19[5-9]\d|20\d\d)\b/)?.[1] || p.title.match(/\((\d{4})[^)]*\)$/)?.[1] || 0) || null;
      return {
        gameId: `w-${p.pageid}`,
        name: p.title.replace(/\s*\([^)]*\b(game|video)\b[^)]*\)$/i, ''),
        year,
        cover: p.thumbnail?.source?.replace(/[?&]utm_[^#]*$/, '') || '',
        platforms: desc.replace(/\b(19[5-9]\d|20\d\d)\b/, '').replace(/\bvideo game\b/i, '').replace(/\s+/g, ' ').trim(),
      };
    });
}

// Only rows that weren't already on screen animate in, so typing doesn't replay the whole list.
let shownKeys = new Set();
function renderResults(q, loc, remote) {
  const list = [...loc, ...remote];
  lastResults = list;
  const key = g => String(g.gameId ?? norm(g.name));
  const item = (g, i) => `<li><button type="button" role="option" data-i="${i}"${shownKeys.has(key(g)) ? '' : ' class="in"'}>
      <span class="art">${g.cover ? `<img src="${esc(g.cover)}" alt="" loading="lazy" decoding="async">` : '?'}</span>
      <span class="tx"><b>${esc(g.name)}</b><small>${[g.year, g.platforms].filter(Boolean).map(esc).join(' &middot; ') || '&nbsp;'}</small></span>
      ${g.local ? '<span class="tag">POOL</span>' : ''}</button></li>`;
  const qq = q.trim();
  $('#results').innerHTML = (qq ? `<li><button type="button" data-custom="1"><span class="art">+</span><span class="tx"><b>${esc(qq)}</b><small>Add as typed, without art</small></span></button></li>` : '')
    + list.map(item).join('')
    + (!qq && !list.length ? `<li class="note">START TYPING A GAME NAME</li>` : '');
  shownKeys = new Set(list.map(key));
}

$('#results').addEventListener('click', e => {
  const b = e.target.closest('button');
  if (!b) return;
  if (b.dataset.custom) {
    const name = searchInput.value.trim();
    draft.game = { gameId: 'x-' + norm(name).replace(/ /g, '-'), name, cover: '', year: null, platforms: '' };
  } else {
    draft.game = lastResults[+b.dataset.i];
  }
  b.classList.add('sel');
  navigator.vibrate?.(10);
  searchInput.blur();
  setTimeout(() => showStep('place'), 120);
});

// placings. In team mode draft.placings holds just the winners; everyone else is 2nd.
const TEAM_PLACE = ['1ST TEAM', '2ND TEAM'];
const restOf = ids => players().filter(p => !ids.includes(p.id)).map(p => p.id);

function renderPlace() {
  const g = draft.game, ps = players(), pl = draft.placings, team = draft.team;
  $('#picked').innerHTML = `${g.cover ? `<img class="cv" src="${esc(g.cover)}" alt="">` : ''}<div class="pt"><strong>${esc(g.name)}</strong><small>${[g.year, g.platforms].filter(Boolean).map(esc).join(' &middot; ')}</small></div><button type="button" id="changeGame">CHANGE</button>`;
  $('#changeGame').onclick = () => { showStep('search', true); searchInput.value = ''; runSearch(''); searchInput.focus(); };
  $('#teamToggle').checked = team;
  $('#resetBtn').disabled = !pl.length;
  const names = ids => ids.map(id => ps.find(p => p.id === id)).filter(Boolean)
    .map(p => `<span class="nm" style="--pc:${p.color}">${esc(p.name)}</span>`).join('');
  const slots = $('#slots');
  slots.classList.toggle('team', team);
  if (team) {
    const ok = pl.length >= 1 && pl.length <= 3;
    slots.innerHTML = [pl, ok ? restOf(pl) : []].map((ids, i) => `<li><button type="button" data-slot="${i}" class="${ids.length ? 'filled' : i === 0 ? 'cur' : ''}" aria-label="${TEAM_PLACE[i]}">
      ${placeIcon(i)}${names(ids) || `<span class="nm">${TEAM_PLACE[i]}</span>`}</button></li>`).join('');
    $('#ask').innerHTML = ok ? `&#9733; READY TO SAVE &#9733;` : `TAP THE WINNING TEAM<span class="blink">_</span>`;
    $('#pads').innerHTML = ps.map(p => {
      const on = pl.includes(p.id);
      return `<button class="pad${on ? ' on' : pl.length ? ' off' : ''}" type="button" data-p="${esc(p.id)}" style="--pc:${p.color}" aria-pressed="${on}" ${!on && pl.length >= 3 ? 'disabled' : ''}>${on ? '&#9733; ' : ''}${esc(p.name)}</button>`;
    }).join('');
    $('#saveBtn').disabled = !ok;
    return;
  }
  // Solo: "=" between slots ties a player with the one above (next place follows on: 1, 1, 2, 3).
  const r = ranks();
  slots.innerHTML = PLACE.map((_, i) => {
    const p = ps.find(x => x.id === pl[i]), label = PLACE[r[i]];
    const tie = i > 0 && i <= pl.length
      ? `<button type="button" class="tie${draft.ties[i] ? ' on' : ''}" data-tie="${i}" aria-pressed="${!!draft.ties[i]}" aria-label="Tied with ${PLACE[r[i - 1]]}">=</button>` : '';
    return `<li>${tie}<button type="button" data-slot="${i}" class="${p ? 'filled' : i === pl.length ? 'cur' : ''}" ${p ? `aria-label="${label}: ${esc(p.name)}, tap to redo"` : `aria-label="${label}"`}>
      ${placeIcon(r[i])}${p ? names([p.id]) : `<span class="nm">${label}</span>`}</button></li>`;
  }).join('');
  const n = pl.length;
  $('#ask').innerHTML = n < 4 ? `WHO ${draft.ties[n] ? 'ELSE ' : ''}CAME ${PLACE[r[n]]}?<span class="blink">_</span>` : `&#9733; READY TO SAVE &#9733;`;
  $('#pads').innerHTML = ps.map(p => `<button class="pad" type="button" data-p="${esc(p.id)}" style="--pc:${p.color}" ${pl.includes(p.id) ? 'disabled' : ''}>${esc(p.name)}</button>`).join('');
  $('#saveBtn').disabled = n !== 4;
}

// Dense ranks from the tie links: [0, 0, 1, 2] for a tie for 1st.
function ranks() {
  const r = [0];
  for (let i = 1; i < 4; i++) r[i] = draft.ties[i] ? r[i - 1] : r[i - 1] + 1;
  return r;
}

$('#pads').addEventListener('click', e => {
  const b = e.target.closest('.pad');
  if (!b || b.disabled) return;
  const id = b.dataset.p, pl = draft.placings;
  if (draft.team) {
    draft.placings = pl.includes(id) ? pl.filter(x => x !== id) : [...pl, id];
    navigator.vibrate?.(15);
  } else {
    pl.push(id);
    // 4th is whoever is left.
    if (pl.length === 3) pl.push(...restOf(pl));
    navigator.vibrate?.(pl.length === 4 ? [15, 40, 15] : 15);
  }
  renderPlace();
});
$('#slots').addEventListener('click', e => {
  const tie = e.target.closest('[data-tie]');
  if (tie) {
    const i = +tie.dataset.tie;
    draft.ties[i] = !draft.ties[i];
    navigator.vibrate?.(10);
    renderPlace();
    return;
  }
  const b = e.target.closest('[data-slot]');
  if (!b) return;
  const i = +b.dataset.slot;
  if (draft.team) { if (i === 0 && draft.placings.length) { draft.placings = []; renderPlace(); } return; }
  if (i < draft.placings.length) {
    draft.placings = draft.placings.slice(0, Math.min(i, 2));
    draft.ties = draft.ties.map((t, j) => j <= draft.placings.length && t);
    renderPlace();
  }
});
$('#teamToggle').addEventListener('change', e => {
  draft.team = e.target.checked;
  draft.placings = [];
  draft.ties = [false, false, false, false];
  navigator.vibrate?.(10);
  renderPlace();
});
$('#resetBtn').onclick = () => {
  draft.placings = [];
  draft.ties = [false, false, false, false];
  navigator.vibrate?.(10);
  renderPlace();
};

$('#saveBtn').onclick = () => {
  let team = draft.team, k = draft.placings.length;
  if (team ? !(k >= 1 && k <= 3) : k !== 4) return;
  const t = S.t, g = draft.game;
  const placings = team ? [...draft.placings, ...restOf(draft.placings)] : draft.placings;
  // Solo ties: only joint 1sts and 2nds is a team game; anything else keeps its tied ranks.
  let rk = null;
  if (!team && draft.ties.some(Boolean)) {
    rk = ranks();
    if (rk.every(x => x <= 1) && rk.includes(1)) { team = true; k = rk.filter(x => x === 0).length; rk = null; }
  }
  const data = { gameId: g.gameId, name: g.name, cover: g.cover || '', year: g.year || null, platforms: g.platforms || '', placings, team, winners: team ? k : null, ranks: rk };
  const fail = () => toast('SAVE FAILED - CHECK PIN / SIGNAL', true);
  if (draft.id) {
    S.flash = draft.id;
    store.updateGame(t, draft.id, data).catch(fail);
    toast('RESULT UPDATED');
  } else {
    const order = Math.max(0, ...S.games.map(x => x.order || 0)) + 1;
    store.addGame(t, { ...data, order }).catch(fail);
    toast(`${g.name.toUpperCase()} SAVED!`);
  }
  if (g.gameId) store.savePool(t, g).catch(() => {});
  if (pool && !pool.some(p => String(p.id) === String(g.gameId))) pool.push({ id: String(g.gameId), ...g });
  closeSheet($('#gameSheet'));
};

$('#deleteBtn').onclick = () => {
  const b = $('#deleteBtn');
  if (!b.classList.contains('armed')) { b.classList.add('armed'); b.textContent = 'SURE?'; return; }
  store.deleteGame(S.t, draft.id).catch(() => toast('DELETE FAILED', true));
  toast('GAME DELETED');
  closeSheet($('#gameSheet'));
};

// ---------- standings ----------
function renderStandings() {
  const st = S.st, sc = scoring();
  if (!st) return;
  const rankIcon = pos => placeIcon(Math.min(pos, 3));
  const chipP = st.chip && pById(st.chip.holder);
  $('#standingsTitle').innerHTML = `${px(TROPHY, 'gold')} STANDINGS`;
  $('#standingsBody').innerHTML = `
    <ol class="stand">${st.table.map((r, i) => {
      const p = pById(r.id);
      return `<li style="animation-delay:${i * 60}ms">
        <span class="rk">${rankIcon(r.pos)}</span>
        <span class="who"><b style="--pc:${p.color}">${esc(p.name)}${st.chip?.holder === r.id ? chipIcon() : ''}</b>
          <small>${r.places.map((n, k) => `${PLACE[k]}&times;${n}`).join(' ')}${sc.wackChip ? ` &middot; WACK +${r.bonus}` : ''}</small></span>
        <span class="tot">${r.points}<small>PTS</small></span>
      </li>`;
    }).join('')}</ol>
    <p class="sub">GAMES <b>${S.games.length}</b> &middot; POINTS <b>${sc.points.join('/')}</b>${sc.lowWins ? ' &middot; <b>LOWEST WINS</b>' : ''}
    ${sc.wackChip ? `<br>WACK CHIP <b>ON</b>${chipP ? ` &middot; HELD BY <b style="color:${chipP.color}">${esc(chipP.name)}</b> (+${st.chip.next} NEXT GAME)` : ''}` : ''}</p>
    ${live() && S.games.length && (trusted || S.editable) ? `<button class="btn pundit-btn" id="punditBtn" type="button">${px(MIC)} PUNDIT'S VERDICT<span class="uses" aria-label="verdicts used">${punditUses(S.t)}/${PUNDIT_MAX}</span></button>` : ''}`;
  $('#adminBtn').hidden = false;
}

function exportText() {
  const tr = S.tour, st = S.st, sc = scoring();
  const name = id => pById(id)?.name || '?';
  const title = `${tr.title || 'RVGD ' + roman(tr.number)}${tr.subtitle ? ': ' + tr.subtitle : ''}`;
  const lines = [
    title,
    `Players: ${players().map(p => p.name).join(', ')}`,
    (sc.lowWins ? 'Scoring: each player scores their finishing place (1st = 1, 2nd = 2, 3rd = 3, 4th = 4) and the lowest total wins. Tied players share the same place' : `Scoring: 1st ${sc.points[0]}, 2nd ${sc.points[1]}, 3rd ${sc.points[2]}, 4th ${sc.points[3]}`)
      + '. Team games: everyone on the winning team scores 1st, everyone on the losing team scores 2nd.'
      + (sc.wackChip ? ' Wack Chip ON: whoever is last overall holds it; it adds +1, +2, +3... to their score for each game they keep holding it, and resets to 0 when it passes on.' : ' Wack Chip OFF.'),
    `Status: ${live() ? 'in progress' : 'complete'} | Games played: ${S.games.length}`,
    '',
    `# | Game | Year | Type | 1st | 2nd | 3rd | 4th${sc.wackChip ? ' | Wack bonus' : ''}`,
    ...S.games.map((g, i) => {
      const b = st.perGame[g.id]?.bonus;
      const pl = g.placings || [];
      const cols = [0, 1, 2, 3].map(k => pl.filter((_, j) => placeOf(g, j) === k).map(name).join(' & ') || '-');
      return [i + 1, g.name, g.year || '', g.team ? 'team' : 'solo', ...cols, ...(sc.wackChip ? [b ? `${name(b.player)} +${b.amount}` : '-'] : [])].join(' | ');
    }),
    '',
    'STANDINGS',
    `Pos | Player | Total | Base | ${sc.wackChip ? 'Wack | ' : ''}1st | 2nd | 3rd | 4th`,
    ...st.table.map(r => [r.pos + 1, name(r.id), r.points, r.base, ...(sc.wackChip ? [r.bonus] : []), ...r.places].join(' | ')),
  ];
  if (st.chip) lines.push('', `Wack Chip currently held by ${name(st.chip.holder)} (worth +${st.chip.next} next game)`);
  return lines.join('\n');
}

$('#copyBtn').onclick = async () => {
  const text = exportText();
  try { await navigator.clipboard.writeText(text); }
  catch {
    const ta = Object.assign(document.createElement('textarea'), { value: text });
    $('#standingsSheet').append(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
  }
  toast('COPIED! PASTE IT ANYWHERE');
};

// ---------- AI pundit ----------
// The verdict is kept (across closing and reopening the sheet) until someone presses
// ANOTHER; only a different tournament starts afresh. punditFor = { t, games } it was written for.
let punditText = '', punditFor = null, punditBusy = false;
function punditWhen() {
  const n = punditFor?.games, since = S.games.length - n;
  $('#punditWhen').innerHTML = punditText && n ? `WRITTEN AFTER GAME ${n}${since > 0 ? ` &middot; ${plural(since, 'GAME')} AGO, PRESS ANOTHER FOR AN UPDATE` : ''}` : '';
}
// This phone's verdicts for a tournament (localStorage), so the pundit can number its updates,
// call back to earlier ones and avoid repeating jokes. A reroll (ANOTHER with no new games)
// replaces the latest verdict rather than counting as a new update.
const punditKey = t => `rvgd-pundit-${t}`;
// Verdicts per tournament (every successful ask, rerolls included), counted by the Worker in
// Cloudflare KV so every phone shares the limit; it refuses once a tournament reaches the cap.
// Cached here, refreshed when the standings open and after each ask. At the cap the last
// verdict can still be read and played. The cap itself comes from the Worker (MAX_VERDICTS),
// so changing it there is enough; 12 is only the fallback until it has answered.
let PUNDIT_MAX = 12;
const punditCount = {};
const punditUses = t => punditCount[t] ?? 0;
const punditSpent = () => punditUses(S.t) >= PUNDIT_MAX;
function setPunditUses(t, n, max) {
  if (Number.isFinite(max) && max > 0) PUNDIT_MAX = max;
  if (!Number.isFinite(n)) return;
  punditCount[t] = n;
  const b = $('#punditBtn .uses');
  if (b && S.t === t) b.textContent = `${n}/${PUNDIT_MAX}`;
  if ($('#punditSheet').open && S.t === t && !punditBusy) punditControls();
}
async function refreshPunditUses(t) {
  try {
    const r = await fetch(`${PUNDIT_URL}/uses?t=${encodeURIComponent(t)}`);
    if (r.ok) { const j = await r.json(); setPunditUses(t, +j.uses, +j.max); }
  } catch {}
}
function punditHistory(t) {
  try { return JSON.parse(localStorage.getItem(punditKey(t))) || []; } catch { return []; }
}
function savePundit(t, games, text) {
  const h = punditHistory(t);
  if (h.length && h[h.length - 1].games === games) h.pop();
  h.push({ games, text });
  try { localStorage.setItem(punditKey(t), JSON.stringify(h.slice(-10))); } catch {}
}
function historyLines(t) {
  const h = punditHistory(t).filter(v => v.games < S.games.length);
  if (!h.length) return ['', 'PUNDIT HISTORY: This is your first update of the day.'];
  return ['', `PUNDIT HISTORY: This is your update number ${h.length + 1} of the day. Your earlier updates (oldest first):`,
    ...h.slice(-3).map(v => `- After game ${v.games}: "${v.text.replace(/\s*\n+\s*/g, ' ')}"`)];
}
function punditSummary() {
  const last = S.games[S.games.length - 1];
  const lastRank = last ? Math.max(...last.placings.map((_, i) => placeOf(last, i))) : -1;
  const pickers = last ? last.placings.filter((_, i) => placeOf(last, i) === lastRank).map(id => pById(id)?.name) : [];
  const tbl = S.st.table;
  return [exportText(), '',
    `Last game: ${last.name}, where ${pickers.join(' and ')} came last, so ${pickers.join(' or ')} ${pickers.length > 1 ? 'pick' : 'picks'} the next game.`,
    // Ready-made gaps: the model is unreliable at subtracting scores itself.
    leaderLine(tbl),
    `Gap from 1st to last overall: ${plural(Math.abs(tbl[0].points - tbl[tbl.length - 1].points), 'point')}.`,
    ...historyLines(S.t)].join('\n');
}
function leaderLine(tbl) {
  const name = r => pById(r.id)?.name;
  const top = tbl.filter(r => r.pos === 0), next = tbl.find(r => r.pos > 0);
  if (top.length > 1) return `Joint leaders: ${top.map(name).join(' and ')} on ${top[0].points} points.`;
  return `Leader: ${name(top[0])}, ${plural(Math.abs(top[0].points - next.points), 'point')} clear of ${tbl.filter(r => r.pos === next.pos).map(name).join(' and ')}.`;
}
async function askPundit() {
  if (punditBusy || punditSpent()) return;
  stopPundit();
  const mine = punditFor = { t: S.t, games: S.games.length };
  punditText = '';
  punditBusy = true;
  punditWhen();
  $('#punditText').innerHTML = `<span class="blink">THE PUNDIT IS THINKING...</span>`;
  ['#punditSay', '#punditCopy', '#punditAgain'].forEach(s => $(s).disabled = true);
  let text = '', error = '';
  try {
    const r = await fetch(PUNDIT_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ summary: punditSummary(), t: mine.t }) });
    // 429 = refused: error 'out-of-tokens' (the free daily AI allowance is used up, resets at
    // midnight UTC) or 'limit' (this tournament has had all its verdicts).
    const j = await r.json().catch(() => ({}));
    setPunditUses(mine.t, +j.uses, +j.max);
    error = j.error || (r.ok ? '' : 'failed');
    text = r.ok ? String(j.text || '').trim() : '';
  } catch { error = 'failed'; }
  punditBusy = false;
  if (punditFor !== mine) return; // moved to another tournament meanwhile
  punditText = text;
  if (text) {
    $('#punditText').textContent = text;
    savePundit(mine.t, mine.games, text);
  } else {
    punditFor = null;
    $('#punditText').innerHTML = `<span class="err">${error === 'out-of-tokens' ? 'OUT OF TOKENS.'
      : error === 'limit' ? `ALL ${PUNDIT_MAX} VERDICTS USED.` : 'THE PUNDIT HAS LOST HIS VOICE. TRY AGAIN IN A MINUTE.'}</span>`;
  }
  punditControls();
}
// Buttons and caption for whatever verdict is showing; ANOTHER is off once the cap is reached.
function punditControls() {
  punditWhen();
  if (punditSpent() && punditText) $('#punditWhen').innerHTML += ` &middot; ALL ${PUNDIT_MAX} VERDICTS USED`;
  $('#punditAgain').disabled = punditSpent();
  $('#punditSay').disabled = $('#punditCopy').disabled = !punditText;
  $('#punditSay').innerHTML = '&#9654; LISTEN';
}
// Read it out with the phone's own voice, British if it has one.
function pickVoice() {
  const vs = window.speechSynthesis.getVoices();
  return vs.find(v => v.lang === 'en-GB' && /daniel|male|george|arthur|oliver/i.test(v.name)) || vs.find(v => v.lang === 'en-GB') || vs.find(v => v.lang.startsWith('en')) || null;
}
window.speechSynthesis?.getVoices();
// Voiceover: the Worker's /speak (Deepgram Aura via Workers AI), one clip per paragraph with a
// pause between them. Falls back to the phone's own voice if the Worker can't be reached.
const PARA_GAP = 700; // ms of silence between paragraphs
// A silent clip played inside the tap: iOS only lets an <audio> play later if it started in a tap.
const SILENT = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAESsAACJWAAACABAAZGF0YQAAAAA=';
const paragraphs = text => text.split(/\n+/).map(p => p.trim()).filter(Boolean);
let punditAudio = null, gapTimer = 0;
const sayLabel = () => { $('#punditSay').innerHTML = '&#9654; LISTEN'; };
function stopPundit() {
  clearTimeout(gapTimer);
  if (punditAudio) { punditAudio.pause(); punditAudio = null; }
  window.speechSynthesis?.cancel();
  sayLabel();
}
// The voice uses most of the Worker's free daily allowance, so each verdict is only voiced once:
// the clips are kept as blobs and LISTEN again replays them (until ANOTHER).
let spoken = null; // { text, clips: [Promise<blob url>] }
async function fetchClip(p) {
  const r = await fetch(`${PUNDIT_URL}/speak?text=${encodeURIComponent(p)}`);
  if (!r.ok) throw new Error(r.status);
  return URL.createObjectURL(await r.blob());
}
$('#punditSay').onclick = () => {
  if (punditAudio || window.speechSynthesis?.speaking) return stopPundit();
  const a = punditAudio = new Audio(SILENT);
  a.play().catch(() => {});
  if (spoken?.text !== punditText) {
    spoken?.clips.forEach(c => c.then(URL.revokeObjectURL, () => {}));
    // Fetch every paragraph at once, so the next one is ready when the gap ends.
    spoken = { text: punditText, clips: paragraphs(punditText).map(p => { const c = fetchClip(p); c.catch(() => {}); return c; }) };
  }
  $('#punditSay').innerHTML = '&#9632; STOP';
  playClip(a, spoken, 0);
};
async function playClip(a, sp, i) {
  if (punditAudio !== a) return;
  if (i >= sp.clips.length) { punditAudio = null; return sayLabel(); }
  let url;
  try { url = await sp.clips[i]; } catch { url = null; }
  if (punditAudio !== a) return;
  const fail = () => { if (punditAudio !== a) return; if (spoken === sp) spoken = null; punditAudio = null; speakLocally(paragraphs(sp.text).slice(i)); };
  if (!url) return fail();
  a.onended = () => { gapTimer = setTimeout(() => playClip(a, sp, i + 1), PARA_GAP); };
  a.onerror = fail;
  a.src = url;
  // The TTS model has no speed setting; play it a touch slower (browsers keep the pitch).
  a.defaultPlaybackRate = a.playbackRate = 0.9;
  a.play().catch(fail);
}
function speakLocally(paras = paragraphs(punditText)) {
  const synth = window.speechSynthesis;
  if (!synth) { sayLabel(); return toast('NO VOICE ON THIS DEVICE', true); }
  const v = pickVoice();
  paras.forEach((p, i) => {
    const u = new SpeechSynthesisUtterance(p);
    if (v) { u.voice = v; u.lang = v.lang; }
    u.rate = 0.95; u.pitch = 0.9;
    if (i === paras.length - 1) u.onend = u.onerror = sayLabel;
    synth.speak(u);
  });
  $('#punditSay').innerHTML = '&#9632; STOP';
}
$('#punditAgain').onclick = askPundit;
$('#punditCopy').onclick = async () => {
  try { await navigator.clipboard.writeText(punditText); toast('COPIED!'); } catch { toast('COULD NOT COPY', true); }
};
// Closing keeps the verdict (and its voiceover) for next time; only ANOTHER asks again.
$('#punditSheet').addEventListener('close', stopPundit);
$('#standingsBody').addEventListener('click', e => {
  if (!e.target.closest('#punditBtn')) return;
  $('#punditTitle').innerHTML = `${px(MIC)} PUNDIT`;
  openSheet($('#punditSheet'));
  refreshPunditUses(S.t);
  if (punditFor?.t === S.t && punditBusy) return punditWhen();
  if (punditFor?.t === S.t && punditText) return punditControls();
  // After a reload (or a failed ask), bring back this phone's latest verdict rather than asking again.
  const last = punditHistory(S.t).pop();
  if (last && !punditBusy) {
    stopPundit();
    punditFor = { t: S.t, games: last.games };
    punditText = last.text;
    $('#punditText').textContent = last.text;
    return punditControls();
  }
  if (punditSpent()) {
    punditText = '';
    $('#punditText').innerHTML = `<span class="err">ALL ${PUNDIT_MAX} VERDICTS USED.</span>`;
    return punditControls();
  }
  punditBusy = false;
  askPundit();
});

// ---------- stats ----------
const swatch = p => `<span class="pn"><i style="background:${p.color}"></i>${esc(p.name)}</span>`;
const who = ids => ids.map(id => swatch(pById(id))).join('<span class="amp">&amp;</span>');

function renderStats() {
  const ps = players(), sc = scoring();
  const s = computeStats(ps, S.games, sc);
  $('#statsTitle').innerHTML = `${px(CHART)} STATS`;
  if (s.games < 2) {
    $('#statsBody').innerHTML = `<div class="empty"><p>PLAY A COUPLE OF GAMES<br>TO UNLOCK STATS</p></div>`;
    return;
  }
  const { top, per, games } = s;
  const plural = (n, one, many = one + 's') => `${n} ${n === 1 ? one : many}`;
  const range = r => r.from === r.to ? `game #${r.from}` : `games #${r.from}&ndash;${r.to}`;
  const tiles = [];
  const add = (label, html, detail) => tiles.push(`<div class="tile"><small>${label}</small><b>${html}</b><span>${detail}</span></div>`);

  let t = top(x => x.wins);
  add('MOST WINS', who(t.ids), plural(t.value, 'win'));
  t = top(x => x.lasts);
  add('MOST LAST PLACES', who(t.ids), plural(t.value, 'wooden spoon'));
  t = top(x => x.winStreak.n);
  if (t.value >= 2) add('LONGEST WIN STREAK', who(t.ids), `${plural(t.value, 'win')} in a row${t.ids.length === 1 ? ` &middot; ${range(per[t.ids[0]].winStreak)}` : ''}`);
  t = top(x => x.slump.n);
  add('LONGEST SLUMP', who(t.ids), `${plural(t.value, 'game')} without a win${t.ids.length === 1 ? ` &middot; ${range(per[t.ids[0]].slump)}` : ''}`);
  t = top(x => x.placeSum / x.played, true);
  add('BEST RATING', who(t.ids), `${rating(t.value)} (100% = always 1st)`);
  t = top(x => x.ledFor);
  add('TIME AT THE TOP', who(t.ids), `leading after ${t.value} of ${games} games`);
  tiles.push(`<div class="tile"><small>LEAD CHANGES</small><b class="big">${s.leadChanges}</b><span>${s.leadChanges ? 'times the lead swapped hands' : 'led from start to finish'}</span></div>`);
  t = top(x => x.picks >= 2 ? x.pickWins / x.picks : -1);
  if (t.value >= 0) add('LOSER&rsquo;S REVENGE', who(t.ids), t.ids.length === 1
    ? `won ${per[t.ids[0]].pickWins} of the ${plural(per[t.ids[0]].picks, 'game')} they picked`
    : `won ${Math.round(t.value * 100)}% of the games they picked`);
  if (s.rivalry) {
    const r = s.rivalry;
    add('BIGGEST RIVALRY', `${who([r.winner])}<span class="amp">vs</span>${who([r.loser])}`, `finished above them ${r.wins}&ndash;${r.losses}`);
  }
  t = top(x => x.teamPlayed ? x.teamWins : -1);
  if (t.value > 0) add('TEAM PLAYER', who(t.ids), `${plural(t.value, 'team win')} from ${plural(per[t.ids[0]].teamPlayed, 'team game')}`);
  if (s.chip?.hold.player) add('LONGEST WACK HOLD', who([s.chip.hold.player]), `held the chip for ${plural(s.chip.hold.n, 'game')}`);
  if (s.chip?.payout) add('BIGGEST WACK PAYOUT', who([s.chip.payout.player]), `+${s.chip.payout.amount} on ${esc(s.chip.payout.game)}`);

  $('#statsBody').innerHTML = `
    <section class="race">
      <h3>THE RACE <small>${sc.lowWins ? 'vs average &middot; up = better (lowest total wins)' : 'points above / below average'}</small></h3>
      <div class="chart" id="raceChart">${raceSvg(s, ps, sc)}<div class="tip" id="raceTip" hidden></div></div>
      <ul class="legend">${ps.map(p => `<li>${swatch(p)}</li>`).join('')}</ul>
      <details class="tview"><summary>VIEW AS TABLE</summary>${raceTable(s, ps)}</details>
    </section>
    <div class="tiles">${tiles.join('')}</div>`;
  bindRace(s, ps, sc);
}

// Running totals as the gap to the group average (flipped when lowest wins, so up is always better).
const RACE = { W: 420, H: 230, L: 34, R: 66, T: 12, B: 26 };
function raceGeom(s, ps, sc) {
  const sign = sc.lowWins ? -1 : 1;
  const series = [Object.fromEntries(ps.map(p => [p.id, 0])), ...s.history.map(h => {
    const mean = ps.reduce((a, p) => a + h.pts[p.id], 0) / ps.length;
    return Object.fromEntries(ps.map(p => [p.id, sign * (h.pts[p.id] - mean)]));
  })];
  const vals = series.flatMap(o => Object.values(o));
  let lo = Math.min(0, ...vals), hi = Math.max(0, ...vals);
  const step = [1, 2, 5, 10, 20, 25, 50, 100].find(st => (hi - lo) / st <= 5) || 100;
  lo = Math.floor(lo / step) * step;
  hi = Math.max(Math.ceil(hi / step) * step, lo + step);
  const { W, H, L, R, T, B } = RACE;
  const x = i => L + (i / (series.length - 1)) * (W - L - R);
  const y = v => T + (hi - v) / (hi - lo) * (H - T - B);
  return { series, lo, hi, step, x, y };
}

function raceSvg(s, ps, sc) {
  const { W, H, L, R, T, B } = RACE;
  const { series, lo, hi, step, x, y } = raceGeom(s, ps, sc);
  const n = series.length - 1;
  const fmt = v => (v > 0 ? '+' : '') + Math.round(v * 10) / 10;
  let grid = '';
  for (let v = lo; v <= hi + 1e-9; v += step) {
    grid += `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" class="${v === 0 ? 'zero' : 'gl'}"/><text x="${L - 6}" y="${y(v) + 5}" text-anchor="end" class="ax">${fmt(v)}</text>`;
  }
  const every = Math.max(1, Math.ceil(n / 6));
  let xt = '';
  for (let i = 0; i <= n; i += every) xt += `<text x="${x(i)}" y="${H - 8}" text-anchor="middle" class="ax">${i === 0 ? 'START' : '#' + i}</text>`;
  const lines = ps.map(p => `<path d="${series.map((o, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(o[p.id]).toFixed(1)}`).join('')}" stroke="${p.color}" class="ln"/>`).join('');
  // Direct labels at the line ends, nudged apart so they never overlap.
  const ends = ps.map(p => ({ p, y: y(series[n][p.id]) })).sort((a, b) => a.y - b.y);
  ends.forEach((e, i) => { e.ly = i ? Math.max(e.y, ends[i - 1].ly + 15) : e.y; });
  const labels = ends.map(e => `<circle cx="${x(n)}" cy="${e.y}" r="4.5" fill="${e.p.color}" class="dot"/><text x="${x(n) + 10}" y="${e.ly + 5}" class="lbl">${esc(e.p.name)}</text>`).join('');
  const sum = ps.map(p => `${p.name} ${fmt(series[n][p.id])}`).join(', ');
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Points versus the average after each game. Final: ${esc(sum)}">
    ${grid}${xt}${lines}${labels}
    <line id="raceCross" class="cross" y1="${T}" y2="${H - B}" x1="-10" x2="-10"/>
    <g id="raceDots"></g>
    <rect x="${L}" y="0" width="${W - L - R + 1}" height="${H}" fill="transparent" id="raceHit"/>
  </svg>`;
}

function raceTable(s, ps) {
  return `<table><thead><tr><th>#</th><th>GAME</th>${ps.map(p => `<th>${esc(p.name)}</th>`).join('')}</tr></thead><tbody>${
    s.history.map((h, i) => `<tr><td>${i + 1}</td><td>${esc(S.games[i]?.name || '')}</td>${ps.map(p => `<td>${h.pts[p.id]}</td>`).join('')}</tr>`).join('')
  }</tbody></table>`;
}

// Crosshair + tooltip: tap or hover on the plot to read the totals after that game.
function bindRace(s, ps, sc) {
  const svg = $('#raceChart svg'), tip = $('#raceTip'), cross = $('#raceCross');
  const { series, x, y } = raceGeom(s, ps, sc);
  const n = series.length - 1;
  const show = e => {
    const r = svg.getBoundingClientRect();
    const vx = (e.clientX - r.left) / r.width * RACE.W;
    const i = Math.max(1, Math.min(n, Math.round((vx - RACE.L) / (RACE.W - RACE.L - RACE.R) * n)));
    cross.setAttribute('x1', x(i));
    cross.setAttribute('x2', x(i));
    $('#raceDots').innerHTML = ps.map(p => `<circle cx="${x(i)}" cy="${y(series[i][p.id])}" r="5" fill="${p.color}" class="dot"/>`).join('');
    const h = s.history[i - 1];
    const order = [...ps].sort((a, b) => sc.lowWins ? h.pts[a.id] - h.pts[b.id] : h.pts[b.id] - h.pts[a.id]);
    tip.innerHTML = `<b>#${i} ${esc(S.games[i - 1]?.name || '')}</b>${order.map(p => `<div>${swatch(p)}<span>${h.pts[p.id]}</span></div>`).join('')}`;
    tip.hidden = false;
    const left = x(i) / RACE.W * r.width;
    tip.style.left = `${Math.min(Math.max(left - tip.offsetWidth / 2, 0), r.width - tip.offsetWidth)}px`;
  };
  const hit = $('#raceHit');
  hit.addEventListener('pointermove', show);
  hit.addEventListener('pointerdown', show);
  hit.addEventListener('pointerleave', e => {
    if (e.pointerType !== 'mouse') return;
    tip.hidden = true;
    cross.setAttribute('x1', -10);
    cross.setAttribute('x2', -10);
    $('#raceDots').innerHTML = '';
  });
}

// ---------- all-time stats (archive) ----------
async function openGlobal() {
  $('#statsTitle').innerHTML = `${px(TROPHY, 'gold')} HALL OF FAME`;
  $('#statsBody').innerHTML = `<p class="loading">LOADING<span class="blink">_</span></p>`;
  openSheet($('#statsSheet'));
  let g, exhibitions = 0;
  try {
    const list = await store.listTournaments();
    // Exhibitions keep their own page but stay out of all-time stats.
    exhibitions = list.filter(t => t.exhibition).length;
    const tours = await Promise.all(list.filter(t => !t.exhibition).map(async t => ({ ...t, games: await store.loadGames(t.id) })));
    g = computeGlobal(tours);
  } catch {
    $('#statsBody').innerHTML = `<div class="empty"><p>COULD NOT LOAD STATS.</p></div>`;
    return;
  }
  if (!g.players.length) {
    $('#statsBody').innerHTML = `<div class="empty"><p>NO GAMES PLAYED YET</p></div>`;
    return;
  }
  const pct = v => `${Math.round(v * 100)}%`;
  const art = c => `<span class="gart">${c ? `<img src="${esc(c)}" alt="" loading="lazy">` : '?'}</span>`;
  const gameLine = (b, label) => b ? `<div class="gl2" data-game="${esc(b.id)}" role="button" tabindex="0">${art(b.cover)}<div><small>${label}</small><b>${esc(b.name)}</b>
    <span>${b.plays} ${b.plays === 1 ? 'play' : 'plays'} &middot; ${b.wins} ${b.wins === 1 ? 'win' : 'wins'}</span></div></div>` : '';
  const names = g.players.map(p => p.name);
  const odds = fakeOdds(g.players);

  $('#statsBody').innerHTML = `
    <div class="kpis">
      <div><b>${g.tournaments}</b><small>TOURNAMENTS</small></div>
      <div><b>${g.games}</b><small>GAMES</small></div>
      <div><b>${g.players.length}</b><small>PLAYERS</small></div>
    </div>
    ${exhibitions ? `<p class="note">${exhibitions} exhibition ${exhibitions === 1 ? 'tournament is' : 'tournaments are'} not counted.</p>` : ''}

    ${g.closest.length ? `<h3 class="hh">RECORDS</h3>
    <div class="tiles">${g.closest.map(c => `
      <a class="tile link" data-nav href="${BASE}?t=${esc(c.id)}"><small>CLOSEST FINISH</small><b>RVGD ${roman(c.number)}${c.subtitle ? `<span class="amp">${esc(c.subtitle)}</span>` : ''}</b>
        <span>all four within ${c.spread} ${c.spread === 1 ? 'point' : 'points'} over ${c.games} games
          &middot; ${esc(c.first.name)} ${c.first.points} to ${esc(c.last.name)} ${c.last.points}</span></a>`).join('')}
      ${g.comeback ? `<a class="tile link" data-nav href="${BASE}?t=${esc(g.comeback.id)}"><small>GREATEST COMEBACK</small><b>${esc(g.comeback.champion)}<span class="amp">RVGD ${roman(g.comeback.number)}</span></b>
        <span>${g.comeback.deficit} ${g.comeback.deficit === 1 ? 'point' : 'points'} off the lead after game ${g.comeback.after}${g.comeback.lastAtHalf ? ', last at halfway,' : ''} and still won</span></a>` : ''}
      ${g.bestEvent.map(e => `<a class="tile link" data-nav href="${BASE}?t=${esc(e.id)}"><small>BEST SINGLE EVENT</small><b>${esc(e.name)}<span class="amp">RVGD ${roman(e.number)}</span></b>
        <span>won ${e.wins} of ${e.games} games</span></a>`).join('')}
      ${g.winStreak ? `<a class="tile link" data-nav href="${BASE}?t=${esc(g.winStreak.id)}"><small>LONGEST WIN STREAK</small><b>${esc(g.winStreak.name)}<span class="amp">RVGD ${roman(g.winStreak.number)}</span></b>
        <span>${g.winStreak.n} wins in a row, ${esc(g.winStreak.from)} to ${esc(g.winStreak.to)}</span></a>` : ''}
      ${g.chaos ? `<div class="tile"><small>MOST CHAOTIC GAME</small><b>${esc(g.chaos.name)}</b>
        <span>shared places in ${g.chaos.tied} of ${g.chaos.plays} plays</span></div>` : ''}
    </div>` : ''}

    <h3 class="hh">CAREER</h3>
    <div class="scroll"><table class="career">
      <thead><tr><th>PLAYER</th><th title="Titles">${px(TROPHY, 'gold')}</th><th>EVENTS</th><th>GAMES</th><th>WINS</th><th>WIN %</th><th>RATING</th></tr></thead>
      <tbody>${g.players.map(p => `<tr><td><button class="plink" type="button" data-who="${esc(p.name)}">${esc(p.name)}</button></td><td class="hl">${p.titles}</td><td>${p.tournaments}</td><td>${p.games}</td>
        <td>${p.wins}</td><td>${pct(p.winRate)}</td><td>${rating(p.avg)}</td></tr>`).join('')}</tbody>
    </table></div>
    <p class="note">RATING = how high they finish on average: 100% = always 1st, 0% = always last, whatever the scoring.</p>

    ${g.players.some(p => p.form.length) ? `<h3 class="hh">FORM</h3>
    <ul class="formg">${g.players.map((p, i) => `<li><b>${esc(p.name)}</b><span>${p.form.map(f =>
      `<i class="f${Math.min(f.pos, 4)}" title="RVGD ${roman(f.number)}: ${PLACE[f.pos - 1] || f.pos}">${f.pos}<em>${roman(f.number)}</em></i>`).join('')}</span><small class="odds">ODDS<b>${odds[i]}</b></small></li>`).join('')}</ul>
    <p class="note">Overall finish in each of their last five tournaments, oldest to latest. Odds to win the next one are made up from form and win rate, with the bookie's cut. Not financial advice.</p>` : ''}

    <h3 class="hh">BEST &amp; WEAKEST GAMES</h3>
    <div class="pgames">${g.players.map(p => `<div class="pg"><h4>${esc(p.name)}</h4>
      ${gameLine(p.best, 'BEST')}${gameLine(p.worst, 'WEAKEST')}</div>`).join('')}</div>
    <p class="note">By average finish on games played at least twice, where there are any.</p>

    <h3 class="hh">MOST PLAYED</h3>
    <ol class="mp">${g.mostPlayed.map(m => `<li data-game="${esc(m.id)}" role="button" tabindex="0">${art(m.cover)}<b>${esc(m.name)}</b>
      <span>${m.plays}&times;${m.tours > 1 ? ` &middot; ${m.tours} events` : ''}</span></li>`).join('')}</ol>`;
}

// ---------- game finder ----------
// Search every game played (exhibitions excluded, like the Hall of Fame), open a game card,
// or pick a player to see the games they do best and worst at compared with their usual finish.
const GB = { book: null, stack: [], q: '' };
const gArt = (c, cls = 'gart') => `<span class="${cls}">${c ? `<img src="${esc(c)}" alt="" loading="lazy">` : '?'}</span>`;
const tourLabel = t => t.number ? `RVGD ${roman(t.number)}` : 'EXHIBITION';
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
const vsUsual = v => { const n = Math.round(v / 3 * 100); return n ? `<span class="${n > 0 ? 'vsup' : 'vsdn'}">${n > 0 ? '+' : '&minus;'}${Math.abs(n)}%</span>` : `<span class="vs0">&plusmn;0%</span>`; };
const searchKey = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '');

async function openGames(view = { view: 'list' }) {
  openSheet($('#gamesSheet'));
  GB.stack = [];
  $('#gamesBack').hidden = true;
  $('#gamesTitle').innerHTML = `${px(PAD)} GAMES`;
  $('#gamesBody').innerHTML = `<p class="loading">LOADING<span class="blink">_</span></p>`;
  try {
    const list = await store.listTournaments();
    const tours = await Promise.all(list.filter(t => !t.exhibition).map(async t => ({ ...t, games: await store.loadGames(t.id) })));
    GB.book = computeGameBook(tours);
  } catch {
    $('#gamesBody').innerHTML = `<div class="empty"><p>COULD NOT LOAD GAMES.</p></div>`;
    return;
  }
  showGames(view);
}
function showGames(v, push = false) {
  if (push && GB.cur) GB.stack.push(GB.cur);
  GB.cur = v;
  $('#gamesBack').hidden = !GB.stack.length;
  const body = $('#gamesBody');
  if (v.view === 'game') body.innerHTML = gameCard(GB.book.byId[v.id]);
  else if (v.view === 'player') body.innerHTML = playerView(v.who);
  else {
    body.innerHTML = `
      <label class="search"><span class="prompt" aria-hidden="true">&#9654;</span>
        <input id="gameQ" type="search" placeholder="FIND A GAME" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" aria-label="Find a game" value="${esc(GB.q)}"></label>
      <div class="pchips"><small>OR PICK A PLAYER</small>${GB.book.players.map(p => `<button class="pchip" type="button" data-who="${esc(p.name)}">${esc(p.name)}</button>`).join('')}</div>
      <ul class="glist" id="gList"></ul>`;
    renderGameList();
  }
  $('#gamesSheet .sheet-in').scrollTop = 0;
}
function renderGameList() {
  const q = searchKey(GB.q);
  const hits = GB.book.games.filter(g => !q || searchKey(g.name).includes(q));
  $('#gList').innerHTML = hits.map(g => `<li><button type="button" data-game="${esc(g.id)}">${gArt(g.cover)}
    <span class="tx"><b>${esc(g.name)}</b><small>${plural(g.plays, 'play')} &middot; ${[...new Set([g.tours[0], g.tours[g.tours.length - 1]])].map(t => roman(t.number)).join('&ndash;')}</small></span></button></li>`).join('')
    || `<li class="note">NO PLAYED GAME MATCHES THAT.</li>`;
}

function gameCard(x) {
  if (!x) return `<div class="empty"><p>GAME NOT FOUND</p></div>`;
  const names = list => list.map(p => esc(p.name)).join(' &amp; ');
  const first = x.tours[0], last = x.tours[x.tours.length - 1];
  const lw = x.lastWin;
  const most = p => Math.max(...p.places);
  return `
    <div class="gcard">${gArt(x.cover, 'gcv')}<div>
      <b>${esc(x.name)}</b>
      <span>PLAYED ${x.plays}&times; IN ${plural(x.tours.length, 'TOURNAMENT').toUpperCase()}</span>
      <span>${first === last ? `ONLY AT ${tourLabel(first)}` : `FIRST ${tourLabel(first)} &middot; LAST ${tourLabel(last)}`}</span>
      ${x.team ? `<span>${x.team}&times; AS A TEAM GAME</span>` : ''}
    </div></div>
    ${x.plays < 3 ? `<p class="note warn">Small sample: only ${plural(x.plays, 'play')}, so take this with a pinch of salt.</p>` : ''}
    <div class="tiles">
      ${x.master.length ? `<div class="tile"><small>MASTER</small><b>${names(x.master)}</b><span>${plural(x.master[0].wins, 'win')} from ${plural(x.master[0].plays, 'play')}</span></div>` : ''}
      <div class="tile"><small>MUG</small><b>${names(x.mug)}</b><span>rated ${rating(x.mug[0].avg)} on this one</span></div>
      ${lw ? `<a class="tile link" data-nav href="${BASE}?t=${esc(lw.id)}"><small>REIGNING CHAMP</small><b>${lw.names.map(esc).join(' &amp; ')}</b><span>won it last time, at ${tourLabel(lw)}</span></a>` : ''}
      ${x.favPick.length ? `<div class="tile"><small>FAVOURITE PICK OF</small><b>${names(x.favPick)}</b><span>picked it ${plural(x.favPick[0].picks, 'time')}, won ${x.favPick[0].wins}</span></div>` : ''}
    </div>
    <h3 class="hh">FINISHES</h3>
    <div class="scroll"><table class="career gfin">
      <thead><tr><th>PLAYER</th>${[0, 1, 2, 3].map(i => `<th>${placeIcon(i)}</th>`).join('')}<th>WIN %</th><th>VS USUAL</th></tr></thead>
      <tbody>${x.players.map(p => `<tr><td><button class="plink" type="button" data-who="${esc(p.name)}">${esc(p.name)}</button></td>
        ${p.places.map(n => `<td class="${n && n === most(p) ? 'hl' : n ? '' : 'dim'}">${n}</td>`).join('')}
        <td>${Math.round(p.winRate * 100)}%</td><td>${vsUsual(p.vs)}</td></tr>`).join('')}</tbody>
    </table></div>
    <p class="note">Highlighted = where they finish most. VS USUAL = their rating on this game compared with their rating across every game (100% = always 1st).</p>`;
}

function playerView(who) {
  const me = GB.book.players.find(p => p.name === who);
  if (!me) return `<div class="empty"><p>PLAYER NOT FOUND</p></div>`;
  const mine = GB.book.games.map(g => ({ g, s: g.players.find(p => p.name === who) })).filter(r => r.s);
  // Rank games played at least twice (or all of them, if nothing repeats).
  const pool = mine.some(r => r.s.plays >= 2) ? mine.filter(r => r.s.plays >= 2) : mine;
  const ranked = [...pool].sort((a, b) => b.s.vs - a.s.vs || b.s.plays - a.s.plays);
  const n = Math.min(5, Math.ceil(ranked.length / 2));
  const top = ranked.slice(0, n), bottom = ranked.slice(n).slice(-5).reverse();
  const picks = mine.map(r => ({ g: r.g, p: r.g.pickers.find(p => p.name === who) })).filter(r => r.p).sort((a, b) => b.p.picks - a.p.picks || b.p.wins - a.p.wins).slice(0, 3);
  const row = (r, extra) => `<li><button type="button" data-game="${esc(r.g.id)}">${gArt(r.g.cover)}<span class="tx"><b>${esc(r.g.name)}</b><small>${extra}</small></span></button></li>`;
  const line = r => row(r, `${vsUsual(r.s.vs)} vs usual &middot; ${plural(r.s.plays, 'play')} &middot; ${plural(r.s.wins, 'win')}`);
  return `
    <div class="pview"><b>${esc(who)}</b><span>RATED ${rating(me.avg)} OVER ${me.plays} GAMES</span></div>
    <h3 class="hh up">BEST GAMES</h3>
    <ul class="glist">${top.map(line).join('')}</ul>
    ${bottom.length ? `<h3 class="hh dn">WORST GAMES</h3><ul class="glist">${bottom.map(line).join('')}</ul>` : ''}
    ${picks.length ? `<h3 class="hh">FAVOURITE PICKS</h3><ul class="glist">${picks.map(r => row(r, `picked ${plural(r.p.picks, 'time')} &middot; won ${r.p.wins}`)).join('')}</ul>` : ''}
    <p class="note">Compared with their usual (average) finish across every game; games played at least twice.</p>`;
}

$('#gamesBtn').onclick = () => { GB.q = ''; openGames(); };
$('#gamesBack').onclick = () => { if (GB.stack.length) { GB.cur = null; showGames(GB.stack.pop()); } };
$('#gamesBody').addEventListener('input', e => { if (e.target.id === 'gameQ') { GB.q = e.target.value; renderGameList(); } });
$('#gamesBody').addEventListener('click', e => {
  const g = e.target.closest('[data-game]'), w = e.target.closest('[data-who]');
  if (g) showGames({ view: 'game', id: g.dataset.game }, true);
  else if (w) showGames({ view: 'player', who: w.dataset.who }, true);
});
// Hall of Fame: games and player names open the finder on top.
$('#statsBody').addEventListener('click', e => {
  if (S.t) return;
  const g = e.target.closest('[data-game]'), w = e.target.closest('[data-who]');
  if (g) openGames({ view: 'game', id: g.dataset.game });
  else if (w) openGames({ view: 'player', who: w.dataset.who });
});
$('#statsBody').addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.matches('[data-game][tabindex]')) e.target.click(); });

// ---------- admin ----------
$('#adminBtn').onclick = async () => {
  if (!await requireAdmin()) return;
  closeSheet($('#standingsSheet'));
  openAdmin(S.tour);
};

function openAdmin(tr) {
  const f = $('#adminForm');
  f.reset();
  $('#adminErr').textContent = '';
  const sc = { ...DEFAULT_SCORING, wackChip: true, ...(tr?.scoring || {}) };
  f.number.value = tr?.number || '';
  f.number.readOnly = !!tr;
  f.subtitle.value = tr?.subtitle || '';
  // New tournaments default to today (local date, not UTC).
  const now = new Date();
  f.date.value = tr ? tr.date || '' : new Date(now - now.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  (tr?.players || []).forEach((p, i) => { f[`p${i + 1}`].value = p.name; });
  sc.points.forEach((v, i) => { f[`s${i + 1}`].value = v; });
  f.wackChip.checked = !!sc.wackChip;
  f.lowWins.checked = !!sc.lowWins;
  f.complete.checked = tr?.status === 'complete';
  f.exhibition.checked = !!tr?.exhibition;
  f.pin.placeholder = tr ? 'Leave blank to keep' : 'Required';
  f.pin.required = !tr && !store.demo;
  f.complete.closest('label').hidden = !tr;
  $('#adminTitle').textContent = tr ? 'SETTINGS' : 'NEW TOURNAMENT';
  f.dataset.mode = tr ? 'edit' : 'new';
  openSheet($('#adminSheet'));
}

$('#adminForm').addEventListener('submit', async e => {
  e.preventDefault();
  const f = e.target, err = $('#adminErr');
  const isNew = f.dataset.mode === 'new';
  const exhibition = f.exhibition.checked;
  const n = parseInt(f.number.value, 10);
  const numbered = Number.isFinite(n) && n > 0;
  if (isNew && !numbered && !exhibition) { err.textContent = 'ENTER A NUMBER, OR MAKE IT AN EXHIBITION.'; return; }
  const list = isNew ? await store.listTournaments() : [];
  if (isNew && numbered && list.some(x => x.number === n)) { err.textContent = `RVGD ${roman(n)} ALREADY EXISTS.`; return; }
  // Numberless exhibitions get a text id and sort just after the latest tournament.
  const sub = f.subtitle.value.trim();
  let t = S.t;
  if (isNew) {
    t = numbered ? String(n) : 'ex-' + (norm(sub) || 'exhibition').replace(/ /g, '-');
    if (!numbered && list.some(x => x.id === t)) t += '-' + Date.now().toString(36).slice(-4);
  }
  const status = f.complete.checked ? 'complete' : 'live';
  const data = {
    number: numbered ? n : null,
    title: !isNew ? (S.tour?.title || `RVGD ${roman(n)}`) : numbered ? `RVGD ${roman(n)}` : `RVGD ${sub || 'Exhibition'}`,
    subtitle: isNew && !numbered ? '' : sub,
    players: [1, 2, 3, 4].map(i => ({ id: `p${i}`, name: f[`p${i}`].value.trim().toUpperCase() })),
    scoring: { points: [1, 2, 3, 4].map(i => +f[`s${i}`].value), wackChip: f.wackChip.checked, lowWins: f.lowWins.checked },
    status,
    exhibition: f.exhibition.checked,
    date: f.date.value || null,
  };
  if (isNew) {
    data.createdAt = new Date().toISOString();
    if (!numbered) data.seq = Math.max(0, ...list.map(sortKey)) + 0.5;
  }
  if (!isNew && status === 'complete') {
    const st = computeStandings(data.players, S.games, data.scoring);
    data.champion = st.table.filter(r => r.pos === 0).map(r => data.players.find(p => p.id === r.id)?.name).join(' & ');
    data.gameCount = S.games.length;
  }
  err.textContent = 'SAVING...';
  try {
    await store.saveTournament(t, data, f.pin.value.trim());
  } catch {
    err.textContent = 'SAVE FAILED. ARE YOU ADMIN?';
    return;
  }
  closeSheet($('#adminSheet'));
  toast(isNew ? `${data.title.toUpperCase()} CREATED!` : 'SETTINGS SAVED');
  if (isNew) go(`${BASE}?t=${t}`);
});

// ---------- toast ----------
let toastTimer;
function toast(msg, bad) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.toggle('bad', !!bad);
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2200);
}
