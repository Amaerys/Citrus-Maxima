// Bergamot live: what Citrus reads from its status, and Claude's tasks/notes are left to it. Run: node test/bergamot.mjs
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
import assert from 'node:assert/strict';
const BG = await import('../docs/js/bergamot.js'), M = await import('../docs/js/mind.js');
const s = { apps: { bergamot: { app: 'bergamot', extra: { tasks: { overdue: 1, today: 2, top: [{ title: 'Call bank', due: '2099-01-01' }, { nope: 1 }] }, habits: { due: 3, done: 1, pending: ['Read', { name: 'Walk' }] }, journaledToday: false, mood: { today: 4, week: 3.6 }, streaks: [{ name: 'Read', days: 5 }], goalLinks: { 'aim-1': { tasks: 4, open: 2, done: 2, doneWeek: 1, habits: 1, entries: 3, notes: 0 } } } } } };
assert.ok(BG.live(s)); assert.ok(!BG.live({}));
assert.equal(BG.tasks(s).top.length, 1); assert.deepEqual(BG.habits(s).pending, ['Read', 'Walk']); assert.equal(BG.mood(s).week, 3.6);
assert.equal(BG.goalLink(s, 'aim-1').done, 2); assert.equal(BG.goalLink(s, 'nope'), null);
assert.equal(BG.todayLine(s), '2 tasks today (1 overdue): Call bank');
const apps = { claude: { app: 'claude', inbox: [{ id: 't', type: 'task', title: 'x' }, { id: 'e', type: 'event', title: 'y', date: '2099-01-01' }] }, clementine: { app: 'clementine', inbox: [{ id: 'b', type: 'task', title: 'Wish Tess' }] } };
assert.deepEqual(M.inboxPending({}, apps).map(x => x.item.id).sort(), ['b', 'e', 't']);
const left = M.inboxPending({}, { ...apps, bergamot: { app: 'bergamot', inbox: [] } }).map(x => x.item.id).sort(); assert.deepEqual(left, ['b', 'e'], 'Claude tasks go to Bergamot; other apps\' reminders stay');
const r = M.acceptInbox({ apps: { bergamot: {} }, tasks: {}, inboxLog: {} }, { ref: 'clementine:b', app: 'clementine', item: { id: 'b', type: 'task', title: 'Wish Tess' } });
assert.equal(Object.keys(r.state.tasks).length, 0, 'not copied into Citrus tasks'); assert.equal(r.state.inboxLog['clementine:b'].status, 'accepted');
console.log('bergamot ok');
