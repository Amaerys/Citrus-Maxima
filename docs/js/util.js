// Shared helpers: dates (dd/mm/yyyy), ids, DOM.
export const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
export const DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export const pad2 = (n) => String(n).padStart(2, '0');
export const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);

// ISO key YYYY-MM-DD in local time
export function keyOf(d) { return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; }
export function fromKey(k) { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d); }
export function addDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
export function startOfDay(d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
export function sameDay(a, b) { return keyOf(a) === keyOf(b); }
export function fmtDate(d) { return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()}`; }
export function fmtDateShort(d) { return `${DAY_SHORT[d.getDay()]} ${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}`; }
export function fmtTime(d) { return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`; }
export function fmtMin(min) { const h = Math.floor(min / 60) % 24; return `${pad2(h)}:${pad2(min % 60)}`; }
export function fmtDur(min) { const h = Math.floor(min / 60), m = min % 60; return h ? (m ? `${h}h ${m}m` : `${h}h`) : `${m}m`; }
export function minsOf(d) { return d.getHours() * 60 + d.getMinutes(); }
export function atMin(dayDate, min) { const x = startOfDay(dayDate); x.setMinutes(min); return x; }
export function monthKey(y, m) { return `${y}-${pad2(m)}`; }
export function relDay(d, today = new Date()) {
  const diff = Math.round((startOfDay(d) - startOfDay(today)) / 86400000);
  if (diff === 0) return 'Today'; if (diff === 1) return 'Tomorrow'; if (diff === -1) return 'Yesterday';
  return fmtDateShort(d);
}

export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'html') el.innerHTML = v;
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function toast(msg, kind = '') {
  let host = document.getElementById('toasts');
  if (!host) { host = h('div', { id: 'toasts' }); document.body.append(host); }
  const t = h('div', { class: `toast ${kind}` }, msg);
  host.append(t);
  setTimeout(() => t.classList.add('show'), 10);
  setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 300); }, 3200);
}

export function telLink(mobile) {
  const digits = String(mobile || '').replace(/\D/g, '');
  if (!digits) return null;
  const intl = digits.startsWith('966') ? `+${digits}` : digits.startsWith('0') ? `+966${digits.slice(1)}` : `+966${digits}`;
  return { tel: `tel:${intl}`, wa: `https://wa.me/${intl.replace('+', '')}`, display: intl };
}

export function firstName(name) {
  return String(name || '').replace(/^Dr\.?\s*/i, '').split(/\s+/)[0] || name;
}
