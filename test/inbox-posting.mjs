// Nurse postings sent into Citrus through an app status file (e.g. by Claude from a screenshot). Run: node test/inbox-posting.mjs
import assert from 'node:assert/strict';
globalThis.location = { href: 'https://x/' }; globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
import { normalizeStatus } from '../docs/js/inbound.js'; import * as M from '../docs/js/mind.js'; import * as N from '../docs/js/nurses.js';
let fails = 0; const t = async (n, f) => { try { await f(); console.log('  ✓', n); } catch (e) { fails++; console.log('  ✗', n, '\n    ', e.stack.split('\n').slice(0, 3).join('\n     ')); } };
const D = { start: 480, end: 1200, durationMin: 720 };
const gp = { id: 'gp-2026-12', unitKind: 'gp', year: 2026, month: 12, daysInMonth: 31, legend: { D2: { desc: 'Lower Village', hours: D } }, people: [{ name: 'Dr Me', id: '1', days: { 6: 'D2' } }] };
const mk = (id, name, g) => ({ name, id, group: g, days: { 6: 'D' } });
const nr = { id: 'nurse-2026-12', unitKind: 'nurse', year: 2026, month: 12, daysInMonth: 31, legend: { D: { desc: 'Day', hours: D } }, people: [mk('11', 'Areej Patuguial', 'pool'), mk('12', 'Anika Mubarak', 'pool'), mk('13', 'Fatima Marwati', 'pool'), mk('14', 'Narita Lahe', 'fsed')] };
const s0 = { rotas: { gp, nr }, me: { id: '1', name: 'Dr Me' }, tasks: {}, inboxLog: {}, posts: {} };
const status = { app: 'claude', title: 'Claude', updatedAt: '2026-12-05T14:00:00Z', inbox: [{ id: 'team-2026-12-06', type: 'posting', date: '2026-12-06', from: 'Griselda', site: 'mine', postings: [{ nurse: 'Areej Patuguial' }, { nurse: 'Anika Mubarak' }, { nurse: 'Fatima Marwati' }, { nurse: 'Nobody Here' }] }, { id: 'bad', type: 'posting', postings: [] }] };
await t('the status contract accepts postings and refuses broken ones', () => {
  const st = normalizeStatus(status, 'claude'); assert.equal(st.inbox.length, 1); assert.equal(st.inbox[0].type, 'posting'); assert.equal(st.inbox[0].postings.length, 4); assert.equal(st.inbox[0].from, 'Griselda'); assert.ok(st.issues.some(x => /bad/.test(x)));
});
await t('accepting saves them as heard tips at YOUR site that day, never as confirmed posts; unknown names are reported', () => {
  const st = normalizeStatus(status, 'claude'), p = M.inboxPending(s0, { claude: st }, new Date(2026, 11, 5))[0]; assert.ok(p, 'offered');
  const r = M.acceptInbox(s0, p); assert.equal(r.placed, 3); assert.deepEqual(r.missed, ['nobody here']);
  const d = new Date(2026, 11, 6); assert.deepEqual(N.tipOf(r.state, d, 'id:11'), { site: 'LPV', from: 'Griselda' }); assert.equal(N.postOf(r.state, d, 'id:11'), '', 'not a confirmed posting');
  assert.equal(M.inboxPending(r.state, { claude: st }, new Date(2026, 11, 5)).length, 0, 'not offered twice');
  const w = N.workingWithMe(r.state, d, { shift: { kind: 'work', type: 'D', site: 'Lower Village', hours: D } }); assert.equal(w.tipped.length, 3); assert.ok(w.tipped.every(x => x.heardFrom === 'Griselda'));
});
await t('a past posting proposal is not offered', () => { const st = normalizeStatus(status, 'claude'); assert.equal(M.inboxPending(s0, { claude: st }, new Date(2026, 11, 7)).length, 0); });
console.log(fails ? `${fails} FAILED` : 'inbox posting ok'); process.exit(fails ? 1 : 0);
