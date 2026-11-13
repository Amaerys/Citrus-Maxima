// Nurses' schedule parsing + postings + who-works-with-me. Run: node test/nurses.mjs
import assert from 'node:assert/strict'; import fs from 'node:fs';
globalThis.location = { href: 'https://x/' }; globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
import { parseRotaFile, serializeRota, interpretCode } from '../docs/js/rota-parser.js'; import * as N from '../docs/js/nurses.js'; import { dayInfo } from '../docs/js/model.js'; import { mergeStates } from '../docs/js/store.js';
const file = new URL('./data/nurses.xlsx', import.meta.url).pathname; let fails = 0;
const t = async (n, f) => { try { await f(); console.log('  ✓', n); } catch (e) { fails++; console.log('  ✗', n, '\n    ', e.stack.split('\n').slice(0, 3).join('\n     ')); } };
const D = (d) => new Date(2026, 10, d);
// a GP rota with me at Upper Village (D1) on the 9th, Lower Village (D2) on the 10th, night at UV on the 11th
const gp = { id: 'gp-2026-11', unitKind: 'gp', year: 2026, month: 11, daysInMonth: 30, legend: { D: { hours: { start: 480, end: 1200, overnight: false, durationMin: 720 } }, N: { hours: { start: 1200, end: 480, overnight: true, durationMin: 720 } }, D1: { desc: 'Upper Village' }, D2: { desc: 'Lower Village' }, N1: { desc: 'Upper Village' } }, people: [{ name: 'Dr Me', id: '1', days: { 9: 'D1', 10: 'D2', 11: 'N1' } }, { name: 'Dr Colleague', id: '2', days: { 9: 'D1' } }] };
let nurse = null;
if (fs.existsSync(file)) {
  const buf = fs.readFileSync(file); nurse = serializeRota(await parseRotaFile(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), 'QID-Nov.26_Schedule.xlsx'));
  await t('real file: read as a NURSE schedule, not a GP rota', () => { assert.equal(nurse.unitKind, 'nurse'); assert.equal(nurse.id, 'nurse-2026-11'); assert.equal(nurse.year, 2026); assert.equal(nurse.month, 11); assert.ok(nurse.weekdayOk); assert.equal(nurse.people.length, 50); });
  await t('section headings are not people; names, IDs, titles, numbers read', () => {
    assert.ok(!nurse.people.some(p => /construction|qiddiyah project|free standing|upper\s+plat/i.test(p.name))); const c = nurse.people.find(p => /Cresilda/.test(p.name));
    assert.equal(c.id, '418467'); assert.equal(c.title, 'RN'); assert.equal(c.name, 'Cresilda Belleza'); assert.ok(c.leader); assert.equal(c.group, 'leaders'); assert.equal(c.mobile, '501215648'); assert.equal(c.clinic, 'QIC');
  });
  await t('groups: leaders, first aiders, pool, FSED, Aqua Arabia, Six Flags, Upper Plateau, Nairiya', () => {
    const g = (re) => nurse.people.find(p => re.test(p.name)).group;
    assert.equal(g(/Mary Rose/), 'fa'); assert.equal(g(/Anika/), 'pool'); assert.equal(g(/Narita/), 'fsed'); assert.equal(g(/Sillina/), 'aqua'); assert.equal(g(/Ara Karla/), 'sixflags'); assert.equal(g(/Kharmina/), 'plateau'); assert.equal(g(/Jesther/), 'nairiya'); assert.equal(g(/Odai/), 'head');
    const n = {}; nurse.people.forEach(p => n[p.group] = (n[p.group] || 0) + 1); assert.deepEqual(n, { head: 1, leaders: 6, fa: 2, pool: 25, fsed: 6, aqua: 4, sixflags: 4, plateau: 1, nairiya: 1 });
  });
  await t('legend: hours for every code, leave, training, rest days are off', () => {
    const L = nurse.legend; assert.deepEqual([L.D.hours.start, L.D.hours.end], [480, 1200]); assert.ok(L.N.hours.overnight); assert.deepEqual([L.M.hours.start, L.M.hours.end], [720, 1440]); assert.deepEqual([L.A.hours.start, L.A.hours.end], [480, 960]); assert.equal(L['A+'].hours.start, 600); assert.ok(L.A2.hours.overnight); assert.equal(L['B+'].hours.durationMin, 570);
    const k = (name, d) => { const p = nurse.people.find(x => x.name.includes(name)); return interpretCode(p.days[d] || '', nurse.legend, 'nurse'); };
    assert.equal(k('Elfa', 1).kind, 'leave'); assert.equal(k('Cresilda', 2).kind, 'off'); assert.equal(k('Cresilda', 1).kind, 'work'); assert.equal(k('Cresilda', 1).type, 'D'); assert.equal(k('Odai', 15).kind, 'other'); assert.equal(k('Fatima Kadil', 15).kind, 'other'); assert.equal(k('Meldina', 1).kind, 'other'); assert.equal(k('Cresilda', 9).hours.end, 960);
  });
  await t('headcount per day matches the sheet’s own counts (D16 on the 1st, N6, M2)', () => {
    const st = N.staffing({ rotas: { n: nurse } }, D(1)); assert.equal(st.byShift.D, 16); assert.equal(st.byShift.N, 6); assert.equal(st.byShift.M, 2);
  });
}
const base = () => ({ rotas: { gp, ...(nurse ? { n: nurse } : {}) }, me: { id: '1', name: 'Dr Me' }, posts: {}, deleted: {} });
await t('nurses never leak into the doctors’ day: not colleagues, not on leave, not in coverage', () => {
  const info = dayInfo(base(), D(9)); assert.ok(info.entries.every(e => e.rota.unitKind !== 'nurse')); assert.ok(info.leave.length === 0); assert.equal(Object.values(info.bySite).flat().length, 2);
});
if (nurse) {
  await t('who will work with me: pool + leaders, not FSED / Aqua / Plateau; overlap-sorted', () => {
    const s = base(), mine = dayInfo(s, D(9)).mine, w = N.workingWithMe(s, D(9), mine);
    assert.equal(w.site, 'UPV'); assert.equal(w.confirmed.length, 0); assert.ok(w.possible.length >= 10, 'possible ' + w.possible.length);
    assert.ok(w.possible.every(p => ['pool', 'leaders', 'fa', 'head'].includes(p.group)), 'no fixed groups'); assert.ok(w.possible.every(p => p.overlap > 0));
    assert.ok(w.possible.every(p => p.group !== 'leaders' || p.choices.includes('UPV')));
    const ov = w.possible.map(p => p.pct); assert.ok(w.possible[0].chance * w.possible[0].pct >= w.possible.at(-1).chance * w.possible.at(-1).pct);
  });
  await t('posting a nurse to my site confirms her; posting elsewhere removes her; clearing restores', () => {
    let s = base(); const mine = () => dayInfo(s, D(9)).mine, who = N.rowsFor(s, D(9)).find(r => r.group === 'pool' && r.shift.type === 'D');
    s = N.setPost(s, D(9), who.key, 'UPV'); let w = N.workingWithMe(s, D(9), mine()); assert.ok(w.confirmed.some(c => c.key === who.key)); assert.ok(!w.possible.some(c => c.key === who.key));
    s = N.setPost(s, D(9), who.key, 'LPV'); w = N.workingWithMe(s, D(9), mine()); assert.ok(!w.confirmed.some(c => c.key === who.key) && !w.possible.some(c => c.key === who.key)); assert.equal(w.elsewhere, 1);
    s = N.setPost(s, D(9), who.key, ''); w = N.workingWithMe(s, D(9), mine()); assert.ok(w.possible.some(c => c.key === who.key)); assert.ok(s.deleted[`post:${D(9).getFullYear()}-11-09:${who.key}`]);
  });
  await t('history teaches the app: suggestions and chances', () => {
    let s = base(); const who = N.rowsFor(s, D(10)).find(r => r.group === 'pool' && r.shift.type === 'D' && N.rowsFor(s, D(9)).some(x => x.key === r.key));
    assert.ok(who, 'a pool nurse on D both days');
    s = N.setPost(s, D(9), who.key, 'UPV'); s = N.setPost(s, D(8), who.key, 'UPV');
    assert.equal(N.rowsFor(s, D(10)).find(r => r.key === who.key).suggest, 'UPV');
    const w0 = N.workingWithMe(base(), D(11), dayInfo(base(), D(11)).mine); const w1 = N.workingWithMe(s, D(11), dayInfo(s, D(11)).mine);
    s = N.applySuggestions(s, D(10)); assert.equal(N.postOf(s, D(10), who.key), '', 'a guess is never a confirmed posting'); assert.equal(N.tipOf(s, D(10), who.key).site, 'UPV');
  });
  await t('tips: heard postings rank above guesses, never count as fact or history', () => {
  let s = base(); const mine = () => dayInfo(s, D(9)).mine, who = N.rowsFor(s, D(9)).find(r => r.group === 'pool' && r.shift.type === 'D');
  s = N.setPost(s, D(9), who.key, 'UPV', { tip: true, from: 'Cresilda' }); assert.equal(N.postOf(s, D(9), who.key), ''); assert.deepEqual(N.tipOf(s, D(9), who.key), { site: 'UPV', from: 'Cresilda' });
  let w = N.workingWithMe(s, D(9), mine()); assert.equal(w.confirmed.length, 0); assert.equal(w.tipped.length, 1); assert.equal(w.tipped[0].heardFrom, 'Cresilda'); assert.ok(!w.possible.some(x => x.key === who.key));
  assert.equal(N.history(s, who.key, D(20)).length, 0, 'a tip is not history'); assert.equal(N.staffing(s, D(9)).bySite.UPV, undefined, 'a tip is not on the board as posted');
  s = N.setPost(s, D(9), who.key, 'LPV', { tip: true, from: 'Cresilda' }); w = N.workingWithMe(s, D(9), mine()); assert.equal(w.tipped.length, 0); assert.equal(w.tippedElsewhere, 1); assert.ok(!w.possible.some(x => x.key === who.key));
  s = N.setPost(s, D(9), who.key, 'UPV'); w = N.workingWithMe(s, D(9), mine()); assert.equal(w.confirmed.length, 1); assert.equal(w.tipped.length, 0, 'confirming replaces the tip');
});
await t('leaders go to UPV/LPV only (the sheet heading); fixed groups carry their place; posts merge across devices', () => {
    const s = base(), rows = N.rowsFor(s, D(1)); const lead = rows.find(r => r.group === 'leaders'), fsed = rows.find(r => r.group === 'fsed');
    assert.deepEqual(lead.choices, ['UPV', 'LPV']); assert.equal(fsed.post, 'FSED'); assert.equal(N.setPost(s, D(1), fsed.key, 'UPV').posts[`2026-11-01:${fsed.key}`].site, 'UPV');
    const a = N.setPost(s, D(1), lead.key, 'UPV'), b = N.setPost(s, D(1), 'id:99', 'LPO'); const m = mergeStates(a, b); assert.equal(Object.keys(m.posts).length, 2);
  });
}
await t('no nurse schedule loaded → quiet', () => { const s = { rotas: { gp }, me: { id: '1', name: 'Dr Me' }, posts: {} }; assert.equal(N.workingWithMe(s, D(9), dayInfo(s, D(9)).mine).hasNurses, false); assert.deepEqual(N.rowsFor(s, D(9)), []); assert.equal(N.workingWithMe(s, D(20), dayInfo(s, D(20)).mine), null); });
console.log(fails ? `${fails} FAILED` : 'nurses ok'); process.exit(fails ? 1 : 0);
