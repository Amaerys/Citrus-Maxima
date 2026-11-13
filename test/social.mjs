// Social logic. Run: node test/social.mjs
import assert from 'node:assert/strict';
globalThis.location = { href: 'https://citrus.test/' }; globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
import * as S from '../docs/js/social.js'; import { mergeStates } from '../docs/js/store.js';
let fails = 0; const t = (n, f) => { try { f(); console.log('  ✓', n); } catch (e) { fails++; console.log('  ✗', n, '\n    ', e.stack.split('\n').slice(0, 3).join('\n     ')); } };
const legend = { D: { hours: { start: 480, end: 1020 }, desc: 'Day' }, E: { hours: { start: 780, end: 1320 } }, N: { hours: { start: 1260, end: 540, overnight: true } } };
const D = (y, m, d) => new Date(y, m - 1, d);
const mk = (days) => ({ unitKind: 'gp', year: 2026, month: 11, daysInMonth: 30, legend, people: [
  { name: 'Dr Mohammed Merri Alharbi', id: '11', mobile: '0501112222', days: { 9: 'D', 10: 'D', 11: 'OFF', 12: 'N', 13: 'OFF' } },
  { name: 'Dr Mohammed Salem', id: '12', days: {} },
  { name: 'Dr Faisal Alotaibi', id: '13', days: { 9: 'OFF', 10: 'E', 11: 'OFF', 12: 'OFF' } },
  { name: 'Dr Me Myself', id: '1', days: { 9: 'D', 10: 'OFF', 11: 'OFF', 12: 'D', 13: 'OFF' } }] });
const base = () => ({ rotas: { a: mk() }, me: { name: 'Dr Me Myself', id: '1' }, friends: {}, outings: {}, deleted: {} });

t('phone normaliser', () => {
  assert.equal(S.normPhone('0501234567'), '966501234567'); assert.equal(S.normPhone('+966 50 123 4567'), '966501234567'); assert.equal(S.normPhone('00971501234567'), '971501234567');
  assert.equal(S.normPhone('501234567'), '966501234567'); assert.equal(S.normPhone('abc'), ''); assert.equal(S.normPhone('+1'), ''); assert.equal(S.normPhone(''), '');
});
t('handles: links, @names and junk', () => {
  assert.equal(S.cleanHandle('@faisal.k'), 'faisal.k'); assert.equal(S.cleanHandle('https://www.instagram.com/faisal.k/?hl=en'), 'faisal.k'); assert.equal(S.cleanHandle('https://www.snapchat.com/add/fsl_99'), 'fsl_99');
  assert.equal(S.cleanHandle('<script>'), ''); assert.equal(S.cleanHandle('a b'), 'b'); assert.equal(S.cleanHandle(null), '');
  const l = S.links({ phone: '0551234567', snap: '@fsl', insta: 'https://instagram.com/fsl' }); assert.equal(l.wa, 'https://wa.me/966551234567'); assert.equal(l.snap, 'https://www.snapchat.com/add/fsl'); assert.equal(l.insta, 'https://www.instagram.com/fsl/'); assert.equal(l.tel, 'tel:+966551234567');
  assert.equal(S.links({}).wa, ''); assert.equal(S.links({ whatsapp: '0509999999', phone: '0551234567' }).wa, 'https://wa.me/966509999999'); assert.match(S.waWith({ phone: '0551234567' }, 'a b&c'), /text=a%20b%26c$/); assert.equal(S.waWith({}, 'x'), '');
});
t('add / update / delete friend + hostile input', () => {
  let s = S.addFriend(base(), { name: ' Faisal ', kind: 'bogus', phone: '05' + '1'.repeat(40), snap: '<b>', every: 9999, weeklyOff: [1, 9, 'x'] }); const f = Object.values(s.friends)[0];
  assert.equal(f.name, 'Faisal'); assert.equal(f.kind, 'other'); assert.ok(f.phone.length <= 24); assert.equal(f.snap, ''); assert.equal(f.every, 365); assert.deepEqual(f.weeklyOff, [1]);
  assert.equal(Object.keys(S.addFriend(base(), { name: '  ' }).friends).length, 0);
  s = S.updateFriend(s, f.id, { nick: 'Fs' }); assert.equal(S.shortName(s.friends[f.id]), 'Fs'); assert.equal(s.friends[f.id].createdAt, f.createdAt);
  s = S.deleteFriend(s, f.id); assert.equal(Object.keys(s.friends).length, 0); assert.ok(s.deleted[`friend:${f.id}`]);
  assert.equal(S.updateFriend(base(), 'nope', { nick: 'x' }).friends.nope, undefined);
});
t('rota matching: full name picks one Mohammed, first name offers both, never me', () => {
  const s = base(); assert.deepEqual(S.matchRota(s, 'Mohammed Merri').map(p => p.id), ['11']); assert.deepEqual(S.matchRota(s, 'mohammed').map(p => p.id).sort(), ['11', '12']);
  assert.deepEqual(S.matchRota(s, 'Faisal').map(p => p.id), ['13']); assert.deepEqual(S.matchRota(s, 'Me Myself'), []); assert.deepEqual(S.matchRota(s, 'Nobody'), []); assert.deepEqual(S.matchRota(s, ''), []);
  assert.equal(S.matchRota(s, 'Mohammed Merri')[0].mobile, '0501112222');
});
const withF = (extra = {}) => { let s = base(); s = S.addFriend(s, { name: 'Mohammed Merri', id: 'mm', rotaKey: 'id:11', kind: 'gp', ...extra }); s = S.addFriend(s, { name: 'Faisal', id: 'fa', rotaKey: 'id:13', kind: 'gp' }); return s; };
t('free windows: off day is long, day shift leaves evening, night leaves afternoon only', () => {
  const s = withF(), mm = s.friends.mm, fa = s.friends.fa;
  const off = S.freeWindows(s, mm, D(2026, 11, 11)); assert.equal(off[0][1], 1440); assert.ok(off[0][1] - off[0][0] >= 8 * 60);
  const day = S.freeWindows(s, mm, D(2026, 11, 9)); assert.equal(day.length, 1); assert.equal(day[0][0], 1020 + 45);   // after 17:00 + travel
  const ev = S.freeWindows(s, fa, D(2026, 11, 10)); assert.ok(ev.every(w => w[1] <= 780 - 90 + 1)); // only before it starts
  const night = S.freeWindows(s, mm, D(2026, 11, 12)); assert.ok(night.length <= 1 && night.every(w => w[1] <= 1260 - 90 - 120 + 1));
  const after = S.freeWindows(s, mm, D(2026, 11, 13)); assert.ok(after[0][0] >= 540 + 8 * 60 - 1, 'sleeps after night: ' + after[0][0]);
});
t('unknown days are not claimed free', () => { const s = withF(); assert.equal(S.dayState(s, s.friends.mm, D(2026, 12, 20)).free, 'unknown'); assert.deepEqual(S.freeWindows(s, s.friends.mm, D(2026, 12, 20)), []); assert.equal(S.dayState(s, s.friends.mm, D(2026, 11, 11)).free, 'all'); assert.equal(S.dayState(s, s.friends.mm, D(2026, 11, 9)).free, 'part'); });
t('manual schedule (nurses) and weekly off', () => {
  let s = S.addFriend(base(), { name: 'Nurse Sara', id: 'ns', kind: 'nurse', weeklyOff: [5] }); s = S.setShift(s, 'ns', '2026-11-10', 'N'); s = S.setShift(s, 'ns', '2026-11-11', 'off'); s = S.setShift(s, 'ns', '2026-11-12', 'leave');
  const f = s.friends.ns; assert.equal(S.dayState(s, f, D(2026, 11, 10)).status, 'work'); assert.equal(S.dayState(s, f, D(2026, 11, 11)).free, 'part', 'off after a night is never a whole day off'); assert.ok(S.dayState(s, f, D(2026, 11, 11)).afterNight); assert.equal(S.dayState(s, f, D(2026, 11, 12)).free, 'all'); assert.equal(S.dayState(s, f, D(2026, 11, 13)).free, 'all'); // 13 Nov 2026 is a Friday
  assert.equal(S.dayState(s, f, D(2026, 11, 14)).free, 'unknown'); s = S.setShift(s, 'ns', '2026-11-10', ''); assert.equal(S.dayState(s, s.friends.ns, D(2026, 11, 10)).free, 'unknown'); assert.equal(S.setShift(s, 'zz', '2026-11-10', 'D'), s);
  s = S.setShift(s, 'ns', '2026-11-20', 'N'); assert.ok(S.dayState(s, s.friends.ns, D(2026, 11, 21)).afterNight);
});
t('my windows honour busy slots', () => {
  const s = base(), free = S.myWindows(s, D(2026, 11, 10)); assert.ok(free[0][1] - free[0][0] >= 8 * 60);
  const busy = S.myWindows(s, D(2026, 11, 10), [[12 * 60, 15 * 60]]); assert.equal(busy.length, 2); assert.ok(busy.every(w => w[1] <= 720 || w[0] >= 900));
  assert.equal(S.myWindows(s, D(2026, 11, 10), [[0, 1440]]).length, 0);
});
t('meetups: ranks the day both are off first, respects min length, empty when nobody known', () => {
  const s = withF(), now = D(2026, 11, 9), r = S.meetups(s, { from: D(2026, 11, 9), days: 5, now }); assert.ok(r.length); assert.equal(r[0].who.length, 2); assert.ok(r[0].all); const wed = r.find(m => m.key === '2026-11-11'); assert.ok(wed && wed.dayLong && wed.all); assert.ok(r.findIndex(m => m.key === '2026-11-12') > r.findIndex(m => m.key === '2026-11-11'), 'a night-shift day with only one friend ranks lower');
  assert.ok(r.every(m => m.window[1] - m.window[0] >= 120)); assert.equal(S.meetups(withF(), { from: D(2026, 12, 1), days: 5, now }).length, 0);
  const only = S.meetups(s, { ids: ['fa'], from: D(2026, 11, 9), days: 5, now }); assert.ok(only.every(m => m.who.length === 1 && m.who[0] === 'fa'));
  assert.deepEqual(S.meetups(base(), { days: 5, now }), []);
});
t('outings: log, lastSeen, overdue, stats, planned excluded, delete', () => {
  let s = withF({ every: 14 }); const now = D(2026, 11, 20);
  s = S.logOuting(s, { date: '2026-11-01', who: ['mm', 'fa'], what: 'Dinner', where: 'Najd', rating: 4 }); s = S.logOuting(s, { date: '2026-11-25', who: ['mm'], planned: true });
  assert.equal(S.lastSeen(s, 'mm', now), '2026-11-01'); assert.equal(S.overdue(s, s.friends.mm, now), 5); assert.equal(S.overdue(s, s.friends.fa, now), 0);
  const st = S.friendStats(s, s.friends.mm, now); assert.equal(st.total, 1); assert.equal(st.avgRating, 4); assert.equal(st.favPlace, 'Najd');
  const id = S.outingList(s)[0].id; s = S.deleteOuting(s, id); assert.ok(s.deleted[`outing:${id}`]);
  const bad = S.logOuting(base(), { date: 'garbage', rating: 99, who: [null, 'x'] }); const o = Object.values(bad.outings)[0]; assert.match(o.date, /^\d{4}-\d\d-\d\d$/); assert.equal(o.rating, 5); assert.deepEqual(o.who, ['x']);
});
t('birthdays wrap the year', () => {
  let s = S.addFriend(base(), { name: 'A', id: 'a', birthday: '1990-01-05' }); s = S.addFriend(s, { name: 'B', id: 'b', birthday: '11-12' }); s = S.addFriend(s, { name: 'C', id: 'c', birthday: '06-01' });
  const b = S.birthdays(s, D(2026, 11, 8), 70); assert.deepEqual(b.map(x => x.friend.id), ['b', 'a']); assert.equal(b[0].inDays, 4);
});
t('ideas fit the window; invite text', () => {
  assert.ok(S.ideas({ window: [600, 1440], size: 4 }).some(i => /Desert/.test(i.title))); assert.ok(S.ideas({ window: [1100, 1300], size: 1 }).length >= 2); assert.ok(S.ideas({ window: null }).length); assert.ok(S.ideas({ window: [1100, 1300], birthday: 'Faisal' })[0].title.includes('Faisal'));
  const c = { date: D(2026, 11, 11), window: [1080, 1380] }, fmt = { fmtDay: () => 'Wed', fmtT: (m) => `${m / 60}h` };
  assert.match(S.inviteText({ names: ['Faisal'], choices: [c], ...fmt }), /free Wed 18h–23h/); assert.match(S.inviteText({ names: ['A', 'B'], choices: [c, c], ...fmt }), /1\) Wed[\s\S]*2\) Wed/);
});
t('vcf parsing', () => {
  const v = 'BEGIN:VCARD\nVERSION:3.0\nFN:Faisal K\nTEL;TYPE=CELL:+966 55 111 2222\nBDAY:19900105\nEND:VCARD\nBEGIN:VCARD\nN:Salem;Meshal;;;\nTEL:0501\nEND:VCARD\nBEGIN:VCARD\nEND:VCARD\r\n';
  const r = S.parseVCF(v); assert.equal(r.length, 2); assert.equal(r[0].birthday, '1990-01-05'); assert.equal(r[1].name, 'Meshal Salem'); assert.deepEqual(S.parseVCF(''), []); assert.deepEqual(S.parseVCF(null), []);
});
t('state merge keeps friends from both devices, newer wins, delete sticks', () => {
  const a = S.addFriend(base(), { name: 'A', id: 'a' }), b = S.addFriend(base(), { name: 'B', id: 'b' });
  const m = mergeStates(a, b); assert.deepEqual(Object.keys(m.friends).sort(), ['a', 'b']);
  const del = S.deleteFriend(m, 'a'); const m2 = mergeStates(m, del); assert.deepEqual(Object.keys(m2.friends), ['b']);
  const o = mergeStates(S.logOuting(base(), { id: 'o1', who: ['a'] }), base()); assert.ok(o.outings.o1);
});


await t('find a day: anyone from the rotas, together with me; missing and no-info people are named, never assumed free', () => {
  const hrs = (a, b, o) => ({ start: a, end: b, overnight: !!o, durationMin: o ? b + 1440 - a : b - a });
  const mk = (f) => Object.fromEntries(Array.from({ length: 30 }, (_, i) => [i + 1, f(i + 1)]));
  const gp = { id: 'gp-2026-12', unitKind: 'gp', year: 2026, month: 12, daysInMonth: 30, legend: { D: { hours: hrs(480, 1200) }, N: { hours: hrs(1200, 480, 1) } },
    people: [{ name: 'Dr Me', id: '1', days: mk(d => d % 2 ? 'D' : '') }, { name: 'Dr Ann', id: '2', days: mk(d => d % 3 ? '' : 'D') }, { name: 'Nurse Bo', id: '3', days: mk(d => d === 4 ? 'N' : '') }] };
  const st = { rotas: { gp }, me: { id: '1', name: 'Dr Me' }, friends: {}, outings: {} };
  const people = [S.personRecord(st, 'id:2', 'Dr Ann'), S.personRecord(st, 'id:3', 'Nurse Bo')]; assert.equal(people[0].rotaKey, 'id:2');
  const r = S.commonFree(st, people, { from: new Date(2026, 11, 1), days: 6 }), by = (d) => r.find(x => x.key === `2026-12-0${d}`);
  assert.ok(by(2).all && by(2).window[1] - by(2).window[0] >= 8 * 60, 'the 2nd: everyone off'); assert.ok(by(3).all && by(3).window[0] >= 20 * 60, 'the 3rd: Ann and I both work 8–20: together in the evening only');
  assert.ok(by(4).all && by(4).window[1] <= 17 * 60, 'the 4th: Bo starts a night at 20:00, so only the early afternoon works');
  const long = S.commonFree(st, people, { from: new Date(2026, 11, 4), days: 1, minMin: 240 })[0]; assert.ok(!long.all && long.missing.map(p => p.name).includes('Nurse Bo'), 'asking for 4h: Bo is the one missing'); assert.ok(by(6).missing.map(p => p.name).includes('Dr Ann') || by(6).free.length === 2);
  const nm = S.commonFree(st, [S.personRecord(st, 'name:ghost', 'Ghost')], { from: new Date(2026, 11, 1), days: 2 }); assert.ok(nm.every(x => !x.all && x.unknown.length === 1), 'no schedule info → not counted as free');
  const free = S.commonFree(st, people, { from: new Date(2026, 11, 1), days: 6, withMe: false }); assert.ok(free.filter(x => x.all).length >= by(2).all + 0, 'without me, more days can fit');
});
console.log(fails ? `${fails} FAILED` : 'social ok'); process.exit(fails ? 1 : 0);
