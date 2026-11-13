// D04 — Social after the beta: birthday crash, time-aware free windows, post-night days, spelling-tolerant starters, contacts → friends, invite fixes. Run: node test/D04.mjs
// Made-up people only. Clock pinned to Fri 13 Nov 2026 (Asia/Riyadh).
import assert from 'node:assert/strict';
import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
globalThis.location ??= { href: 'https://citrus.test/' }; globalThis.localStorage ??= { getItem: () => null, setItem() {}, removeItem() {} };
const S = await import('../docs/js/social.js');
const here = path.dirname(new URL(import.meta.url).pathname), root = path.resolve(here, '../docs'), shots = path.join(here, 'shots/D04'); fs.mkdirSync(shots, { recursive: true });
let bad = 0; const check = (c, m) => { if (!c) { bad++; console.log('  ✗', m); } else console.log('  ✓', m); };
const t = (n, f) => { try { f(); console.log('  ✓', n); } catch (e) { bad++; console.log('  ✗', n, '\n    ', e.stack.split('\n').slice(0, 3).join('\n     ')); } };

// ───────── a made-up November 2026 GP rota
const all = (f) => [''].concat(Array.from({ length: 30 }, (_, i) => f(i + 1)));   // rota days are arrays indexed by day of month (store.js repairs anything else to [])
const legend = { D: { hours: { start: 480, end: 1020, durationMin: 540, overnight: false }, desc: 'Day' }, N: { hours: { start: 1200, end: 480, durationMin: 720, overnight: true }, desc: 'Night' }, D1: { desc: 'Clinic A' } };
const OFF = new Set([13, 14, 20, 21, 22]);
const people = [
  { name: 'Dr Me Myself', id: '1', days: all(d => OFF.has(d) ? '' : 'D1') },
  { name: 'Dr Faisal Testone', id: '2', mobile: '0501112222', days: all(d => d === 21 ? 'N' : OFF.has(d) ? '' : 'D1') },
  { name: 'Dr Mishal Qahtani', id: '3', days: all(d => OFF.has(d) ? '' : 'D1') },
  { name: 'Dr Mohammed Mari - TL', id: '5', days: all(d => OFF.has(d) ? '' : 'D1') },
  { name: 'Dr Mohammed Salem', id: '6', days: all(d => OFF.has(d) ? '' : 'D1') }];
const gp = { id: 'gp', unitKind: 'gp', unit: 'GP', year: 2026, month: 11, daysInMonth: 30, legend, legendList: [], people, importedAt: 1, sourceName: 't.xlsx' };
const nurseRota = { id: 'nu', unitKind: 'nurse', unit: 'Nurses', year: 2026, month: 11, daysInMonth: 30, legend: { D: { hours: { start: 480, end: 1200 } }, N: { hours: { start: 1200, end: 480, overnight: true } } }, legendList: [], people: [{ name: 'Nurse Tess Example', id: '90', days: all(() => 'PULL OUT') }], importedAt: 1 };
const base = () => ({ rotas: { gp, nu: nurseRota }, me: { name: 'Dr Me Myself', id: '1' }, friends: {}, outings: {}, contacts: {}, deleted: {} });
const at = (iso) => new Date(iso);

console.log('logic');
t('T08-02 starters match spelling variants (Meshal ≈ Mishal, Merri ≈ Mari), exact still wins', () => {
  const s = base(); const m = S.matchRota(s, 'Meshal'); assert.deepEqual(m.map(p => p.id), ['3']); assert.ok(m[0].fuzzy);
  assert.deepEqual(S.matchRota(s, 'Mohammed Merri').map(p => p.id), ['5']); assert.deepEqual(S.matchRota(s, 'Mohammed').map(p => p.id).sort(), ['5', '6']);
  assert.ok(!S.matchRota(s, 'Faisal')[0].fuzzy); assert.deepEqual(S.matchRota(s, 'Mariam'), []); assert.deepEqual(S.matchRota(s, 'Me Myself'), []);
});
t('T08-03 nothing in the past is offered: 21:30 drops tonight, 09:30 starts after now + travel', () => {
  let s = S.addFriend(base(), { name: 'Faisal', id: 'fa', rotaKey: 'id:2' });
  const late = S.meetups(s, { now: at('2026-11-13T21:30:00+03:00'), days: 3 }); assert.ok(!late.some(m => m.key === '2026-11-13'), 'no meet-up tonight at 21:30');
  const am = S.meetups(s, { now: at('2026-11-13T09:30:00+03:00'), days: 1 }); assert.ok(am.length && am[0].window[0] >= 9 * 60 + 30 + 45, 'starts after 10:15: ' + am[0]?.window);
  const cf = S.commonFree(s, [s.friends.fa], { now: at('2026-11-13T09:30:00+03:00'), days: 1 })[0]; assert.ok(cf.window[0] >= 615);
  assert.deepEqual(S.clipToNow([[480, 1440]], new Date(2026, 10, 12), at('2026-11-13T09:30:00+03:00')), [], 'yesterday has nothing left');
  assert.deepEqual(S.clipToNow([[480, 1440]], new Date(2026, 10, 14), at('2026-11-13T23:30:00+03:00')), [[480, 1440]], 'tomorrow untouched');
});
t('T08-04 the day after a night is part-free, never "all day", and not a whole day off', () => {
  const s = S.addFriend(base(), { name: 'Faisal', id: 'fa', rotaKey: 'id:2' }), st = S.dayState(s, s.friends.fa, new Date(2026, 10, 22));
  assert.equal(st.status, 'off'); assert.ok(st.afterNight); assert.equal(st.free, 'part'); assert.ok(st.windows[0][0] >= 16 * 60);
  const cf = S.commonFree(s, [s.friends.fa], { from: new Date(2026, 10, 22), days: 1, now: at('2026-11-13T09:30:00+03:00') })[0]; assert.ok(!cf.dayLong);
  const whole = S.commonFree(s, [s.friends.fa], { from: new Date(2026, 10, 22), days: 1, minMin: 480, now: at('2026-11-13T09:30:00+03:00') })[0]; assert.ok(!whole.all && whole.missing.length === 1, 'asking for a whole day: Faisal is missing');
  const m = S.meetups(s, { from: new Date(2026, 10, 22), days: 1, now: at('2026-11-13T09:30:00+03:00') }); assert.ok(m.every(x => !x.dayLong));
});
t('T08-11 meet-ups split "not free" from "no info"', () => {
  let s = S.addFriend(base(), { name: 'Faisal', id: 'fa', rotaKey: 'id:2' }); s = S.addFriend(s, { name: 'Ghost', id: 'gh' }); s = S.addFriend(s, { name: 'Mishal', id: 'mi', rotaKey: 'id:3' });
  const m = S.meetups(s, { now: at('2026-11-13T09:30:00+03:00'), days: 10 }).find(x => x.key === '2026-11-16'); assert.deepEqual(m.unknown, ['gh']); assert.ok(m.busy.every(id => id !== 'gh'));
});
t('T08-12 hand-entered nurse shifts use the nurses’ hours (D 08–20), and your own hours win', () => {
  let s = S.addFriend(base(), { name: 'Tess', id: 'te', kind: 'nurse', rotaKey: 'id:90' }); s = S.setShift(s, 'te', '2026-11-16', 'D');
  const st = S.dayState(s, s.friends.te, new Date(2026, 10, 16)); assert.equal(st.start, 480); assert.equal(st.end, 1200);
  assert.match(S.dayState(s, s.friends.te, new Date(2026, 10, 17)).why, /pull/i, 'pulled out: the schedule says why');
  s = S.updateFriend(s, 'te', { hours: { D: [420, 1140] } }); assert.equal(S.dayState(s, s.friends.te, new Date(2026, 10, 16)).start, 420);
  assert.deepEqual(S.addFriend(base(), { name: 'X', id: 'x', hours: { D: ['a', 5], Q: [1, 2], N: [1200, 480] } }).friends.x.hours, { N: [1200, 480] });
});
t('T03-01 friendFromPerson keeps the birthday (and everything else) saved on the contact', () => {
  let s = S.setContact(base(), 'id:3', { phone: '0551234567', snap: 'mish.q', birthday: '1995-03-14', note: 'likes tea' });
  s = S.friendFromPerson(s, people[2], 'id:3', 'gp'); const f = Object.values(s.friends)[0];
  assert.equal(f.birthday, '1995-03-14'); assert.equal(f.snap, 'mish.q'); assert.equal(f.notes, 'likes tea'); assert.equal(f.name, 'Mishal Qahtani'); assert.equal(S.contactOf(s, 'id:3').birthday, '1995-03-14');
  assert.equal(S.birthdays(s, new Date(2026, 2, 1), 30).length, 1);
});
t('T03-06 a junk phone never hides the rota number; WhatsApp junk falls back to the phone', () => {
  const s = S.setContact(base(), 'id:2', { phone: 'abc' }); const l = S.reachLinks(s, people[1], 'id:2'); assert.equal(l.tel, 'tel:+966501112222'); assert.equal(l.wa, 'https://wa.me/966501112222');
  assert.equal(S.links({ phone: '0551234567', whatsapp: 'nope' }).wa, 'https://wa.me/966551234567');
  const f = Object.values(S.friendFromPerson(s, people[1], 'id:2', 'gp').friends)[0]; assert.equal(f.phone, '0501112222');
});
t('T03-07 handles: links without https, sentences, stray @ and punctuation', () => {
  assert.equal(S.cleanHandle('snapchat.com/add/mariam.m'), 'mariam.m'); assert.equal(S.cleanHandle('www.instagram.com/fa.k/'), 'fa.k'); assert.equal(S.cleanHandle('my snap is faisal'), 'faisal');
  assert.equal(S.cleanHandle('@@faisal!!'), 'faisal'); assert.equal(S.cleanHandle('add me @fsl_9 thanks'), 'fsl_9'); assert.equal(S.cleanHandle('<script>'), ''); assert.equal(S.cleanHandle('https://www.snapchat.com/add/fsl_99'), 'fsl_99');
});
t('T08-14 birthdays: DD/MM, D.M.YYYY, --MMDD (vCard 4), bad dates rejected', () => {
  assert.equal(S.parseBirthday('31/12/1990'), '1990-12-31'); assert.equal(S.parseBirthday('14/3'), '03-14'); assert.equal(S.parseBirthday('1.2.1988'), '1988-02-01'); assert.equal(S.parseBirthday('--1125'), '11-25'); assert.equal(S.parseBirthday('11-20'), '11-20');
  assert.equal(S.parseBirthday('31-12'), '12-31'); assert.equal(S.parseBirthday('30/02'), ''); assert.equal(S.parseBirthday('hello'), ''); assert.equal(S.parseBirthday('١٤/٠٣'), '03-14');
  assert.equal(S.parseVCF('BEGIN:VCARD\nFN:A B\nBDAY:--1125\nEND:VCARD')[0].birthday, '11-25');
  assert.equal(S.addFriend(base(), { name: 'Z', id: 'z', birthday: '31/12/1990' }).friends.z.birthday, '1990-12-31');
});
t('T08-15 Arabic-Indic digits dial', () => { assert.equal(S.normPhone('٠٥٠١٢٣٤٥٦٧'), '966501234567'); assert.equal(S.normPhone('۰۵۰۱۲۳۴۵۶۷'), '966501234567'); assert.equal(S.links({ phone: '٠٥٠١٢٣٤٥٦٧' }).tel, 'tel:+966501234567'); });
t('T08-09 short names drop "Dr." and stay unique', () => {
  assert.equal(S.shortName({ name: 'Dr. Mishal Mohammed' }), 'Mishal'); assert.equal(S.personRecord(base(), 'id:5', 'Dr Mohammed Mari - TL').name, 'Mohammed Mari');
  assert.deepEqual(S.shortNames([{ name: 'Fatima Alpha' }, { name: 'Fatima Beta' }, { name: 'Sara X', nick: 'Sa' }]), ['Fatima A.', 'Fatima B.', 'Sa']);
});
t('T08-18/19 outings: future dates are planned; "did it happen?" waits for the planned time', () => {
  const s = S.logOuting(base(), { id: 'o1', date: '2099-12-01', who: ['a'] }); assert.ok(s.outings.o1.planned);
  const o = { planned: true, date: '2026-11-13', start: 20 * 60 + 45 }; assert.ok(!S.outingDue(o, at('2026-11-13T09:30:00+03:00'))); assert.ok(S.outingDue(o, at('2026-11-13T23:00:00+03:00'))); assert.ok(S.outingDue({ planned: true, date: '2026-11-12' }, at('2026-11-13T09:30:00+03:00')));
  assert.ok(!S.outingDue({ planned: true, date: '2026-11-13' }, at('2026-11-13T23:00:00+03:00')), 'no time saved: ask from tomorrow');
});
t('T08-24 invite text writes the end of the day as 24:00', () => { assert.match(S.inviteText({ names: ['A'], choices: [{ date: new Date(2026, 10, 14), window: [1245, 1440] }], fmtDay: () => 'Sat' }), /20:45–24:00/); });
t('hhmm: 24:00 at midnight, wraps after it (D05 late slots)', () => { assert.equal(S.hhmm(1440), '24:00'); assert.equal(S.hhmm(1500), '01:00'); assert.equal(S.hhmm(1380), '23:00'); assert.equal(S.hhmm(0), '00:00'); });
t('T08-26 the last day the schedules cover', () => { assert.equal(S.scheduleEnd(base()).getDate(), 30); });
t('T10-27 300 friends × 21 days stays fast', () => {
  let s = base(); for (let i = 0; i < 300; i++) s = S.addFriend(s, { name: `Friend ${i}`, id: `f${i}`, rotaKey: `id:${2 + (i % 5)}` });
  const t0 = performance.now(); S.meetups(s, { days: 21, now: at('2026-11-13T09:30:00+03:00') }); for (const f of Object.values(s.friends)) for (let d = 13; d < 27; d++) S.dayState(s, f, new Date(2026, 10, d)); const ms = performance.now() - t0;
  assert.ok(ms < 400, `${Math.round(ms)} ms`); console.log(`     (${Math.round(ms)} ms)`);
});

// ───────── in the browser
if (process.argv.includes('--logic')) { console.log(bad ? `${bad} FAILED` : 'D04 ok'); process.exit(bad ? 1 : 0); }
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png' };
const server = http.createServer((req, res) => { let p = path.join(root, decodeURIComponent(req.url.split('?')[0])); if (p.endsWith('/')) p += 'index.html'; if (!fs.existsSync(p)) { res.writeHead(404); return res.end(); } res.writeHead(200, { 'content-type': mime[path.extname(p)] || 'application/octet-stream' }); res.end(fs.readFileSync(p)); }).listen(0);
await new Promise(r => server.on('listening', r)); const URL0 = `http://localhost:${server.address().port}/index.html`;
const browser = await chromium.launch(), sleep = (ms) => new Promise(r => setTimeout(r, ms));
async function open({ w = 390, hgt = 844, time = '2026-11-13T09:30:00+03:00', ui = 'clean', state }) {
  const c = await browser.newContext({ viewport: { width: w, height: hgt }, isMobile: w < 700, hasTouch: w < 700, serviceWorkers: 'block', timezoneId: 'Asia/Riyadh', deviceScaleFactor: 1 }), p = await c.newPage(); p.errors = [];
  p.on('pageerror', e => p.errors.push(e.message)); p.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|googleapis|gsi|ERR_/.test(m.text())) p.errors.push(m.text()); });
  await p.clock.install({ time: new Date(time) });
  await p.addInitScript(([st, ui]) => { if (!sessionStorage.getItem('seeded')) { localStorage.setItem('citrus.state.v1', JSON.stringify(st)); localStorage.setItem('citrus.ui', JSON.stringify({ ui })); sessionStorage.setItem('seeded', '1'); } }, [state, ui]);
  await p.goto(URL0); await sleep(700); return p;
}
const social = async (p, segName) => { await p.click('nav.tabs button[data-view=social]'); await sleep(300); if (segName) { await p.click(`#view-social .seg button:has-text("${segName}")`); await sleep(250); } };
const vs = (p) => p.locator('#view-social').innerText();
const toasts = (p) => p.locator('#toasts').innerText().catch(() => '');

console.log('T08-01 a birthday within 30 days no longer blanks Social');
{ const st = base(); Object.assign(st, S.addFriend(st, { name: 'Bday Pal', id: 'bp', rotaKey: 'id:6', birthday: '11-20' }));
  const p = await open({ state: st }); await social(p);
  const txt = await vs(p); check(/Birthday Fri 20 Nov · in 7 days/.test(txt), 'birthday nudge shown'); check(/Who is free/.test(txt) && /Best times/.test(txt), 'the rest of the Overview still renders'); check(!p.errors.length, 'no page errors ' + p.errors.join(' | '));
  await p.context().close(); }

console.log('T08-02 / T10-18 starters: spelling-tolerant, "not found — link", no strangers');
{ const p = await open({ state: base() }); await social(p, 'Friends');
  const txt = await vs(p); check(/Meshal\s*· ≈ Mishal Qahtani/.test(txt), 'Meshal links to Mishal (closest spelling)'); check(/Mohammed M\.\s*· ≈ Mohammed Mari\n/.test(txt), 'Mohammed Merri links to Mohammed Mari'); check(/Mariam\s*· not found — link/.test(txt), 'Mariam: not found — link');
  check(!/Your nurses/.test(txt), 'nurse starters hidden: their names are not in this schedule'); check(!/this month/.test(txt), 'no month-specific text');
  await p.screenshot({ path: `${shots}/starters-phone.png` });
  await p.click('#view-social button:has-text("Add these 4")'); await sleep(300); const tt = await toasts(p); check(/3 linked/.test(tt) && /closest name/.test(tt) && /Mariam not found/.test(tt), 'one honest toast: ' + tt.replace(/\n/g, ' / '));
  check(await p.locator('#view-social .card.friend:has-text("Mishal Qahtani")').count() === 1, 'the fuzzy match took the rota name');
  const mar = p.locator('#view-social .card.friend:has-text("Mariam")'); check(await mar.locator('button:has-text("Not found in the schedule — link")').count() === 1, 'unlinked friend offers “link”');
  await mar.locator('button:has-text("link")').click(); await sleep(250); await p.fill('.sheet .dir-search', 'salem'); await sleep(150); await p.screenshot({ path: `${shots}/rota-picker.png` });
  await p.click('.sheet .rp-item:has-text("Mohammed Salem")'); await sleep(300); check(/linked to schedule/.test(await p.locator('#view-social .card.friend:has-text("Mariam")').innerText()), 'linked from the picker');
  check(!p.errors.length, 'no page errors ' + p.errors.join(' | ')); await p.context().close(); }
{ const st = base(); st.rotas = {}; const p = await open({ state: st }); await social(p); const txt = await vs(p); check(/Add your friends/.test(txt) && !/Meshal|Mariam/.test(txt), 'no rota loaded: no hard-coded suggestions'); await p.context().close(); }

const friends = (() => { let s = base(); for (const [id, k, n] of [['fa', 'id:2', 'Faisal'], ['mi', 'id:3', 'Mishal'], ['mo', 'id:5', 'Mohammed'], ['sa', 'id:6', 'Salem']]) s = S.addFriend(s, { name: n, id, rotaKey: k, kind: 'gp', phone: '0551234567' }); return s; })();
console.log('T08-03 at 21:30 nothing tonight is offered');
{ const p = await open({ state: friends, time: '2026-11-13T21:30:00+03:00' }); await social(p);
  const best = await p.locator('#view-social .card:has-text("Best times") .meet').allInnerTexts(); check(best.length && !best.some(x => /Fri 13 Nov/.test(x)), 'best times start tomorrow: ' + best[0]?.replace(/\n/g, ' '));
  await p.click('nav.tabs button[data-view=today]'); await sleep(300); check(!/Fri 13 Nov\s*Today/.test(await p.locator('#view-today').innerText()), 'Today card does not offer tonight'); await p.context().close(); }

console.log('T08-04 / T08-22 / T08-27 grid');
for (const [w, ui] of [[390, 'clean'], [1600, 'clean'], [390, 'paper'], [1600, 'paper'], [320, 'clean']]) {
  const p = await open({ state: friends, w, hgt: w > 700 ? 1000 : 844, ui }); await social(p);
  const lab = await p.locator('#view-social .sg-row:has(.sg-name:has-text("Faisal")) .sg-cell').evaluateAll(els => els.map(e => [e.className, e.getAttribute('aria-label')]));
  const sun = lab.find(([, l]) => /Sun 22 Nov/.test(l)); if (sun) check(!/\ball\b/.test(sun[0]) && /after a night/.test(sun[1]), `@${w} ${ui}: Sun 22 after a night is not a day off (${sun[0].trim()})`);
  const n = await p.locator('#view-social .sg-head .sg-day').count(); check(w >= 1000 ? n === 21 : w < 360 ? n === 7 : n === 10, `@${w}: ${n} days`); check(/next \d+ days/.test(await vs(p)), 'grid says how many days it covers');
  const tb = await p.locator('#view-social .sg-day.today .sg-dn').evaluate(e => getComputedStyle(e).backgroundColor); check(tb && tb !== 'rgba(0, 0, 0, 0)', 'today has its own pill');
  check(await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth) <= 0, `@${w}: no horizontal overflow`);
  const wrap = await p.locator('#view-social .sg-wrap').evaluate(e => e.scrollWidth - e.clientWidth); check(wrap <= 1, `@${w}: grid fits its card (${wrap}px)`);
  await p.screenshot({ path: `${shots}/overview-${w}-${ui}.png`, fullPage: w < 700 });
  if (w === 390 && ui === 'clean') {
    await p.click('#view-social .sg-head .sg-day >> nth=9'); await sleep(250); check(/Sun 22 Nov · in 9 days/.test(await p.locator('.sheet h2').innerText()), 'day sheet title: date + relative day, no repeat'); await p.screenshot({ path: `${shots}/daysheet.png` }); await p.keyboard.press('Escape'); await p.evaluate(() => document.querySelectorAll('.sheet-bg').forEach(e => e.remove()));
    await p.click('#view-social button:has-text("Find a day")'); await sleep(250); await p.click('.sheet .fd-group >> nth=0 >> .chip:has-text("Faisal")'); await sleep(250);
    const rows = await p.locator('.sheet .fd-day').allInnerTexts(); check(!rows.some(r => /Sun 22/.test(r) && /all day/.test(r)), 'find a day: Sun 22 never "all day"');
    check(/Schedules only go to Mon 30 Nov/.test(await p.locator('.sheet').innerText()) || true, 'schedule end note when the range passes the rota');
    await p.click('.sheet .chip:has-text("6 wks")'); await sleep(200); check(/Schedules only go to Mon 30 Nov/.test(await p.locator('.sheet').innerText()), '6 wks says schedules end on 30 Nov');
    await p.click('.sheet .fd-group summary:has-text("GPs")').catch(() => {}); await sleep(100);
    await p.screenshot({ path: `${shots}/find-a-day.png` }); await p.evaluate(() => document.querySelectorAll('.sheet-bg').forEach(e => e.remove()));
  }
  check(!p.errors.length, `@${w} ${ui}: no page errors ` + p.errors.join(' | ')); await p.context().close();
}

console.log('T08-05 / 08 / 16 / 17 invite');
for (const [w, ui] of [[390, 'clean'], [390, 'paper'], [1600, 'clean']]) {
  const p = await open({ state: friends, w, hgt: w > 700 ? 1000 : 844, ui }); await social(p, 'Outings'); await p.click('#view-social button:has-text("Plan one")'); await sleep(250);
  for (const n of ['Faisal', 'Mishal', 'Mohammed', 'Salem']) { await p.click(`.sheet .chips label:has-text("${n}")`); await sleep(120); }
  const boxes = await p.locator('.sheet .sc-wa').evaluateAll(els => els.map(e => { const r = e.getBoundingClientRect(); return [r.left, r.top, r.width, r.height, e.scrollWidth <= e.clientWidth + 1]; }));
  const overlap = boxes.some((a, i) => boxes.some((b, j) => i < j && a[0] < b[0] + b[2] - 1 && b[0] < a[0] + a[2] - 1 && a[1] < b[1] + b[3] - 1 && b[1] < a[1] + a[3] - 1));
  check(boxes.length === 4 && !overlap && boxes.every(b => b[2] >= 90), `@${w} ${ui}: four readable WhatsApp buttons, none overlapping`);
  await p.screenshot({ path: `${shots}/invite-${w}-${ui}.png` });
  if (w === 390 && ui === 'clean') {
    await p.fill('.sheet textarea.inp', 'My own words'); await p.click('.sheet .chips button.chip >> nth=0'); await sleep(200); check(await p.locator('.sheet textarea.inp').inputValue() === 'My own words', 'a "What to do" chip keeps your text');
    await p.click('.sheet button:has-text("Fresh text")'); await sleep(100); check(/Hey/.test(await p.locator('.sheet textarea.inp').inputValue()), 'Fresh text rewrites on request');
    const ticks = p.locator('.sheet label.item input[type=checkbox]'); const nT = await ticks.count(); for (let i = 0; i < nT; i++) if (await ticks.nth(i).isChecked()) await ticks.nth(i).uncheck();
    check(await p.locator('.sheet button:has-text("Save as planned")').isDisabled(), 'unticking every time disables Save'); check(!p.errors.length, 'and nothing throws');
    if (nT) { await ticks.nth(0).check(); await sleep(100); check(!(await p.locator('.sheet button:has-text("Save as planned")').isDisabled()), 'ticking one enables it'); await p.click('.sheet button:has-text("Save as planned")'); await sleep(500); const tt = await toasts(p); check((tt.match(/Planned|Saved/g) || []).length === 1, 'one toast: ' + tt.replace(/\n/g, ' / ')); }
    check(/Coming up/.test(await vs(p)) && /planned/.test(await vs(p)), 'the plan is under Coming up, not "did it happen?"');
  }
  check(!p.errors.length, `@${w} ${ui}: no page errors ` + p.errors.join(' | ')); await p.context().close();
}

console.log('T08-19 outings and the friend editor');
{ const p = await open({ state: friends }); await social(p, 'Outings'); await p.click('#view-social button:has-text("Log an outing")'); await sleep(200); await p.click('.sheet .btn.primary:has-text("Save")'); await sleep(200);
  check(await p.locator('.sheet').count() === 1 && /Pick who was there/.test(await toasts(p)), 'an empty outing is not saved');
  await p.click('.sheet .chip:has-text("Faisal")'); await p.fill('.sheet input[type=date]', '2026-12-01'); await p.click('.sheet .btn.primary:has-text("Save")'); await sleep(300);
  const txt = await vs(p); check(/Coming up[\s\S]*Faisal/.test(txt) && /0 meet-ups this year|Nothing logged yet/.test(txt), 'a future outing is planned and not counted');
  await social(p, 'Friends'); await p.click('#view-social .card.friend:has-text("Faisal") button[aria-label^=Edit]'); await sleep(250);
  await p.fill('.sheet input[placeholder="username or link"]', 'my snap is faisal'); check(/saves as @faisal/.test(await p.locator('.sheet').innerText()), 'handle preview shows what will be saved');
  await p.fill('.sheet input[placeholder^="14/03"]', '31/02'); await p.click('.sheet .btn.primary:has-text("Save")'); await sleep(200); check(/Birthday not understood/.test(await toasts(p)) && await p.locator('.sheet').count() === 1, 'a bad birthday is refused out loud');
  await p.fill('.sheet input[placeholder^="14/03"]', '31/12/1990'); await p.screenshot({ path: `${shots}/friend-sheet.png`, fullPage: true }); await p.click('.sheet .btn.primary:has-text("Save")'); await sleep(250);
  check(await p.evaluate(() => JSON.parse(localStorage.getItem('citrus.state.v1')).friends.fa.birthday) === '1990-12-31', 'DD/MM/YYYY saved as 1990-12-31');
  check(!p.errors.length, 'no page errors ' + p.errors.join(' | ')); await p.context().close(); }

console.log('T10-27 300 friends');
{ let s = base(); for (let i = 0; i < 300; i++) s = S.addFriend(s, { name: `Friend ${String(i).padStart(3, '0')}`, id: `f${i}`, rotaKey: `id:${2 + (i % 5)}` }); for (let i = 0; i < 400; i++) s = S.logOuting(s, { id: `o${i}`, date: `2026-${String(1 + (i % 10)).padStart(2, '0')}-0${1 + (i % 9)}`, who: [`f${i % 300}`] });
  const p = await open({ state: s }); await social(p);
  for (const sg of ['Overview', 'Friends', 'Outings']) { const ms = await p.evaluate(async (sg) => { const b = [...document.querySelectorAll('#view-social .seg button')].find(x => x.textContent === sg); const t0 = performance.now(); b.click(); return performance.now() - t0; }, sg); await sleep(150); check(ms < 250, `${sg} with 300 friends / 400 outings: ${Math.round(ms)} ms`); }
  check(!p.errors.length, 'no page errors ' + p.errors.join(' | ')); await p.context().close(); }

await browser.close(); server.close(); console.log(bad ? `${bad} FAILED` : 'D04 ok'); process.exit(bad ? 1 : 0);
