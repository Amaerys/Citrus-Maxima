// In-memory Google for Playwright: Drive v3 (folders, multipart upload, media, export), Calendar v3, userinfo,
// and a GIS stub. State lives in Node so several browser contexts ("devices") share one Drive.
import fs from 'node:fs';

export function createFakeGoogle({ email = 'tester@example.com' } = {}) {
  let seq = 0;
  const id = (p) => `${p}${(++seq).toString(36)}`;
  const files = new Map(); // id -> {id,name,mimeType,parents,content:Buffer,modifiedTime,appData}
  const calendars = new Map([['primary', { id: 'primary', summary: email, primary: true, events: new Map() }]]);
  const log = [];
  const faults = { status500: 0, status401: 0, offline: false, gisFail: false };
  const now = () => new Date().toISOString();
  const FOLDER = 'application/vnd.google-apps.folder';

  function put(name, parent, content, mimeType = 'application/json') {
    const f = { id: id('f'), name, mimeType, parents: [parent], content: Buffer.isBuffer(content) ? content : Buffer.from(typeof content === 'string' ? content : JSON.stringify(content)), modifiedTime: now() };
    files.set(f.id, f); return f;
  }
  function mkdir(name, parent = 'root') { return put(name, parent, Buffer.alloc(0), FOLDER); }
  function find(name, parent) { return [...files.values()].find(f => f.name === name && f.parents.includes(parent) && !f.trashed); }
  function path(parts, create = true) { let p = 'root'; for (const n of parts) { let f = find(n, p); if (!f && create) f = mkdir(n, p); if (!f) return null; p = f.id; } return p; }
  function readJsonAt(parts, name) { const dir = path(parts, false); if (!dir) return null; const f = find(name, dir); return f ? JSON.parse(f.content.toString()) : null; }
  function tree(parent = 'root', indent = '') {
    const out = [];
    for (const f of [...files.values()].filter(x => x.parents.includes(parent) && !x.trashed && !x.appData).sort((a, b) => a.name.localeCompare(b.name))) {
      out.push(`${indent}${f.mimeType === FOLDER ? '📁' : '📄'} ${f.name}${f.mimeType === FOLDER ? '' : ` (${f.content.length} B)`}`);
      if (f.mimeType === FOLDER) out.push(...tree(f.id, indent + '   '));
    }
    return out;
  }

  // ---- query parser for the subset the apps use ----
  function matches(f, q, spaces) {
    if (spaces === 'appDataFolder' ? !f.appData : f.appData) return false;
    if (/trashed\s*=\s*false/.test(q) && f.trashed) return false;
    const par = /'([^']+)' in parents/.exec(q); if (par && !f.parents.includes(par[1])) return false;
    const nm = /name\s*=\s*'((?:[^'\\]|\\.)*)'/.exec(q); if (nm && f.name !== nm[1].replace(/\\'/g, "'")) return false;
    if (/mimeType\s*=\s*'application\/vnd\.google-apps\.folder'/.test(q) && !q.includes(' or ') && f.mimeType !== FOLDER) return false;
    const nc = /name contains '([^']+)'/.exec(q);
    if (q.includes('spreadsheetml') || q.includes("contains '.xlsx'")) { if (!(f.mimeType.includes('spreadsheet') || /\.xlsx$/.test(f.name))) return false; }
    else if (nc && !f.name.includes(nc[1])) return false;
    return true;
  }
  function parseMultipart(body, ct) {
    const b = /boundary=([^;]+)/.exec(ct)[1];
    const parts = body.toString('binary').split(`--${b}`).filter(p => p.trim() && p.trim() !== '--');
    const get = (p) => { const i = p.indexOf('\r\n\r\n'); return p.slice(i + 4).replace(/\r\n$/, ''); };
    return { meta: JSON.parse(Buffer.from(get(parts[0]), 'binary').toString('utf8')), content: Buffer.from(get(parts[1]), 'binary') };
  }
  const json = (route, status, obj) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(obj) });

  async function handle(route) {
    const req = route.request(); const url = new URL(req.url()); const method = req.method();
    const short = `${method} ${url.pathname.replace('/drive/v3', 'drive').replace('/upload/drive/v3', 'upload').replace('/calendar/v3', 'cal')}`;
    if (faults.offline) { log.push(short + ' ✗offline'); return route.abort('internetdisconnected'); }
    if (url.hostname === 'accounts.google.com') return route.fulfill({ status: 200, contentType: 'text/javascript', body: gisStub(faults.gisFail) });
    const auth = req.headers()['authorization'] || '';
    if (!auth.startsWith('Bearer ')) { log.push(short + ' 401(no token)'); return json(route, 401, { error: { message: 'no token' } }); }
    if (faults.status401 > 0) { faults.status401--; log.push(short + ' 401'); return json(route, 401, { error: { message: 'Invalid Credentials' } }); }
    if (faults.status500 > 0) { faults.status500--; log.push(short + ' 500'); return json(route, 500, { error: { message: 'backend error' } }); }
    log.push(short);
    const p = url.pathname;
    // userinfo
    if (p === '/oauth2/v3/userinfo') return json(route, 200, { email });
    // ---- Drive ----
    if (p === '/drive/v3/files' && method === 'GET') {
      const q = url.searchParams.get('q') || ''; const spaces = url.searchParams.get('spaces');
      const list = [...files.values()].filter(f => matches(f, q, spaces)).sort((a, b) => b.modifiedTime.localeCompare(a.modifiedTime));
      return json(route, 200, { files: list.map(f => ({ id: f.id, name: f.name, mimeType: f.mimeType, modifiedTime: f.modifiedTime, size: String(f.content.length) })) });
    }
    if (p === '/drive/v3/files' && method === 'POST') { const m = JSON.parse(req.postData() || '{}'); const f = put(m.name, (m.parents || ['root'])[0], Buffer.alloc(0), m.mimeType || 'application/octet-stream'); return json(route, 200, { id: f.id }); }
    let m;
    if ((m = /^\/drive\/v3\/files\/([^/]+)$/.exec(p)) && method === 'GET') {
      const f = files.get(m[1]); if (!f || f.trashed) return json(route, 404, { error: { message: 'File not found' } });
      if (url.searchParams.get('alt') === 'media') return route.fulfill({ status: 200, contentType: f.mimeType, body: f.content });
      return json(route, 200, { id: f.id, name: f.name, trashed: !!f.trashed });
    }
    if ((m = /^\/drive\/v3\/files\/([^/]+)\/export$/.exec(p))) { const f = files.get(m[1]); return f ? route.fulfill({ status: 200, body: f.content }) : json(route, 404, {}); }
    if (p === '/upload/drive/v3/files' && method === 'POST') {
      const { meta, content } = parseMultipart(req.postDataBuffer(), req.headers()['content-type']);
      const parent = (meta.parents || ['root'])[0];
      const f = put(meta.name, parent === 'appDataFolder' ? 'appDataFolder' : parent, content, meta.mimeType || 'application/json');
      if (parent === 'appDataFolder') f.appData = true;
      return json(route, 200, { id: f.id, modifiedTime: f.modifiedTime });
    }
    if ((m = /^\/upload\/drive\/v3\/files\/([^/]+)$/.exec(p)) && method === 'PATCH') {
      const f = files.get(m[1]); if (!f || f.trashed) return json(route, 404, { error: { message: 'File not found' } });
      const { meta, content } = parseMultipart(req.postDataBuffer(), req.headers()['content-type']);
      f.content = content; if (meta.name) f.name = meta.name; f.modifiedTime = now();
      return json(route, 200, { id: f.id, modifiedTime: f.modifiedTime });
    }
    // ---- Calendar ----
    if (p === '/calendar/v3/users/me/calendarList') return json(route, 200, { items: [...calendars.values()].map(c => ({ id: c.id, summary: c.summary, primary: !!c.primary, accessRole: 'owner' })) });
    if (p === '/calendar/v3/calendars' && method === 'POST') { const b = JSON.parse(req.postData()); const c = { id: id('cal'), summary: b.summary, events: new Map() }; calendars.set(c.id, c); return json(route, 200, { id: c.id }); }
    if ((m = /^\/calendar\/v3\/calendars\/([^/]+)\/events$/.exec(p))) {
      const cal = calendars.get(decodeURIComponent(m[1])); if (!cal) return json(route, 404, { error: { message: 'Not Found' } });
      if (method === 'GET') {
        const a = new Date(url.searchParams.get('timeMin')), b = new Date(url.searchParams.get('timeMax'));
        return json(route, 200, { items: [...cal.events.values()].filter(e => new Date(e.end.dateTime || e.end.date) > a && new Date(e.start.dateTime || e.start.date) < b) });
      }
      if (method === 'POST') { const e = { ...JSON.parse(req.postData()), id: id('ev'), status: 'confirmed', htmlLink: 'https://calendar.google.com/x' }; cal.events.set(e.id, e); return json(route, 200, e); }
    }
    if ((m = /^\/calendar\/v3\/calendars\/([^/]+)\/events\/([^/]+)$/.exec(p))) {
      const cal = calendars.get(decodeURIComponent(m[1])); const e = cal?.events.get(decodeURIComponent(m[2]));
      if (!e) return json(route, 404, { error: { message: 'Not Found' } });
      if (method === 'DELETE') { cal.events.delete(e.id); return route.fulfill({ status: 204, body: '' }); }
      if (method === 'PATCH') { Object.assign(e, JSON.parse(req.postData())); return json(route, 200, e); }
    }
    log.push('  ↳ UNHANDLED');
    return json(route, 404, { error: { message: 'unhandled in fake' } });
  }

  function gisStub(fail) {
    return `window.google = { accounts: { oauth2: {
      initTokenClient(cfg) { return { callback: cfg.callback, error_callback: null, requestAccessToken(o) {
        const self = this; setTimeout(() => ${fail ? "self.error_callback ? self.error_callback({ type: 'popup_failed_to_open' }) : self.callback({ error: 'interaction_required' })" : "self.callback({ access_token: 'tok-' + Math.random().toString(36).slice(2), expires_in: 3600 })"}, 20); } }; },
      revoke(t, cb) { cb && cb(); } } } };`;
  }

  async function attach(context) {
    await context.route(/https:\/\/(www\.googleapis\.com|accounts\.google\.com)\/.*/, handle);
    await context.route(/https:\/\/fonts\.(googleapis|gstatic)\.com\/.*/, r => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  }

  function seed({ rotaFiles = [], apps = {}, events = [] } = {}) {
    const rotas = path(['My Apps', 'Rotas']);
    for (const f of rotaFiles) put(f.name, rotas, fs.readFileSync(f.path), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    for (const [app, st] of Object.entries(apps)) put('status.json', path(['My Apps', 'hub', app]), st);
    for (const e of events) { const ev = { id: id('ev'), status: 'confirmed', ...e }; calendars.get('primary').events.set(ev.id, ev); }
  }

  return { attach, seed, files, calendars, log, faults, tree, readJsonAt, path };
}
