// Work → Calendar: month report (with a shareable picture of your month), leave planner, and richer swap options in the cover sheet.
import { h, toast, keyOf, fromKey, addDays, startOfDay, DAY_SHORT, MONTHS } from './util.js';
import * as P from './plans.js';
import * as L from './labor.js';
import { dayInfo } from './model.js';
let ctx = null;
export function initPlans(c) { ctx = c; }
const S = () => ctx.S(), sar = (n) => `${Math.round(n).toLocaleString()} SAR`, plural = (n, one, many = one + 's') => `${n} ${n === 1 ? one : many}`;
const fd = (k) => { const d = fromKey(k); return `${DAY_SHORT[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()].slice(0, 3)}`; };
const stat = (n, l) => h('div', {}, h('b', {}, n), h('small', {}, l));
const typeClass = (t) => ['D', 'N', 'E'].includes(t) ? t : 'other';

// A toast with an Undo button (same look as the Mind undo toast), so a removal can be taken back for 5 s
let undoTimer = 0;
function undoToast(msg, onUndo) {
  let host = document.getElementById('toasts'); if (!host) { host = h('div', { id: 'toasts' }); document.body.append(host); }
  host.querySelector('.toast.undo')?.remove(); clearTimeout(undoTimer);
  const close = () => { t.classList.remove('show'); setTimeout(() => t.remove(), 300); };
  const t = h('div', { class: 'toast undo', role: 'status' }, h('span', { class: 'u-msg' }, msg),
    h('button', { type: 'button', class: 'u-btn', onClick: () => { clearTimeout(undoTimer); close(); onUndo(); toast('Undone'); } }, 'Undo'));
  host.append(t); setTimeout(() => t.classList.add('show'), 10); undoTimer = setTimeout(close, 5000);
}

export function monthCard(y, mo) {
  const s = S(); if (!s.me) return null; const r = P.monthReport(s, y, mo); if (!r.work && !r.leave) return null;
  const top = Object.entries(r.sites).sort((a, b) => b[1] - a[1]).slice(0, 3);
  const rate = r.otRate != null ? `Paid at ${r.otRate.toFixed(2)} SAR an hour (hourly + 50 % of basic) ≈ ${sar(r.otPay)}` : 'Paid at hourly wage + 50 % of basic (add your basic in Career to see the amount)';
  return h('div', { class: 'card mr' }, h('div', { class: 'row' }, h('div', { class: 'title grow' }, `${MONTHS[mo - 1]} in numbers`), h('button', { class: 'btn sm ghost', onClick: () => shareImage(y, mo) }, '🖼 Share image')),
    h('div', { class: 'lw-stats' }, [stat(r.work, 'shifts'), stat(`${r.hours}h`, 'worked'), stat(r.nights, 'nights'), stat(r.weekend, 'Fri/Sat worked'), stat(r.longestStreak, 'longest run'), stat(`${r.avgShiftH}h`, 'average shift')]),
    // "Check my rota against the law" off: no overtime verdict or flags here either (beta T02-13)
    r.lawOn ? h('div', { class: 'cr-key' }, h('div', { class: 'grow' }, h('b', {}, r.overtimeH ? `${r.overtimeH}h overtime` : 'No overtime this month'),
      h('div', { class: 'tiny dim' }, r.overtimeH ? `${r.holidayH ? `${r.holidayH}h on public holidays + weekly hours over the limit. ` : ''}${rate}, or ${r.compLeaveH}h of leave in lieu if you agree` : 'Under the weekly limit in every full week, and no public holiday worked')),
      r.flags ? h('span', { class: 'chip lw-warn' }, plural(r.flags, 'flag')) : h('span', { class: 'chip lw-ok' }, 'clear')) : null,
    top.length ? h('div', { class: 'chips', style: { marginTop: '8px' } }, top.map(([k, v]) => h('span', { class: 'chip' }, `${k} × ${v}`))) : null,
    h('div', { class: 'row wrap', style: { marginTop: '8px' } }, h('button', { class: 'btn sm grow', onClick: () => leaveSheet() }, '🌴 Plan leave'), h('div', { class: 'tiny dim' }, `${r.off} days off${r.leave ? ` · ${r.leave} on leave` : ''}`)));
}

// ───────── picture of the month (canvas → share sheet, or download)
// Colours come from the interface in use (Clean / Paper / Arcade). Any CSS colour (hex, rgb, color-mix) is resolved by
// painting it on a 1×1 canvas, so text on each cell can be picked dark or light by contrast.
function themeColours() {
  const probe = document.createElement('canvas').getContext('2d', { willReadFrequently: true }), span = document.createElement('span'); document.body.append(span);
  const get = (v, d) => { span.style.color = d; span.style.color = `var(${v}, ${d})`; const c = getComputedStyle(span).color; probe.clearRect(0, 0, 1, 1); probe.fillStyle = d; probe.fillStyle = c; probe.fillRect(0, 0, 1, 1); const [r, g, b] = probe.getImageData(0, 0, 1, 1).data; return { css: `rgb(${r},${g},${b})`, lum: (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255 }; };
  const out = { bg: get('--bg', '#0f1117'), card: get('--card', '#1a1e2b'), line: get('--line', '#2a3043'), text: get('--text', '#f3f2ee'), muted: get('--muted', '#a0a6b8'), orange: get('--orange', '#ff7a1a'), orange2: get('--orange2', '#ffa052'), D: get('--day', '#ffc857'), N: get('--night', '#7d8cff'), E: get('--eve', '#c58cff'), leave: get('--green', '#5fd38d'), other: get('--cyan', '#7ffaee'), red: get('--red', '#ff5f6d') };
  span.remove(); return out;
}
const ink = (c) => c.lum > 0.55 ? '#14161f' : '#ffffff'; // dark text on light fills (yellow day cells), white on dark ones
const SHARE_W = 1080, CELL_H = 124, GRID_TOP = 330;
/** Height of the picture for a month: header + one row per calendar week + legend, no empty band under a 5-row month. */
export const shareHeight = (y, mo) => { const rows = Math.ceil((new Date(y, mo - 1, 1).getDay() + new Date(y, mo, 0).getDate()) / 7); return GRID_TOP + rows * CELL_H + 210; };

export async function shareImage(y, mo) {
  const s = S(), r = P.monthReport(s, y, mo), W = SHARE_W, H = shareHeight(y, mo), cv = document.createElement('canvas'); cv.width = W; cv.height = H; const g = cv.getContext('2d');
  const c = themeColours(), css = getComputedStyle(document.documentElement), font = (css.getPropertyValue('--font') || '').trim() || 'system-ui, sans-serif', disp = (css.getPropertyValue('--pixel') || '').trim() || font;
  const rad = Math.min(22, (parseFloat(css.getPropertyValue('--rs')) || 11) * 1.6), F = (w, px, f = font) => `${w} ${px}px ${f}`;
  try { await document.fonts?.ready; } catch { /* drawing with a fallback font is fine */ }
  g.fillStyle = c.bg.css; g.fillRect(0, 0, W, H);
  g.fillStyle = c.orange.css; g.fillRect(0, 0, W, 250); const glow = g.createLinearGradient(0, 0, W, 250); glow.addColorStop(0, 'rgba(255,255,255,.22)'); glow.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = glow; g.fillRect(0, 0, W, 250); // one hue under the text, so its contrast is known
  const hd = ink(c.orange); g.fillStyle = hd; g.font = F(700, 84, disp); g.fillText(`${MONTHS[mo - 1]} ${y}`, 60, 118);
  g.font = F(600, 34); g.fillText([s.me?.name, `${r.work} shifts · ${r.hours}h · ${r.nights} nights · ${r.off} off`].filter(Boolean).join('  ·  ').slice(0, 64), 60, 182);
  const first = new Date(y, mo - 1, 1), days = new Date(y, mo, 0).getDate(), cw = (W - 120) / 7, ch = CELL_H, top = GRID_TOP, sites = new Map(); let anyMci = false;
  g.font = F(700, 26); g.fillStyle = c.muted.css; g.textAlign = 'center'; ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].forEach((x, i) => g.fillText(x, 60 + cw * i + cw / 2, top - 24));
  for (let d = 1; d <= days; d++) {
    const date = new Date(y, mo - 1, d), i = first.getDay() + d - 1, x = 60 + (i % 7) * cw, yy = top + Math.floor(i / 7) * ch, mi = dayInfo(s, date).mine, sh = mi?.shift;
    const fill = sh?.kind === 'work' ? (c[sh.type] || c.other) : sh?.kind === 'leave' ? c.leave : c.card, fg = sh?.kind === 'work' || sh?.kind === 'leave' ? ink(fill) : c.muted.css;
    g.fillStyle = fill.css; g.beginPath(); g.roundRect(x + 4, yy + 4, cw - 8, ch - 8, rad); g.fill();
    if (!sh || sh.kind === 'off') { g.strokeStyle = c.line.css; g.lineWidth = 2; g.stroke(); }
    g.fillStyle = fg; g.globalAlpha = 0.75; g.font = F(600, 22); g.textAlign = 'left'; g.fillText(d, x + 16, yy + 34); g.globalAlpha = 1; g.textAlign = 'center';
    if (sh?.kind === 'work') {
      // the full code (D1 / D2 / N3 …) so colleagues can read the site, not just "D"
      g.font = F(800, 40, disp); g.fillText(sh.code || sh.type, x + cw / 2, yy + 78);
      const st = sh.site; if (st) { const k = (sh.code || '').replace(/^[A-Z]+/i, '') || sh.code; if (k && !sites.has(k)) sites.set(k, st); }
      if (sh.hours) { g.font = F(600, 20); const hh = (m) => String(Math.floor(m / 60) % 24).padStart(2, '0'); g.fillText(`${hh(sh.hours.start)}–${hh(sh.hours.end)}`, x + cw / 2, yy + 104); }
      if (mi.mci) { anyMci = true; g.fillStyle = c.red.css; g.beginPath(); g.arc(x + cw - 22, yy + 24, 9, 0, Math.PI * 2); g.fill(); g.strokeStyle = fg; g.lineWidth = 2; g.stroke(); }
    } else if (sh?.kind === 'leave') { g.font = F(800, 34, disp); g.fillText('Leave', x + cw / 2, yy + 80); }
  }
  // legend: colours, the MCI dot and what each site number means
  const rows = Math.ceil((first.getDay() + days) / 7); let ly = top + rows * ch + 46, lx = 60; g.textAlign = 'left'; g.font = F(600, 24);
  const key = (fill, label, dot) => { g.fillStyle = fill.css; g.beginPath(); dot ? g.arc(lx + 11, ly - 8, 10, 0, Math.PI * 2) : g.roundRect(lx, ly - 20, 24, 24, 6); g.fill(); g.fillStyle = c.text.css; g.fillText(label, lx + 34, ly); lx += 34 + g.measureText(label).width + 30; };
  for (const [t, l] of [['D', 'Day'], ['E', 'Evening'], ['N', 'Night']]) if (r.types[t]) key(c[t], l); if (Object.keys(r.types).some(t => !['D', 'E', 'N'].includes(t))) key(c.other, 'Other'); if (r.leave) key(c.leave, 'Leave'); if (anyMci) key(c.red, 'MCI', true);
  ly += 44; g.fillStyle = c.muted.css; g.font = F(500, 24); let line = '';
  for (const [k, v] of [...sites].sort()) { const piece = `${k} ${v}`; if (g.measureText(line + '   ' + piece).width > W - 120 && line) { g.fillText(line, 60, ly); ly += 34; line = piece; } else line = line ? `${line}   ${piece}` : piece; }
  if (line) g.fillText(line, 60, ly);
  g.fillStyle = c.muted.css; g.font = F(600, 22); g.textAlign = 'right'; g.fillText('Citrus Maxima', W - 60, H - 34);
  const blob = await new Promise(res => cv.toBlob(res, 'image/png')); if (!blob) return toast('Could not make the picture', 'err'); const file = new File([blob], `rota-${y}-${String(mo).padStart(2, '0')}.png`, { type: 'image/png' });
  try { if (navigator.canShare?.({ files: [file] })) { await navigator.share({ files: [file], title: `${MONTHS[mo - 1]} rota` }); return; } } catch (e) { if (e?.name === 'AbortError') return; }
  const a = h('a', { href: URL.createObjectURL(blob), download: file.name }); a.click(); toast('Picture saved');
}

// ───────── leave planner
/** Opening range: 30 days ahead when the rota covers it, else the best window the loaded rota offers, so the sheet never opens on blank dates. */
function defaultRange(s, now) {
  const a = addDays(startOfDay(now), 30); if (dayInfo(s, a).hasRota) return { from: keyOf(a), to: keyOf(addDays(a, 6)) };
  const w = P.bestWindows(s, 7, { now, top: 1 })[0]; return w ? { from: w.from, to: w.to } : { from: keyOf(a), to: keyOf(addDays(a, 6)) };
}
function verdicts(e) {
  const out = [], known = e.days - e.noRota, fresh = known - e.already;
  if (e.noRota === e.days) out.push(['warn', 'No rota loaded for these dates yet, so it can’t tell which shifts this replaces.']);
  else if (e.noRota) out.push(['', `${plural(e.noRota, 'day')} ha${e.noRota === 1 ? 's' : 've'} no rota loaded yet; the shift count covers the other ${known}.`]);
  if (e.already) out.push(['', `${plural(e.already, 'day')} already leave, not counted again.`]);
  if (known && !e.covered && fresh > 0) out.push(['warn', e.already || e.noRota ? `You are off on the other ${plural(fresh, 'day')} anyway, so that leave would be spent for nothing.` : 'You are off on every one of these days anyway, so you would spend leave for nothing.']);
  if (e.enough === false) out.push(['bad', 'More than the balance you have left. Check whether it is unpaid or comes out of next year.']);
  if (e.shortNotice) out.push(['warn', `Less than 30 days’ notice (it was due ${fd(e.noticeBy)}). Ask today; the employer may refuse at short notice.`]);
  return out;
}
export function leaveSheet() {
  const now = new Date(), today = keyOf(startOfDay(now)); let len = 7;
  const wrap = h('div', { class: 'lp' }), box = ctx.sheet([wrap]); const v = defaultRange(S(), now);
  function paint() {
    const s = S(), ls = L.leaveStatus(s, now), e = P.evalLeave(s, fromKey(v.from), fromKey(v.to), now), wins = P.bestWindows(s, len, { now }), planned = P.plannedLeave(s);
    const fresh = e ? e.days - e.already : 0;
    wrap.replaceChildren(h('h2', {}, 'Plan leave'),
      ls ? h('div', { class: 'cr-key' }, h('div', { class: 'grow' }, h('b', {}, `${ls.left} of ${ls.entitled} days left`), h('div', { class: 'tiny dim' }, `Leave year from ${fd(ls.yearStart)}. Your contract counts calendar days, so every day in the range is used, even days you would have been off.`))) : h('div', { class: 'small muted' }, 'Add your start date in Career to see your balance.'),
      h('div', { class: 'row wrap' }, h('div', { class: 'field grow' }, h('label', {}, 'From'), h('input', { type: 'date', min: today, value: v.from, onChange: (x) => { v.from = x.target.value || v.from; if (v.to < v.from) v.to = v.from; paint(); } })), h('div', { class: 'field grow' }, h('label', {}, 'To'), h('input', { type: 'date', min: v.from, value: v.to, onChange: (x) => { v.to = x.target.value || v.to; if (v.to < v.from) v.to = v.from; paint(); } }))),
      e ? h('div', { class: 'card lp-eval' }, h('div', { class: 'lw-stats' }, [stat(e.days, 'days'), stat(e.noRota === e.days ? '?' : e.covered, 'shifts replaced'), stat(e.noRota === e.days ? '?' : e.nights, 'nights'), e.leftAfter != null ? stat(e.leftAfter, 'days left after') : null].filter(Boolean)),
        verdicts(e).map(([k, t]) => h('div', { class: `lw-flag ${k}` }, t)),
        e.shortNotice ? null : h('div', { class: 'tiny dim' }, `Ask for it in writing by ${fd(e.noticeBy)}: the employer sets leave dates, with 30 days’ notice, and may refuse for work needs.`)) : null,
      h('div', { class: 'row wrap', style: { marginTop: '10px' } }, h('button', { class: 'btn primary grow', disabled: fresh ? null : '', onClick: () => {
        const r = P.applyLeave(ctx.S(), fromKey(v.from), fromKey(v.to)); if (!r.days) return toast('Those days are already leave');
        ctx.update(() => r.state); toast(`${plural(r.days, 'day')} marked as leave in your rota${r.already ? ` · ${r.already} already planned` : ''}`); box.close(); ctx.render(); } }, fresh ? `Mark ${plural(fresh, 'day')} as leave in my rota` : 'Already leave')),
      planned.length ? h('div', { class: 'card lp-planned' }, h('div', { class: 'title' }, 'Planned leave in your rota'), planned.map(r => h('div', { class: 'row' }, h('div', { class: 'grow small' }, `${fd(r.from)} → ${fd(r.to)} · ${plural(r.days, 'day')}`), h('button', { class: 'btn sm ghost', 'aria-label': `Remove leave ${r.from}`, onClick: () => {
        ctx.update(st => P.clearLeave(st, fromKey(r.from), fromKey(r.to), r.id)); paint(); ctx.render();
        undoToast(`Leave ${fd(r.from)} → ${fd(r.to)} removed`, () => { ctx.update(st => P.restoreLeave(st, r.entries)); if (wrap.isConnected) paint(); ctx.render(); }); } }, 'Remove')))) : null,
      h('div', { class: 'title', style: { marginTop: '14px' } }, 'Best use of your days'), h('div', { class: 'chips' }, [3, 5, 7, 10, 14].map(n => h('button', { class: `chip ${len === n ? 'sel' : ''}`, onClick: () => { len = n; paint(); } }, `${n} days`))),
      wins.length ? h('div', { class: 'lp-wins' }, wins.map(w => h('button', { class: `cr-key lp-win ${w.from === v.from && w.to === v.to ? 'on' : ''}`, onClick: () => { v.from = w.from; v.to = w.to; paint(); } }, h('div', { class: 'grow' }, h('b', {}, `${fd(w.from)} → ${fd(w.to)}`), h('div', { class: 'tiny dim' }, `replaces ${plural(w.covered, 'shift')}${w.nights ? `, ${plural(w.nights, 'night')}` : ''}`)),
        w.short ? h('span', { class: 'chip lw-warn' }, 'short notice') : null, h('span', { class: 'chip' }, `${Math.round(w.ratio * 100)} %`)))) : h('div', { class: 'small muted' }, 'Needs a loaded rota covering the dates ahead.'),
      h('div', { class: 'tiny dim', style: { marginTop: '8px' } }, 'The percentage is how much of the window is real shifts. Higher means the days you spend replace more work. “Short notice” starts within 30 days.'),
      h('div', { class: 'tiny dim', style: { marginTop: '6px' } }, 'This only pencils the days into your own rota. Your imported schedule is untouched, and the request still has to go to your employer.'));
  }
  paint();
}

/** Swap options block for the cover sheet. */
export function swapBlock(date, openPerson) {
  const r = P.swapOptions(S(), date, { now: new Date() }); if (!r.mine || r.mine.shift.kind !== 'work') return null;
  if (r.past) return h('div', { class: 'card sw-card' }, h('div', { class: 'title' }, 'Even swaps'), h('div', { class: 'small muted' }, 'This shift has already started or passed. The swap finder is for shifts ahead.'));
  const out = Object.values(r.left).reduce((a, b) => a + b, 0);
  const why = out ? h('div', { class: 'tiny dim sw-left' }, `Left out ${plural(out, 'trade')} that would give one of you less than ${P.MIN_REST_H}h between shifts (e.g. a day straight after a night), more than ${P.MAX_RUN} days in a row, or no ${P.WEEK_REST_H}h weekly rest.`) : null;
  if (!r.options.length) return out ? h('div', { class: 'card sw-card' }, h('div', { class: 'title' }, 'Even swaps'), h('div', { class: 'small muted' }, 'No safe even swap within two weeks.'), why) : null;
  return h('div', { class: 'card sw-card' }, h('div', { class: 'title' }, 'Even swaps'), h('div', { class: 'tiny dim' }, `They take your ${r.mine.code}; you take one of their shifts on a day you are off. Checked for rest on both sides.`),
    r.options.slice(0, 6).map(o => h('div', { class: 'item clickable sw-opt', onClick: () => openPerson(o.person) },
      h('div', { class: 'grow' }, h('div', { class: 'name' }, o.person.name),
        h('div', { class: 'sw-gives' }, h('span', { class: 'tiny dim' }, 'you take'), o.gives.map(g => h('span', { class: `chip ${typeClass(g.type)} ${g.sameType ? 'same' : 'diff'}`, title: g.sameType ? 'same shift type as yours' : 'a different shift type' }, `${fd(g.date)} ${g.code}`)), o.more ? h('span', { class: 'tiny dim' }, `+${o.more}`) : null)),
      o.allSame ? h('span', { class: 'chip sel' }, 'same type') : null)),
    why);
}
