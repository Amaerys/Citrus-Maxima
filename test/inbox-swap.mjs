// Inbox "swap": Claude can send a shift swap; accepting writes the same day correction as "Correct this day". Run: node test/inbox-swap.mjs
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
import assert from 'node:assert/strict';
const I = await import('../docs/js/inbound.js'), M = await import('../docs/js/mind.js');
const st = I.normalizeStatus({ app: 'claude', inbox: [{ id: 'swap-x', type: 'swap', date: '2099-01-02', code: 'D1', with: 'Dr Test Colleague', note: 'swap' }, { id: 'bad', type: 'swap' }] }, 'claude');
const it = st.inbox.find(x => x.id === 'swap-x'); assert.ok(it && it.type === 'swap' && it.code === 'D1'); assert.ok(!st.inbox.find(x => x.id === 'bad'));
const r = M.acceptInbox({ swaps: {}, deleted: { 'swap:2099-01-02': 1 }, inboxLog: {} }, { ref: 'claude:swap-x', app: 'claude', item: it });
assert.equal(r.state.swaps['2099-01-02'].code, 'D1'); assert.equal(r.state.swaps['2099-01-02'].with, 'Dr Test Colleague'); assert.ok(!r.state.deleted['swap:2099-01-02']); assert.equal(r.state.inboxLog['claude:swap-x'].status, 'accepted');
console.log('inbox-swap ok');
// "nurse" items: mark a nurse as a possible team leader by a short name
{ const N = await import('../docs/js/nurses.js');
  const s = { rotas: { n: { unitKind: 'nurse', year: 2099, month: 1, people: [{ name: 'Testa Quillamar Ulo', id: '91', group: 'pool', days: [] }, { name: 'Bea Solo', id: '92', group: 'pool', days: [] }] } }, settings: {}, inboxLog: {} };
  assert.equal(N.findNurse(s, 'Testa')?.id, '91'); assert.equal(N.findNurse(s, 'quill'), N.findNurse(s, 'Testa')); assert.equal(N.findNurse(s, 'Zed'), null);
  const st2 = I.normalizeStatus({ app: 'claude', inbox: [{ id: 'lead-x', type: 'nurse', nurse: 'Testa', canLead: true }] }, 'claude'), it2 = st2.inbox[0];
  const r2 = M.acceptInbox(s, { ref: 'claude:lead-x', app: 'claude', item: it2 }); assert.ok(N.canLead(r2.state, 'id:91')); assert.ok(!N.canLead(r2.state, 'id:92'));
  const NB = await import('../docs/js/nurse-board.js'); assert.ok(NB.heardSources(r2.state).some(x => x.key === 'id:91'), 'a nurse who can lead is offered as a tip source');
  console.log('nurse lead ok'); }
// once Mandarin reports in, work items (posting, swap, nurse) are left to it; tasks still come to Citrus
{ const apps = { claude: { app: 'claude', inbox: [{ id: 'a', type: 'swap', date: '2099-01-02', code: 'D1' }, { id: 'b', type: 'task', title: 'x' }] } };
  assert.equal(M.inboxPending({}, apps).length, 2);
  const left = M.inboxPending({}, { ...apps, mandarin: { app: 'mandarin', inbox: [] } }); assert.deepEqual(left.map(x => x.item.id), ['b']);
  console.log('mandarin takes work items ok'); }
