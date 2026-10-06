// Data layer. Firestore when configured, otherwise a localStorage demo store
// with the same interface so the page can be tried before Firebase is set up.

const FB = '10.12.2';
const base = `https://www.gstatic.com/firebasejs/${FB}`;

export async function createStore(config) {
  return config && config.apiKey ? firebaseStore(config) : localStore();
}

async function firebaseStore(config) {
  const [{ initializeApp }, fs, au] = await Promise.all([
    import(`${base}/firebase-app.js`),
    import(`${base}/firebase-firestore.js`),
    import(`${base}/firebase-auth.js`),
  ]);
  const app = initializeApp(config);
  let db;
  try {
    db = fs.initializeFirestore(app, { localCache: fs.persistentLocalCache({ tabManager: fs.persistentMultipleTabManager() }) });
  } catch {
    db = fs.getFirestore(app);
  }
  const auth = au.getAuth(app);
  const user = new Promise(resolve => {
    const off = au.onAuthStateChanged(auth, u => {
      if (u) { off(); resolve(u); } else au.signInAnonymously(auth).catch(() => resolve(null));
    });
  });
  const uid = async () => (await user)?.uid;
  const exists = async path => {
    try { return (await fs.getDoc(fs.doc(db, path))).exists(); } catch { return false; }
  };
  const ts = fs.serverTimestamp;

  return {
    demo: false,
    async listTournaments() {
      const snap = await fs.getDocs(fs.collection(db, 'tournaments'));
      const key = t => t.seq ?? t.number ?? 0;
      return snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => key(b) - key(a));
    },
    watchTournament(t, cb) {
      return fs.onSnapshot(fs.doc(db, 'tournaments', t), d => cb(d.exists() ? { id: d.id, ...d.data() } : null), () => cb(null));
    },
    async loadGames(t) {
      const snap = await fs.getDocs(fs.query(fs.collection(db, 'tournaments', t, 'games'), fs.orderBy('order')));
      return snap.docs.map(d => ({ id: d.id, ...d.data() }));
    },
    watchGames(t, cb) {
      return fs.onSnapshot(fs.query(fs.collection(db, 'tournaments', t, 'games'), fs.orderBy('order')),
        snap => cb(snap.docs.map(d => ({ id: d.id, ...d.data() }))));
    },
    async isEditor(t) {
      const u = await uid();
      return !!u && (await exists(`editors/${t}/members/${u}`) || await exists(`admins/${u}`));
    },
    async isAdmin() {
      const u = await uid();
      return !!u && exists(`admins/${u}`);
    },
    async unlock(t, pin) {
      const u = await uid();
      if (!u) return false;
      try { await fs.setDoc(fs.doc(db, 'editors', t, 'members', u), { pin: String(pin), at: ts() }); return true; }
      catch { return false; }
    },
    async adminUnlock(pin) {
      const u = await uid();
      if (!u) return false;
      try { await fs.setDoc(fs.doc(db, 'admins', u), { pin: String(pin), at: ts() }); return true; }
      catch { return false; }
    },
    // Writes resolve once the server acks; the snapshot listener updates the UI before that.
    addGame: (t, g) => fs.addDoc(fs.collection(db, 'tournaments', t, 'games'), { ...g, createdAt: ts(), updatedAt: ts() }),
    updateGame: (t, id, g) => fs.updateDoc(fs.doc(db, 'tournaments', t, 'games', id), { ...g, updatedAt: ts() }),
    deleteGame: (t, id) => fs.deleteDoc(fs.doc(db, 'tournaments', t, 'games', id)),
    async loadPool() {
      try { return (await fs.getDocs(fs.collection(db, 'pool'))).docs.map(d => ({ id: d.id, ...d.data() })); }
      catch { return []; }
    },
    savePool: (t, g) => fs.setDoc(fs.doc(db, 'pool', String(g.gameId)),
      { name: g.name, cover: g.cover || '', year: g.year || null, platforms: g.platforms || '', t, updatedAt: ts() }, { merge: true }),
    async saveTournament(t, data, pin) {
      const b = fs.writeBatch(db);
      b.set(fs.doc(db, 'tournaments', t), { ...data, updatedAt: ts() }, { merge: true });
      if (pin) b.set(fs.doc(db, 'secrets', t), { pin: String(pin) });
      await b.commit();
    },
  };
}

function localStore() {
  const KEY = 'rvgd-demo';
  const listeners = new Set();
  let data;
  try { data = JSON.parse(localStorage.getItem(KEY)); } catch { data = null; }
  if (!data) {
    data = { tournaments: {}, games: {}, pool: {} };
    data.tournaments['11'] = {
      number: 11, title: 'RVGD XI', subtitle: 'A New Dawn', status: 'live',
      players: ['ALEX', 'BEN', 'CHRIS', 'DAN'].map((name, i) => ({ id: `p${i + 1}`, name })),
      scoring: { points: [10, 8, 7, 6], wackChip: true },
    };
  }
  const save = () => {
    try { localStorage.setItem(KEY, JSON.stringify(data)); } catch {}
    listeners.forEach(fn => fn());
  };
  const watch = fn => { listeners.add(fn); fn(); return () => listeners.delete(fn); };
  const games = t => (data.games[t] ||= []);
  const clone = o => JSON.parse(JSON.stringify(o));

  return {
    demo: true,
    listTournaments: async () => Object.entries(data.tournaments).map(([id, t]) => ({ id, ...clone(t) })).sort((a, b) => (b.seq ?? b.number ?? 0) - (a.seq ?? a.number ?? 0)),
    watchTournament: (t, cb) => watch(() => cb(data.tournaments[t] ? { id: t, ...clone(data.tournaments[t]) } : null)),
    loadGames: async t => clone(games(t)).sort((a, b) => a.order - b.order),
    watchGames: (t, cb) => watch(() => cb(clone(games(t)).sort((a, b) => a.order - b.order))),
    isEditor: async () => true,
    isAdmin: async () => true,
    unlock: async () => true,
    adminUnlock: async () => true,
    addGame: async (t, g) => { games(t).push({ ...g, id: Math.random().toString(36).slice(2, 10) }); save(); },
    updateGame: async (t, id, g) => { const x = games(t).find(x => x.id === id); Object.assign(x, g); save(); },
    deleteGame: async (t, id) => { data.games[t] = games(t).filter(x => x.id !== id); save(); },
    loadPool: async () => Object.entries(data.pool).map(([id, p]) => ({ id, ...p })),
    savePool: async (t, g) => { data.pool[g.gameId] = { name: g.name, cover: g.cover || '', year: g.year || null, platforms: g.platforms || '', t }; save(); },
    saveTournament: async (t, d) => { data.tournaments[t] = { ...(data.tournaments[t] || {}), ...clone(d) }; save(); },
  };
}
