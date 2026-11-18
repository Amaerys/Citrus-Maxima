// Every app in the Citrus family, where it lives in Drive, and who reads whose folder. Pure, no DOM.
// The Drive layout (owner, 17/11/2026): one "Citrus" folder at the top of My Drive, nested by area.
// Folders are found by a tag (appProperties.citrusApp), never by path, so they can move without breaking anyone:
// "tag first, move later" — a folder only moves once its app and every app that reads it say they find folders by tag.

export const ROOT = 'Citrus';
/** Category folders, top to bottom. Each path is under Citrus/. */
export const AREAS = [
  { id: 'hub', path: ['00 Hub'], title: 'Hub', blurb: 'Citrus itself, the Claude inbox, and the map of everything' },
  { id: 'work', path: ['Work'], title: 'Work', blurb: 'Rotas and your job' },
  { id: 'life', path: ['Life'], title: 'Life', blurb: 'People, home, mind, media, fitness' },
  { id: 'medicine', path: ['Learning', 'Medicine'], title: 'Learning › Medicine', blurb: 'Clinical learning apps' },
  { id: 'languages', path: ['Learning', 'Languages'], title: 'Learning › Languages', blurb: '' },
  { id: 'science', path: ['Learning', 'Science'], title: 'Learning › Science', blurb: '' },
  { id: 'tech', path: ['Learning', 'Tech'], title: 'Learning › Tech', blurb: '' },
  { id: 'study', path: ['Learning'], title: 'Learning', blurb: 'Study tools' },
  { id: 'handoffs', path: ['Handoffs'], title: 'Handoffs', blurb: 'Files apps pass to each other' },
  { id: 'archive', path: ['Archive'], title: 'Archive', blurb: 'Old My Apps and Citrus Maxima leftovers' },
];
const areaOf = (id) => AREAS.find(a => a.id === id);

// readers: apps that open this folder besides its owner (checked 18/11/2026 against each app's notes: Bassiet reads only its own folder and
// the Yuzu inbox; Mephisto reads plan.json from the never-created hub/scheduler, so neither holds the shared folders back). '*' = every app.
// legacy: where the folder is today ([] under the Drive folder setting, normally "My Apps").
const A = (id, title, folder, area, extra = {}) => ({ id, title, folder, area, legacy: ['hub', id], readers: ['citrus', 'bergamot'], ...extra });
export const APPS = [
  A('citrus', 'Citrus', 'Citrus', 'hub', { icon: '🍊', color: '#ff8a1f', url: 'https://amaerys.github.io/Citrus-Maxima/', readers: ['mandarin', 'clementine', 'calamansi', 'bergamot', 'sudachi', 'yuzu', 'orange', 'embergine', 'sinus', 'kumquat', 'buffer', 'galen', 'atls', 'lime', 'zest'], files: ['state.json', 'plan.json', 'backups/'], blurb: 'Your plan, goals and the hub' }),
  A('claude', 'Claude inbox', 'Claude', 'hub', { icon: '✨', color: '#c58cff', url: '', readers: ['mandarin', 'bergamot'], files: ['status.json'], blurb: 'Things Claude sends you to accept', noApp: true }),
  A('rotas', 'Rotas', 'Rotas', 'work', { icon: '📅', color: '#8fb3ff', legacy: ['Rotas'], readers: ['mandarin', 'orange', 'yuzu'], files: ['*.xlsx'], blurb: 'Monthly rota spreadsheets', noApp: true }),
  A('mandarin', 'Mandarin', 'Mandarin', 'work', { icon: '🍊', color: '#ff8a1f', url: 'https://mandarin-work.github.io/Mandarin/', readers: ['citrus', 'bergamot', 'clementine', 'calamansi', 'sudachi'], files: ['state.json', 'status.json', 'shifts.json'], blurb: 'Rotas, roster, nurses, leave, career' }),
  A('clementine', 'Clementine', 'People - Clementine', 'life', { icon: '🍊', color: '#ff6a3d', url: 'https://clementine-social.github.io/Clementine/', readers: ['citrus', 'bergamot', 'mandarin'], files: ['state.json', 'status.json', 'contacts.json'], blurb: 'Contacts, friends, outings' }),
  A('calamansi', 'Calamansi', 'Home & Kitchen - Calamansi', 'life', { icon: '🍋', color: '#9fd94a', url: 'https://calamansi-food.github.io/Calamansi/', files: ['state.json', 'status.json'], blurb: 'Chores, recipes, meals, bills, car' }),
  A('bergamot', 'Bergamot', 'Mind & Journal - Bergamot', 'life', { icon: '🫖', color: '#c9d86a', url: 'https://bergamot-mind.github.io/Bergamot/', files: ['state.json', 'status.json'], blurb: 'Journal, notes, tasks, habits' }),
  A('sudachi', 'Sudachi', 'Media - Sudachi', 'life', { icon: '🟢', color: '#b8f03c', url: 'https://sudachi-library.github.io/Sudachi/', files: ['state.json', 'status.json'], blurb: 'Books, shows, films, games' }),
  A('orange', 'Orange', 'Fitness - Orange', 'life', { icon: '🍊', color: '#ff7a1a', url: 'https://orange-fitness.github.io/Orange/', files: ['status.json', 'data/'], blurb: 'Training and readiness' }),
  A('buffer', 'Buffer', 'Blood gases - Buffer', 'medicine', { icon: '🫧', color: '#5ec8ff', url: 'https://buffer-gases.github.io/Buffer/', blurb: 'ABG / VBG learning' }),
  A('sinus', 'Sinus', 'ECG - Sinus', 'medicine', { icon: '💓', color: '#ff5f6d', url: 'https://sinus-ekg.github.io/Sinus-EKG/', blurb: 'ECG learning' }),
  A('embergine', 'Embergine', 'Arrest sim - Embergine', 'medicine', { icon: '🔥', color: '#f26a1b', url: 'https://embergine.github.io/embergine/', blurb: 'Cardiac arrest simulator' }),
  A('galen', 'Galen', 'History & exam - Galen', 'medicine', { icon: '🩺', color: '#7fd1b9', url: 'https://galen-app.github.io/galen/', blurb: 'History taking and examination' }),
  A('bassiet', 'Bassiet', 'Step 1 - Bassiet', 'medicine', { icon: '🧫', color: '#e07bff', url: '', blurb: 'USMLE Step 1' }),
  A('atls', 'ATLS Companion', 'Trauma - ATLS', 'medicine', { icon: '🚑', color: '#ff9f43', url: '', blurb: 'ATLS 11' }),
  A('dragonfruit', 'Dragonfruit', 'ER & OH clinic - Dragonfruit', 'medicine', { icon: '🐉', color: '#ff4f9a', url: '', blurb: 'ER and occupational health clinic' }),
  A('mephisto', 'Mephisto', 'German - Mephisto', 'languages', { icon: '🇩🇪', color: '#c58cff', url: 'https://mephisto-deutsch.github.io/Mephisto/', blurb: 'Medical German' }),
  A('kumquat', 'Kumquat', 'Biostatistics - Kumquat', 'science', { icon: '📊', color: '#ff6a13', url: 'https://kumquat-evidence.github.io/Kumquat/', blurb: 'Biostatistics and appraisal' }),
  A('lime', 'Lime', 'Programming - Lime', 'tech', { icon: '💻', color: '#7bd88f', url: '', blurb: 'Programming and computer science' }),
  A('zest', 'Zest', 'Zest', 'study', { icon: '✳️', color: '#ffd166', url: '', blurb: '' }),
  A('yuzu', 'Yuzu', 'Flashcards - Yuzu', 'study', { icon: '🍋', color: '#f2d34b', url: 'https://yuzu-cards.github.io/Yuzu/', files: ['status.json'], blurb: 'Flashcards' }),
  // Yuzu's card collection and media live in their own folder; it moves inside Yuzu's once Yuzu and Mephisto (which drops words into its inbox) find it by tag
  A('yuzu-data', 'Yuzu collection', 'Flashcards - Yuzu/collection & media', 'study', { icon: '🗂️', color: '#f2d34b', legacy: ['Yuzu'], owner: 'yuzu', inside: 'yuzu', readers: ['mephisto'], files: ['collection/', 'media/', 'backups/'], blurb: 'Cards, media, inbox', noApp: true }),
  A('handoff', 'Clinical reasoning inbox', 'Clinical reasoning inbox', 'handoffs', { icon: '🔁', color: '#9aa0b1', legacy: ['hub', 'handoff'], owner: 'buffer', readers: [], files: ['buffer_handoff*.json'], blurb: 'Cases Buffer leaves for the reasoning app', noApp: true }),
];
// Each app's own logo: the 192 px icon every app in the family ships at <site>/icons/icon-192.png (its manifest icon).
// A status.json may name another (logo). Where it fails to load, the emoji above shows instead.
for (const a of APPS) if (!a.logo && a.url) a.logo = `${a.url}icons/icon-192.png`;

export const byId = (id) => APPS.find(a => a.id === id) || null;
/** Apps (not shared folders) for the Apps tab, grouped by area in layout order. */
export function directory() {
  return AREAS.filter(a => a.id !== 'archive').map(a => ({ ...a, apps: APPS.filter(x => x.area === a.id && !x.noApp) })).filter(a => a.apps.length);
}
/** The folder path under Citrus/ an app's folder moves to. */
export function targetPath(app) {
  if (app.inside) return [...targetPath(byId(app.inside)), 'collection & media'];
  return [...areaOf(app.area).path, app.folder];
}
/** Does an app say it finds folders by tag? (status.json › drive.byTag, contract v3 of the hub) */
export const findsByTag = (st) => !!(st && st.drive && (st.drive.byTag === true || st.drive.byTag === 1));
/**
 * May this folder move now? Its owner and every reader must find folders by tag. Citrus itself does (this build).
 * apps: { id: rawStatus } as Citrus last read them. Readers that have no status at all (not built, never opened) don't block,
 * except for '*' folders, where every app that has ever reported must be ready.
 */
export function readyToMove(app, apps = {}) {
  const ok = (id) => id === 'citrus' || id === 'claude' || findsByTag(apps[id]);
  const owner = app.owner || app.id, o = byId(owner);
  if (o && !o.noApp && !ok(owner)) return { ok: false, waiting: [owner] };
  const readers = app.readers.includes('*') ? Object.keys(apps).filter(id => byId(id) && !byId(id).noApp) : app.readers.filter(id => apps[id]);
  const waiting = [...new Set(readers.filter(id => id !== owner && !ok(id)))];
  return { ok: !waiting.length, waiting };
}
/** Map.json: every app's folder, where it is, what is in it, and who reads it. */
export function buildMap(found, apps = {}, now = new Date()) {
  return {
    citrusMap: 1, updatedAt: now.toISOString(),
    about: 'Every app in the Citrus family keeps its Drive files in one folder, found by the tag appProperties.citrusApp = <id>. Paths are for people; apps use the tag.',
    find: "files?q=mimeType='application/vnd.google-apps.folder' and trashed=false and appProperties has { key='citrusApp' and value='<id>' }",
    areas: AREAS.map(a => ({ id: a.id, path: [ROOT, ...a.path].join('/'), title: a.title })),
    apps: APPS.map(a => {
      const f = found[a.id], st = apps[a.owner || a.id], r = readyToMove(a, apps);
      return { id: a.id, title: a.title, area: a.area, folderId: f?.id || null, path: f?.path || null, target: [ROOT, ...targetPath(a)].join('/'), moved: !!f?.moved,
        files: a.files || ['status.json', 'state.json'], readBy: a.readers, findsByTag: a.id === 'citrus' || a.id === 'claude' || findsByTag(st), waitingFor: f?.moved ? [] : r.waiting, url: a.url || '' };
    }),
  };
}
/** README for people, kept next to Map.json. */
export function readme(map) {
  const lines = ['# Citrus — your apps on Drive', '', `Updated ${map.updatedAt.slice(0, 10)} by Citrus. Every app keeps its files in one folder below. Apps find their folder by a tag, so it is safe to look around; please don't rename or move app folders by hand — Citrus moves them when every app is ready.`, ''];
  for (const area of AREAS) {
    const rows = map.apps.filter(a => a.area === area.id); if (!rows.length) continue;
    lines.push(`## ${area.title}`);
    for (const a of rows) lines.push(`- **${a.title}** — ${a.moved ? a.target : a.path ? `${a.path} (moves to ${a.target}${a.waitingFor.length ? ` once ${a.waitingFor.join(', ')} ${a.waitingFor.length === 1 ? 'is' : 'are'} ready` : ''})` : 'no folder yet'}. Files: ${a.files.join(', ')}.${a.readBy.length ? ` Read by: ${a.readBy.includes('*') ? 'every app' : a.readBy.join(', ')}.` : ''}`);
    lines.push('');
  }
  return lines.join('\n');
}
