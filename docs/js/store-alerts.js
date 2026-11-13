// Banners for the two storage problems the user must know about: this device's saved copy was damaged (and what Citrus did),
// and this device can no longer save (storage full). Loaded by store.js only when one of them happens.
import { h, fmtTime } from './util.js';

const fmtAt = (t) => { const d = new Date(t); return `${d.getDate()}/${d.getMonth() + 1} ${fmtTime(d)}`; };
const download = (text, name) => {
  const a = h('a', { href: URL.createObjectURL(new Blob([text], { type: 'application/json' })), download: name });
  document.body.append(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
};
const openSettings = () => document.getElementById('btnMore')?.click();

function host() {
  let el = document.querySelector('.d10-alerts');
  if (!el) { el = h('div', { class: 'd10-alerts', role: 'region', 'aria-label': 'Storage alerts' }); document.body.append(el); }
  return el;
}
function banner(id, { tone, title, text, actions, onClose }) {
  document.querySelector(`.d10-alert[data-id="${id}"]`)?.remove();
  const el = h('div', { class: `d10-alert ${tone}`, 'data-id': id, role: tone === 'err' ? 'alert' : 'status' },
    h('div', { class: 'd10-ic', 'aria-hidden': 'true' }, tone === 'err' ? '!' : 'i'),
    h('div', { class: 'd10-body' }, h('b', {}, title), h('div', { class: 'd10-text' }, text),
      h('div', { class: 'd10-acts' }, ...actions.map(([label, fn, primary]) => h('button', { class: `btn sm${primary ? '' : ' ghost'}`, onClick: fn }, label)))),
    h('button', { class: 'd10-x', 'aria-label': 'Dismiss', title: 'Dismiss', onClick: () => { el.remove(); onClose?.(); } }, '×'));
  host().append(el);
  return el;
}

/** Show, update or clear the banners for what store.js reports. Safe to call again and again. */
export function showStoreAlerts({ recovery, persistence, corruptCopy, dismissRecovery, exportJSON }) {
  const rec = typeof recovery === 'function' ? recovery() : recovery;
  if (rec && !document.querySelector('.d10-alert[data-id="recovery"]') && !rec.shown) {
    rec.shown = true;
    const damaged = rec.reason === 'unreadable';
    const from = rec.from?.length ? `Recovered from ${rec.from.map(f => f === 'backup' ? 'this device\'s last clean copy' : 'the part that could still be read').join(' and ')}.` : 'Nothing could be read from it, so Citrus started empty.';
    banner('recovery', {
      tone: damaged ? 'err' : 'warn',
      title: damaged ? 'Your saved data on this device was damaged' : `Citrus skipped ${rec.fixed} damaged item${rec.fixed === 1 ? '' : 's'}`,
      text: damaged
        ? `${from} ${rec.kept ? 'The damaged copy is kept on this device. ' : ''}If you use Google sync, your Drive copy merges back in on the next sync; daily backups are in Settings › Drive.`
        : `Some saved records were unreadable and were left out, so the rest of the app keeps working${rec.kept ? '. The original copy is kept on this device' : ''}.`,
      actions: [
        ...(rec.kept ? [['Download damaged copy', () => { const t = corruptCopy(); if (t) download(t, `citrus-damaged-${new Date(rec.at).toISOString().slice(0, 10)}.json`); }]] : []),
        ...(damaged ? [['Drive backups', openSettings, true]] : []),
      ],
      onClose: () => { if (!damaged) dismissRecovery(); },
    });
  }
  const full = document.querySelector('.d10-alert[data-id="persist"]');
  if (!persistence.ok && !full) {
    banner('persist', {
      tone: 'err',
      title: `Not saved on this device${persistence.since ? ` since ${fmtAt(persistence.since)}` : ''}`,
      text: `${persistence.lastError || 'Saving failed'}. Edits stay only until you close Citrus. Sync to Google Drive, or download a backup now, then free some space.`,
      actions: [['Download backup', () => download(exportJSON(), `citrus-maxima-backup-${new Date().toISOString().slice(0, 10)}.json`), true], ['Settings', openSettings]],
    });
  } else if (persistence.ok && full) full.remove();
}
