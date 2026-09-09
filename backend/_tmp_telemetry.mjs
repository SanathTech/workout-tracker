import db from './src/db/index.js';
const q = async (sql, p) => (await db.query(sql, p)).rows;
const rows = await q(`SELECT session_id sid, extract(epoch FROM ts)*1000 ms,
  to_char(ts AT TIME ZONE 'Australia/Melbourne','YYYY-MM-DD HH24:MI:SS') lt,
  extract(hour FROM ts AT TIME ZONE 'Australia/Melbourne')::int hr,
  extract(dow FROM ts AT TIME ZONE 'Australia/Melbourne')::int dow,
  kind, name, route, detail FROM app_events ORDER BY ts, id`);
await db.pool.end();
for (const r of rows) r.ms = +r.ms;

const QA = [['2026-09-08 08:10','2026-09-08 08:20'],['2026-09-08 08:55','2026-09-08 09:20'],['2026-09-08 13:30','2026-09-08 14:15'],
 ['2026-09-08 17:20','2026-09-08 17:35'],['2026-09-08 22:13','2026-09-08 22:25'],['2026-09-09 09:20','2026-09-09 09:25'],['2026-09-09 12:45','2026-09-09 12:50']];
const inQA = lt => QA.some(([s,e]) => lt >= s+':00' && lt < e+':00');

// ---- sessions
const bySid = new Map();
for (const r of rows) { if (!bySid.has(r.sid)) bySid.set(r.sid, []); bySid.get(r.sid).push(r); }
const sess = [];
for (const [sid, ev] of bySid) {
  const t0 = ev[0].ms, tN = ev[ev.length-1].ms;
  const hasAction = ev.some(e => e.kind==='save'||e.kind==='tap');
  const hasCheckin = ev.some(e => e.name==='checkin-saved');
  const maxLeave = Math.max(0, ...ev.filter(e=>e.name==='leave').map(e=>+(e.detail?.dwell_ms||0)));
  const span = tN - t0;
  const passive = !hasAction && maxLeave < 20000 && span < 20000;
  const off = span;
  const sig = passive && ((off>=1000 && off<=10000 && Math.abs(off - Math.round(off/1000)*1000) <= 5) || Math.abs(off-3600)<=100 || Math.abs(off-2500)<=100);
  sess.push({ sid, ev, start: ev[0].lt, minute: ev[0].lt.slice(0,16), t0, tN, hasAction, hasCheckin, maxLeave, span, passive, sig, qaStart: inQA(ev[0].lt) });
}
const perMinute = {}; for (const s of sess) if (s.passive) perMinute[s.minute] = (perMinute[s.minute]||0)+1;
for (const s of sess) {
  s.burst = s.passive && perMinute[s.minute] >= 3;
  let reason = null;
  if (s.qaStart && !s.hasCheckin) reason = 'starts in QA window';
  else if (s.passive && s.sig) reason = 'fixed-wait signature @' + s.span + 'ms';
  else if (s.burst) reason = 'burst of passive sessions in same minute';
  s.human = !reason; s.reason = reason;
}
console.log('SESSIONS total', sess.length, 'human', sess.filter(s=>s.human).length, 'qa', sess.filter(s=>!s.human).length);
console.log('in-window sessions with checkin-saved:', sess.filter(s=>s.qaStart && s.hasCheckin).map(s=>s.sid+' '+s.start).join(', '));
console.log('\nEXCLUDED outside known QA windows:');
for (const s of sess.filter(s=>!s.human && !s.qaStart)) console.log(' ', s.start, s.sid, s.reason, [...new Set(s.ev.filter(e=>e.name==='enter').map(e=>e.route))].join('>'));
console.log('\nHUMAN sessions after 09-08 (kept):');
for (const s of sess.filter(s=>s.human && s.start>='2026-09-08')) console.log(' ', s.start, s.sid, 'span', Math.round(s.span/1000)+'s', 'action', s.hasAction, 'maxLeave', Math.round(s.maxLeave/1000)+'s', s.ev.filter(e=>e.name==='enter').map(e=>e.route).join('>'));
console.log('\nHUMAN sessions before 09-08 that are passive (<20s, no action):');
for (const s of sess.filter(s=>s.human && s.start<'2026-09-08' && s.passive)) console.log(' ', s.start, s.sid, 'span', s.span+'ms', s.ev.map(e=>e.name+':'+e.route).join(' '));

// ---- human event stream -> visits (30-min gap)
const H = sess.filter(s=>s.human);
const hev = H.flatMap(s=>s.ev.map(e=>({...e}))).sort((a,b)=>a.ms-b.ms);
let visits = []; let cur = null;
for (const e of hev) {
  if (!cur || e.ms - cur.last > 30*60*1000) { cur = { start: e.lt, hr: e.hr, dow: e.dow, first: e.ms, last: e.ms, ev: [] }; visits.push(cur); }
  cur.ev.push(e); cur.last = e.ms;
}
for (const v of visits) v.id = visits.indexOf(v);
console.log('\nVISITS', visits.length, 'over days', new Set(visits.map(v=>v.start.slice(0,10))).size);

// ---- route entries with foreground dwell (per session)
const entries = [];
for (const s of H) {
  let curE = null, visible = true, fgStart = null, lastClosed = null;
  const close = (ms) => { if (!curE) return; if (visible && fgStart!=null) curE.fg += ms - fgStart; curE.end = ms; curE.raw = curE.raw ?? (ms - curE.t0); entries.push(curE); lastClosed = curE; curE = null; };
  for (const e of s.ev) {
    if (!visible && (e.kind==='nav' || e.kind==='save' || e.kind==='tap')) { visible = true; fgStart = e.ms; }
    if (e.kind==='nav' && e.name==='enter') {
      if (curE && curE.route===e.route && e.ms - curE.t0 < 300) continue; // StrictMode double-mount
      close(e.ms);
      curE = { route: e.route, sid: s.sid, t0: e.ms, lt: e.lt, hr: e.hr, dow: e.dow, fg: 0, raw: null, terminal: true, from: e.detail?.from ?? null };
      fgStart = visible ? e.ms : null;
    } else if (e.kind==='nav' && e.name==='leave') {
      const d = +(e.detail?.dwell_ms||0);
      if (curE && curE.route===e.route) { curE.raw = d; curE.terminal = false; close(e.ms); }
      else if (lastClosed && lastClosed.route===e.route && e.ms - lastClosed.end < 1000) { lastClosed.raw = d; lastClosed.terminal = false; }
    } else if (e.name==='hidden' || e.name==='pagehide') {
      if (visible) { if (curE && fgStart!=null) curE.fg += e.ms - fgStart; visible = false; fgStart = null; }
    } else if (e.name==='visible') {
      if (!visible) { visible = true; fgStart = e.ms; }
    }
  }
  close(s.ev[s.ev.length-1].ms);
}
// attach visit id
for (const en of entries) en.visit = visits.find(v => en.t0 >= v.first && en.t0 <= v.last)?.id;
const norm = r => r==='/health' ? '/trends' : r;   // rename 09-09
const med = a => { if (!a.length) return null; const b=[...a].sort((x,y)=>x-y); const m=b.length>>1; return b.length%2? b[m] : (b[m-1]+b[m])/2; };
const routeStats = {};
for (const en of entries) {
  if (en.route==='/') continue;
  const k = norm(en.route); const rs = routeStats[k] ??= { fg: [], raw: [], term: 0 };
  rs.fg.push(en.fg); rs.raw.push(en.raw); if (en.terminal) rs.term++;
}
console.log('\nROUTE DWELL (human; fg = foreground-corrected, raw = leave dwell_ms or span)');
const rt = Object.entries(routeStats).map(([route, rs]) => ({ route, visits: rs.fg.length, fg_median_s: +(med(rs.fg)/1000).toFixed(1), fg_total_min: +(rs.fg.reduce((a,b)=>a+b,0)/60000).toFixed(1), raw_median_s: +(med(rs.raw)/1000).toFixed(1), raw_total_min: +(rs.raw.reduce((a,b)=>a+b,0)/60000).toFixed(1), bounce_lt2s: rs.fg.filter(x=>x<2000).length, lt5s: rs.fg.filter(x=>x<5000).length, ge20s: rs.fg.filter(x=>x>=20000).length, ge60s: rs.fg.filter(x=>x>=60000).length, terminal: rs.term })).sort((a,b)=>b.visits-a.visits);
console.table(rt);
const allE = entries.filter(e=>e.route!=='/');
console.log('corridor/destination entries: <5s', allE.filter(e=>e.fg<5000).length, '5-20s', allE.filter(e=>e.fg>=5000&&e.fg<20000).length, '>=20s', allE.filter(e=>e.fg>=20000).length, 'total', allE.length);
console.log('root / entries', entries.filter(e=>e.route==='/').length, 'median raw ms', med(entries.filter(e=>e.route==='/').map(e=>e.raw)));

// per-route dwell before/after nav change (09-05) 
const era = en => en.lt < '2026-09-05' ? 'A(pre 09-05)' : en.lt < '2026-09-08 17:00' ? 'B(09-05..08)' : 'C(09-08 17:00+)';
const es = {};
for (const en of allE) { const k = era(en)+' '+norm(en.route); (es[k] ??= []).push(en.fg); }
console.log('\nROUTE fg median by era');
console.table(Object.entries(es).map(([k,a])=>({ k, n:a.length, med_s:+(med(a)/1000).toFixed(1), tot_min:+(a.reduce((x,y)=>x+y,0)/60000).toFixed(1) })).sort((a,b)=>a.k.localeCompare(b.k)));

// ---- opens per day / hour
const byDay = {}; for (const v of visits) byDay[v.start.slice(0,10)] = (byDay[v.start.slice(0,10)]||0)+1;
const sByDay = {}; for (const s of H) sByDay[s.start.slice(0,10)] = (sByDay[s.start.slice(0,10)]||0)+1;
console.log('\nOPENS per day (visits / sessions):'); for (const d of Object.keys(sByDay).sort()) console.log(' ', d, byDay[d]||0, '/', sByDay[d]);
const byHr = Array(24).fill(0); for (const v of visits) byHr[v.hr]++;
const sByHr = Array(24).fill(0); for (const s of H) sByHr[s.ev[0].hr]++;
console.log('OPENS by hour (visits):', byHr.map((n,h)=>n?`${h}:${n}`:null).filter(Boolean).join(' '));
console.log('OPENS by hour (sessions):', sByHr.map((n,h)=>n?`${h}:${n}`:null).filter(Boolean).join(' '));
const dows=['Sun','Mon','Tue','Wed','Thu','Fri','Sat']; const byDow={}; for (const v of visits) byDow[dows[v.dow]]=(byDow[dows[v.dow]]||0)+1; console.log('visits by weekday', byDow);

// ---- journeys per visit
const journeys = [];
for (const v of visits) {
  const ens = allE.filter(e=>e.visit===v.id).sort((a,b)=>a.t0-b.t0);
  const steps = [];
  for (const en of ens) { const r = norm(en.route); if (steps.length && steps[steps.length-1].r===r) steps[steps.length-1].fg += en.fg; else steps.push({ r, fg: en.fg }); }
  const saves = v.ev.filter(e=>e.kind==='save').length, taps = v.ev.filter(e=>e.kind==='tap').length;
  const ci = v.ev.filter(e=>e.name==='checkin-saved').length, wl = v.ev.filter(e=>e.name==='saved' && e.route==='/session/:id').length;
  journeys.push({ v, steps, saves, taps, ci, wl, dur_min: +((v.last-v.first)/60000).toFixed(1), fg_min: +(ens.reduce((a,e)=>a+e.fg,0)/60000).toFixed(1) });
}
console.log('\nJOURNEYS (each visit):');
for (const j of journeys) console.log(' ', j.v.start, dows[j.v.dow], 'dur', j.dur_min+'m', 'fg', j.fg_min+'m', 'ci', j.ci, 'wl', j.wl, 'taps', j.taps, '|', j.steps.map(s=>`${s.r}(${(s.fg/1000).toFixed(0)}s)`).join('>'));
const pathCount = {}; for (const j of journeys) { const p = j.steps.map(s=>s.r).join('>'); pathCount[p]=(pathCount[p]||0)+1; }
console.log('\nPATH frequency:'); console.table(Object.entries(pathCount).sort((a,b)=>b[1]-a[1]).map(([p,n])=>({p,n})));
const bigram = {}; for (const j of journeys) for (let i=0;i+1<j.steps.length;i++) { const k=j.steps[i].r+'>'+j.steps[i+1].r; (bigram[k] ??= []).push(j.steps[i].fg); }
console.log('TRANSITIONS (count, median dwell on source):'); console.table(Object.entries(bigram).map(([k,a])=>({k,n:a.length,med_s:+(med(a)/1000).toFixed(1)})).sort((a,b)=>b.n-a.n).slice(0,20));
const first = {}; for (const j of journeys) if (j.steps.length) first[j.steps[0].r]=(first[j.steps[0].r]||0)+1; console.log('FIRST route of visit', first);
const lastR = {}; for (const j of journeys) if (j.steps.length) lastR[j.steps[j.steps.length-1].r]=(lastR[j.steps[j.steps.length-1].r]||0)+1; console.log('LAST route of visit', lastR);

// ---- time-of-day windows
const win = h => h>=5&&h<9?'early 5-9':h>=11&&h<14?'midday 11-14':h>=15&&h<18?'afternoon 15-18':h>=19&&h<21?'evening 19-21':h>=22?'late 22-24':`other(${h>=9&&h<11?'9-11':h>=14&&h<15?'14-15':h>=18&&h<19?'18-19':h>=21&&h<22?'21-22':'0-5'})`;
const W = {};
for (const j of journeys) {
  const w = W[win(j.v.hr)] ??= { visits:0, ci:0, wl:0, taps:0, routes:{}, durs:[], fgs:[], paths:[] };
  w.visits++; w.ci+=j.ci; w.wl+=j.wl; w.taps+=j.taps; w.durs.push(j.dur_min); w.fgs.push(j.fg_min);
  for (const s of j.steps) w.routes[s.r]=(w.routes[s.r]||0)+s.fg;
  w.paths.push(j.steps.map(s=>s.r.replace('/session/:id','/session')).join('>'));
}
console.log('\nTIME-OF-DAY WINDOWS:');
for (const [k,w] of Object.entries(W)) console.log(' ', k, 'visits', w.visits, 'med dur', med(w.durs)+'m', 'med fg', med(w.fgs)+'m', 'checkin saves', w.ci, 'set saves', w.wl, 'taps', w.taps, '| fg min by route', Object.entries(w.routes).sort((a,b)=>b[1]-a[1]).map(([r,ms])=>`${r}:${(ms/60000).toFixed(1)}`).join(' '), '| paths', JSON.stringify(w.paths));

// ---- saves & taps by hour / weekday
const cnt = (arr, key) => arr.reduce((m,e)=>{const k=key(e); m[k]=(m[k]||0)+1; return m;},{});
const ci = hev.filter(e=>e.name==='checkin-saved');
console.log('\nCHECKIN saves by hour', cnt(ci, e=>e.hr), 'by dow', cnt(ci, e=>dows[e.dow]), 'fields', cnt(ci, e=>(e.detail?.fields||[]).join('+')), 'routes', cnt(ci,e=>e.route));
console.log('checkin visits (distinct visit) by hour', cnt(journeys.filter(j=>j.ci>0), j=>j.v.hr), 'by dow', cnt(journeys.filter(j=>j.ci>0), j=>dows[j.v.dow]), 'dates', journeys.filter(j=>j.ci>0).map(j=>j.v.start.slice(5,16)).join(', '));
const wl = hev.filter(e=>e.name==='saved' && e.route==='/session/:id');
console.log('WORKOUT set saves by hour', cnt(wl, e=>e.hr), 'by dow', cnt(wl, e=>dows[e.dow]));
console.log('workout visits (visits with set saves) by hour', cnt(journeys.filter(j=>j.wl>0), j=>j.v.hr), 'by dow', cnt(journeys.filter(j=>j.wl>0), j=>dows[j.v.dow]), 'dates', journeys.filter(j=>j.wl>0).map(j=>`${j.v.start.slice(5,16)} ${dows[j.v.dow]} sets=${j.wl} dur=${j.dur_min}m fg=${j.fg_min}m`).join('; '));
const otherSaves = hev.filter(e=>e.kind==='save' && !['checkin-saved','saved','saving'].includes(e.name) || (e.name==='saved' && e.route!=='/session/:id'));
console.log('OTHER saves', otherSaves.map(e=>`${e.lt.slice(5,16)} ${e.name} ${e.route} ${JSON.stringify(e.detail)}`).join('; '));
const taps = hev.filter(e=>e.kind==='tap');
console.log('TAPS by name', cnt(taps, e=>e.name), 'by hour', cnt(taps, e=>e.hr), 'by route', cnt(taps, e=>e.route));
console.log('finish taps', taps.filter(e=>e.name==='finish').map(e=>e.lt.slice(5,16)).join(', '));
console.log('errors', hev.filter(e=>e.kind==='error').length);
// workout session: set-save cadence
for (const j of journeys.filter(j=>j.wl>0)) { const sv = j.v.ev.filter(e=>e.name==='saved'&&e.route==='/session/:id'); const gaps=[]; for(let i=1;i<sv.length;i++) gaps.push((sv[i].ms-sv[i-1].ms)/1000); console.log('  workout', j.v.start, 'first save', sv[0].lt.slice(11,16), 'last', sv[sv.length-1].lt.slice(11,16), 'median gap s', med(gaps)?.toFixed(0), 'hidden/visible cycles', j.v.ev.filter(e=>e.name==='visible').length); }

// ---- extra checks
console.log('\nCHECKIN route by date', Object.entries(ci.reduce((m,e)=>{const k=e.lt.slice(5,10)+' '+e.route; m[k]=(m[k]||0)+1; return m;},{})).sort().map(([k,n])=>k+'='+n).join(', '));
console.log('CHECKIN fields by hour', Object.entries(ci.reduce((m,e)=>{const k=e.hr; (m[k] ??= {}); for (const f of (e.detail?.fields||[])) m[k][f]=(m[k][f]||0)+1; return m;},{})).map(([h,o])=>h+':'+JSON.stringify(o)).join(' | '));
for (const j of journeys.filter(j=>j.wl>0)) {
  let vis = true, inHidden = 0, inVis = 0; const gaps=[]; let hiddenAt=null;
  for (const e of j.v.ev) {
    if (e.name==='hidden'||e.name==='pagehide') { vis=false; hiddenAt=e.ms; }
    else if (e.name==='visible') { vis=true; if (hiddenAt) gaps.push((e.ms-hiddenAt)/1000); hiddenAt=null; }
    else if (e.name==='saved' && e.route==='/session/:id') { if (vis) inVis++; else inHidden++; }
  }
  const fin = j.v.ev.find(e=>e.name==='finish'); const ent = j.v.ev.find(e=>e.name==='enter'&&e.route==='/session/:id');
  console.log('  workout', j.v.start, 'saves while lifecycle=visible', inVis, 'while hidden', inHidden, 'median hidden->visible gap s', med(gaps)?.toFixed(0), 'enter->finish min', fin&&ent ? ((fin.ms-ent.ms)/60000).toFixed(0) : '?');
}
