// xlsx-lite: minimal, dependency-free .xlsx reader (values + merged ranges only).
// Works in browsers (DecompressionStream) and Node (zlib). Returns per sheet:
// { name, cells: Map<'A1', value>, merges: ['A1:B2', ...], maxRow, maxCol }

const td = new TextDecoder('utf-8');

async function inflateRaw(bytes) {
  if (typeof DecompressionStream !== 'undefined') {
    const ds = new DecompressionStream('deflate-raw');
    const w = ds.writable.getWriter();
    w.write(bytes); w.close();
    const buf = await new Response(ds.readable).arrayBuffer();
    return new Uint8Array(buf);
  }
  const zlib = await import('node:zlib');
  return new Uint8Array(zlib.inflateRawSync(Buffer.from(bytes)));
}

function readZip(u8) {
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  // find End Of Central Directory
  let eocd = -1;
  for (let i = u8.length - 22; i >= Math.max(0, u8.length - 70000); i--) {
    if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('Not a zip/xlsx file');
  const count = dv.getUint16(eocd + 10, true);
  let off = dv.getUint32(eocd + 16, true);
  const entries = {};
  for (let n = 0; n < count; n++) {
    if (dv.getUint32(off, true) !== 0x02014b50) break;
    const method = dv.getUint16(off + 10, true);
    const csize = dv.getUint32(off + 20, true);
    const usize = dv.getUint32(off + 24, true);
    const nlen = dv.getUint16(off + 28, true);
    const elen = dv.getUint16(off + 30, true);
    const clen = dv.getUint16(off + 32, true);
    const lho = dv.getUint32(off + 42, true);
    const name = td.decode(u8.subarray(off + 46, off + 46 + nlen));
    entries[name] = { method, csize, usize, lho };
    off += 46 + nlen + elen + clen;
  }
  return {
    async file(name) {
      const e = entries[name];
      if (!e) return null;
      const nlen = dv.getUint16(e.lho + 26, true);
      const elen = dv.getUint16(e.lho + 28, true);
      const start = e.lho + 30 + nlen + elen;
      const data = u8.subarray(start, start + e.csize);
      if (e.method === 0) return td.decode(data);
      if (e.method === 8) return td.decode(await inflateRaw(data));
      throw new Error('Unsupported zip method ' + e.method);
    },
    names: Object.keys(entries),
  };
}

function unescapeXml(s) {
  return s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
    .replace(/&amp;/g, '&');
}

function parseSharedStrings(xml) {
  if (!xml) return [];
  const out = [];
  const re = /<si>([\s\S]*?)<\/si>/g;
  let m;
  while ((m = re.exec(xml))) {
    let t = '';
    const tre = /<t[^>]*>([\s\S]*?)<\/t>/g;
    let tm;
    while ((tm = tre.exec(m[1]))) t += tm[1];
    out.push(unescapeXml(t));
  }
  return out;
}

export function colToNum(col) {
  let n = 0;
  for (const ch of col) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
}
export function splitRef(ref) {
  const m = /^([A-Z]+)(\d+)$/.exec(ref);
  return { col: colToNum(m[1]), row: +m[2] };
}

// Excel serial date -> JS Date (UTC midnight)
export function serialToDate(n) {
  return new Date(Math.round((n - 25569) * 86400 * 1000));
}

// Default Excel indexed palette (subset is enough; custom palettes override it)
const DEFAULT_INDEXED = ['000000', 'FFFFFF', 'FF0000', '00FF00', '0000FF', 'FFFF00', 'FF00FF', '00FFFF', '000000', 'FFFFFF', 'FF0000', '00FF00', '0000FF', 'FFFF00', 'FF00FF', '00FFFF', '800000', '008000', '000080', '808000', '800080', '008080', 'C0C0C0', '808080', '9999FF', '993366', 'FFFFCC', 'CCFFFF', '660066', 'FF8080', '0066CC', 'CCCCFF', '000080', 'FF00FF', 'FFFF00', '00FFFF', '800080', '800000', '008080', '0000FF', '00CCFF', 'CCFFFF', 'CCFFCC', 'FFFF99', '99CCFF', 'FF99CC', 'CC99FF', 'FFCC99', '3366FF', '33CCCC', '99CC00', 'FFCC00', 'FF9900', 'FF6600', '666699', '969696', '003366', '339966', '003300', '333300', '993300', '993366', '333399', '333333'];

// style index -> {top, bottom} border colors (hex, no alpha) for cells with a colored outline
function parseBorderStyles(stylesXml) {
  const out = new Map();
  if (!stylesXml) return out;
  let palette = DEFAULT_INDEXED;
  const ic = /<indexedColors>([\s\S]*?)<\/indexedColors>/.exec(stylesXml);
  if (ic) palette = [...ic[1].matchAll(/rgb="([0-9A-Fa-f]{6,8})"/g)].map(m => m[1].slice(-6).toUpperCase());
  const colorOf = (tag) => {
    const m = /<color ([^/]*)\/>/.exec(tag); if (!m) return null;
    const rgb = /rgb="([0-9A-Fa-f]{6,8})"/.exec(m[1]); if (rgb) return rgb[1].slice(-6).toUpperCase();
    const idx = /indexed="(\d+)"/.exec(m[1]); if (idx) return palette[+idx[1]] || null;
    return null; // theme colors: ignore
  };
  const bsec = /<borders[^>]*>([\s\S]*?)<\/borders>/.exec(stylesXml);
  if (!bsec) return out;
  const borders = [...bsec[1].matchAll(/<border(?: [^>]*)?>([\s\S]*?)<\/border>|<border(?: [^>]*)?\/>/g)].map(m => {
    const inner = m[1] || '';
    const side = (name) => { const s = new RegExp(`<${name}(?: [^>]*)?>([\\s\\S]*?)<\\/${name}>`).exec(inner); return s ? colorOf(s[1]) : null; };
    return { top: side('top'), bottom: side('bottom'), left: side('left'), right: side('right') };
  });
  const xsec = /<cellXfs[^>]*>([\s\S]*?)<\/cellXfs>/.exec(stylesXml);
  if (!xsec) return out;
  let i = 0;
  for (const m of xsec[1].matchAll(/<xf [^>]*?(?:\/>|>[\s\S]*?<\/xf>)/g)) {
    const bid = /borderId="(\d+)"/.exec(m[0]);
    if (bid && borders[+bid[1]]) out.set(i, borders[+bid[1]]);
    i++;
  }
  return out;
}

function parseSheet(xml, sst, dateStyles, borderStyles = new Map()) {
  const cells = new Map();
  const outlines = new Map(); // ref -> hex color when the cell has a non-black top+bottom outline
  let maxRow = 0, maxCol = 0;
  const cre = /<c r="([A-Z]+\d+)"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
  let m;
  while ((m = cre.exec(xml))) {
    const ref = m[1], attrs = m[2], inner = m[3] || '';
    const t = (/ t="([^"]+)"/.exec(attrs) || [])[1];
    const s = (/ s="(\d+)"/.exec(attrs) || [])[1];
    if (s !== undefined) {
      const b = borderStyles.get(+s);
      if (b && b.top && b.top === b.bottom && b.top !== '000000' && b.top !== 'FFFFFF') outlines.set(ref, b.top);
    }
    let v = null;
    if (t === 'inlineStr') {
      const tm = /<t[^>]*>([\s\S]*?)<\/t>/.exec(inner); v = tm ? unescapeXml(tm[1]) : '';
    } else {
      const vm = /<v>([\s\S]*?)<\/v>/.exec(inner);
      if (!vm) continue;
      const raw = vm[1];
      if (t === 's') v = sst[+raw] ?? '';
      else if (t === 'b') v = raw === '1';
      else if (t === 'str' || t === 'e') v = unescapeXml(raw);
      else {
        v = Number(raw);
        if (s !== undefined && dateStyles.has(+s)) v = serialToDate(v);
      }
    }
    cells.set(ref, v);
    const { col, row } = splitRef(ref);
    if (row > maxRow) maxRow = row;
    if (col > maxCol) maxCol = col;
  }
  const merges = [];
  const mre = /<mergeCell ref="([^"]+)"/g;
  while ((m = mre.exec(xml))) merges.push(m[1]);
  return { cells, merges, maxRow, maxCol, outlines };
}

function parseDateStyles(stylesXml) {
  // style index -> is date? (numFmtId 14-22, 45-47 or custom fmt containing y/m/d)
  const set = new Set();
  if (!stylesXml) return set;
  const custom = new Set();
  const nre = /<numFmt numFmtId="(\d+)" formatCode="([^"]*)"/g;
  let m;
  while ((m = nre.exec(stylesXml))) {
    const code = m[2].toLowerCase();
    if (/[ymd]/.test(code.replace(/\[[^\]]*\]/g, '').replace(/"[^"]*"/g, '')) && !/#|0\.0/.test(code)) custom.add(+m[1]);
  }
  const xfs = /<cellXfs[^>]*>([\s\S]*?)<\/cellXfs>/.exec(stylesXml);
  if (!xfs) return set;
  // every <xf> is one style index, with or without a numFmtId (skipping some would shift the indexes)
  let i = 0;
  for (const xm of xfs[1].matchAll(/<xf\b[^>]*>/g)) {
    const id = +((/numFmtId="(\d+)"/.exec(xm[0]) || [])[1] || 0);
    if ((id >= 14 && id <= 22) || (id >= 45 && id <= 47) || custom.has(id)) set.add(i);
    i++;
  }
  return set;
}

export async function readXlsx(arrayBufferOrU8) {
  const u8 = arrayBufferOrU8 instanceof Uint8Array ? arrayBufferOrU8 : new Uint8Array(arrayBufferOrU8);
  const zip = readZip(u8);
  const wb = await zip.file('xl/workbook.xml');
  if (!wb) throw new Error('Not an .xlsx workbook');
  const rels = (await zip.file('xl/_rels/workbook.xml.rels')) || '';
  const relMap = {};
  const rre = /<Relationship [^>]*?Id="([^"]+)"[^>]*?Target="([^"]+)"/g;
  let m;
  while ((m = rre.exec(rels))) relMap[m[1]] = m[2];
  // attribute order may vary
  const rre2 = /<Relationship [^>]*?Target="([^"]+)"[^>]*?Id="([^"]+)"/g;
  while ((m = rre2.exec(rels))) relMap[m[2]] = relMap[m[2]] || m[1];
  const sst = parseSharedStrings(await zip.file('xl/sharedStrings.xml'));
  const stylesXml = await zip.file('xl/styles.xml');
  const dateStyles = parseDateStyles(stylesXml);
  const borderStyles = parseBorderStyles(stylesXml);
  const sheets = [];
  const sre = /<sheet [^>]*?name="([^"]*)"[^>]*?r:id="([^"]+)"/g;
  while ((m = sre.exec(wb))) {
    let target = relMap[m[2]] || '';
    target = target.replace(/^\/?(xl\/)?/, 'xl/');
    const xml = await zip.file(target);
    if (!xml) continue;
    sheets.push({ name: unescapeXml(m[1]), ...parseSheet(xml, sst, dateStyles, borderStyles) });
  }
  return { sheets };
}

// sheet -> 2D array (1-based rows/cols) with merged values filled across, plus a parallel grid of outline colours
export function sheetToGrid(sheet) {
  const grid = [];
  for (let r = 0; r <= sheet.maxRow; r++) grid.push(new Array(sheet.maxCol + 1).fill(null));
  for (const [ref, v] of sheet.cells) {
    const { col, row } = splitRef(ref);
    grid[row][col] = v;
  }
  for (const rng of sheet.merges) {
    const [a, b = a] = rng.split(':');   // a one-cell "merge" has no colon
    const A = splitRef(a), B = splitRef(b);
    const v = grid[A.row]?.[A.col] ?? null;
    if (v === null) continue;
    for (let r = A.row; r <= B.row; r++) for (let c = A.col; c <= B.col; c++) {
      if (grid[r]) grid[r][c] = v;
    }
  }
  // outlines as a parallel grid of hex colors
  const outlineGrid = [];
  for (const [ref, color] of sheet.outlines || []) { const { col, row } = splitRef(ref); (outlineGrid[row] ||= [])[col] = color; }
  return { grid, outlineGrid };
}
