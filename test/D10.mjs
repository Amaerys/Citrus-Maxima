// D10 — storage, merge, sync, inbound. Node: sanitize, corrupt-localStorage recovery, two-device merge of EVERY collection.
// Browser: malformed records never blank a tab; a damaged copy shows a banner and recovers; full storage warns once.
// Run: node test/D10.mjs   (no network; the browser part uses made-up data only)
import fs from 'node:fs'; import path from 'node:path'; import http from 'node:http';
const here = path.dirname(new URL(import.meta.url).pathname), root = path.resolve(here, '../docs'), shots = path.join(here, 'shots/D10'); fs.mkdirSync(shots, { recursive: true });
let bad = 0; const check = (c, m) => { if (!c) { bad++; console.log('  ✗', m); } else console.log('  ✓', m); };
const J = (x) => JSON.parse(JSON.stringify(x));

// ── a pinned clock and a real-ish localStorage (quota can be switched on)
const T0 = Date.parse('2026-11-13T09:30:00+03:00'); let clock = T0; const realNow = Date.now; Date.now = () => clock;
const H = 3600e3, D = 86400e3;
const LS = { m: new Map(), quota: Infinity, getItem(k) { return this.m.has(k) ? this.m.get(k) : null; }, setItem(k, v) { v = String(v); let used = v.length; for (const [x, y] of this.m) if (x !== k) used += y.length; if (used > this.quota) { const e = new Error('quota'); e.name = 'QuotaExceededError'; throw e; } this.m.set(k, v); }, removeItem(k) { this.m.delete(k); }, clear() { this.m.clear(); } };
globalThis.localStorage = new Proxy(LS, { ownKeys: (t) => [...t.m.keys()], getOwnPropertyDescriptor: (t, k) => (t.m.has(k) ? { enumerable: true, configurable: true, value: t.m.get(k) } : undefined) });
globalThis.location = { href: 'https://citrus.test/' };
let n = 0; const fresh = async () => import(`../docs/js/store.js?i=${++n}`);   // a new module instance = a new app start on this "device"

// ════════════════════════════════════════ sanitize
console.log('sanitize: one bad record never takes the rest down');
const S = await fresh();
{
  const junk = { me: 'Reem', goals: [null, { name: 'Gym', hoursPerWeek: 'x' }, { id: 'g1', name: 'A' }, { id: 'g1', name: 'dup' }, 7], rules: { sleepHours: 'eight', commute: null, protectedBlocks: [null, { id: 'b' }] },
    settings: { calendarIds: 'primary', theme: 'light' }, outbox: [null, { id: 1 }], plan: { '2026-11-13': 'str', '2026-11-14': [null, { start: 600, end: 660 }, { id: 'p1' }] }, notes: { a: 'x', b: null, c: 5, d: { text: 'y' } },
    rotas: { x: { people: 'no' }, y: { people: [null, { name: 'A', days: null }], legend: {} }, z: null }, mediaMeta: { dismissed: 'a' }, deleted: { 'task:a': 'zz', 'task:b': 5 }, prefs: { a: null, b: 2 } };
  for (const k of Object.keys(S.RECORD_MAPS)) junk[k] = { ok: { id: 'ok', at: 1, title: 'fine', month: 11 }, n: null, s: 'str', a: [1], num: 3 };
  junk.habitLog = { h: { '2026-11-13': null, '2026-11-12': { v: 1, at: 1 } }, bad: 'x' }; junk.metricLog = { 'yuzu:cards': null };
  const rep = { fixed: 0, notes: [] }; const s = S.sanitize(junk, rep);
  check(Object.keys(S.RECORD_MAPS).every(k => Object.keys(s[k]).join() === 'ok'), `every record map keeps only object records (${Object.keys(S.RECORD_MAPS).length} collections)`);
  check(s.me === null, 'me that is not a person → nobody');
  check(s.goals.length === 2 && s.goals[0].id === 'g-gym' && s.goals[0].hoursPerWeek === 0 && s.goals[1].id === 'g1', 'goals: non-objects and twin ids dropped, missing id and bad numbers repaired');
  check(s.rules.sleepHours === 7.5 && typeof s.rules.commute === 'object' && s.rules.protectedBlocks.length === 1, 'rules: bad numbers back to defaults');
  check(s.settings.calendarIds.join() === 'primary' && s.settings.theme === 'light', 'settings.calendarIds must be a list');
  check(!s.plan['2026-11-13'] && s.plan['2026-11-14'].length === 2 && s.plan['2026-11-14'].every(p => p.id), 'plan: lists only, objects only, every block has an id');
  check(JSON.stringify(s.notes) === '{"a":"x","c":"5","d":"y"}', 'notes are text');
  check(Object.keys(s.rotas).join() === 'y' && s.rotas.y.people.length === 1 && (typeof s.rotas.y.people[0].days === 'object' && s.rotas.y.people[0].days !== null), 'rotas: unreadable ones dropped, people repaired');
  { const r = S.sanitize({ rotas: { g: { id: 'g', year: 2026, month: 11, daysInMonth: 30, legend: {}, people: [{ name: 'A', id: '1', days: { 1: 'D', 2: 'N' } }] } } }); check(r.rotas.g.people[0].days[2] === 'N', 'rota days stored as an object (the parser\'s format) survive a reload — regression for the D15 find'); }
  check(Array.isArray(s.mediaMeta.dismissed) && JSON.stringify(s.deleted) === '{"task:b":5}' && JSON.stringify(s.prefs) === '{"b":2}', 'mediaMeta / tombstones / prefs cleaned');
  check(JSON.stringify(s.habitLog) === '{"h":{"2026-11-12":{"v":1,"at":1}}}' && JSON.stringify(s.metricLog) === '{}', 'habit and metric cells cleaned');
  check(rep.fixed > 40, `report counts the repairs (${rep.fixed})`);
  const good = J(S.get()); check(JSON.stringify(S.sanitize(good)) === JSON.stringify(good), 'a clean state passes through unchanged');
  for (const x of [null, 5, 'x', [], undefined]) S.sanitize(x);
  check(true, 'never throws on non-objects');
}

// ════════════════════════════════════════ this device's copy: damaged, repaired, kept
console.log('localStorage: damaged copies are kept and recovered');
{
  LS.clear(); clock = T0;
  const good = { me: { name: 'Dr. Test', id: '1' }, tasks: { t1: { title: 'from yesterday', at: T0 - D } }, notes: { '2026-11-12': 'kept' }, updatedAt: T0 - D };
  LS.setItem('citrus.state.v1', JSON.stringify(good));
  let st = await fresh();
  check(!st.recovery && LS.getItem('citrus.state.v1.bak'), 'a clean start leaves a known-good copy');
  st.update(s => ({ ...s, tasks: { ...s.tasks, t2: { title: 'typed today', at: clock } } }));
  const raw = LS.getItem('citrus.state.v1');
  LS.setItem('citrus.state.v1', raw.slice(0, raw.indexOf('typed today') + 30));   // cut off mid-write
  st = await fresh();
  const s = st.get();
  check(st.recovery?.reason === 'unreadable', 'an unreadable copy is noticed (not silently replaced)');
  check(s.me?.id === '1' && s.tasks.t1 && s.tasks.t2?.title === 'typed today', `recovered from the clean copy AND the readable part (tasks: ${Object.keys(s.tasks)})`);
  check(st.recovery.kept && LS.getItem(st.recovery.kept)?.length > 100 && st.corruptCopy() === LS.getItem(st.recovery.kept), 'the damaged text is kept under its own key for download');
  st.update(x => ({ ...x, notes: { ...x.notes, z: 'after' } }));
  check(LS.getItem(st.recovery.kept) && JSON.parse(LS.getItem('citrus.state.v1')).tasks.t2, 'saving again never overwrites the kept copy');
  LS.clear(); LS.setItem('citrus.state.v1', 'not json at all'); st = await fresh();
  check(st.recovery?.reason === 'unreadable' && st.recovery.from.length === 0 && st.get().goals.length === 5, 'garbage with no clean copy: starts empty, still kept');
  LS.clear(); LS.setItem('citrus.state.v1', JSON.stringify({ ...good, tasks: { a: null, t1: good.tasks.t1 }, friends: { f: null }, habits: { h: null }, plan: { '2026-11-13': 'str' } })); st = await fresh();
  check(st.recovery?.reason === 'repaired' && st.get().tasks.t1 && !('a' in st.get().tasks) && Object.keys(st.get().friends).length === 0, 'null records are dropped on load, the rest kept');
  check(!('a' in JSON.parse(LS.getItem('citrus.state.v1')).tasks), 'the repaired copy is written back (no repair at every start)');
  st.replaceState({ me: { id: '1', name: 'x' }, rotas: { x: { people: 'no' } }, plan: { '2026-11-13': 'str' }, tasks: { q: null } }, { bump: true });
  check(!st.get().rotas.x && !st.get().plan['2026-11-13'] && !('q' in st.get().tasks), 'a malformed restore is cleaned before it reaches the views');
  check(st.undoReplace() && st.get().tasks.t1, 'a restore can be undone');
  // storage full
  LS.clear(); st = await fresh(); const seen = []; st.onPersistence(p => seen.push(p.ok));
  LS.quota = 10; st.update(x => ({ ...x, notes: { a: 'b' } })); st.update(x => ({ ...x, notes: { a: 'c' } }));
  check(!st.persistence.ok && /full/.test(st.persistence.lastError) && st.persistence.since === clock && seen.join() === 'false', 'full storage is reported once (not on every edit)');
  LS.quota = Infinity; st.update(x => ({ ...x, notes: { a: 'd' } })); check(st.persistence.ok && seen.join() === 'false,true', 'and clears when saving works again');
  LS.setItem('citrus.state.v1.bak', 'x'.repeat(50)); LS.setItem('citrus.events', 'y'.repeat(50)); LS.quota = JSON.stringify(st.get()).length + 60;
  check(st.update(x => ({ ...x, notes: { a: 'e' } })) && st.persistence.ok && !LS.getItem('citrus.events'), 'when full, the calendar cache is dropped first');
  LS.quota = Infinity;
  const tr = S.salvageJSON('{"a":{"b":[1,2,{"c":"x"}],"d":"unterminated');
  check(tr && tr.a.b.length === 3, 'truncated JSON is closed at its last complete value');
}

// ════════════════════════════════════════ two devices
console.log('two devices diverge from one copy, then merge (both directions, every collection)');
LS.clear(); clock = T0 - 10 * H;
const st0 = await fresh();
const prefix = S.RECORD_MAPS;
const rec = (c, id, v, at) => ({ id, month: 11, title: `${c}:${id}:${v}`, v, at, ...(c === 'rotaChanges' ? { at2: at } : {}) });
// the common ancestor (what both devices last pulled from Drive)
st0.update(s => {
  const o = { ...s, me: { name: 'Dr. Test', id: '1' } };
  for (const c of Object.keys(prefix)) o[c] = { r1: rec(c, 'r1', 'anc', clock), r2: rec(c, 'r2', 'anc', clock), r3: rec(c, 'r3', 'anc', clock) };
  o.habits = { ...o.habits, h1: { id: 'h1', name: 'walk', at: clock } };
  o.habitLog = { h1: { '2026-11-10': { v: 1, at: clock } } }; o.metricLog = { 'yuzu:cards': { '2026-11-10': { v: 10, at: clock } } };
  o.plan = { '2026-11-14': [{ id: 'p1', start: 600, end: 660, at: clock }, { id: 'p2', start: 700, end: 760, at: clock }] };
  o.rotas = { 'gp-2026-11': { id: 'gp-2026-11', people: [], legend: {}, importedAt: new Date(clock).toISOString(), v: 'anc' }, 'uv-2026-11': { id: 'uv-2026-11', people: [], legend: {}, importedAt: new Date(clock).toISOString() } };
  o.notes = { n0: 'ancestor note', n9: 'will be cleared' }; o.prefs = { 'g|x': 1 }; o.mediaMeta = { dismissed: ['z'], goals: { book: 12 }, at: clock };
  return o;
});
const anc = JSON.stringify(st0.get());
const device = async () => { LS.setItem('citrus.state.v1', anc); return fresh(); };
const A = await device(), B = await device();
const del = (s, c, id) => { const m = { ...s[c] }; delete m[id]; return { ...s, [c]: m, deleted: { ...s.deleted, [`${prefix[c] || c}:${id}`]: clock } }; };
// t1 — A: edits r1, adds a1, deletes r2; new note, clears n9, a new goal, deletes g-social, sleepHours, theme, a plan block, a rota, a dismissed suggestion
clock = T0 - 5 * H;
A.update(s => {
  let o = { ...s };
  for (const c of Object.keys(prefix)) { o[c] = { ...o[c], r1: rec(c, 'r1', 'A', clock), a1: rec(c, 'a1', 'A', clock) }; o = del(o, c, 'r2'); }
  o.habitLog = { h1: { ...o.habitLog.h1, '2026-11-11': { v: 1, at: clock } } }; o.metricLog = { 'yuzu:cards': { ...o.metricLog['yuzu:cards'], '2026-11-10': { v: 30, at: clock } } };
  o.notes = { ...o.notes, nA: 'from A' }; delete o.notes.n9; o.deleted = { ...o.deleted, 'note:n9': clock };
  o.goals = [...o.goals.filter(g => g.id !== 'g-social'), { id: 'g-A', name: 'Goal from A', kind: 'study', hoursPerWeek: 2, minBlock: 30, maxBlock: 60, priority: 9, color: '#123456' }];
  o.rules = { ...o.rules, sleepHours: 8 }; o.settings = { ...o.settings, theme: 'light' }; o.prefs = { ...o.prefs, 'g|a': 2 };
  o.plan = { '2026-11-14': [...o.plan['2026-11-14'], { id: 'pA', start: 800, end: 860, at: clock }] };
  o.rotas = { ...o.rotas, 'fsed-2026-11': { id: 'fsed-2026-11', people: [], legend: {}, importedAt: new Date(clock).toISOString() } };
  o.mediaMeta = { ...o.mediaMeta, dismissed: [...o.mediaMeta.dismissed, 'a'], at: clock };
  o.outbox = [{ id: 'oA' }];
  return o;
});
// t2 — B (later): edits r1, adds b1, deletes r3; a note, edits n0, g-gym hours, wakeMin, calendars, plan block p1 removed, a rota re-imported, removes uv rota
clock = T0 - 3 * H;
B.update(s => {
  let o = { ...s };
  for (const c of Object.keys(prefix)) { o[c] = { ...o[c], r1: rec(c, 'r1', 'B', clock), b1: rec(c, 'b1', 'B', clock) }; o = del(o, c, 'r3'); }
  o.habitLog = { h1: { ...o.habitLog.h1, '2026-11-12': { v: 1, at: clock } } }; o.metricLog = { 'yuzu:cards': { ...o.metricLog['yuzu:cards'], '2026-11-11': { v: 5, at: clock } } };
  o.notes = { ...o.notes, nB: 'from B', n0: 'edited on B' };
  o.goals = o.goals.map(g => (g.id === 'g-gym' ? { ...g, hoursPerWeek: 6 } : g));
  o.rules = { ...o.rules, wakeMin: 400 }; o.settings = { ...o.settings, calendarIds: ['primary', 'work'] }; o.prefs = { ...o.prefs, 'g|b': 3 };
  o.plan = { '2026-11-14': o.plan['2026-11-14'].filter(p => p.id !== 'p1') }; o.deleted = { ...o.deleted, 'plan:p1': clock };
  o.rotas = { ...o.rotas, 'gp-2026-11': { ...o.rotas['gp-2026-11'], importedAt: new Date(clock).toISOString(), v: 'B' } }; delete o.rotas['uv-2026-11']; o.deleted = { ...o.deleted, 'rota:uv-2026-11': clock };
  o.mediaMeta = { ...o.mediaMeta, dismissed: [...o.mediaMeta.dismissed, 'b'], goals: { ...o.mediaMeta.goals, movie: 50 }, at: clock };
  o.outbox = [{ id: 'oB' }]; o.google = { email: 'b@test', lastSync: clock };
  return o;
});
// t3 — A again: edits r3 AFTER B deleted it (the edit is newer than the deletion, so it must survive), clears n0 locally? no: re-types n9 after clearing it
clock = T0 - 1 * H;
A.update(s => { const o = { ...s }; for (const c of Object.keys(prefix)) o[c] = { ...o[c], r3: rec(c, 'r3', 'A-late', clock) }; o.notes = { ...o.notes, n9: 'typed again on A' }; return o; });

const covered = new Set();
const expect = (keys, fn) => { for (const k of [].concat(keys)) covered.add(k); fn(); };
for (const [name, m] of [['A←B', S.mergeStates(A.get(), B.get())], ['B←A', S.mergeStates(B.get(), A.get())]]) {
  console.log(`  ${name}`);
  const local = name === 'A←B' ? A.get() : B.get();
  const recOk = Object.keys(prefix).filter(c => { const x = m[c] || {}; return x.r1?.v === 'B' && x.a1?.v === 'A' && x.b1?.v === 'B' && !x.r2 && x.r3?.v === 'A-late' && Object.keys(x).length === 4 + (c === 'habits' ? 1 : 0); });
  expect(Object.keys(prefix), () => check(recOk.length === Object.keys(prefix).length, `${recOk.length}/${Object.keys(prefix).length} record collections: newer edit wins, both additions kept, deletions stay deleted, an edit after a deletion survives${recOk.length < Object.keys(prefix).length ? ' — wrong: ' + Object.keys(prefix).filter(c => !recOk.includes(c)) : ''}`));
  expect('habitLog', () => check(Object.keys(m.habitLog.h1 || {}).length === 3, 'habitLog: taps from both devices'));
  expect('metricLog', () => check(m.metricLog['yuzu:cards']['2026-11-10'].v === 30 && m.metricLog['yuzu:cards']['2026-11-11'].v === 5, 'metricLog: cells from both, newest per day'));
  expect('plan', () => check(m.plan['2026-11-14'].map(p => p.id).sort().join() === 'p2,pA', `plan: A's new block kept, B's removal applied (${m.plan['2026-11-14'].map(p => p.id)})`));
  expect('rotas', () => check(m.rotas['gp-2026-11'].v === 'B' && m.rotas['fsed-2026-11'] && !m.rotas['uv-2026-11'], 'rotas: newest import, A\'s new rota, B\'s removal'));
  expect('notes', () => check(m.notes.nA === 'from A' && m.notes.nB === 'from B' && m.notes.n0 === 'edited on B' && m.notes.n9 === 'typed again on A', `notes: both new notes, B's edit, a note re-typed after clearing survives (${JSON.stringify(m.notes)})`));
  expect('goals', () => { const ids = m.goals.map(g => g.id); check(ids.includes('g-A') && !ids.includes('g-social') && m.goals.find(g => g.id === 'g-gym').hoursPerWeek === 6 && ids.length === 5, `goals: A's new goal, A's deletion, B's edit (${ids})`); });
  expect('rules', () => check(m.rules.sleepHours === 8 && m.rules.wakeMin === 400 && m.rules.commute.FSED === 25, 'rules: field by field (A sleep 8h, B wake 06:40)'));
  expect('settings', () => check(m.settings.theme === 'light' && m.settings.calendarIds.join() === 'primary,work' && m.settings.clientId, 'settings: field by field'));
  expect('me', () => check(m.me?.id === '1', 'me kept'));
  expect('prefs', () => check(m.prefs['g|a'] === 2 && m.prefs['g|b'] === 3 && m.prefs['g|x'] === 1, 'prefs: learned scores from both'));
  expect('mediaMeta', () => check([...m.mediaMeta.dismissed].sort().join() === 'a,b,z' && m.mediaMeta.goals.book === 12 && m.mediaMeta.goals.movie === 50, 'mediaMeta: dismissed suggestions unioned, reading goals kept'));
  expect('deleted', () => check(m.deleted['task:r2'] && m.deleted['task:r3'] && m.deleted['plan:p1'] && m.deleted['note:n9'] && m.deleted['goal:g-social'], 'tombstones from both devices kept'));
  expect('stamps', () => check(m.stamps['rule:sleepHours'] && m.stamps['rule:wakeMin'] && m.stamps['note:nA'] && m.stamps['goal:g-A'], 'edit times from both devices kept'));
  expect(['outbox', 'google', 'apps'], () => check(m.outbox === local.outbox && m.google === local.google && m.apps === local.apps, 'outbox, sign-in and app cache stay on their own device'));
  expect(['version', 'updatedAt'], () => check(m.version === 1 && m.updatedAt === Math.max(A.get().updatedAt, B.get().updatedAt), 'version / updatedAt'));
  const again = S.mergeStates(m, name === 'A←B' ? B.get() : A.get());
  check(JSON.stringify({ ...again, stamps: 0 }) === JSON.stringify({ ...m, stamps: 0 }), 'merging the result again changes nothing (no ping-pong between devices)');
}
const strip = (s) => { const { outbox, google, apps, ...r } = s; return JSON.stringify(Object.fromEntries(Object.entries(r).map(([k, v]) => [k, Array.isArray(v) && k === 'goals' ? [...v].sort((a, b) => a.id.localeCompare(b.id)) : v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort()) : v]).sort())); };
check(strip(S.mergeStates(A.get(), B.get())) === strip(S.mergeStates(B.get(), A.get())), 'both directions give the same synced state');
const missing = Object.keys(st0.get()).filter(k => !covered.has(k));
check(!missing.length, `every collection in store.js defaults is covered by this test${missing.length ? ' — missing: ' + missing : ''}`);

console.log('old copies (no edit times) and fresh devices');
{
  clock = T0;
  const drive = J(st0.get()); delete drive.stamps; drive.goals = [...drive.goals.slice(0, 3), { id: 'g-c', name: 'Custom', hoursPerWeek: 3, minBlock: 30, maxBlock: 60, priority: 4, color: '#000' }]; drive.rules = { ...drive.rules, sleepHours: 8 }; drive.settings = { ...drive.settings, theme: 'light' };
  LS.clear(); const N = await fresh(); N.update(s => ({ ...s, rotas: { 'gp-2026-12': { id: 'gp-2026-12', people: [], legend: {}, importedAt: new Date(clock).toISOString() } } }));   // imports a rota before signing in
  for (const [nm, m] of [['fresh←Drive', S.mergeStates(N.get(), drive)], ['Drive←fresh', S.mergeStates(drive, N.get())]]) {
    check(m.me?.id === '1', `${nm}: a newer fresh device never wipes me`);
    check(m.goals.map(g => g.id).join() === 'g-usmle,g-german,g-yuzu,g-c', `${nm}: custom goals kept, deleted defaults not brought back (${m.goals.map(g => g.id)})`);
    check(m.rules.sleepHours === 8 && m.settings.theme === 'light', `${nm}: custom rules and settings kept`);
    check(m.rotas['gp-2026-12'] && m.rotas['gp-2026-11'] && Object.keys(m.tasks).length === 3, `${nm}: both devices' rotas and Drive's tasks kept`);
  }
  const old = J(st0.get()); old.updatedAt = T0 - 120 * D; old.tasks.r1 = rec('tasks', 'r1', 'anc', T0 - 200 * D);
  const now = J(st0.get()); delete now.tasks.r1; now.deleted = { ...now.deleted, 'task:r1': T0 - 110 * D }; now.updatedAt = T0;
  check(!S.mergeStates(now, old).tasks.r1 && !S.mergeStates(old, now).tasks.r1, 'a device offline for 120 days does not bring back what was deleted 110 days ago');
  const ghost = J(st0.get()); ghost.tasks = { ...ghost.tasks, x: null, y: 'str' }; ghost.plan = { a: 'str' }; ghost.notes = { q: null }; ghost.goals = 'no'; ghost.me = 5; ghost.updatedAt = T0 + H;
  let m; try { m = S.mergeStates(st0.get(), ghost); } catch (e) { m = null; }
  check(m && !('x' in m.tasks) && m.tasks.r1 && Array.isArray(m.goals) && m.goals.length === 5 && m.me?.id === '1', 'a malformed Drive copy merges without throwing; bad records dropped, good ones kept');
  check(S.mergeStates(st0.get(), null) === st0.get() && S.mergeStates(null, st0.get()) === st0.get(), 'nothing on Drive: the local copy as is');
  const fut = J(st0.get()); fut.choreLog = { c1: { at: 5, v: 1 } }; const fut2 = J(st0.get()); fut2.choreLog = { c2: { at: 6, v: 2 } }; fut2.updatedAt = T0 + 1;
  check(Object.keys(S.mergeStates(fut, fut2).choreLog).length === 2, 'a collection this build does not know yet is merged record by record, not overwritten');
}

console.log('inbound: icons are cut by graphemes');
{
  const I = await import('../docs/js/inbound.js');
  const t = (v) => I.normalizeStatus({ app: 'x', icon: v, updatedAt: '2026-11-13T06:00:00Z' }).icon;
  check(t('a🚀🚀') === 'a' && t('🚀🚀') === '🚀' && t('🇸🇦') === '🇸🇦' && t('👩‍⚕️') === '👩‍⚕️' && t('OR') === 'OR' && t('\uD83D') === '', 'one emoji (flags and ZWJ kept whole) or a 2-letter monogram, never a lone surrogate');
  const due = (v) => I.normalizeStatus({ app: 'x', due: v }).due;
  check(due(5000) === 999 && due(-3) === 0 && due('2') === 2 && due(null) === undefined && due('x') === undefined, 'due counts are clamped to 0–999');
}
Date.now = realNow;

// ════════════════════════════════════════ in the browser
const { chromium } = await import('/opt/npm-tools/node_modules/playwright/index.mjs').catch(() => ({}));
if (!chromium) { console.log('  (playwright missing: browser part skipped)'); }
else {
  console.log('browser: a malformed record never blanks a tab');
  const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png' };
  const server = http.createServer((req, res) => { let p = path.join(root, decodeURIComponent(req.url.split('?')[0])); if (p.endsWith('/')) p += 'index.html'; if (!fs.existsSync(p)) { res.writeHead(404); return res.end(); } res.writeHead(200, { 'content-type': mime[path.extname(p)] || 'application/octet-stream' }); res.end(fs.readFileSync(p)); }).listen(0);
  await new Promise(r => server.on('listening', r)); const URL0 = `http://localhost:${server.address().port}/index.html`;
  const browser = await chromium.launch(), sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const open = async ({ w = 390, h = 844, preset = {}, ui = 'clean' } = {}) => {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, isMobile: w < 500, hasTouch: w < 500, serviceWorkers: 'block', timezoneId: 'Asia/Riyadh', deviceScaleFactor: 1 });
    const p = await ctx.newPage(); const errors = []; p.on('pageerror', e => errors.push(e.message));
    await p.clock.install({ time: new Date('2026-11-13T09:30:00+03:00') });
    await p.addInitScript(([pre, u]) => { if (!sessionStorage.getItem('seeded')) { sessionStorage.setItem('seeded', '1'); for (const [k, v] of Object.entries(pre)) localStorage.setItem(k, v); localStorage.setItem('citrus.ui', JSON.stringify({ ui: u, size: 'normal' })); } }, [preset, ui]);
    await p.goto(URL0); await sleep(700);
    return { p, ctx, errors };
  };
  const tabs = ['today', 'rota', 'plan', 'mind', 'social', 'apps', 'more'];
  const walk = async (p) => { const empty = []; for (const v of tabs) { if (v === 'more') await p.click('#btnMore'); else await p.click(`nav.tabs button[data-view=${v}]`); await sleep(250); const n = await p.locator(`#view-${v} *`).count(); if (n < 5) empty.push(v); } return empty; };
  // every collection gets a null, a string, an array and a number record, plus broken plan / goals / rules / rota
  const poison = { me: { name: 'Dr. Test', id: '1' }, updatedAt: 1 };
  for (const k of Object.keys(S.RECORD_MAPS)) poison[k] = { a: null, b: 'x', c: [1], d: 4, ok: { id: 'ok', title: 'Fine', name: 'Fine', at: 1, month: 11 } };
  Object.assign(poison, { habitLog: { a: null, ok: { '2026-11-13': null } }, metricLog: { a: null }, plan: { '2026-11-13': 'str', '2026-11-14': [null, { id: 'p', start: 600, end: 660, status: 'accepted' }] }, goals: [null, { name: 'Gym' }], rules: { sleepHours: 'x', protectedBlocks: [null] }, rotas: { x: { people: 'no' }, y: null }, notes: { a: null }, mediaMeta: { dismissed: 'x' }, settings: { calendarIds: 'primary' }, outbox: [null] });
  {
    const { p, ctx, errors } = await open({ preset: { 'citrus.state.v1': JSON.stringify(poison) } });
    const empty = await walk(p);
    check(!empty.length && !errors.length, `every tab renders with a poisoned state${empty.length ? ' — empty: ' + empty : ''}${errors.length ? ' — errors: ' + errors.slice(0, 3).join(' | ') : ''}`);
    check(await p.locator('.d10-alert').count() === 1 && /skipped \d+ damaged/i.test(await p.locator('.d10-alert').innerText()), 'a quiet banner says damaged items were skipped');
    await p.reload(); await sleep(700);
    check(await p.locator('.d10-alert').count() === 0, 'repaired once: no banner on the next start');
    // a malformed restore through Settings › Restore
    await p.click('#btnMore'); await sleep(250);
    const bad = path.join(shots, 'bad-restore.json'); fs.writeFileSync(bad, JSON.stringify({ me: { name: 'Dr. Test', id: '1' }, rotas: { x: { people: 'no' } }, plan: { '2026-11-13': 'str' }, tasks: { a: null } }));
    const inp = p.locator('#view-more input[type=file][accept=".json"]');
    if (await inp.count()) { await inp.setInputFiles(bad); await sleep(500); const e2 = await walk(p); check(!e2.length && !errors.length, `a malformed restore leaves every tab working${errors.length ? ' — ' + errors[0] : ''}`); }
    await ctx.close();
  }
  console.log('browser: damaged copy and full storage');
  for (const [ui, w, h] of [['clean', 390, 844], ['paper', 390, 844], ['clean', 1600, 1000], ['paper', 1600, 1000]]) {
    const good = JSON.stringify({ me: { name: 'Dr. Test', id: '1' }, tasks: { t1: { id: 't1', title: 'Renew licence', at: 1 } }, updatedAt: 1 });
    const { p, ctx, errors } = await open({ w, h, ui, preset: { 'citrus.state.v1': good.slice(0, -20), 'citrus.state.v1.bak': good } });
    const txt = await p.locator('.d10-alert').innerText().catch(() => '');
    const task = await p.evaluate(() => window.__citrus?.store.get().tasks.t1?.title);
    if (w === 390 && ui === 'clean') {
      check(/damaged/i.test(txt) && /last clean copy/.test(txt) && task === 'Renew licence', 'a damaged copy: banner, and the data is back from the clean copy');
      check(await p.evaluate(() => Object.keys(localStorage).some(k => k.startsWith('citrus.state.corrupt.'))), 'the damaged copy is kept on the device');
      const [dl] = await Promise.all([p.waitForEvent('download', { timeout: 3000 }).catch(() => null), p.click('.d10-alert button:has-text("Download damaged copy")')]);
      check(!!dl && /citrus-damaged/.test(dl?.suggestedFilename() || ''), 'the damaged copy can be downloaded');
    }
    const box = await p.locator('.d10-alert').boundingBox();
    check(box && box.x >= 15 && box.x + box.width <= w - 15 && !(await p.evaluate(() => document.documentElement.scrollWidth > innerWidth)), `${ui} ${w}px: banner inside the 16px gutter, no sideways scroll`);
    await p.screenshot({ path: `${shots}/damaged-${ui}-${w}.png` });
    await p.locator('.d10-alert .d10-x').click(); await sleep(100); check(await p.locator('.d10-alert').count() === 0, `${ui} ${w}px: banner can be dismissed`);
    // storage full: the next edit cannot be saved
    await p.evaluate(() => { const real = Storage.prototype.setItem; Storage.prototype.setItem = function (k, v) { if (k.startsWith('citrus.state')) { const e = new DOMException('full', 'QuotaExceededError'); throw e; } return real.call(this, k, v); }; window.__citrus.store.update(s => ({ ...s, notes: { ...s.notes, '2026-11-13': 'x' } })); });
    await sleep(300);
    const full = await p.locator('.d10-alert[data-id=persist]').innerText().catch(() => '');
    check(/Not saved on this device since/.test(full) && /full/i.test(full), `${ui} ${w}px: full storage shows a banner`);
    await p.evaluate(() => window.__citrus.store.update(s => ({ ...s, notes: { ...s.notes, '2026-11-13': 'y' } }))); await sleep(200);
    check(await p.locator('.d10-alert').count() === 1, `${ui} ${w}px: only once`);
    await p.screenshot({ path: `${shots}/full-${ui}-${w}.png` });
    check(!errors.length, `${ui} ${w}px: no page errors${errors.length ? ' — ' + errors[0] : ''}`);
    await ctx.close();
  }
  await browser.close(); server.close();
}
console.log(bad ? `\n${bad} FAILED` : '\nall passed');
process.exit(bad ? 1 : 0);
