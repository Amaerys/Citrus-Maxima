// Google integration: sign-in (Google Identity Services, browser-only), Calendar, Drive.
// Needs only the OAuth *client ID* (entered in Settings). No secret, no backend.
import { keyOf } from './util.js';

const SCOPES = [
  'https://www.googleapis.com/auth/calendar',
  'https://www.googleapis.com/auth/drive.file',
  'https://www.googleapis.com/auth/drive.appdata',
  'https://www.googleapis.com/auth/drive.readonly',
  'https://www.googleapis.com/auth/userinfo.email',
].join(' ');

const TOKEN_KEY = 'citrus.token';
let tokenClient = null;
let token = loadToken();
let clientId = '';
const authListeners = new Set();

function loadToken() {
  try { const t = JSON.parse(sessionStorage.getItem(TOKEN_KEY) || 'null'); return t && t.exp > Date.now() ? t : null; } catch { return null; }
}
function saveToken(t) { token = t; try { t ? sessionStorage.setItem(TOKEN_KEY, JSON.stringify(t)) : sessionStorage.removeItem(TOKEN_KEY); } catch {} for (const fn of authListeners) fn(!!t); }

export function onAuthChange(fn) { authListeners.add(fn); return () => authListeners.delete(fn); }
export function isSignedIn() { return !!(token && token.exp > Date.now()); }

function loadGis() {
  if (window.google?.accounts?.oauth2) return Promise.resolve();
  return new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client'; s.async = true; s.defer = true;
    s.onload = () => res(); s.onerror = () => rej(new Error('Could not load Google sign-in (offline?)'));
    document.head.append(s);
  });
}

export async function init(id) {
  clientId = id;
  if (!clientId) return false;
  await loadGis();
  tokenClient = window.google.accounts.oauth2.initTokenClient({
    client_id: clientId, scope: SCOPES, prompt: '',
    callback: () => {}, // replaced per request
  });
  return true;
}

export function signIn({ silent = false } = {}) {
  return new Promise(async (res, rej) => {
    if (!tokenClient) { if (!clientId) return rej(new Error('Add your Google client ID in Settings first')); await init(clientId); }
    tokenClient.callback = (resp) => {
      if (resp.error) return rej(new Error(resp.error_description || resp.error));
      saveToken({ access_token: resp.access_token, exp: Date.now() + (resp.expires_in - 60) * 1000 });
      res(token);
    };
    tokenClient.error_callback = (e) => rej(new Error(e.type || 'Sign-in cancelled'));
    tokenClient.requestAccessToken({ prompt: silent ? '' : 'consent' });
  });
}

export function signOut() {
  if (token && window.google?.accounts?.oauth2) try { window.google.accounts.oauth2.revoke(token.access_token, () => {}); } catch {}
  saveToken(null);
}

async function authFetch(url, opts = {}, retry = true) {
  if (!isSignedIn()) {
    try { await signIn({ silent: true }); } catch (e) { throw new Error('Not signed in to Google'); }
  }
  const r = await fetch(url, { ...opts, headers: { ...(opts.headers || {}), Authorization: `Bearer ${token.access_token}` } });
  if (r.status === 401 && retry) { saveToken(null); return authFetch(url, opts, false); }
  if (!r.ok) {
    let msg = `${r.status} ${r.statusText}`;
    try { const j = await r.json(); msg = j.error?.message || msg; } catch {}
    throw new Error(msg);
  }
  if (r.status === 204) return null;
  const ct = r.headers.get('content-type') || '';
  return ct.includes('json') ? r.json() : r.arrayBuffer();
}

export async function userInfo() {
  return authFetch('https://www.googleapis.com/oauth2/v3/userinfo');
}

// ---------------- Calendar ----------------
export async function listCalendars() {
  const j = await authFetch('https://www.googleapis.com/calendar/v3/users/me/calendarList?minAccessRole=reader');
  return (j.items || []).map(c => ({ id: c.id, name: c.summaryOverride || c.summary, primary: !!c.primary, color: c.backgroundColor, accessRole: c.accessRole }));
}

export async function listEvents(calendarId, from, to) {
  const q = new URLSearchParams({ timeMin: from.toISOString(), timeMax: to.toISOString(), singleEvents: 'true', orderBy: 'startTime', maxResults: '2500' });
  const j = await authFetch(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?${q}`);
  return (j.items || []).filter(e => e.status !== 'cancelled').map(e => normalizeEvent(e, calendarId));
}

function normalizeEvent(e, calendarId) {
  const allDay = !!e.start?.date;
  const start = allDay ? new Date(e.start.date + 'T00:00:00') : new Date(e.start.dateTime);
  const end = allDay ? new Date(e.end.date + 'T00:00:00') : new Date(e.end.dateTime);
  return { id: e.id, calendarId, title: e.summary || '(no title)', start, end, allDay, location: e.location || '', citrus: e.extendedProperties?.private?.citrus || '', htmlLink: e.htmlLink, color: e.colorId };
}

export async function createEvent(calendarId, { title, start, end, description = '', location = '', tag = '', colorId }) {
  const body = {
    summary: title, description, location,
    start: { dateTime: start.toISOString() }, end: { dateTime: end.toISOString() },
    extendedProperties: { private: { citrus: tag || 'plan' } },
  };
  if (colorId) body.colorId = colorId;
  const j = await authFetch(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  return normalizeEvent(j, calendarId);
}

export async function patchEvent(calendarId, eventId, patch) {
  const body = {};
  if (patch.title) body.summary = patch.title;
  if (patch.start) body.start = { dateTime: patch.start.toISOString() };
  if (patch.end) body.end = { dateTime: patch.end.toISOString() };
  const j = await authFetch(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  return normalizeEvent(j, calendarId);
}

export async function deleteEvent(calendarId, eventId) {
  try { await authFetch(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`, { method: 'DELETE' }); }
  catch (e) { if (!/404|410/.test(e.message)) throw e; }
}

export async function ensureCalendar(name) {
  const cals = await listCalendars();
  const found = cals.find(c => c.name === name);
  if (found) return found.id;
  const j = await authFetch('https://www.googleapis.com/calendar/v3/calendars', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ summary: name, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone }) });
  return j.id;
}

// Replace all citrus-tagged events in a calendar for a date range with the given list
export async function syncTaggedEvents(calendarId, tag, from, to, wanted) {
  const existing = (await listEvents(calendarId, from, to)).filter(e => e.citrus === tag);
  const key = (e) => `${e.title}|${e.start.toISOString()}|${e.end.toISOString()}`;
  const have = new Map(existing.map(e => [key(e), e]));
  const want = new Map(wanted.map(e => [key(e), e]));
  let created = 0, deleted = 0;
  for (const [k, e] of have) if (!want.has(k)) { await deleteEvent(calendarId, e.id); deleted++; }
  for (const [k, e] of want) if (!have.has(k)) { await createEvent(calendarId, { ...e, tag }); created++; }
  return { created, deleted };
}

// ---------------- Drive ----------------
const DRIVE = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';

async function findFolder(name, parentId = 'root') {
  const q = `name='${name.replace(/'/g, "\\'")}' and mimeType='application/vnd.google-apps.folder' and '${parentId}' in parents and trashed=false`;
  const j = await authFetch(`${DRIVE}/files?q=${encodeURIComponent(q)}&fields=files(id,name)`);
  return j.files?.[0] || null;
}
export async function ensureFolder(name, parentId = 'root') {
  const f = await findFolder(name, parentId);
  if (f) return f.id;
  const j = await authFetch(`${DRIVE}/files`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, mimeType: 'application/vnd.google-apps.folder', parents: [parentId] }) });
  return j.id;
}

// Lists .xlsx files in <root>/<folder>/Rotas (creates the folders if missing)
export async function listRotaFiles(rootFolderName) {
  const root = await ensureFolder(rootFolderName);
  const rotas = await ensureFolder('Rotas', root);
  const q = `'${rotas}' in parents and trashed=false and (mimeType='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' or name contains '.xlsx')`;
  const j = await authFetch(`${DRIVE}/files?q=${encodeURIComponent(q)}&fields=files(id,name,modifiedTime,size)&orderBy=modifiedTime desc`);
  return (j.files || []).map(f => ({ ...f, folderId: rotas }));
}
export async function downloadFile(fileId) {
  return authFetch(`${DRIVE}/files/${fileId}?alt=media`);
}

// Other apps drop `<App>.status.json` in <root>/Apps — the scheduler reads them.
export async function listAppStatus(rootFolderName) {
  const root = await ensureFolder(rootFolderName);
  const apps = await ensureFolder('Apps', root);
  const q = `'${apps}' in parents and trashed=false and name contains '.json'`;
  const j = await authFetch(`${DRIVE}/files?q=${encodeURIComponent(q)}&fields=files(id,name,modifiedTime)`);
  const out = {};
  for (const f of j.files || []) {
    try { const buf = await downloadFile(f.id); out[f.name.replace(/\.status\.json$|\.json$/, '')] = { ...JSON.parse(new TextDecoder().decode(buf)), _modified: f.modifiedTime }; } catch {}
  }
  return out;
}

// Write/replace <root>/Apps/<name>.status.json (used to mirror same-device app statuses to other devices)
export async function uploadAppStatus(rootFolderName, name, obj) {
  const root = await ensureFolder(rootFolderName);
  const apps = await ensureFolder('Apps', root);
  const fname = `${name}.status.json`;
  const q = `'${apps}' in parents and trashed=false and name='${fname.replace(/'/g, "\\'")}'`;
  const j = await authFetch(`${DRIVE}/files?q=${encodeURIComponent(q)}&fields=files(id)`);
  const existing = j.files?.[0];
  const boundary = 'citrus' + Date.now();
  const meta = existing ? { name: fname } : { name: fname, parents: [apps] };
  const body = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n--${boundary}\r\nContent-Type: application/json\r\n\r\n${JSON.stringify(obj)}\r\n--${boundary}--`;
  const url = existing ? `${UPLOAD}/files/${existing.id}?uploadType=multipart` : `${UPLOAD}/files?uploadType=multipart`;
  await authFetch(url, { method: existing ? 'PATCH' : 'POST', headers: { 'Content-Type': `multipart/related; boundary=${boundary}` }, body });
}

// App state in the hidden appDataFolder
const STATE_NAME = 'citrus-maxima-state.json';
async function findStateFile() {
  const j = await authFetch(`${DRIVE}/files?spaces=appDataFolder&q=${encodeURIComponent(`name='${STATE_NAME}'`)}&fields=files(id,modifiedTime)`);
  return j.files?.[0] || null;
}
export async function loadRemoteState() {
  const f = await findStateFile();
  if (!f) return null;
  const buf = await downloadFile(f.id);
  try { return JSON.parse(new TextDecoder().decode(buf)); } catch { return null; }
}
export async function saveRemoteState(state) {
  const f = await findStateFile();
  const meta = { name: STATE_NAME, parents: f ? undefined : ['appDataFolder'] };
  const boundary = 'citrus' + Date.now();
  const body = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n--${boundary}\r\nContent-Type: application/json\r\n\r\n${JSON.stringify(state)}\r\n--${boundary}--`;
  const url = f ? `${UPLOAD}/files/${f.id}?uploadType=multipart` : `${UPLOAD}/files?uploadType=multipart`;
  await authFetch(url, { method: f ? 'PATCH' : 'POST', headers: { 'Content-Type': `multipart/related; boundary=${boundary}` }, body });
}

export const dateKeyOf = keyOf;
