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
// Layout (shared by all apps):  <root>/Rotas/*.xlsx   <root>/hub/<app>/status.json|state.json   <root>/hub/citrus/plan.json
const DRIVE = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
const FOLDER = 'application/vnd.google-apps.folder';
const IDS_KEY = 'citrus.drive.ids';
const q = (s) => String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
let ids = {};
try { ids = JSON.parse(localStorage.getItem(IDS_KEY) || '{}'); } catch {}
function remember(key, id) { ids[key] = id; try { localStorage.setItem(IDS_KEY, JSON.stringify(ids)); } catch {} }
function forget(prefix) { for (const k of Object.keys(ids)) if (k === prefix || k.startsWith(prefix + '/')) delete ids[k]; try { localStorage.setItem(IDS_KEY, JSON.stringify(ids)); } catch {} }

async function list(parentId, { name, folders, extra } = {}) {
  const parts = ['trashed = false', `'${q(parentId)}' in parents`];
  if (name) parts.push(`name = '${q(name)}'`);
  if (folders) parts.push(`mimeType = '${FOLDER}'`);
  if (extra) parts.push(extra);
  const j = await authFetch(`${DRIVE}/files?q=${encodeURIComponent(parts.join(' and '))}&fields=files(id,name,mimeType,modifiedTime,size)&pageSize=100&orderBy=modifiedTime desc`);
  return j.files || [];
}
async function mkdir(name, parentId) {
  const j = await authFetch(`${DRIVE}/files?fields=id`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, mimeType: FOLDER, parents: [parentId] }) });
  return j.id;
}
// Folder id for a path like ['My Apps','hub','citrus'], creating what is missing. Ids are cached; a 404 clears the cache and retries once.
export async function ensurePath(parts, { create = true } = {}) {
  const run = async () => {
    let parent = 'root', key = '';
    for (const name of parts) {
      key = key ? `${key}/${name}` : name;
      let id = ids[key];
      if (!id) {
        const found = (await list(parent, { name, folders: true }))[0];
        if (found) id = found.id;
        else if (create) id = await mkdir(name, parent);
        else return null;
        remember(key, id);
      }
      parent = id;
    }
    return parent;
  };
  try { return await run(); }
  catch (e) { if (/404|not found/i.test(e.message)) { forget(parts[0]); return run(); } throw e; }
}
export async function downloadFile(fileId) { return authFetch(`${DRIVE}/files/${fileId}?alt=media`); }
async function readJsonIn(folderId, name) {
  const f = (await list(folderId, { name }))[0];
  if (!f) return null;
  const buf = await downloadFile(f.id);
  try { return { data: JSON.parse(new TextDecoder().decode(buf)), modifiedTime: f.modifiedTime, id: f.id }; } catch { return null; }
}
async function writeJsonIn(folderId, name, obj, fileId = null) {
  if (!fileId) fileId = (await list(folderId, { name }))[0]?.id || null;
  const boundary = 'citrus' + Date.now();
  const meta = fileId ? { name } : { name, parents: [folderId] };
  const body = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n--${boundary}\r\nContent-Type: application/json\r\n\r\n${JSON.stringify(obj)}\r\n--${boundary}--`;
  const url = fileId ? `${UPLOAD}/files/${fileId}?uploadType=multipart&fields=id,modifiedTime` : `${UPLOAD}/files?uploadType=multipart&fields=id,modifiedTime`;
  return authFetch(url, { method: fileId ? 'PATCH' : 'POST', headers: { 'Content-Type': `multipart/related; boundary=${boundary}` }, body });
}
export async function readJson(parts, name) { const id = await ensurePath(parts, { create: false }); return id ? readJsonIn(id, name) : null; }
export async function writeJson(parts, name, obj) { const id = await ensurePath(parts); return writeJsonIn(id, name, obj); }

// <root>/Rotas: every spreadsheet (Google Sheets are exported as xlsx)
export async function listRotaFiles(root) {
  const id = await ensurePath([root, 'Rotas']);
  const files = await list(id, { extra: `(mimeType='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' or mimeType='application/vnd.google-apps.spreadsheet' or name contains '.xlsx')` });
  return files.map(f => ({ ...f, folderId: id }));
}
export async function downloadRota(f) {
  if (f.mimeType === 'application/vnd.google-apps.spreadsheet') return authFetch(`${DRIVE}/files/${f.id}/export?mimeType=${encodeURIComponent('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')}`);
  return downloadFile(f.id);
}

// <root>/hub/<app>/status.json for every app folder (read in parallel)
export async function listAppStatus(root) {
  const hub = await ensurePath([root, 'hub']);
  const folders = await list(hub, { folders: true });
  const out = {};
  await Promise.all(folders.filter(f => f.name !== 'citrus').map(async (f) => {
    remember(`${root}/hub/${f.name}`, f.id);
    try { const r = await readJsonIn(f.id, 'status.json'); if (r?.data) out[f.name] = { ...r.data, _modified: r.modifiedTime, _folder: f.name }; } catch (e) { console.warn('status', f.name, e.message); }
  }));
  // legacy location used by early Sinus builds
  try {
    const legacy = await ensurePath(['Citrus Maxima', 'Apps'], { create: false });
    if (legacy) for (const f of await list(legacy, { extra: `name contains '.status.json'` })) {
      const app = f.name.replace(/\.status\.json$/, '').toLowerCase();
      if (out[app]) continue;
      try { const buf = await downloadFile(f.id); out[app] = { ...JSON.parse(new TextDecoder().decode(buf)), _modified: f.modifiedTime, _legacy: true }; } catch {}
    }
  } catch {}
  return out;
}
export async function uploadAppStatus(root, app, obj) { return writeJson([root, 'hub', app.toLowerCase()], 'status.json', obj); }
export async function writePlan(root, plan) { return writeJson([root, 'hub', 'citrus'], 'plan.json', plan); }

// Citrus's own state: <root>/hub/citrus/state.json (older builds kept it in the hidden appDataFolder — read once as a fallback)
export async function loadRemoteState(root) {
  const r = await readJson([root, 'hub', 'citrus'], 'state.json');
  if (r) return r.data;
  try {
    const j = await authFetch(`${DRIVE}/files?spaces=appDataFolder&q=${encodeURIComponent(`name='citrus-maxima-state.json'`)}&fields=files(id)`);
    const f = j.files?.[0];
    if (f) { const buf = await downloadFile(f.id); return JSON.parse(new TextDecoder().decode(buf)); }
  } catch {}
  return null;
}
let stateFileId = null;
export async function saveRemoteState(root, state) {
  const id = await ensurePath([root, 'hub', 'citrus']);
  const r = await writeJsonIn(id, 'state.json', state, stateFileId);
  stateFileId = r?.id || stateFileId;
}

export const dateKeyOf = keyOf;
