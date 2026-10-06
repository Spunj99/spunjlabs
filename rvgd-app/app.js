import { createStore } from './store.js';
import { computeStandings, placeOf, DEFAULT_SCORING, selfTest } from './score.js';
import { computeStats, computeGlobal } from './stats.js';

// ---- config: paste from Firebase console > Project settings > Your apps ----
// These are public identifiers, not secrets. Security comes from firestore.rules.
// Leave apiKey empty to run in local demo mode.
const FIREBASE_CONFIG = {
  apiKey: 'AIzaSyBZcIXpWFScQtMBHub-tpNtXeDPVSaPA_g',
  authDomain: 'rvgd-101026.firebaseapp.com',
  projectId: 'rvgd-101026',
  appId: '1:964478178587:web:2c3e38372733a952592fbe',
};

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
const placeIcon = i => i < 3 ? px(TROPHY, ['gold', 'silver', 'bronze'][i]) : px(SKULL, 'wood');
const chipIcon = () => `<svg class="px chip" viewBox="0 0 16 16" aria-hidden="true" shape-rendering="crispEdges"><circle cx="8" cy="8" r="7.5" fill="#e8642a"/><circle cx="8" cy="8" r="5.2" fill="#7c2d10"/>${[0, 1, 2, 3, 4, 5, 6, 7].map(i => { const a = i * Math.PI / 4; return `<rect x="${(8 + 6.3 * Math.cos(a) - .6).toFixed(1)}" y="${(8 + 6.3 * Math.sin(a) - .6).toFixed(1)}" width="1.2" height="1.2" fill="#7c2d10"/>`; }).join('')}<rect x="5" y="6" width="1.2" height="4" fill="#fff"/><rect x="9.8" y="6" width="1.2" height="4" fill="#fff"/><rect x="6.2" y="8.6" width="1.2" height="1.4" fill="#fff"/><rect x="8.6" y="8.6" width="1.2" height="1.4" fill="#fff"/><rect x="7.4" y="7.4" width="1.2" height="1.4" fill="#fff"/></svg>`;

// Archive order: tournament number, or seq for numberless exhibitions (e.g. 10.5).
const sortKey = t => t.seq ?? t.number ?? 0;
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

// ---------- boot ----------
$('#homeBtn').innerHTML = px(ARROW);
$('#standingsBtn').innerHTML = px(TROPHY);
$('#statsBtn').innerHTML = px(CHART);
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
  ['#homeBtn', '#lockBtn', '#standingsBtn', '#addBtn'].forEach(s => $(s).hidden = true);
  $('#statsBtn').hidden = false;
  let list;
  try { list = await store.listTournaments(); }
  catch { $('#view').innerHTML = `<div class="empty"><p>COULD NOT LOAD TOURNAMENTS.</p></div>`; return; }
  $('#view').innerHTML = `
    <div class="hero"><h1>RETRO<br>VIDEO GAMES<br>DAY</h1><p>&#9654; SELECT TOURNAMENT<span class="blink">_</span></p></div>
    ${store.demo ? `<div class="banner"><span class="pill demo">DEMO MODE &middot; SAVED ON THIS DEVICE ONLY</span></div>` : ''}
    <ul class="cards">${list.map(t => `
      <li><a class="card" data-nav href="${BASE}?t=${esc(t.id)}">
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
  Object.assign(S, { t, tour: null, games: [], st: null, seen: null, editable: false });
  $('#homeBtn').href = BASE;
  $('#homeBtn').setAttribute('data-nav', '');
  $('#homeBtn').hidden = false;
  $('#view').innerHTML = `<p class="loading">LOADING<span class="blink">_</span></p>`;
  let gotTour = false;
  unsub.push(store.watchTournament(t, tour => {
    gotTour = true;
    S.tour = tour;
    if (!tour) {
      $('#barTitle').innerHTML = `<span class="t1">RVGD${/^\d+$/.test(t) ? ' ' + roman(+t) : ''}</span>`;
      ['#statsBtn', '#lockBtn', '#standingsBtn', '#addBtn'].forEach(s => $(s).hidden = true);
      $('#view').innerHTML = `<div class="empty"><p class="big">?</p><p>TOURNAMENT NOT FOUND</p></div>`;
      return;
    }
    renderTournament();
  }));
  unsub.push(store.watchGames(t, games => {
    S.games = games;
    if (gotTour && S.tour) renderTournament();
  }));
  store.isEditor(t).then(ok => { if (S.t === t) { S.editable = ok; renderChrome(); } });
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
  const champ = !live() && st.table[0] && pById(st.table[0].id);

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
    ${champ ? `<div class="champ"><small>&#9733; CHAMPION &#9733;</small><strong>${esc(champ.name)}</strong>
      <p class="runners">${st.table.slice(1).map((r, i) => `${PLACE[i + 1]} <b style="color:${pById(r.id).color}">${esc(pById(r.id).name)}</b> ${r.points}`).join(' &middot; ')}</p></div>` : ''}
    <div class="banner">
      ${live() && pickers.length ? `<span class="pill next"><span class="blink">&#9654;</span>${pickers.map(p => `<b style="color:${p.color}">${esc(p.name)}</b>`).join(' OR ')} ${pickers.length > 1 ? 'PICK' : 'PICKS'} NEXT</span>` : ''}
      ${chipP ? `<span class="pill wack">${chipIcon()} WACK: <b style="color:${chipP.color}">${esc(chipP.name)}</b> &middot; +${st.chip.next} NEXT</span>` : ''}
      ${store.demo ? `<span class="pill demo">DEMO MODE</span>` : ''}
    </div>
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
$('#standingsBtn').onclick = () => { renderStandings(); openSheet($('#standingsSheet')); };
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
  if (await askPin('editor')) { S.editable = true; renderChrome(); return true; }
  return false;
}
let isAdmin = false;
async function requireAdmin() {
  if (isAdmin || (isAdmin = await store.isAdmin())) return true;
  return (isAdmin = await askPin('admin'));
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
  pool.forEach(p => { if (!map.has(String(p.id))) map.set(String(p.id), { gameId: p.id, name: p.name, cover: p.cover, year: p.year, platforms: p.platforms, local: true }); });
  return [...map.values()];
}

searchInput.addEventListener('input', () => {
  clearTimeout(searchTimer);
  const q = searchInput.value;
  runLocal(q);
  searchTimer = setTimeout(() => runSearch(q), 250);
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
  renderResults(q, loc, null);
  return loc;
}

async function runSearch(q) {
  const loc = await runLocal(q);
  const n = norm(q);
  if (n.length < 2) { renderResults(q, loc, []); return; }
  searchCtl?.abort();
  searchCtl = new AbortController();
  let remote = wikiCache.get(n);
  if (!remote) {
    renderResults(q, loc, 'loading');
    try {
      remote = await wikiSearch(q, searchCtl.signal);
      wikiCache.set(n, remote);
    } catch (e) {
      if (e.name === 'AbortError') return;
      remote = [];
    }
  }
  if (searchInput.value !== q) return;
  const have = new Set(loc.map(g => String(g.gameId ?? norm(g.name))));
  const names = new Set(loc.map(g => norm(g.name) + g.year));
  renderResults(q, loc, remote.filter(g => !have.has(String(g.gameId)) && !names.has(norm(g.name) + g.year)));
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

function renderResults(q, loc, remote) {
  const list = [...loc, ...(Array.isArray(remote) ? remote : [])];
  lastResults = list;
  const item = (g, i) => `<li><button type="button" role="option" data-i="${i}">
      <span class="art">${g.cover ? `<img src="${esc(g.cover)}" alt="" loading="lazy" decoding="async">` : '?'}</span>
      <span class="tx"><b>${esc(g.name)}</b><small>${[g.year, g.platforms].filter(Boolean).map(esc).join(' &middot; ') || '&nbsp;'}</small></span>
      ${g.local ? '<span class="tag">POOL</span>' : ''}</button></li>`;
  const qq = q.trim();
  $('#results').innerHTML = (qq ? `<li><button type="button" data-custom="1"><span class="art">+</span><span class="tx"><b>${esc(qq)}</b><small>Add as typed, without art</small></span></button></li>` : '')
    + list.map(item).join('')
    + (remote === 'loading' ? `<li class="note">SEARCHING<span class="blink">_</span></li>` : '')
    + (!qq && !list.length ? `<li class="note">START TYPING A GAME NAME</li>` : '');
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
  const rankIcon = i => placeIcon(Math.min(i, 3));
  const chipP = st.chip && pById(st.chip.holder);
  $('#standingsTitle').innerHTML = `${px(TROPHY, 'gold')} STANDINGS`;
  $('#standingsBody').innerHTML = `
    <ol class="stand">${st.table.map((r, i) => {
      const p = pById(r.id);
      return `<li style="animation-delay:${i * 60}ms">
        <span class="rk">${rankIcon(i)}</span>
        <span class="who"><b style="--pc:${p.color}">${esc(p.name)}${st.chip?.holder === r.id ? chipIcon() : ''}</b>
          <small>${r.places.map((n, k) => `${PLACE[k]}&times;${n}`).join(' ')}${sc.wackChip ? ` &middot; WACK +${r.bonus}` : ''}</small></span>
        <span class="tot">${r.points}<small>PTS</small></span>
      </li>`;
    }).join('')}</ol>
    <p class="sub">GAMES <b>${S.games.length}</b> &middot; POINTS <b>${sc.points.join('/')}</b>${sc.lowWins ? ' &middot; <b>LOWEST WINS</b>' : ''}
    ${sc.wackChip ? `<br>WACK CHIP <b>ON</b>${chipP ? ` &middot; HELD BY <b style="color:${chipP.color}">${esc(chipP.name)}</b> (+${st.chip.next} NEXT GAME)` : ''}` : ''}</p>`;
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
    ...st.table.map((r, i) => [i + 1, name(r.id), r.points, r.base, ...(sc.wackChip ? [r.bonus] : []), ...r.places].join(' | ')),
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
  add('BEST AVERAGE FINISH', who(t.ids), `averages ${t.value.toFixed(2)} (1 = always 1st)`);
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
  const gameLine = (b, label) => b ? `<div class="gl2">${art(b.cover)}<div><small>${label}</small><b>${esc(b.name)}</b>
    <span>avg ${b.avg.toFixed(1)} &middot; ${b.plays} ${b.plays === 1 ? 'play' : 'plays'} &middot; ${b.wins} ${b.wins === 1 ? 'win' : 'wins'}</span></div></div>` : '';
  const names = g.players.map(p => p.name);

  $('#statsBody').innerHTML = `
    <div class="kpis">
      <div><b>${g.tournaments}</b><small>TOURNAMENTS</small></div>
      <div><b>${g.games}</b><small>GAMES</small></div>
      <div><b>${g.players.length}</b><small>PLAYERS</small></div>
    </div>
    ${exhibitions ? `<p class="note">${exhibitions} exhibition ${exhibitions === 1 ? 'tournament is' : 'tournaments are'} not counted.</p>` : ''}

    ${g.honours.length ? `<h3 class="hh">ROLL OF HONOUR</h3>
    <ul class="honours">${g.honours.map(h => `<li><span class="num">${roman(h.number)}</span>
      <span class="ht">${esc(h.subtitle || h.title || '')}</span><b>${px(TROPHY, 'gold')} ${esc(h.champion)}</b></li>`).join('')}</ul>` : ''}

    <h3 class="hh">CAREER</h3>
    <div class="scroll"><table class="career">
      <thead><tr><th>PLAYER</th><th title="Titles">${px(TROPHY, 'gold')}</th><th>EVENTS</th><th>GAMES</th><th>WINS</th><th>WIN %</th><th>AVG</th><th>LAST</th></tr></thead>
      <tbody>${g.players.map(p => `<tr><td>${esc(p.name)}</td><td class="hl">${p.titles}</td><td>${p.tournaments}</td><td>${p.games}</td>
        <td>${p.wins}</td><td>${pct(p.winRate)}</td><td>${p.avg.toFixed(2)}</td><td>${p.lasts}</td></tr>`).join('')}</tbody>
    </table></div>
    <p class="note">AVG = average finishing place (1 = always 1st). LAST = last places.</p>

    <h3 class="hh">BEST &amp; WEAKEST GAMES</h3>
    <div class="pgames">${g.players.map(p => `<div class="pg"><h4>${esc(p.name)}</h4>
      ${gameLine(p.best, 'BEST')}${gameLine(p.worst, 'WEAKEST')}</div>`).join('')}</div>
    <p class="note">By average finish on games played at least twice, where there are any.</p>

    <h3 class="hh">MOST PLAYED</h3>
    <ol class="mp">${g.mostPlayed.map(m => `<li>${art(m.cover)}<b>${esc(m.name)}</b>
      <span>${m.plays}&times;${m.tours > 1 ? ` &middot; ${m.tours} events` : ''}</span></li>`).join('')}</ol>`;
}

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
    data.champion = data.players.find(p => p.id === st.table[0]?.id)?.name || '';
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
