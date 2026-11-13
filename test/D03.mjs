// D03 — nurse schedule parsing & prediction: unknown section headings, guesses never stored as fact, honest "who's with you". Run: node test/D03.mjs
// Synthetic sheets use made-up names; the real test/data/nurses.xlsx is only READ and checked by counts and structure.
import assert from 'node:assert/strict'; import fs from 'node:fs';
import { parseRotaGrid, parseRotaFile, serializeRota, interpretCode, nurseSection } from '../docs/js/rota-parser.js';
import { readXlsx, sheetToGrid } from '../docs/js/xlsx-lite.js';
import * as N from '../docs/js/nurses.js';
let fails = 0;
const t = async (n, f) => { try { await f(); console.log('  ✓', n); } catch (e) { fails++; console.log('  ✗', n, '\n    ', e.stack.split('\n').slice(0, 3).join('\n     ')); } };
const D = (d) => new Date(2026, 10, d);
const H = (a, b) => ({ start: a * 60, end: (b % 24) * 60, overnight: b % 24 <= a, durationMin: ((b - a + 24) % 24 || 24) * 60 });
const mineAt = (site, a = 8, b = 20) => ({ person: { name: 'Dr Test', id: '1' }, shift: { kind: 'work', type: 'D', site, hours: H(a, b) } });

// ───────── a made-up nurses' sheet, same layout as the real one (sections are merged cells, legend + head-count table below)
const DAYS = 30, C0 = 9;   // day 1 sits in column 9
function sheet() {
  const g = [], row = (cells) => { const r = Array(C0 + DAYS).fill(null); cells.forEach((v, i) => { if (v !== undefined) r[i] = v; }); g.push(r); return r; };
  const band = (text) => row(Array(C0 + DAYS).fill(text));
  const day = (code, from = 1, to = DAYS) => { const a = []; for (let d = from; d <= to; d++) a[C0 + d - 1] = code; return a; };
  const person = (sn, id, name, title, mobile, clinic, codes) => { const r = row([null, `#${sn}`, id, name, title, 'BLS/ACLS', mobile, 'TUWAIQ', clinic]); codes.forEach((v, i) => { if (v) r[i] = v; }); };
  row([]); row([null, '', 'TEST - Medical']); row([null, '', 'UNIT / DEPT', 'UNIT / DEPT', 'EMERGENCY/CLINIC']); row([null, '', 'Month&Year', 'Month&Year', 'November 2026']); row([]);
  const hd = row([null, '#', 'I.D', 'NAME', 'Title', 'BLS/ACLS', 'Mobile #', 'ACCOM.', 'ASSIGNED CLINIC']); for (let d = 1; d <= DAYS; d++) hd[C0 + d - 1] = d;
  const wd = row([null, '#', 'I.D', 'NAME', 'Title', 'BLS/ACLS', 'Mobile #', 'ACCOM.', 'ASSIGNED CLINIC']); for (let d = 1; d <= DAYS; d++) wd[C0 + d - 1] = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'][(d - 1) % 7];
  band('Test Project-HMC');
  person(1, 9001, 'Head Tester', 'HN', '0500000001', ' ALL SITES', day('A+'));
  band('Construction Clinics Team Leaders (UPV-LPV)');
  person(2, 900002, 'Lead Alpha (Leader)', 'RN', '500000002', 'QIC', day('D'));
  band('Construction Clinics (UPV-UPO-LPO-LPV)');
  person(3, 900003, 'Pool Bravo', 'SN', '500000003', 'QIC', day('D'));
  person(4, 900004, 'Pool Charlie', 'SN', '500000004', 'QIC', day('D'));
  person(5, 900005, 'Pool Delta', 'SN', '500000005', 'QIC', day('PULL OUT - SOMEWHERE Project'));
  band('Aqua Arabia (WW+HG)');
  person(6, 900006, 'Aqua Echo', 'SN', '500000006', 'SF/AA', day('D'));
  band('SIX FLAGS');
  person(7, 900007, 'Flags Foxtrot', 'RN', '500000007', 'SF/AA', day('M'));
  band('ROOFTOP WELLNESS CLINIC (0900-1700H)');   // a heading the app has never seen
  person(8, 900008, 'Roof Golf', 'SN', '500000008', 'QIC', day('D'));
  person(9, 900009, 'Roof Hotel', 'SN', '500000008', 'QIC', day('D'));   // same mobile as Golf
  band('Mystery Team (UPV-LPV)');   // unknown, but it lists where it can be posted
  person(10, 900010, 'Myst India', 'SN', '5000001', 'QIC', day('N'));   // 7-digit mobile
  row([]);
  row([null, '', ' LEGEND', ' LEGEND', ' LEGEND', ' LEGEND', null, null, 'D', ...Array(DAYS).fill(6)]);   // sheet says 6 on D every day (there are 6)
  row([null, '', 'D', '08:00-20:00', '12 Hrs', null, null, null, 'N', ...Array(DAYS).fill(2)]);       // sheet says 2 on N (there is 1)
  row([null, '', 'N', '20:00-08:00', '12 Hrs']); row([null, '', 'M', '12:00 - 24:00', '12 Hrs']); row([null, '', 'A+', '10:00-18:00', '8Hrs']);
  row([null, '', 'A2', '14:00-02:00', '8Hrs']);   // the stated length is wrong (12h)
  row([null, '', 'VL', 'Vacation Leave']);
  return g;
}

await t('nurseSection: known headings map to groups, unknown ones get their own key and a readable name', () => {
  assert.equal(nurseSection('Construction Clinics Team Leaders (UPV-LPV)').key, 'leaders'); assert.deepEqual(nurseSection('Construction Clinics Team Leaders (UPV-LPV)').sites, ['UPV', 'LPV']);
  assert.equal(nurseSection('FIRST AID Team').key, 'fa'); assert.equal(nurseSection('SIX FLAGS').key, 'sixflags'); assert.equal(nurseSection('UPPER PLATUE NURSE CLINIC (0800-1730H)').key, 'plateau');
  const u = nurseSection('ROOFTOP WELLNESS CLINIC (0900-1700H)'); assert.equal(u.known, false); assert.equal(u.key, 'sec:rooftop-wellness-clinic'); assert.equal(u.label, 'Rooftop Wellness Clinic');
});
const syn = parseRotaGrid(sheet(), { sourceName: 'test.xlsx' });
await t('synthetic sheet: every block is its own group — nothing folded into the block above', () => {
  const g = Object.fromEntries(syn.people.map(p => [p.name, p.group]));
  assert.equal(g['Head Tester'], 'head'); assert.equal(g['Lead Alpha'], 'leaders'); assert.equal(g['Pool Bravo'], 'pool'); assert.equal(g['Aqua Echo'], 'aqua');
  assert.equal(g['Flags Foxtrot'], 'sixflags'); assert.equal(g['Roof Golf'], 'sec:rooftop-wellness-clinic'); assert.equal(g['Myst India'], 'sec:mystery-team');
  assert.equal(syn.banner, 'Test Project-HMC'); assert.ok(!syn.people.some(p => /project|clinic|team/i.test(p.name)), 'headings are not people');
  assert.deepEqual(syn.groups['sec:rooftop-wellness-clinic'], { heading: 'ROOFTOP WELLNESS CLINIC (0900-1700H)', label: 'Rooftop Wellness Clinic', fixed: 'Rooftop Wellness Clinic' });
  assert.deepEqual(syn.groups['sec:mystery-team'].choices, ['UPV', 'LPV']);
});
await t('unknown fixed block: shown at its own place, never a floater; unknown block with sites floats only there', () => {
  const s = { rotas: { n: serializeRota(syn) }, posts: {} }, rows = N.rowsFor(s, D(3)), r = (n) => rows.find(x => x.person.name === n);
  assert.equal(r('Roof Golf').fixed, 'Rooftop Wellness Clinic'); assert.equal(r('Roof Golf').post, 'Rooftop Wellness Clinic'); assert.ok(!N.isFloater(r('Roof Golf').group));
  assert.equal(r('Flags Foxtrot').fixed, 'Six Flags'); assert.deepEqual(r('Myst India').choices, ['UPV', 'LPV']); assert.deepEqual(r('Lead Alpha').choices, ['UPV', 'LPV']);
  assert.deepEqual(r('Pool Bravo').choices, ['UPV', 'LPV', 'UPO', 'LPO']);
  assert.equal(N.GROUPS['sec:rooftop-wellness-clinic'].label, 'Rooftop Wellness Clinic', 'registered so directory filters list it');
  const st = N.staffing(s, D(3)); assert.equal(st.bySite['Rooftop Wellness Clinic'].D, 2); assert.equal(st.bySite['Six Flags'].M, 1);
  // an unknown group key with no definition at all is fixed under its own name, not silently put in the pool
  assert.deepEqual(N.groupDef('sec:old-wing'), { label: 'Old Wing', fixed: 'Old Wing' });
});
await t('pull out keeps the destination; person carries pulledOut', () => {
  const p = syn.people.find(x => x.name === 'Pool Delta'); assert.equal(p.days[1], 'PULL OUT - SOMEWHERE'); assert.equal(p.pulledOut, 'Somewhere');
  const k = interpretCode(p.days[1], syn.legend, 'nurse'); assert.equal(k.kind, 'other'); assert.equal(k.label, 'Pulled out → Somewhere');
});
await t('import warnings: shared mobile, odd mobile, legend hours, head-count table vs names', () => {
  const w = syn.warnings, k = (x) => w.filter(y => y.kind === x);
  assert.equal(k('mobile-shared').length, 1); assert.match(k('mobile-shared')[0].text, /Roof and Roof share/);
  assert.equal(k('mobile-odd').length, 1); assert.match(k('mobile-odd')[0].text, /5000001/);
  assert.equal(k('legend-hours').length, 1); assert.equal(k('legend-hours')[0].code, 'A2');
  assert.equal(k('count').length, 1, JSON.stringify(k('count'))); assert.equal(k('count')[0].code, 'N'); assert.equal(k('count')[0].days.length, 30);
});

// ───────── postings & prediction on the synthetic sheet
const base = () => ({ rotas: { n: serializeRota(syn) }, posts: {}, deleted: {}, friends: {} });
const key = (s, n) => N.rowsFor(s, D(10)).find(r => r.person.name === n).key;
await t('"Use last posts" saves tips (guesses), never confirmed postings; tips never become history', () => {
  let s = base(); const b = key(s, 'Pool Bravo');
  s = N.setPost(s, D(5), b, 'UPV');   // confirmed once
  assert.equal(N.rowsFor(s, D(10)).find(r => r.key === b).suggest, 'UPV');
  s = N.applySuggestions(s, D(10));
  assert.equal(N.postOf(s, D(10), b), '', 'not a confirmed posting'); assert.deepEqual(N.tipOf(s, D(10), b), { site: 'UPV', from: 'last time', guess: true });
  assert.equal(N.history(s, b).length, 1, 'only the real posting is history'); assert.equal(N.staffing(s, D(10)).bySite.UPV, undefined, 'not on the board as posted');
  const row = N.rowsFor(s, D(10)).find(r => r.key === b); assert.equal(row.suggest, '', 'no second suggestion on top of the tip, so the button empties');
  assert.equal(N.rowsFor(s, D(10)).filter(r => !r.post && r.suggest).length, 0);
  const w = N.workingWithMe(s, D(10), mineAt('Upper Village')); assert.equal(w.confirmed.length, 0); assert.ok(w.tipped.some(x => x.key === b && x.guess));
  s = N.setPost(s, D(10), b, 'UPV'); assert.equal(N.postOf(s, D(10), b), 'UPV', 'confirming replaces the guess');
});
await t('chance uses only postings BEFORE the day; recent postings weigh more', () => {
  let s = base(); const c = key(s, 'Pool Charlie');
  s = N.setPost(s, D(25), c, 'LPV'); let w = N.workingWithMe(s, D(16), mineAt('Upper Village'));
  let p = w.possible.find(x => x.key === c); assert.equal(p.seen, 0, 'a posting on the 25th is not history for the 16th'); assert.equal(p.known, false);
  s = N.setPost(base(), D(1), c, 'LPV'); s = N.setPost(s, D(14), c, 'UPV'); w = N.workingWithMe(s, D(16), mineAt('Upper Village'));
  p = w.possible.find(x => x.key === c); assert.equal(p.seen, 2); assert.ok(p.chance > 2 / 6, `recent UPV outweighs older LPV (${p.chance})`);
  assert.ok(w.likely.some(x => x.key === c));
});
await t('no history: nobody is "likely", ties broken by friends then overlap, one summary line', () => {
  let s = base(); s.friends = { f1: { id: 'f1', name: 'Charlie', rotaKey: key(s, 'Pool Charlie'), fav: true } };
  const w = N.workingWithMe(s, D(10), mineAt('Upper Village'));
  assert.equal(w.likely.length, 0); assert.ok(w.possible.every(p => !p.known));
  assert.equal(w.possible[0].person.name, 'Pool Charlie', 'the favourite comes first, not the alphabet');
  assert.equal(w.summary, `${w.possible.length} could be sent, not posted yet`); assert.doesNotMatch(w.summary, /%|likely/i);
});
await t('head nurse is listed apart, never as a candidate; fixed and unknown fixed blocks are left out', () => {
  const w = N.workingWithMe(base(), D(10), mineAt('Upper Village'));
  assert.deepEqual(w.head.map(r => r.person.name), ['Head Tester']); assert.ok(!w.possible.some(p => p.group === 'head'));
  assert.ok(w.possible.every(p => ['pool', 'leaders', 'fa', 'sec:mystery-team'].includes(p.group)), w.possible.map(p => p.group).join());
  const o = N.workingWithMe(base(), D(10), mineAt('Upper office clinic')); assert.ok(!o.possible.some(p => p.group === 'leaders'), 'team leaders are not sent to the office clinics');
});

// ───────── the real sheet: re-verify the whole parse against the raw cells
const file = new URL('./data/nurses.xlsx', import.meta.url).pathname;
if (fs.existsSync(file)) {
  const buf = fs.readFileSync(file), ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  const rota = serializeRota(await parseRotaFile(ab, 'nurses.xlsx')), { grid } = sheetToGrid((await readXlsx(ab)).sheets[0]);
  await t('real sheet: Six Flags is its own block, team leaders UPV/LPV only, groups add up', () => {
    const n = {}; rota.people.forEach(p => n[p.group] = (n[p.group] || 0) + 1);
    assert.deepEqual(n, { head: 1, leaders: 6, fa: 2, pool: 25, fsed: 6, aqua: 4, sixflags: 4, plateau: 1, nairiya: 1 });
    assert.deepEqual(rota.groups.leaders.choices, ['UPV', 'LPV']); assert.ok(!Object.keys(rota.groups).some(k => k.startsWith('sec:')), 'every heading in this sheet is known');
    const st = N.staffing({ rotas: { n: rota }, posts: {} }, D(12)); assert.ok(st.bySite['Six Flags'], 'Six Flags on the board on the 12th');
    const lead = N.rowsFor({ rotas: { n: rota }, posts: {} }, D(1)).find(r => r.group === 'leaders'); assert.deepEqual(lead.choices, ['UPV', 'LPV']);
  });
  await t('real sheet: every person row and every day cell matches the raw sheet', () => {
    const hdr = grid.findIndex(r => r && r.some(v => String(v ?? '').trim().toUpperCase() === 'NAME')), nameCol = grid[hdr].findIndex(v => String(v ?? '').trim().toUpperCase() === 'NAME');
    const dayCol = {}; grid[hdr].forEach((v, c) => { if (typeof v === 'number' && v >= 1 && v <= 31) dayCol[v] = c; });
    const legendAt = grid.findIndex(r => r && r.some(v => /^\s*legend\s*$/i.test(String(v ?? ''))));
    const raw = []; for (let r = hdr + 2; r < legendAt; r++) { const row = grid[r] || []; if (/^#\d+$/.test(String(row[1] ?? '').trim())) raw.push(row); }
    assert.equal(rota.people.length, raw.length, 'one person per numbered row');
    let cells = 0;
    rota.people.forEach((p, i) => {
      const row = raw[i]; assert.equal(p.name, String(row[nameCol]).replace(/\s*\((leader|fa)\)/ig, '').replace(/\s+/g, ' ').trim());
      for (let d = 1; d <= 30; d++) {
        let v = String(row[dayCol[d]] ?? '').replace(/\s+/g, ' ').trim(); if (v === '/') v = '';
        if (/^pull out/i.test(v)) v = 'PULL OUT - ' + v.replace(/^pull out\s*-\s*/i, '').replace(/\s*project\s*$/i, '').toUpperCase();
        assert.equal(p.days[d] || '', v, `row ${i + 1} day ${d}`); cells++;
      }
    });
    assert.equal(cells, raw.length * 30);
  });
  await t('real sheet: the sheet’s own head-count table agrees on every day; known slips are reported', () => {
    assert.equal(rota.warnings.filter(w => w.kind === 'count').length, 0, JSON.stringify(rota.warnings.filter(w => w.kind === 'count')));
    const k = rota.warnings.map(w => w.kind).sort(); assert.deepEqual(k, ['legend-hours', 'mobile-odd', 'mobile-shared', 'mobile-shared']);
    assert.equal(rota.warnings.find(w => w.kind === 'legend-hours').code, 'A2');
  });
  await t('real sheet: pulled-out nurses keep where they went', () => {
    const pulled = rota.people.filter(p => p.pulledOut); assert.equal(pulled.length, 3); assert.deepEqual([...new Set(pulled.map(p => p.pulledOut))].sort(), ['Nairiya', 'Narjis']);
    for (const p of pulled) for (const c of Object.values(p.days)) assert.match(interpretCode(c, rota.legend, 'nurse').label, /^Pulled out → (Narjis|Nairiya)$/);
  });
}
console.log(fails ? `${fails} FAILED` : 'D03 ok'); process.exit(fails ? 1 : 0);
