/* Reading a contractor two-week lookahead workbook into the model:
   parse() turns the workbook into rows per electrical package,
   match() links each row to an existing activity (or proposes a new one),
   apply() adds the lookahead to the saved model. Pure functions, no page access. */
(function (root) {
  'use strict';
  const DAY = 864e5;
  const D = (s) => { const [y, m, d] = s.split('-').map(Number); return Date.UTC(y, m - 1, d); };
  const iso = (t) => new Date(t).toISOString().slice(0, 10);
  function isoWeek(s) {
    const t = new Date(D(s)); const dn = (t.getUTCDay() + 6) % 7; t.setUTCDate(t.getUTCDate() - dn + 3);
    const j4 = new Date(Date.UTC(t.getUTCFullYear(), 0, 4));
    return 1 + Math.round(((t - j4) / DAY - 3 + ((j4.getUTCDay() + 6) % 7)) / 7);
  }
  const clean = (s) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
  const norm = (s) => clean(s).toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim();

  /* Which sheets are electrical scope, and how their sections map to the tracker's names. */
  const SHEETS = [
    { rx: /^eps\b/i, p: 'EPS' },
    { rx: /^gen(erator)?\b/i, p: 'GEN' },
    { rx: /^automation\b/i, p: 'AUTO' },
    { rx: /^fire\s*fighting\b/i, p: 'ROOMS' },
    { rx: /^ph\s*crane\s*u?4\b/i, p: 'CRANE4' },
  ];
  const SEC_MAP = {
    GEN: [[/refurbish/i, 'Refurbishment at Vantage'], [/site/i, 'Site Activities'], [/transport/i, 'Transportation']],
    EPS: [[/temporary/i, 'Temporary Power Supply'], [/site/i, 'Site Activities'], [/transport/i, 'Transportation']],
    AUTO: [[/site/i, 'Site Activities'], [/transport/i, 'Transportation']],
    CRANE4: [[/mobili/i, 'Mobilisation'], [/install/i, 'Site - Installation'], [/dismantl/i, 'Site - Dismantling'], [/refurbish|workshop/i, 'Workshop Refurbishment'], [/transport/i, 'Transportation']],
    ROOMS: [[/control\s*room/i, 'New Control Room'], [/charger/i, 'Battery Charger Room'], [/ac\s*\/?\s*dc|lv\s*room/i, 'AC/DC (LV) Room'], [/battery\s*room/i, 'Battery Room'], [/sst\s*2/i, 'SST2'], [/fwp|fire\s*water\s*pump/i, 'Fire Water Pump House']],
  };
  // inside the fire-water section only the pump's electrical work is in scope
  const FWP_ELEC = /\b(electric\w*|wiring|panel|termination|testing|commission\w*|t\s*&\s*c|cable|motor)\b/i;
  function mapSec(p, raw) {
    for (const [rx, name] of SEC_MAP[p] || []) if (rx.test(raw)) return name;
    if (p === 'ROOMS') return null;                              // other fire-fighting sections are out of scope
    return clean(raw).toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
  }

  /* sheets: [{name, hidden, rows: Map(row -> Map(col -> value))}] as CEND_XLSX.read gives. */
  function parse(sheets, fileName) {
    const out = { file: fileName || '', packages: [], skipped: [], cw: null, start: null, end: null, problems: [] };
    const weeks = new Map();
    for (const sh of sheets) {
      const conf = SHEETS.find((s) => s.rx.test(sh.name.trim()));
      if (!conf) { out.skipped.push({ sheet: sh.name, why: 'not electrical scope' }); continue; }
      // the date row: the row with the most date cells
      let dateRow = null, best = 0;
      for (const [r, cells] of sh.rows) { const n = [...cells.values()].filter((v) => v && v.date).length; if (n > best) { best = n; dateRow = r; } }
      if (!dateRow || best < 7) { out.skipped.push({ sheet: sh.name, why: 'no date row found' }); continue; }
      const dayCols = [...sh.rows.get(dateRow)].filter(([, v]) => v && v.date).sort((a, b) => a[0] - b[0]);
      const dates = dayCols.map(([, v]) => v.date);
      const start = dates[0], end = dates[dates.length - 1], cw = isoWeek(start);
      // description and remarks columns from the header rows above the dates
      let descCol = 2, remCol = null, numCol = 1;
      for (let r = 1; r <= dateRow; r++) {
        const cells = sh.rows.get(r); if (!cells) continue;
        for (const [c, v] of cells) {
          if (typeof v !== 'string') continue;
          if (/desc\w*ption|activity/i.test(v)) descCol = c;
          if (/remark/i.test(v)) remCol = c;
          if (/^no\.?$/i.test(v.trim())) numCol = c;
        }
      }
      if (remCol == null) remCol = dayCols[dayCols.length - 1][0] + 1;
      const firstDay = dayCols[0][0], lastDay = dayCols[dayCols.length - 1][0];
      const pkg = { sheet: sh.name, p: conf.p, hidden: sh.hidden, cw, start, end, rows: [] };
      // walk the rows: sections (whole numbers), sub-headings (numbered parents), activities
      const lines = [];
      for (const r of [...sh.rows.keys()].filter((r) => r > dateRow).sort((a, b) => a - b)) {
        const cells = sh.rows.get(r);
        const text = clean(cells.get(descCol));
        if (!text || /^x$/i.test(text)) continue;
        const rawNum = cells.get(numCol);
        const numStr = typeof rawNum === 'number' ? String(Math.round(rawNum * 1000) / 1000) : clean(rawNum);
        const isWhole = typeof rawNum === 'number' ? Math.abs(rawNum - Math.round(rawNum)) < 1e-6 : /^\d+$/.test(numStr);
        const days = [];
        for (const [c, v] of dayCols) { const m = cells.get(c); if (m != null && clean(typeof m === 'object' ? '' : m) !== '') days.push(v.date); }
        let rem = '';
        for (const [c, v] of cells) if (c > lastDay && c >= remCol && typeof v === 'string') rem += (rem ? '; ' : '') + clean(v);
        lines.push({ r, text, numStr, isNumStr: typeof rawNum === 'string', isWhole, days, rem });
      }
      let sec = null, secRaw = '';
      const stack = [];   // [{num, text, rem}]
      for (let i = 0; i < lines.length; i++) {
        const L = lines[i];
        if (L.isWhole && !L.days.length) { secRaw = L.text; sec = mapSec(conf.p, L.text); stack.length = 0; continue; }
        if (/^nil\.?$/i.test(L.text) || /^inspection according/i.test(L.text)) continue;
        while (stack.length && !L.numStr.startsWith(stack[stack.length - 1].num + '.')) stack.pop();
        const next = lines[i + 1];
        const isHeader = !L.days.length && L.numStr && next && next.numStr.startsWith(L.numStr + '.');
        if (isHeader) { stack.push({ num: L.numStr, text: L.text, rem: L.rem }); continue; }
        if (!sec) continue;
        if (conf.p === 'ROOMS' && sec === 'Fire Water Pump House' && !FWP_ELEC.test(L.text)) continue;
        const remarks = [];
        if (L.rem) remarks.push(L.rem);
        for (const hd of stack) if (hd.rem) remarks.push(`${hd.rem} (whole component)`);
        pkg.rows.push({ sec, secRaw, path: stack.map((s) => s.text), text: L.text, days: L.days, remarks, row: L.r });
      }
      weeks.set(sh.name, cw);
      out.packages.push(pkg);
    }
    // the lookahead week is the one most electrical sheets agree on; stale (e.g. hidden, older) sheets are left out
    const counts = new Map(); for (const p of out.packages) counts.set(p.cw, (counts.get(p.cw) || 0) + 1);
    const cw = [...counts].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0];
    if (!cw) { out.problems.push('No electrical sheet with a two-week date row was found in this workbook.'); return out; }
    out.cw = cw[0];
    for (const p of out.packages.filter((x) => x.cw !== out.cw)) out.skipped.push({ sheet: p.sheet, why: `dates are for CW${p.cw}, not CW${out.cw}${p.hidden ? ' (hidden sheet)' : ''}` });
    out.packages = out.packages.filter((x) => x.cw === out.cw);
    const ref = out.packages[0]; out.start = ref.start; out.end = ref.end;
    return out;
  }

  // ---------------------------------------------------------------- matching
  function lev(a, b) {
    if (a === b) return 0; const m = a.length, n = b.length; if (!m || !n) return m || n;
    let prev = Array.from({ length: n + 1 }, (_, j) => j);
    for (let i = 1; i <= m; i++) { const cur = [i]; for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); prev = cur; }
    return prev[n];
  }
  const sim = (a, b) => { const x = norm(a), y = norm(b); if (!x || !y) return 0; return 1 - lev(x, y) / Math.max(x.length, y.length); };
  const subCode = (s) => { const m = /\bR\.?\s*0?(\d)\b/i.exec(s || ''); return m ? 'R0' + m[1] : null; };
  const PART_WORDS = ['body', 'fan', 'assembly', 'motor', 'gearbox'];
  function partOf(path) { for (const t of [...path].reverse()) { const w = PART_WORDS.find((k) => new RegExp(`\\b${k}`, 'i').test(t)); if (w) return w; } return null; }
  /* Which existing sub-heading a row's headings point to (e.g. "R05 - Lower bracket Part" -> "R05 Lower Bracket"),
     and which activities it may be matched against. */
  function subFor(p, path, acts) {
    if (!path.length) return { sub: '', group: () => true };
    const code = path.map(subCode).find(Boolean);
    const inPkg = acts.filter((a) => a.p === p && a.sub);
    const subs = [...new Set(inPkg.map((a) => a.sub))];
    const last = clean(path[path.length - 1]);
    if (code) {
      const cands = subs.filter((s) => subCode(s) === code);
      const part = partOf(path.slice(1));            // a nested heading such as "Rotor Body"
      let pick = null;
      if (part) pick = cands.find((s) => new RegExp(`\\b${part}`, 'i').test(s)) || null;
      else if (cands.length === 1) pick = cands[0];
      if (pick && part) return { sub: pick, group: (a) => a.sub === pick };
      if (pick) return { sub: pick, group: (a) => subCode(a.sub) === code };
      if (cands.length && !part) {                   // rows straight under a split heading: the busiest of its subs
        const n = (s) => inPkg.filter((a) => a.sub === s).length;
        return { sub: [...cands].sort((x, y) => n(y) - n(x))[0], group: (a) => subCode(a.sub) === code };
      }
      const base = clean(path[0]).replace(/^R\.?\s*0?(\d)\s*-?\s*/i, 'R0$1 ').replace(/\s+(and\s+)?parts?$/i, '');
      return { sub: path.length > 1 ? `${base} - ${last}` : base, group: (a) => subCode(a.sub) === code };
    }
    const exact = subs.find((s) => norm(s) === norm(last));
    return { sub: exact || last, group: (a) => !a.sub || a.sub === exact };
  }

  /* Link each parsed row to an existing activity. Returns a plan the review screen edits. */
  function match(model, parsed) {
    const acts = model.acts;
    const used = new Set();
    const plan = { cw: parsed.cw, start: parsed.start, end: parsed.end, file: parsed.file, rows: [], replaces: model.meta.lookaheads.some((l) => l.cw === parsed.cw) };
    for (const pkg of parsed.packages) for (const row of pkg.rows) {
      const { sub, group } = subFor(pkg.p, row.path, acts);
      const pool = acts.filter((a) => a.p === pkg.p && (!row.sec || a.sec === row.sec) && group(a));
      const names = (a) => [a.n, ...(a.al || [])];
      let hit = null, how = null, score = 0;
      // 1. same wording (ignoring case, spaces and punctuation)
      const exact = pool.filter((a) => !used.has(a.id) && names(a).some((t) => norm(t) === norm(row.text)));
      if (exact.length) { hit = exact.sort((x, y) => (y.o.length ? y.o[y.o.length - 1][0] : 0) - (x.o.length ? x.o[x.o.length - 1][0] : 0))[0]; how = 'same wording'; score = 1; }
      // 2. near-identical wording (typos)
      if (!hit) {
        let best = null, bs = 0;
        for (const a of pool) if (!used.has(a.id)) for (const t of names(a)) { const s = sim(t, row.text); if (s > bs) { bs = s; best = a; } }
        if (best && bs >= 0.88) { hit = best; how = 'typo'; score = bs; }
      }
      if (hit) used.add(hit.id);
      plan.rows.push({ p: pkg.p, sheet: pkg.sheet, sec: row.sec, sub, path: row.path, text: row.text, days: row.days, remarks: row.remarks, row: row.row,
        match: hit ? hit.id : null, how, score, suggest: null });
    }
    // activities that were in the previous lookahead and are missing now (for the review screen, and for AI suggestions)
    return plan;
  }

  /* Candidates the AI may link an unmatched row to: same package, not already linked, seen recently. */
  function candidatesFor(model, plan, row, limit = 40) {
    const used = new Set(plan.rows.filter((r) => r.match != null).map((r) => r.match));
    const lastCw = (a) => (a.o.length ? a.o[a.o.length - 1][0] : 0);
    return model.acts.filter((a) => a.p === row.p && !used.has(a.id) && (!row.sec || a.sec === row.sec))
      .sort((x, y) => lastCw(y) - lastCw(x)).slice(0, limit);
  }

  /* Add the reviewed lookahead to the model (in place). Re-uploading the same week replaces it. */
  function apply(model, plan, opts = {}) {
    const md = (s) => s.slice(5);
    const cw = plan.cw;
    model.meta.lookaheads = model.meta.lookaheads.filter((l) => l.cw !== cw).concat([{ cw, file: plan.file, start: plan.start, end: plan.end }]).sort((a, b) => a.cw - b.cw);
    for (const a of model.acts) a.o = a.o.filter((o) => o[0] !== cw);
    let nextId = Math.max(0, ...model.acts.map((a) => a.id)) + 1;
    const rand = opts.rand || (() => Math.random().toString(16).slice(2, 14).padEnd(12, '0'));
    const byId = new Map(model.acts.map((a) => [a.id, a]));
    let added = 0, linked = 0;
    for (const r of plan.rows) {
      if (r.skip) continue;
      const obs = [cw, r.days.map(md).sort(), r.remarks.slice()];
      let a = r.match != null ? byId.get(r.match) : null;
      if (a) {
        if (norm(a.n) !== norm(r.text) && !(a.al || []).some((t) => norm(t) === norm(r.text))) a.al = [...(a.al || []), r.text];
        a.o.push(obs); a.o.sort((x, y) => x[0] - y[0]); linked++;
      } else {
        a = { id: nextId++, k: 'k' + rand(), p: r.p, sec: r.sec, sub: r.sub || '', n: r.text, al: [], o: [obs] };
        model.acts.push(a); byId.set(a.id, a); added++;
      }
    }
    // activities that came back with new dates after being completed lose the old completion mark
    for (const a of model.acts) if (a.done && a.o.some((o) => o[0] > (a.done.cw || 0) && o[1].length)) delete a.done;
    model.remark_cats = { ...(model.remark_cats || {}), ...(plan.remark_cats || {}) };
    return { added, linked };
  }

  root.CEND_LOOK = { parse, match, apply, candidatesFor, norm, sim, isoWeek, SHEETS };
})(typeof window !== 'undefined' ? window : globalThis);
