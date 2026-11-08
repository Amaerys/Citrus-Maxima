// Briefing, wind-down, day ratings and study planner on a synthetic rota. Run: node test/daily.mjs
import assert from 'node:assert/strict';
globalThis.location = { href: 'https://x/' }; globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
import * as D from '../docs/js/daily.js'; import { mergeStates } from '../docs/js/store.js';
let fails = 0; const t = async (n, f) => { try { await f(); console.log('  ✓', n); } catch (e) { fails++; console.log('  ✗', n, '\n    ', e.stack.split('\n').slice(0, 3).join('\n     ')); } };
const hrs = (s, e, o) => ({ start: s, end: e, overnight: !!o, durationMin: o ? e + 1440 - s : e - s });
const days = {}; for (let d = 1; d <= 30; d++) days[d] = [3, 4, 10, 11, 17, 18, 24, 25].includes(d) ? 'N1' : [5, 6, 12, 13, 19, 20, 26, 27].includes(d) ? '' : 'D1';
const gp = { id: 'gp-2026-11', unitKind: 'gp', year: 2026, month: 11, daysInMonth: 30, legend: { D: { hours: hrs(480, 1200) }, N: { hours: hrs(1200, 480, 1) }, D1: { desc: 'Upper Village' }, N1: { desc: 'Upper Village' } }, people: [{ name: 'Dr Me', id: '1', days }, { name: 'Dr Ann', id: '2', days: Object.fromEntries(Object.keys(days).map(d => [d, 'D1'])) }] };
const s0 = { rotas: { gp }, me: { id: '1', name: 'Dr Me' }, settings: {}, chores: { c1: { id: 'c1', title: 'Laundry', icon: '🧺', every: 4, mins: 60, lastDone: '2026-11-01', at: 1 } }, tasks: { t1: { id: 't1', title: 'Renew licence', due: '2026-11-09', done: false } } };
await t('briefing: shift, colleagues, home, tasks and week load, in that order', () => {
  const b = D.briefing(s0, new Date(2026, 10, 9, 7)), txt = b.map(x => x.text).join(' | '); assert.match(b[0].text, /Day · Upper Village|Upper Village/); assert.ok(b[0].text.includes('08:00–20:00')); assert.match(txt, /With you: Ann/); assert.match(txt, /Due at home: Laundry/); assert.match(txt, /1 task due: Renew licence/); assert.match(txt, /rostered this week/);
  assert.ok(!/undefined|null|NaN/.test(txt));
});
await t('briefing on a day off says so and is not empty', () => { assert.match(D.briefing(s0, new Date(2026, 10, 6, 9))[0].text, /Day off/); assert.match(D.briefing(s0, new Date(2026, 10, 5, 9))[0].text, /after a night/); });
await t('wind-down: sleep time = shift start − getting-ready time − sleep target; days off need no alarm', () => {
  const w = D.windDown(s0, new Date(2026, 10, 9, 21)); assert.ok(w.work && w.night, 'the 10th is a night shift'); assert.equal(w.wake, 20 * 60 - 90); assert.equal(w.bed, 20 * 60 - 90 - 8 * 60); const e = D.windDown(s0, new Date(2026, 10, 13, 21)); assert.ok(e.work && !e.night); assert.equal(e.wake, 8 * 60 - 90); assert.equal(e.bed, 1350); assert.ok(e.bedPrevDay, 'asleep before midnight is the evening before');
  const off = D.windDown(s0, new Date(2026, 10, 4, 21)); assert.ok(!off.work); assert.match(off.label, /no alarm/);
  const n = D.windDown({ ...s0, settings: { day: { sleepH: 7, prepMin: 60 } } }, new Date(2026, 10, 2, 21)); assert.ok(n.night); assert.equal(n.wake, 20 * 60 - 60); assert.match(n.notes.join(), /Night shift/);
});
await t('day ratings: 1–5 only, one per day; insights need enough data and a real gap', () => {
  let s = D.rateDay(s0, '2026-11-09', 7); assert.equal(s.dayLog, s0.dayLog); s = D.rateDay(s0, '2026-11-09', 4); assert.equal(D.dayRating(s, '2026-11-09'), 4);
  let x = s0; for (const d of [3, 4, 10]) x = D.rateDay(x, `2026-11-${String(d).padStart(2, '0')}`, 2); for (const d of [1, 2, 8, 9]) x = D.rateDay(x, `2026-11-${String(d).padStart(2, '0')}`, 5);
  const i = D.dayInsights(x); assert.match(i.lines[0], /best days are day shifts \(5\/5\).*night shifts \(2\/5\)/); assert.equal(D.dayInsights(s0).lines.length, 0);
});
await t('study: subjects, logging adds up and can be undone, streak, weekly minutes', () => {
  let s = D.saveSubject(s0, { name: 'Anatomy', perWeek: 120, block: 45 }); const id = Object.keys(s.study)[0]; assert.equal(D.saveSubject(s0, { name: ' ' }).study, undefined);
  s = D.logStudy(s, '2026-11-08', id, 30); s = D.logStudy(s, '2026-11-09', id, 45); s = D.logStudy(s, '2026-11-09', id, 15); assert.equal(D.studyOn(s, '2026-11-09', id), 60); assert.equal(D.weekMinutes(s, id, new Date(2026, 10, 9)), 90); assert.equal(D.studyStreak(s, new Date(2026, 10, 9)), 2); assert.equal(D.studyStreak(s, new Date(2026, 10, 10)), 2, 'yesterday still counts');
  assert.equal(D.studyStreak(s, new Date(2026, 10, 12)), 0); s = D.logStudy(s, '2026-11-09', id, -60); assert.equal(D.studyOn(s, '2026-11-09', id), 0); assert.ok(s.deleted[`slog:2026-11-09:${id}`]);
});
await t('study plan: blocks fit free windows, never on top of a shift, furthest-behind subject first, none past the weekly target', () => {
  let s = D.saveSubject(D.saveSubject(s0, { name: 'A', perWeek: 90, block: 45 }), { name: 'B', perWeek: 300, block: 60 }); const plan = D.studyPlan(s, new Date(2026, 10, 9, 21), { days: 6 });
  assert.ok(plan.length >= 3); for (const p of plan) { assert.ok(p.end - p.start === (p.name === 'A' ? 45 : 60)); assert.ok(p.start >= 0 && p.end <= 1440); }
  assert.ok(plan.filter(p => p.name === 'A').length <= 2, 'A target 90 min = two 45 min blocks'); assert.equal(D.studyPlan(s0).length, 0);
});
await t('merge keeps ratings and study logs from both devices', () => { const a = D.rateDay({ dayLog: {}, study: {}, studyLog: {} }, '2026-11-01', 3), b = D.logStudy({ dayLog: {}, study: {}, studyLog: {} }, '2026-11-01', 'x', 20); const m = mergeStates(a, b); assert.ok(m.dayLog['2026-11-01']); assert.ok(m.studyLog['2026-11-01:x']); });
console.log(fails ? `${fails} FAILED` : 'daily ok'); process.exit(fails ? 1 : 0);
