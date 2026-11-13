// D16 — planner engine: doctor-aware planning on synthetic rotas (day, night and off patterns). Run: node test/D16.mjs
import assert from 'node:assert/strict';
globalThis.location = { href: 'https://x/' }; globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
import { suggest, dayBusy, dayProfile, learn, weekProgress, weekStartOf } from '../docs/js/planner.js';
import { DEFAULT_RULES, DEFAULT_GOALS } from '../docs/js/store.js';
import { keyOf, fmtMin } from '../docs/js/util.js';

let fails = 0; const t = (n, f) => { try { f(); console.log('  ✓', n); } catch (e) { fails++; console.log('  ✗', n, '\n    ', e.message.split('\n').slice(0, 4).join('\n     ')); } };
const hrs = (s, e, o) => ({ start: s, end: e, overnight: !!o, durationMin: o ? e + 1440 - s : e - s });
// November 2026 (1st = Sunday). N = night 20:00–08:00, D = 12h day 08:00–20:00, E = 8h evening 14:00–22:00, '' = off
const pattern = { 1: 'N1', 2: 'N1', 3: 'N1', 4: 'N1', 8: 'D1', 9: 'D1', 10: 'D1', 11: 'D1', 12: 'D1', 16: 'D1', 17: 'D1', 18: 'E1', 19: 'N1', 20: 'N1', 23: 'D1', 24: 'D1', 26: 'D1' };
const days = {}; for (let d = 1; d <= 30; d++) days[d] = pattern[d] || '';
const gp = { id: 'gp-2026-11', unitKind: 'gp', year: 2026, month: 11, daysInMonth: 30, legend: { D: { hours: hrs(480, 1200) }, N: { hours: hrs(1200, 480, 1) }, E: { hours: hrs(840, 1320) }, D1: { desc: 'Upper Village' }, N1: { desc: 'Upper Village' }, E1: { desc: 'Upper Village' } },
  people: [{ name: 'Dr Test', id: '1', days }, { name: 'Dr Other', id: '2', days: Object.fromEntries(Object.keys(days).map(d => [d, 'D1'])) }] };
const base = (x = {}) => ({ rotas: { gp }, me: { id: '1', name: 'Dr Test' }, rules: { ...DEFAULT_RULES }, goals: DEFAULT_GOALS.map(g => ({ ...g })), plan: {}, prefs: {}, swaps: {}, ...x });
const D = (d, h = 0, m = 0, mo = 10) => new Date(2026, mo, d, h, m);
const at = (d, h, m) => ({ now: D(d, h, m) });
const run = (s, from, n, now, apps = {}) => suggest(s, from, n, {}, apps, null, { now });
const goalBlocks = (list) => (list || []).filter(b => b.kind !== 'rest');
const all = (sg) => Object.entries(sg).flatMap(([k, l]) => l.map(b => ({ ...b, k })));
const str = (l) => (l || []).map(b => `${b.title} ${fmtMin(b.start)}–${fmtMin(b.end)}`).join(', ');

console.log('D16 planner');
t('never in the past: today starts after now (09:30 → ≥09:45), earlier days get nothing', () => {
  const sg = run(base(), D(10), 6, D(13, 9, 30));
  assert.ok(!Object.keys(sg).some(k => k < '2026-11-13'), 'no days before today: ' + Object.keys(sg));
  assert.ok(goalBlocks(sg['2026-11-13']).every(b => b.start >= 9 * 60 + 45) && (sg['2026-11-13'] || []).every(b => b.start >= 9 * 60 + 30), str(sg['2026-11-13']));
  const late = run(base(), D(14), 1, D(14, 21, 30))['2026-11-14'] || [];
  assert.ok(late.every(b => b.start >= 21 * 60 + 45), 'at 21:30 nothing before 21:45: ' + str(late));
  const p = dayBusy(base(), D(14)); assert.ok(late.every(b => b.end <= p.lightsOut - 30), 'and nothing in the wind-down');
});
t('first night (1st and 19th): nap 14:00–17:30 protected, only one light item before lunch', () => {
  for (const d of [1, 19]) {
    const s = base(), prof = dayProfile(s, D(d)); assert.equal(prof.mode, 'night-first', d + ': ' + prof.mode);
    const l = run(s, D(d), 1, D(d, 7))[keyOf(D(d))] || [];
    const nap = l.find(b => b.kind === 'rest' && /Nap/.test(b.title)); assert.ok(nap, 'nap block offered: ' + str(l));
    assert.equal(fmtMin(nap.start) + '–' + fmtMin(nap.end), '14:00–17:30');
    const g = goalBlocks(l); assert.ok(g.length <= 1, 'one light item: ' + str(g));
    assert.ok(g.every(b => b.end - b.start <= 30 && b.end <= 13 * 60 && b.start >= 10 * 60), 'light, before 13:00, after a lie-in: ' + str(g));
    assert.ok(!dayBusy(s, D(d)).busy.some(b => b.kind === 'shift' && b.start < nap.end), 'nap ends before leaving');
  }
});
t('between nights (2nd, 3rd, 20th): sleep till mid-afternoon, habit-sized only, rest + eat before leaving', () => {
  for (const d of [2, 3, 20]) {
    const s = base(); assert.equal(dayProfile(s, D(d)).mode, 'between-nights');
    const l = run(s, D(d), 1, D(d, 7))[keyOf(D(d))] || [];
    assert.ok(l.every(b => b.start >= 15 * 60), 'nothing before 15:00: ' + str(l));
    const g = goalBlocks(l); assert.ok(g.length <= 1 && g.every(b => b.end - b.start <= 30 && b.kind !== 'study' || b.end - b.start <= 30), 'habit-sized: ' + str(g));
    assert.ok(g.every(b => /between nights/.test(b.reason)), 'reason says between nights');
    assert.ok(l.some(b => b.kind === 'rest' && /eat/i.test(b.title) && b.end === dayBusy(s, D(d)).leave), 'rest + eat block up to leaving: ' + str(l));
  }
});
t('after the last night (5th, 21st): nothing before 15:00, no gym, study light', () => {
  for (const d of [5, 21]) {
    const s = base(); assert.equal(dayProfile(s, D(d)).mode, 'post-night');
    const l = run(s, D(d), 1, D(d, 7))[keyOf(D(d))] || [];
    assert.ok(l.every(b => b.start >= 15 * 60), str(l)); assert.ok(!l.some(b => b.kind === 'fitness'), 'no gym');
    assert.ok(l.filter(b => b.kind === 'study').reduce((a, b) => a + b.end - b.start, 0) <= 45, 'study ≤45 min');
  }
});
t('after a 12h day shift: one light item, never in the last hour before lights-out', () => {
  for (const d of [9, 10, 16, 23]) {
    const s = base(), ctx = dayBusy(s, D(d)); assert.equal(ctx.profile.mode, 'long-day', d);
    const l = run(s, D(d), 1, D(d, 6))[keyOf(D(d))] || [];
    assert.ok(goalBlocks(l).length <= 1, d + ': ' + str(l));
    assert.ok(l.every(b => b.end - b.start <= 30), 'light: ' + str(l));
    assert.ok(l.every(b => b.end <= ctx.lightsOut - 60), `ends before ${fmtMin(ctx.lightsOut - 60)}: ` + str(l));
    assert.ok(l.some(b => b.goalId === 'g-yuzu'), 'the daily habit is the one that stays: ' + str(l));
  }
});
t('after12h rule: "rest" plans nothing, "normal" may plan study but keeps the wind-down', () => {
  const rest = base({ rules: { ...DEFAULT_RULES, after12h: 'rest' } }); assert.equal(goalBlocks(run(rest, D(16), 1, D(16, 6))['2026-11-16']).length, 0);
  const norm = base({ rules: { ...DEFAULT_RULES, after12h: 'normal' } }), ctx = dayBusy(norm, D(16)); const l = run(norm, D(16), 1, D(16, 6))['2026-11-16'] || [];
  assert.ok(l.every(b => b.end <= ctx.lightsOut - 60), str(l));
});
t('recovery day after a 60h week (13th): slow morning, study ≤60 min, label says so', () => {
  const s = base(), p = dayProfile(s, D(13)); assert.equal(p.mode, 'recovery'); assert.match(p.label, /60h week/);
  const l = run(s, D(13), 1, D(13, 7))['2026-11-13'] || [];
  assert.ok(l.some(b => b.kind === 'rest' && /Slow morning/.test(b.title)), str(l));
  assert.ok(goalBlocks(l).every(b => b.start >= 11 * 60), 'nothing in the slow morning: ' + str(l));
  assert.ok(l.filter(b => b.kind === 'study').reduce((a, b) => a + b.end - b.start, 0) <= 60, 'study ≤60: ' + str(l));
  assert.equal(dayProfile(s, D(14)).mode, 'free', 'only the first day off is recovery');
});
t('weekly goals are carried by the days off (week 22–28: off, D, D, off, D, off, off)', () => {
  const s = base(), sg = run(s, D(22), 7, D(22, 6));
  const usmle = (d) => (sg[keyOf(D(d))] || []).filter(b => b.goalId === 'g-usmle').reduce((a, b) => a + b.end - b.start, 0);
  const off = [22, 25, 27, 28].map(usmle), work = [23, 24, 26].map(usmle);
  assert.ok(work.every(x => x === 0), 'no USMLE after 12h shifts: ' + work); assert.ok(off.reduce((a, b) => a + b) >= 6 * 60, 'most of the 8h on days off: ' + off);
  const tot = all(sg).reduce((m, b) => (m[b.goalId] = (m[b.goalId] || 0) + b.end - b.start, m), {});
  for (const g of s.goals) assert.ok((tot[g.id] || 0) <= g.hoursPerWeek * 60 + 15, `${g.name} not over target: ${tot[g.id]}`);
  assert.ok(tot['g-gym'] >= 120 && tot['g-social'] >= 90, 'gym and friends still get time: ' + JSON.stringify(tot));
});
t('block lengths are round (habit 5, others 15, long study 30) and respect min/max', () => {
  const s = base(), sg = run(s, D(13), 10, D(13, 6));
  for (const b of all(sg).filter(b => b.kind !== 'rest')) {
    const len = b.end - b.start, g = s.goals.find(x => x.id === b.goalId);
    assert.equal(b.start % 15, 0, `start on the quarter: ${b.title} ${fmtMin(b.start)}`);
    assert.equal(len % (b.kind === 'habit' ? 5 : b.kind === 'study' && len >= 60 ? 30 : 15), 0, `${b.title} ${len}`);
    if (g) assert.ok(len <= g.maxBlock, `${b.title} ≤ max`);
  }
});
t('breaks on both sides, accepted blocks included; never over shifts, sleep or events', () => {
  const s = base(); s.plan['2026-11-14'] = [{ id: 'a1', goalId: 'g-usmle', title: 'USMLE Step 1', kind: 'study', start: 480, end: 660, status: 'accepted' }];
  const ev = { '2026-11-15': [{ title: 'Dentist', start: +D(15, 10), end: +D(15, 11) }] };
  const sg = suggest(s, D(13), 10, ev, {}, null, { now: D(13, 6) });
  for (const [k, l] of Object.entries(sg)) {
    const acc = (s.plan[k] || []).filter(p => p.status === 'accepted');
    const ctx = dayBusy(s, new Date(k + 'T00:00'), ev[k] || []);
    const goals = goalBlocks(l).concat(acc).sort((a, b) => a.start - b.start);
    for (let i = 1; i < goals.length; i++) assert.ok(goals[i].start - goals[i - 1].end >= 15, `${k}: ${goals[i - 1].title}→${goals[i].title} gap ${goals[i].start - goals[i - 1].end}`);
    for (const b of goalBlocks(l)) for (const x of ctx.busy.filter(x => x.kind !== 'plan')) assert.ok(b.end <= x.start || b.start >= x.end, `${k}: ${b.title} ${fmtMin(b.start)} over ${x.label}`);
    for (const b of goalBlocks(l)) for (const e of ev[k] || []) { const es = new Date(e.start).getHours() * 60, ee = new Date(e.end).getHours() * 60; assert.ok(b.end <= es - 15 || b.start >= ee + 15, 'gap around the event'); }
  }
});
t('accept everything then regenerate: no goal twice on a day, totals stay within target', () => {
  const s = base(), sg = run(s, D(13), 10, D(13, 6)); const plan = {};
  for (const [k, l] of Object.entries(sg)) plan[k] = l.map(b => ({ ...b, status: 'accepted' }));
  const s2 = { ...s, plan }, sg2 = run(s2, D(13), 10, D(13, 6));
  for (const [k, l] of Object.entries(sg2)) for (const b of l) assert.ok(!plan[k]?.some(p => p.goalId === b.goalId), `${k}: second ${b.title}`);
  const ws = weekStartOf(D(15)), prog = weekProgress(s2, ws), extra = all(sg2).filter(b => b.k >= '2026-11-15' && b.k <= '2026-11-21');
  for (const g of s.goals) assert.ok((prog[g.id] || 0) + extra.filter(b => b.goalId === g.id).reduce((a, b) => a + b.end - b.start, 0) <= g.hoursPerWeek * 60 + 15, g.name);
});
t('Skip moves the block away from the skipped time; a second Skip drops it for the day; learning counts once', () => {
  const s = base(), k = '2026-11-14';
  const b1 = run(s, D(14), 1, D(14, 6))[k].find(b => b.goalId === 'g-usmle'); assert.ok(b1);
  const s1 = { ...s, plan: { [k]: [{ ...b1, status: 'rejected' }] }, prefs: learn(s, b1, -2) };
  const b2 = (run(s1, D(14), 1, D(14, 6))[k] || []).find(b => b.goalId === 'g-usmle'); assert.ok(b2, 'offered again elsewhere');
  assert.ok(b2.end <= b1.start || b2.start >= b1.end, `not on the skipped time: ${fmtMin(b1.start)} → ${fmtMin(b2.start)}`); assert.match(b2.reason, /moved — you skipped/);
  assert.deepEqual(learn(s1, b1, -2), s1.prefs, 'skipping the same block again teaches nothing');
  const s2 = { ...s1, plan: { [k]: [...s1.plan[k], { ...b2, status: 'rejected' }] } }, sg = run(s2, D(14), 1, D(14, 6));
  assert.ok(!(sg[k] || []).some(b => b.goalId === 'g-usmle'), 'gone after two skips'); assert.ok(sg.notes[k]?.some(n => /skipped twice/.test(n)));
});
t('the daily habit is placed first and shrinks to fit rather than vanish', () => {
  const s = base(); const sg = run(s, D(8), 7, D(8, 6));
  for (const d of [8, 9, 10, 11, 12]) assert.ok((sg[keyOf(D(d))] || []).some(b => b.goalId === 'g-yuzu'), `Yuzu on the ${d}th: ` + str(sg[keyOf(D(d))]));
  const tight = base({ rules: { ...DEFAULT_RULES, sleepStart: 22 * 60 + 15 } });   // 21:10 home, 21:15 lights-out wind-down… only ~20 min left
  const l = run(tight, D(14), 1, D(14, 21, 20))['2026-11-14'] || [], notes = run(tight, D(14), 1, D(14, 21, 20)).notes['2026-11-14'] || [];
  assert.ok(l.some(b => b.goalId === 'g-yuzu') || notes.some(n => /Yuzu/.test(n)), 'either it fits shortened or the day says why');
});
t('a month without a rota is "rota unknown": nothing planned, the day says why', () => {
  const s = base(), sg = run(s, D(28), 10, D(28, 6));
  assert.ok(!Object.keys(sg).some(k => k >= '2026-12-01'), 'no December blocks: ' + Object.keys(sg));
  assert.equal(sg.days['2026-12-02'].mode, 'unknown'); assert.match(sg.notes['2026-12-02'][0], /No December rota/);
  assert.ok(!Object.keys(sg).includes('notes') && !JSON.stringify(sg).includes('"notes"'), 'extras are not enumerable');
  const none = base({ rotas: {} }), sn = run(none, D(28), 5, D(28, 6)); assert.ok(Object.keys(sn).length >= 3, 'no rota at all: days are planned as free');
});
t('"rest" goals are shift-aware: none on plain days off, the nap counts toward them', () => {
  const s = base(); s.goals.push({ id: 'g-nap', name: 'Nap before nights', kind: 'rest', hoursPerWeek: 3, minBlock: 60, maxBlock: 180, priority: 6, color: '#8b93ff' });
  const sg = run(s, D(14), 6, D(14, 6));
  for (const k of ['2026-11-14', '2026-11-15']) assert.ok(!(sg[k] || []).some(b => b.goalId === 'g-nap'), k + ': ' + str(sg[k]));
  assert.ok(sg['2026-11-19'].some(b => b.goalId === 'g-nap' && /Nap/.test(b.title)), 'first night nap is the rest goal');
});
t('app asks: "before your shift" lands before an afternoon shift; capped on light days; never in the past', () => {
  const s = base(), apps = { mephisto: { app: 'mephisto', title: 'Mephisto', asks: [{ date: '2026-11-18', minutes: 30, slot: 'before' }, { date: '2026-11-20', minutes: 60, slot: 'free' }, { date: '2026-11-14', minutes: 30, slot: 'free' }] } };
  const sg = run(s, D(14), 7, D(14, 20), apps), ctx = dayBusy(s, D(18));
  const m18 = sg['2026-11-18'].find(b => b.goalId === 'app:mephisto'); assert.ok(m18 && m18.end <= ctx.leave, 'before the 14:00 shift: ' + str(sg['2026-11-18']));
  const m20 = (sg['2026-11-20'] || []).find(b => b.goalId === 'app:mephisto'); assert.ok(!m20 || m20.end - m20.start <= 30, 'between nights: ≤30 min');
  assert.ok((sg['2026-11-14'] || []).every(b => b.start >= 20 * 60), 'today\'s ask after now');
  assert.ok(!Object.values(sg).flat().some(b => b.goalId === 'g-german' && ['2026-11-18'].includes(b.date)), 'the ask replaces the German goal that day');
});
t('every block on every day of the month: inside the plan window, no NaN, no overlap with each other', () => {
  const s = base(), sg = run(s, D(1), 30, D(1, 6));
  for (const [k, l] of Object.entries(sg)) {
    for (const b of l) { assert.ok(Number.isFinite(b.start) && Number.isFinite(b.end) && b.end > b.start, `${k} ${b.title}`); assert.ok(b.kind === 'rest' || (b.start >= s.rules.earliestPlan && b.end <= s.rules.latestPlan), `${k} ${b.title} ${fmtMin(b.start)}`); }
    const srt = [...l].sort((a, b) => a.start - b.start); for (let i = 1; i < srt.length; i++) assert.ok(srt[i].start >= srt[i - 1].end, `${k}: ${str(srt)}`);
  }
});
t('weekly target counts minutes logged by hand in Study for the linked subject (T06-21)', () => {
  const s = base(), ws = weekStartOf(D(10)), k = keyOf(D(10));
  const withSub = { ...s, study: { x: { id: 'x', name: 'Step 1 pathology', app: 'Step 1 pathology', perWeek: 300, block: 45 } }, studyLog: { [`${k}:x`]: { key: `${k}:x`, mins: 90, at: 1 } } };
  assert.equal(weekProgress(withSub, ws)['g-usmle'], 90, 'USMLE Step 1 goal ↔ Step 1 pathology subject: 90 logged minutes count');
  assert.equal(weekProgress(s, ws)['g-usmle'] || 0, 0);
});
if (fails) { console.log(`\n${fails} FAILED`); process.exit(1); } else console.log('\nall D16 planner tests passed');
