// Across your apps (insights.js) + the hand-over (store.HANDOVER). Run: node test/insights.mjs
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
import assert from 'node:assert/strict';
const IN = await import('../docs/js/insights.js'), ST = await import('../docs/js/store.js');
const now = new Date(2026, 10, 18, 9), k = (d) => `2026-11-${String(d).padStart(2, '0')}`;
const log = { 'orange:sessions-week': { [k(17)]: { v: 1, goal: 4, label: 'Sessions this week', unit: 'sessions' } }, 'calamansi:chores-overdue': { [k(18)]: { v: 2, goal: 0, label: 'Chores overdue', unit: 'chores' } },
  'yuzu:cards-due': { [k(1)]: { v: 900, goal: 0, label: 'Cards due' } }, 'bergamot:mood': {} };
// mood: low after nights, high on days off
const kinds = {}; for (let d = 1; d <= 16; d++) { const kind = d % 4 === 0 ? 'postnight' : d % 4 === 3 ? 'night' : d % 2 ? 'off' : 'day'; kinds[k(d)] = kind; log['bergamot:mood'][k(d)] = { v: kind === 'postnight' ? 2 : kind === 'off' ? 4.5 : 3.5, label: 'Mood', unit: '/5' }; }
const s = { metricLog: log };
const wk = IN.week(s, now); assert.ok(wk.find(g => g.app === 'orange').rows[0].ok === false); assert.ok(!wk.find(g => g.app === 'yuzu'), 'stale series left out');
assert.equal(wk.find(g => g.app === 'calamansi').rows[0].ok, false, 'overdue chores: a goal of 0 means none left');
const late = IN.behind(s, now); assert.ok(late.some(r => r.app === 'orange') && late.some(r => r.app === 'calamansi'));
const fx = IN.shiftEffects(s, (d) => kinds[d] || '', now); assert.equal(fx[0].series, 'bergamot:mood'); assert.equal(fx[0].lo.k, 'postnight'); assert.equal(fx[0].hi.k, 'off');
assert.match(IN.effectLine(fx[0]), /^Mood: 2 after a night vs 4\.5 on days off$/);
// hand-over: pending lists live apps only; once handed over the keys are emptied on every clean, and merges can't bring them back
const st = { apps: { sudachi: {}, clementine: {} }, media: { a: { title: 'X', at: 1 } }, friends: { f: { name: 'Y', at: 1 } }, chores: { c: { title: 'Z', at: 1 } }, settings: {} };
assert.deepEqual(IN.handoverPending(st).map(p => p.app).sort(), ['clementine', 'sudachi']);
assert.deepEqual(Object.keys(IN.handoverPart(st, ['sudachi'])), ['media', 'mediaMeta'].filter(x => st[x] !== undefined));
const after = ST.sanitize({ ...st, settings: { handedOver: { sudachi: 1 } } });
assert.deepEqual(after.media, {}); assert.equal(Object.keys(after.friends).length, 1, 'only the handed-over app is emptied'); assert.equal(Object.keys(after.chores).length, 1);
const merged = ST.mergeStates(ST.sanitize({ ...st, updatedAt: 1, settings: { handedOver: { sudachi: 5 } }, stamps: { 'set:handedOver': 5 } }), { ...st, updatedAt: 2, media: { b: { title: 'old device', at: 9 } }, settings: {} });
assert.deepEqual(ST.sanitize(merged).media, {}, 'an old device\'s copy does not come back');
assert.deepEqual(IN.handoverPending(after).map(p => p.app), ['clementine']);
console.log('insights ok');
