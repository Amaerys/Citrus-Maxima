import fs from 'node:fs';
import path from 'node:path';
import { parseRotaFile, interpretCode, fmtMin } from '../docs/js/rota-parser.js';

const dir = path.join(path.dirname(new URL(import.meta.url).pathname), 'data');
for (const f of ['main.xlsx', 'uv.xlsx', 'fsed.xlsx']) {
  const buf = fs.readFileSync(path.join(dir, f));
  const rota = await parseRotaFile(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), f);
  console.log(`\n=== ${f}: unit="${rota.unit}" kind=${rota.unitKind} ${rota.month}/${rota.year} days=${rota.daysInMonth} people=${rota.people.length} weekdayOk=${rota.weekdayOk}`);
  console.log('legend:', rota.legendList.map(e => `${e.code || '(none)'}=${e.desc || e.hoursText}`).join(' ; '));
  for (const p of rota.people.slice(0, 40)) {
    const codes = Object.entries(p.days).map(([d, c]) => `${d}:${c}`).join(' ');
    console.log(` ${p.sn.padStart(2)} ${p.id.padEnd(7)} ${p.name.padEnd(26)} ${p.title.padEnd(20)} ${p.mobile}  ${codes}`);
  }
  const me = rota.people.find(p => /amro/i.test(p.name));
  if (me) {
    console.log('\nMy shifts interpreted:');
    for (const [d, c] of Object.entries(me.days)) {
      const s = interpretCode(c, rota.legend, rota.unitKind);
      console.log(`  ${d}/${rota.month}: ${c} -> ${s.kind} ${s.label} ${s.hours ? fmtMin(s.hours.start) + '-' + fmtMin(s.hours.end) : ''}`);
    }
  }
  const codes = new Set(rota.people.flatMap(p => Object.values(p.days)));
  console.log('distinct codes:', [...codes].map(c => `${c} => ${interpretCode(c, rota.legend, rota.unitKind).label}`).join(' | '));
}
