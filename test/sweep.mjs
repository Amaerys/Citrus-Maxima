// Scans every main view for stray "null"/"undefined"/NaN text, with the real schedules loaded. Run: node test/sweep.mjs
import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
const root='/home/claude/citrus-maxima/docs', here='/home/claude/citrus-maxima/test', data=(f)=>path.join(here,'data',f);
const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml','.png':'image/png','.webmanifest':'application/manifest+json'};
const server=http.createServer((q,r)=>{let p=path.join(root,decodeURIComponent(q.url.split('?')[0]));if(p.endsWith('/'))p+='index.html';if(!fs.existsSync(p)){r.writeHead(404);return r.end()}r.writeHead(200,{'content-type':mime[path.extname(p)]||'application/octet-stream'});r.end(fs.readFileSync(p))}).listen(0);
await new Promise(r=>server.on('listening',r));
const b=await chromium.launch(),sleep=(m)=>new Promise(r=>setTimeout(r,m));
const c=await b.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,serviceWorkers:'block'}),p=await c.newPage();
await p.addInitScript(()=>{if(!localStorage.getItem('citrus.state.v1'))localStorage.setItem('citrus.state.v1',JSON.stringify({me:{name:'Dr. Reem Mahgoub',id:'437326'}}))});
await p.goto(`http://localhost:${server.address().port}/index.html`);await sleep(600);
await p.click('nav.tabs button[data-view=rota]');await p.locator('#view-rota input[type=file]').first().setInputFiles(['main.xlsx','nurses.xlsx','fsed.xlsx','uv.xlsx'].map(data));await sleep(2500);
let fails=0;const bad=/\b(null|undefined|NaN|\[object Object\])\b/;
const scan=async(label)=>{const t=await p.locator('body').innerText();const m=t.match(new RegExp('.{0,60}'+bad.source+'.{0,40}'));console.log(label,m?'  ✗ '+m[0].replace(/\n/g,' | '):'  ✓ no stray null/undefined/NaN');if(m)fails++};
for(const seg of ['Calendar','People','Nurses','Home','Career']){await p.click('nav.tabs button[data-view=rota]');await p.click(`.work-seg button:has-text("${seg}")`);await sleep(300);await scan('work/'+seg);}
for(const v of ['today','plan','mind','social','apps']){await p.click(`nav.tabs button[data-view=${v}]`);await sleep(300);await scan(v);}
await p.click('nav.tabs button[data-view=rota]');await p.click('.work-seg button:has-text("Calendar")');await sleep(200);await p.click('#view-rota .cal .day:not(.pad) >> nth=8');await sleep(400);await scan('day sheet');
await p.keyboard.press('Escape');await sleep(200);await p.click('nav.tabs button[data-view=rota]');await p.click('.work-seg button:has-text("People")');await p.click('.view-mode button:has-text("Roster grid")');await sleep(300);await scan('roster grid');await p.click('.view-mode button:has-text("List")');await p.locator('.dir-item .name').first().click();await sleep(300);await scan('person sheet');await p.keyboard.press('Escape');
await b.close();server.close();console.log(fails?fails+' FAILED':'sweep ok');process.exit(fails?1:0);
