/* Lookahead model: works out each activity's dates, slip, rollovers and status from how it
   appears across the weekly two-week lookaheads, plus constraints and plan reliability (PPC).
   The same rules as the Chenderoh Electrical Progress tracker ("How it's worked out"). */
(function (root) {
  'use strict';
  const DAY = 864e5;
  const D = (s) => { const [y, m, d] = s.split('-').map(Number); return Date.UTC(y, m - 1, d); };
  const iso = (t) => new Date(t).toISOString().slice(0, 10);
  const add = (s, n) => iso(D(s) + n * DAY);
  const diff = (a, b) => Math.round((D(a) - D(b)) / DAY);

  // remarks that confirm a finish, and the date they give (if any)
  const DONE_RX = /\b(completed?|transported on|handed over|delivered on)\b/i;
  const NOT_DONE_RX = /\b(subject to|to be confirm|after .* completed|completion to be|pending)\b/i;
  function doneFromRemark(t, year) {
    if (!DONE_RX.test(t) || NOT_DONE_RX.test(t)) return null;
    let m = /(\d{1,2})[-\s.\/]([A-Za-z]{3})[-\s.\/](\d{2,4})/.exec(t);
    const MON = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
    if (m && MON[m[2].toLowerCase()]) {
      const y = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
      return { date: `${y}-${String(MON[m[2].toLowerCase()]).padStart(2, '0')}-${m[1].padStart(2, '0')}` };
    }
    m = /(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{4})/.exec(t);
    if (m) return { date: `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` };
    return { date: null };
  }

  // constraint categories, first match wins
  const CATS = [
    ['Outage / LOTO', /\b(outage|loto|isolation permit|shutdown)\b/i],
    ['Material', /\b(material|spare|parts? (not|pending)|awaiting delivery|waiting .*deliver)/i],
    ['Crane & Lifting', /\b(crane|lifting|trailer|man ?carrier|forklift|rigging)\b/i],
    ['Manpower', /\b(manpower|mobili[sz]ation|foreman|workers?|technician)\b/i],
    ['Approval', /\b(approval|approve|permit to work|ptw)\b/i],
    ['Logistics', /\b(pick ?up|shipment|shipping|transport to)\b/i],
    ['Dependency', /\bsubject to (?!completion)|\bby TNB\b|\bwaiting for\b/i],
  ];
  function categorise(t) {
    for (const [cat, rx] of CATS) if (rx.test(t)) return cat;
    return null;
  }

  /* model = { meta: {lookaheads:[{cw,start,end,file}]}, pk, acts: [{id,k,p,sec,sub,n,al,o:[[cw,[mm-dd],[remarks]]], done?}] }
     Returns a new object with derived fields on every activity, plus cons and ppc. */
  function derive(model, opts = {}) {
    const looks = [...model.meta.lookaheads].sort((a, b) => a.cw - b.cw);
    const latest = looks[looks.length - 1];
    const LATEST = latest.cw, LSTART = latest.start;
    const year = Number(LSTART.slice(0, 4));
    const lookByCw = new Map(looks.map((l) => [l.cw, l]));
    const full = (cw, md) => {           // mm-dd inside a lookahead -> yyyy-mm-dd (handles a Dec/Jan crossing)
      const l = lookByCw.get(cw); const y0 = Number((l ? l.start : LSTART).slice(0, 4));
      let s = `${y0}-${md}`; if (l && D(s) < D(l.start) - 60 * DAY) s = `${y0 + 1}-${md}`; return s;
    };
    const RC = model.remark_cats || {};      // categories confirmed on upload (AI-suggested or edited) win over the patterns
    const catOf = (t) => (Object.prototype.hasOwnProperty.call(RC, t) ? RC[t] : categorise(t));
    const acts = model.acts.map((a0) => {
      const a = { ...a0, o: a0.o.map((o) => [o[0], [...o[1]], [...o[2]]]).sort((x, y) => x[0] - y[0]) };
      const obs = a.o;
      const dated = obs.filter((o) => o[1].length);
      a.f = obs.length ? obs[0][0] : LATEST; a.l = obs.length ? obs[obs.length - 1][0] : LATEST;
      a.ns = dated.length;
      if (dated.length) {
        const first = dated[0][1].map((m) => full(dated[0][0], m)).sort();
        const last = dated[dated.length - 1][1].map((m) => full(dated[dated.length - 1][0], m)).sort();
        a.bs = first[0]; a.bf = first[first.length - 1]; a.ls = last[0]; a.lf = last[last.length - 1];
        a.sl = diff(a.lf, a.bf);
        // rollover: came back with new dates after all previously planned dates had passed
        let r = 0, maxPrev = null;
        for (const o of dated) {
          const ds = o[1].map((m) => full(o[0], m)).sort();
          const l = lookByCw.get(o[0]);
          if (maxPrev && l && D(maxPrev) < D(l.start)) r++;
          if (!maxPrev || D(ds[ds.length - 1]) > D(maxPrev)) maxPrev = ds[ds.length - 1];
        }
        a.r = r;
      } else { a.bs = a.bf = a.ls = a.lf = null; a.sl = 0; a.r = 0; }
      // completion from remarks (latest such remark wins)
      let comp = null;
      for (const o of obs) for (const t of o[2]) { const c = doneFromRemark(t, year); if (c) comp = { ...c, cw: o[0], text: t }; }
      const cur = obs.find((o) => o[0] === LATEST);
      const inLatestDated = !!(cur && cur[1].length);
      const curCons = cur ? cur[2].filter((t) => catOf(t)) : [];
      let st, d = null;
      if (a.done && a.done.date && !(inLatestDated && a.done.cw && a.done.cw < LATEST)) { st = 'Completed'; d = a.done.date; }
      else if (comp && !inLatestDated) { st = 'Completed'; d = comp.date || a.lf; }
      else if (inLatestDated) st = (a.sl >= 7 || a.r >= 1) ? 'Slipping' : 'Active';
      else if (cur) {                                   // listed in the latest lookahead without dates
        if (curCons.length) st = 'On hold';
        else if (!dated.length) st = 'Pending';
        else { st = 'Done (inferred)'; d = a.lf; }
      } else if (!dated.length) st = 'Not scheduled';
      else if (a.lf && D(a.lf) >= D(LSTART) && a.l === LATEST - 1) st = 'Not in latest plan';
      else { st = 'Done (inferred)'; d = a.lf; }
      a.st = st; a.d = d;
      a.nw = a.f === LATEST && inLatestDated;
      return a;
    });
    // constraints: one per activity and category; open while the remark is in the latest lookahead
    const cons = [];
    for (const a of acts) {
      const byCat = new Map();
      for (const o of a.o) for (const t of o[2]) {
        const cat = catOf(t); if (!cat) continue;
        if (!byCat.has(cat)) byCat.set(cat, { act: a.id, pkg: a.p, cat, texts: [], first: o[0], last: o[0] });
        const c = byCat.get(cat); if (!c.texts.includes(t)) c.texts.push(t); c.last = Math.max(c.last, o[0]); c.first = Math.min(c.first, o[0]);
      }
      for (const c of byCat.values()) { c.open = c.last === LATEST; cons.push(c); }
      a.oc = [...byCat.keys()];
    }
    // plan reliability: of the activities a lookahead planned to finish in its first week,
    // the share that did not come back with dates in the next lookahead
    const pkgs = Object.keys(model.pk);
    const ppc = [];
    for (let i = 0; i < looks.length - 1; i++) {
      const L = looks[i], N = looks[i + 1];
      const wkEnd = add(L.start, 6);
      const byp = Object.fromEntries(pkgs.map((p) => [p, [0, 0]]));
      let planned = 0, kept = 0; const slipped = [];
      for (const a of acts) {
        const o = a.o.find((x) => x[0] === L.cw); if (!o || !o[1].length) continue;
        const fin = o[1].map((m) => full(L.cw, m)).sort().pop();
        if (D(fin) > D(wkEnd)) continue;
        planned++; if (byp[a.p]) byp[a.p][0]++;
        const n = a.o.find((x) => x[0] === N.cw);
        if (n && n[1].length) slipped.push(a.id); else { kept++; if (byp[a.p]) byp[a.p][1]++; }
      }
      ppc.push({ w: L.cw, next: N.cw, planned, kept, pct: planned ? Math.round(100 * kept / planned) : null, slipped, byp });
    }
    return { meta: { ...model.meta, latest: LATEST, latest_start: latest.start, latest_end: latest.end }, pk: model.pk, acts, cons, ppc, remark_cats: RC };
  }

  root.CEND_MODEL = { derive, categorise, doneFromRemark, CATS };
})(typeof window !== 'undefined' ? window : globalThis);
