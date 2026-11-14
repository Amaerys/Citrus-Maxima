// Inbox "swap": Claude can send a shift swap; accepting writes the same day correction as "Correct this day". Run: node test/inbox-swap.mjs
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
import assert from 'node:assert/strict';
const I = await import('../docs/js/inbound.js'), M = await import('../docs/js/mind.js');
const st = I.normalizeStatus({ app: 'claude', inbox: [{ id: 'swap-x', type: 'swap', date: '2099-01-02', code: 'D1', with: 'Dr Test Colleague', note: 'swap' }, { id: 'bad', type: 'swap' }] }, 'claude');
const it = st.inbox.find(x => x.id === 'swap-x'); assert.ok(it && it.type === 'swap' && it.code === 'D1'); assert.ok(!st.inbox.find(x => x.id === 'bad'));
const r = M.acceptInbox({ swaps: {}, deleted: { 'swap:2099-01-02': 1 }, inboxLog: {} }, { ref: 'claude:swap-x', app: 'claude', item: it });
assert.equal(r.state.swaps['2099-01-02'].code, 'D1'); assert.equal(r.state.swaps['2099-01-02'].with, 'Dr Test Colleague'); assert.ok(!r.state.deleted['swap:2099-01-02']); assert.equal(r.state.inboxLog['claude:swap-x'].status, 'accepted');
console.log('inbox-swap ok');
