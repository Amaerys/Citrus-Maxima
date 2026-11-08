// Work → Calendar: month report (with a shareable picture of your month), leave planner, and richer swap options in the cover sheet.
import { h, toast, keyOf, fromKey, addDays, startOfDay, DAY_SHORT, MONTHS } from './util.js';
import * as P from './plans.js';
import * as L from './labor.js';
import { dayInfo } from './model.js';
let ctx = null;
export function initPlans(c) { ctx = c; }
const S = () => ctx.S(), sar = (n) => `${Math.round(n).toLocaleString()} SAR`;
const fd = (k) => { const d = fromKey(k); return `${DAY_SHORT[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()].slice(0, 3)}`; };
const stat = (n, l) => h('div', {}, h('b', {}, n), h('small', {}, l));

export function monthCard(y, mo) {
  const s = S(); if (!s.me) return null; const r = P.monthReport(s, y, mo); if (!r.work && !r.leave) return null;
  const top = Object.entries(r.sites).sort((a, b) => b[1] - a[1]).slice(0, 3);
  return h('div', { class: 'card mr' }, h('div', { class: 'row' }, h('div', { class: 'title grow' }, `${MONTHS[mo - 1]} in numbers`), h('button', { class: 'btn sm ghost', onClick: () => shareImage(y, mo) }, '🖼 Share image')),
    h('div', { class: 'lw-stats' }, [stat(r.work, 'shifts'), stat(`${r.hours}h`, 'worked'), stat(r.nights, 'nights'), stat(r.weekend, 'Fri/Sat worked'), stat(r.longestStreak, 'longest run'), stat(`${r.avgShiftH}h`, 'average shift')]),
    h('div', { class: 'cr-key' }, h('div', { class: 'grow' }, h('b', {}, r.overtimeH ? `${r.overtimeH}h over the weekly limit` : 'No overtime this month'), h('div', { class: 'tiny dim' }, r.overtimeH ? `Paid at ${(r.hourlyBasic * 1.5).toFixed(2)} SAR an hour (hourly + 50 % of basic)${r.otPay != null ? ` ≈ ${sar(r.otPay)}` : ''}, or ${r.compLeaveH}h of leave in lieu if you agree` : 'Under the 48h weekly limit in every full week')), r.flags ? h('span', { class: 'chip lw-warn' }, `${r.flags} flag${r.flags > 1 ? 's' : ''}`) : h('span', { class: 'chip lw-ok' }, 'clear')),
    top.length ? h('div', { class: 'chips', style: { marginTop: '8px' } }, top.map(([k, v]) => h('span', { class: 'chip' }, `${k} × ${v}`))) : null,
    h('div', { class: 'row wrap', style: { marginTop: '8px' } }, h('button', { class: 'btn sm grow', onClick: () => leaveSheet() }, '🌴 Plan leave'), h('div', { class: 'tiny dim' }, `${r.off} days off${r.leave ? ` · ${r.leave} on leave` : ''}`)));
}

// ───────── picture of the month (canvas → share sheet, or download)
export async function shareImage(y, mo) {
  const s = S(), r = P.monthReport(s, y, mo), W = 1080, H = 1350, cv = document.createElement('canvas'); cv.width = W; cv.height = H; const g = cv.getContext('2d');
  const css = getComputedStyle(document.documentElement), col = (v, d) => (css.getPropertyValue(v) || '').trim() || d;
  g.fillStyle = '#14110f'; g.fillRect(0, 0, W, H); const grad = g.createLinearGradient(0, 0, W, 320); grad.addColorStop(0, '#ff9a1f'); grad.addColorStop(1, '#ff6a00'); g.fillStyle = grad; g.fillRect(0, 0, W, 250);
  g.fillStyle = '#fff'; g.font = '700 84px system-ui, sans-serif'; g.fillText(`${MONTHS[mo - 1]} ${y}`, 60, 120); g.font = '500 36px system-ui, sans-serif'; g.fillText(`${r.work} shifts · ${r.hours}h · ${r.nights} nights`, 60, 185);
  const first = new Date(y, mo - 1, 1), days = new Date(y, mo, 0).getDate(), cw = (W - 120) / 7, ch = 120, top = 330, palette = { D: '#d9a400', E: '#e8643c', N: '#5967c9', leave: '#8e8e8e', other: '#9a4fb0' };
  g.font = '600 26px system-ui, sans-serif'; g.fillStyle = '#9b948c'; g.textAlign = 'center'; ['S', 'M', 'T', 'W', 'T', 'F', 'S'].forEach((x, i) => g.fillText(x, 60 + cw * i + cw / 2, top - 22));
  for (let d = 1; d <= days; d++) {
    const date = new Date(y, mo - 1, d), i = first.getDay() + d - 1, x = 60 + (i % 7) * cw, yy = top + Math.floor(i / 7) * ch, mi = dayInfo(s, date).mine, sh = mi?.shift;
    g.fillStyle = sh?.kind === 'work' ? (palette[sh.type] || '#26a69a') : sh?.kind === 'leave' ? palette.leave : '#221e1b'; g.beginPath(); g.roundRect(x + 4, yy + 4, cw - 8, ch - 8, 18); g.fill();
    g.fillStyle = 'rgba(255,255,255,.6)'; g.font = '500 22px system-ui, sans-serif'; g.textAlign = 'left'; g.fillText(d, x + 14, yy + 32); g.textAlign = 'center'; g.fillStyle = '#fff';
    if (sh?.kind === 'work') { g.font = '700 38px system-ui, sans-serif'; g.fillText(sh.type || sh.code, x + cw / 2, yy + 74); if (sh.hours) { g.font = '500 20px system-ui, sans-serif'; const hh = (m) => String(Math.floor(m / 60) % 24).padStart(2, '0'); g.fillText(`${hh(sh.hours.start)}–${hh(sh.hours.end)}`, x + cw / 2, yy + 100); } } else if (sh?.kind === 'leave') { g.font = '700 34px system-ui, sans-serif'; g.fillText('L', x + cw / 2, yy + 74); }
  }
  g.textAlign = 'left'; g.fillStyle = '#9b948c'; g.font = '500 28px system-ui, sans-serif'; g.fillText(`${r.off} days off${r.overtimeH ? ` · ${r.overtimeH}h overtime` : ''}`, 60, H - 70); g.textAlign = 'right'; g.fillText('Citrus Maxima', W - 60, H - 70);
  const blob = await new Promise(res => cv.toBlob(res, 'image/png')); if (!blob) return toast('Could not make the picture', 'err'); const file = new File([blob], `rota-${y}-${String(mo).padStart(2, '0')}.png`, { type: 'image/png' });
  try { if (navigator.canShare?.({ files: [file] })) { await navigator.share({ files: [file], title: `${MONTHS[mo - 1]} rota` }); return; } } catch (e) { if (e?.name === 'AbortError') return; }
  const a = h('a', { href: URL.createObjectURL(blob), download: file.name }); a.click(); toast('Picture saved');
}

// ───────── leave planner
export function leaveSheet() {
  const now = new Date(), today = keyOf(startOfDay(now)); let len = 7;
  const wrap = h('div', {}), box = ctx.sheet([wrap]); const v = { from: keyOf(addDays(startOfDay(now), 30)), to: keyOf(addDays(startOfDay(now), 36)) };
  function paint() {
    const s = S(), ls = L.leaveStatus(s, now), e = P.evalLeave(s, fromKey(v.from), fromKey(v.to), now), wins = P.bestWindows(s, len, { now });
    wrap.replaceChildren(h('h2', {}, 'Plan leave'),
      ls ? h('div', { class: 'cr-key' }, h('div', { class: 'grow' }, h('b', {}, `${ls.left} of ${ls.entitled} days left`), h('div', { class: 'tiny dim' }, `Leave year from ${fd(ls.yearStart)}. Your contract counts calendar days, so every day in the range is used, even days you would have been off.`))) : h('div', { class: 'small muted' }, 'Add your start date in Career to see your balance.'),
      h('div', { class: 'row wrap' }, h('div', { class: 'field grow' }, h('label', {}, 'From'), h('input', { type: 'date', min: today, value: v.from, onChange: (x) => { v.from = x.target.value || v.from; if (v.to < v.from) v.to = v.from; paint(); } })), h('div', { class: 'field grow' }, h('label', {}, 'To'), h('input', { type: 'date', min: v.from, value: v.to, onChange: (x) => { v.to = x.target.value || v.to; paint(); } }))),
      e ? h('div', { class: 'card' }, h('div', { class: 'lw-stats' }, [stat(e.days, 'days'), stat(e.covered, 'shifts replaced'), stat(e.nights, 'nights'), e.leftAfter != null ? stat(e.leftAfter, 'days left after') : null].filter(Boolean)),
        e.enough === false ? h('div', { class: 'lw-flag bad' }, 'More than the balance you have left. Check whether it is unpaid or comes out of next year.') : null,
        e.covered === 0 ? h('div', { class: 'lw-flag warn' }, 'You are off on every one of these days anyway, so you would spend leave for nothing.') : null,
        h('div', { class: 'tiny dim' }, `Ask for it in writing by ${fd(e.noticeBy)}: the employer sets leave dates, with 30 days’ notice, and may refuse for work needs.`)) : null,
      h('div', { class: 'title', style: { marginTop: '12px' } }, 'Best use of your days'), h('div', { class: 'chips' }, [3, 5, 7, 10, 14].map(n => h('button', { class: `chip ${len === n ? 'sel' : ''}`, onClick: () => { len = n; paint(); } }, `${n} days`))),
      wins.length ? wins.map(w => h('button', { class: 'cr-key', style: { width: '100%', border: 0, color: 'inherit', textAlign: 'left' }, onClick: () => { v.from = w.from; v.to = w.to; paint(); } }, h('div', { class: 'grow' }, h('b', {}, `${fd(w.from)} → ${fd(w.to)}`), h('div', { class: 'tiny dim' }, `replaces ${w.covered} of your shifts${w.nights ? `, ${w.nights} nights` : ''}`)), h('span', { class: 'chip' }, `${Math.round(w.ratio * 100)} %`))) : h('div', { class: 'small muted' }, 'Needs a loaded rota covering the dates ahead.'),
      h('div', { class: 'tiny dim', style: { marginTop: '8px' } }, 'The percentage is how much of the window is real shifts. Higher means the days you spend replace more work.'),
      h('div', { class: 'row wrap', style: { marginTop: '10px' } }, h('button', { class: 'btn primary grow', onClick: () => { const r = P.applyLeave(ctx.S(), fromKey(v.from), fromKey(v.to)); ctx.update(() => r.state); toast(`${r.days} day${r.days > 1 ? 's' : ''} marked as leave in your rota`); box.close(); ctx.render(); } }, 'Mark as leave in my rota'),
        ),
      P.plannedLeave(s).length ? h('div', { class: 'card', style: { marginTop: '10px' } }, h('div', { class: 'title' }, 'Planned leave in your rota'), P.plannedLeave(s).map(r => h('div', { class: 'row' }, h('div', { class: 'grow small' }, `${fd(r.from)} → ${fd(r.to)} · ${r.days} day${r.days > 1 ? 's' : ''}`), h('button', { class: 'btn sm ghost', 'aria-label': `Remove leave ${r.from}`, onClick: () => { ctx.update(st => P.clearLeave(st, fromKey(r.from), fromKey(r.to))); toast('Planned leave removed'); box.close(); ctx.render(); } }, 'Remove')))) : null,
      h('div', { class: 'tiny dim' }, 'This only pencils the days into your own rota. Your imported schedule is untouched, and the request still has to go to your employer.'));
  }
  paint();
}

/** Swap options block for the cover sheet. */
export function swapBlock(date, openPerson) {
  const r = P.swapOptions(S(), date); if (!r.mine || !r.options.length) return null;
  return h('div', { class: 'card' }, h('div', { class: 'title' }, 'Even swaps'), h('div', { class: 'tiny dim' }, 'Off that day, and working a day you are off, so you trade shift for shift'),
    r.options.slice(0, 6).map(o => h('div', { class: 'item clickable', onClick: () => openPerson(o.person) }, h('div', { class: 'grow' }, h('div', { class: 'name' }, o.person.name), h('div', { class: 'meta' }, `you could take ${o.gives.map(g => `${fd(g.date)} ${g.code}`).join(' · ')}`), o.tired ? h('div', { class: 'tiny', style: { color: '#fb8c00' } }, o.theirRun >= 7 ? 'would be on 7 days in a row' : 'just finished a night') : null), h('span', { class: `chip ${o.sameType ? 'sel' : ''}` }, o.sameType ? 'same shift type' : 'different type'))));
}
