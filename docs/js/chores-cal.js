// Home chores ↔ Google Calendar. Chores need to move and remove their calendar copy (Re-plan, Done early, Delete), which the
// shared addEvent() can't do: it returns nothing and toasts on its own. So chores talk to Google and the outbox here, using the
// same outbox op shapes app.js flushes ({type:'create', id = event key} / {type:'delete', eventId}).
import * as G from './google.js';
import * as store from './store.js';
import { fromKey, atMin, addDays } from './util.js';

const live = () => (typeof navigator === 'undefined' || navigator.onLine !== false) && G.isSignedIn();
const key = () => 'chore' + Math.random().toString(36).slice(2, 9) + Date.now().toString(36);
const outbox = () => store.get().outbox || [];
// local-only bookkeeping: never bumps updatedAt (the outbox doesn't sync between devices)
const setOutbox = (fn) => store.update(s => ({ ...s, outbox: fn(s.outbox || []) }), { silent: true, remote: false });
const reminders = (s) => { const m = s.settings?.alarmPlan ?? 10; return m > 0 ? [m] : null; };

/** Why a plan isn't in Google yet, in words for a toast. */
export const waitingWhy = () => (typeof navigator !== 'undefined' && navigator.onLine === false) ? 'goes to Google Calendar when back online' : 'goes to Google Calendar when you sign in';

/**
 * Put a chore slot in the calendar. → { next, how } where how is 'cal' (created now) or 'queued' (waits in the outbox).
 * next carries eventId (created) or key (queued: the outbox op id, which the flush also stamps on the event).
 */
export async function place(c, slot) {
  const s = store.get(), calendarId = s.settings?.calendarIds?.[0] || 'primary', d = fromKey(slot.key), k = key();
  const payload = { title: `${c.icon} ${c.title}`, start: atMin(d, slot.start), end: atMin(d, slot.end), description: 'Planned by Citrus around your shifts.', tag: 'plan', reminders: reminders(s) };
  const next = { date: slot.key, start: slot.start, mins: slot.end - slot.start, calendarId, key: k, eventId: '' };
  if (live()) {
    try { const ev = await G.createEvent(calendarId, { ...payload, key: k }); return { next: { ...next, eventId: ev?.id || '', calendarId: ev?.calendarId || calendarId }, how: 'cal' }; }
    catch (e) { if (!(e.network || /expired|not signed/i.test(e.message || ''))) return { next, how: 'local', error: e.message || 'calendar error' }; }
  }
  setOutbox(o => [...o, { type: 'create', calendarId, payload, meta: { chore: c.id }, id: k, at: Date.now() }]);
  return { next, how: 'queued' };
}

/**
 * Take a planned chore out of the calendar. → 'unqueued' (it never left this device), 'removed', 'queued' (delete waits for
 * the network), 'unknown' (it was sent but we can't reach Google to find it now) or '' (nothing to remove).
 */
export async function remove(next) {
  if (!next) return '';
  const cal = next.calendarId || 'primary';
  if (next.key && outbox().some(o => o.id === next.key)) { setOutbox(o => o.filter(x => x.id !== next.key)); return 'unqueued'; }
  let eventId = next.eventId;
  if (!eventId && next.key && live()) { const d = fromKey(next.date); eventId = (await G.findEventByKey(cal, next.key, addDays(d, -1), addDays(d, 2)).catch(() => null))?.id || ''; }
  if (!eventId) return next.key ? 'unknown' : '';
  if (live()) { try { await G.deleteEvent(cal, eventId); return 'removed'; } catch (e) { if (!(e.network || /expired|not signed/i.test(e.message || ''))) return 'unknown'; } }
  setOutbox(o => [...o, { type: 'delete', calendarId: cal, eventId, id: key(), at: Date.now() }]);
  return 'queued';
}
