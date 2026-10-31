/* Upload a contractor two-week lookahead (.xlsx): read it in the browser, link its rows to the tracked
   activities, ask Gemini about the rows and remarks the rules can't place, then show everything for review.
   Nothing is saved until "Save" on the review screen. */
(function () {
  'use strict';
  const CATS = ['Outage / LOTO', 'Material', 'Crane & Lifting', 'Manpower', 'Approval', 'Logistics', 'Dependency'];
  let CTX = null;     // the upload being reviewed

  async function open() {
    const UI = window.CEND_UI, S = window.CEND_STORE;
    if (!UI || !UI.state()) return;
    if (!S.canEdit()) { UI.openSettings('Uploading a lookahead saves it for everyone, so editing has to be on first. Add the GitHub access token below (one time).'); return; }
    if (!UI.name()) { const ok = await UI.askName(); if (!ok) return; }
    pickScreen();
  }

  // ---------------------------------------------------------------- step 1: choose the file
  function pickScreen(problem) {
    const UI = window.CEND_UI, { h, icon } = UI;
    CTX = null;
    const input = h('input', { type: 'file', accept: '.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', class: 'cend-file' });
    const drop = h('label', { class: 'cend-drop' }, input,
      h('span', 'cend-drop-ic', icon('up')),
      h('b', null, 'Choose the lookahead workbook'),
      h('span', 'cend-muted', 'or drop the .xlsx file here'));
    const msg = h('p', problem ? 'cend-alert' : 'cend-msg', { role: 'status' }, problem || '');
    const sec = window.CEND_STORE.secrets() || {};
    const panel = UI.panel({
      type: 'upload', wide: true, crumb: 'Upload lookahead', title: 'Upload a two-week lookahead',
      status: [h('p', 'cend-muted', 'The contractor’s workbook as it is. Nothing is saved until you have reviewed it.')],
      body: [drop, msg,
        h('div', 'cend-sec', h('h3', null, 'What is read'),
          h('ul', 'cend-ul',
            h('li', null, h('b', null, 'EPS, GEN, AUTOMATION, PH Crane U4'), ' sheets, and the electrical rooms and fire-water pump electrical work on ', h('b', null, 'FIRE FIGHTING'), '. Other sheets are left out. Other sections of these sheets are listed on the review screen, so you can choose to track them.'),
            h('li', null, 'Each row is linked to the activity it continues, so slip, rollovers and plan reliability carry on from the earlier lookaheads.'),
            h('li', null, sec.gemini_key ? 'Gemini checks the rows that don’t match word for word (renamed activities) and sorts new remarks into constraint types. You confirm everything.' : 'Rows that don’t match word for word are listed for you to link. Add a Gemini key in Settings to get suggestions.'),
            h('li', null, 'Uploading the same week again replaces it.')))],
    });
    const go = (f) => { if (f) readFile(f, panel, msg); };
    input.addEventListener('change', () => go(input.files[0]));
    drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('is-over'); });
    drop.addEventListener('dragleave', () => drop.classList.remove('is-over'));
    drop.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('is-over'); go(e.dataTransfer.files[0]); });
  }

  async function readFile(file, panel, msg) {
    const UI = window.CEND_UI, L = window.CEND_LOOK;
    msg.className = 'cend-msg'; msg.textContent = `Reading ${file.name}…`;
    let parsed;
    try {
      if (!/\.xlsx$/i.test(file.name)) throw new Error('Choose the .xlsx file (Excel Workbook). An older .xls file must be saved as .xlsx first.');
      const sheets = await window.CEND_XLSX.read(await file.arrayBuffer());
      parsed = L.parse(sheets, file.name, { secs: UI.state().model.meta.secs || {} });
      if (parsed.problems.length) throw new Error(parsed.problems.join(' '));
      if (!parsed.packages.some((p) => p.rows.length)) throw new Error('No electrical activities were found in this workbook.');
    } catch (e) {
      console.error(e);
      msg.className = 'cend-alert'; msg.textContent = String(e.message || e).replace(/^Error: /, '');
      return;
    }
    const model = UI.clone(UI.state().model);
    const plan = L.match(model, parsed);
    plan.rows.forEach((r, i) => { r.i = i; r.orig = r.match; r.origHow = r.how; });
    const latest = Math.max(...model.meta.lookaheads.map((l) => l.cw));
    CTX = { file, parsed, plan, model, remarks: [], latest, panel, ai: { state: 'idle' }, open: {}, saving: false, secs: {} };
    collectRemarks(CTX);
    render();
    runAI(CTX);
  }

  /* New remarks (never seen in an earlier lookahead) on the rows being saved; keeps choices already made. */
  function collectRemarks(ctx) {
    const seen = new Set(); for (const a of ctx.model.acts) for (const o of a.o) for (const t of o[2]) seen.add(t);
    const rc = ctx.model.remark_cats || {}, have = new Set(ctx.remarks.map((x) => x.text));
    for (const t of new Set(ctx.plan.rows.filter((r) => !r.out).flatMap((r) => r.remarks))) {
      if (seen.has(t) || have.has(t) || Object.prototype.hasOwnProperty.call(rc, t)) continue;
      const rule = window.CEND_MODEL.categorise(t);
      ctx.remarks.push({ text: t, rule, cat: rule, ai: false, touched: false });
    }
  }
  /* Track (or stop tracking) a section the rules leave out; remembered for later uploads when saved. */
  function trackSec(ctx, key, on) {
    const rows = ctx.plan.rows.filter((r) => r.secKey === key);
    if (!rows.length) return;
    if (on) {
      window.CEND_LOOK.matchRows(ctx.model, ctx.plan, rows);
      rows.forEach((r) => { r.orig = r.match; r.origHow = r.how; });
      ctx.secs[key] = { track: true, name: rows[0].sec };
      collectRemarks(ctx);
    } else {
      rows.forEach((r) => Object.assign(r, { out: true, skip: true, match: null, how: null, suggest: null }));
      delete ctx.secs[key];
    }
    render();
  }

  // ---------------------------------------------------------------- Gemini
  async function runAI(ctx) {
    const sec = window.CEND_STORE.secrets() || {}, G = window.CEND_GEMINI;
    const newRows = ctx.plan.rows.filter((r) => r.match == null && !r.out);
    const uncat = ctx.remarks.filter((x) => !x.rule);
    if (!newRows.length && !uncat.length) { ctx.ai = { state: 'none' }; return render(); }
    if (!sec.gemini_key || !G) { ctx.ai = { state: 'off' }; return render(); }
    ctx.ai = { state: 'busy', rows: newRows.length, remarks: uncat.length }; render();
    const jobs = [];
    if (newRows.length) {
      const byP = new Map();
      for (const r of newRows) {
        if (!byP.has(r.p)) byP.set(r.p, { name: `${r.p} – ${window.CEND_UI.pkName(r.p)}`, rows: [], cands: new Map() });
        const g = byP.get(r.p);
        g.rows.push({ row: r.i, section: r.sec, headings: r.path, text: r.text, remarks: r.remarks });
        for (const a of candidates(ctx, r, 50)) g.cands.set(a.id, a);
      }
      const packages = [...byP.values()].map((g) => ({ name: g.name, rows: g.rows, candidates: [...g.cands.values()].map((a) => {
        const lo = a.o[a.o.length - 1], dated = [...a.o].reverse().find((o) => o[1].length);
        return { id: a.id, section: a.sec, heading: a.sub || '', text: a.n, also_listed_as: a.al && a.al.length ? a.al : undefined, last_listed: lo ? `CW${lo[0]}` : '', last_dates: dated ? `${dated[1][0]}..${dated[1][dated[1].length - 1]}` : 'none' };
      }) }));
      jobs.push(G.suggestLinks(sec, packages).then((res) => {
        if (CTX !== ctx) return;
        const taken = new Set(ctx.plan.rows.filter((r) => r.match != null).map((r) => r.match));
        const order = { high: 0, medium: 1, low: 2 };
        for (const x of res.links.filter((l) => l && l.id).sort((a, b) => (order[a.confidence] ?? 3) - (order[b.confidence] ?? 3))) {
          const r = ctx.plan.rows[x.row]; if (!r || r.orig != null) continue;
          const ok = candidates(ctx, r, 400).some((a) => a.id === x.id);
          if (!ok || taken.has(x.id) || r.suggest) continue;
          r.suggest = { id: x.id, confidence: x.confidence, why: String(x.why || '').slice(0, 140) };
          if (x.confidence === 'high' && !r.touched) { r.match = x.id; r.how = 'ai'; taken.add(x.id); }
        }
        ctx.ai.links = res.links.filter((l) => l && l.id).length; ctx.ai.model = res.model;
      }));
    }
    if (uncat.length) {
      jobs.push(G.classifyRemarks(sec, uncat.map((x) => x.text)).then((res) => {
        if (CTX !== ctx) return;
        let n = 0;
        for (const x of uncat) if (Object.prototype.hasOwnProperty.call(res.cats, x.text)) { x.ai = true; x.aiCat = res.cats[x.text]; if (!x.touched) x.cat = x.aiCat; if (x.aiCat) n++; }
        ctx.ai.cons = n; ctx.ai.model = res.model;
      }));
    }
    const out = await Promise.allSettled(jobs);
    if (CTX !== ctx) return;
    const bad = out.find((x) => x.status === 'rejected');
    ctx.ai.state = bad ? (out.every((x) => x.status === 'rejected') ? 'error' : 'partial') : 'done';
    if (bad) { ctx.ai.error = String(bad.reason && bad.reason.message || bad.reason); console.warn(bad.reason); }
    render();
  }

  // ---------------------------------------------------------------- helpers
  const lastCw = (a) => (a.o.length ? a.o[a.o.length - 1][0] : 0);
  /* Existing activities a row could be linked to: same package, not linked by another row; same section and heading first. */
  function candidates(ctx, row, limit) {
    const used = new Set(ctx.plan.rows.filter((r) => r !== row && !r.skip && r.match != null).map((r) => r.match));
    const score = (a) => (a.sec === row.sec ? 2 : 0) + (a.sub === row.sub ? 1 : 0);
    return ctx.model.acts.filter((a) => a.p === row.p && !used.has(a.id))
      .sort((x, y) => score(y) - score(x) || lastCw(y) - lastCw(x) || x.id - y.id).slice(0, limit);
  }
  function span(ctx, days) {
    const { fmt, plural } = window.CEND_UI;
    if (!days.length) return 'no dates';
    const d = [...days].sort();
    return d.length > 1 ? `${fmt(d[0])} – ${fmt(d[d.length - 1])} · ${plural(d.length, 'day')}` : fmt(d[0]);
  }
  const actById = (ctx, id) => ctx.model.acts.find((a) => a.id === id);
  const actLabel = (a) => `${a.sub ? `${a.sub}: ` : a.sec ? `${a.sec}: ` : ''}${a.n}`;
  function weekLabel(plan) { const L = window.CEND_LOOK; const w2 = L.isoWeek(plan.end); return `CW${plan.cw}${w2 !== plan.cw ? `–${w2}` : ''}`; }

  // ---------------------------------------------------------------- step 2: review
  function render() {
    const ctx = CTX; if (!ctx) return;
    const UI = window.CEND_UI, { h, fmt, plural } = UI;
    const { plan, parsed } = ctx;
    if (!ctx.panel.live()) return;
    const rows = plan.rows;
    const live = rows.filter((r) => !r.skip);
    const nNew = live.filter((r) => r.match == null).length;
    const nLink = live.length - nNew;
    const wk = weekLabel(plan);
    // status line
    ctx.panel.setStatus([
      h('span', 'cend-tag is-new', wk), h('span', 'cend-muted', `${fmt(plan.start)} – ${fmt(plan.end)} ${plan.end.slice(0, 4)}`), h('span', 'cend-muted', `· ${ctx.file.name}`)]);
    const out = [];
    // warnings
    if (plan.replaces) out.push(h('p', 'cend-alert', `${wk} is already on the dashboard. Saving replaces it with this file.`));
    else if (plan.cw < ctx.latest) out.push(h('p', 'cend-alert', `This is older than the latest lookahead on the dashboard (CW${ctx.latest}). It will be added as history; CW${ctx.latest} stays the latest.`));
    else if (plan.cw > ctx.latest + 2) out.push(h('p', 'cend-alert', `The latest lookahead on the dashboard is CW${ctx.latest}, so ${plural(plan.cw - ctx.latest - 1, 'week')} in between ${plan.cw - ctx.latest - 1 === 1 ? 'is' : 'are'} missing. You can upload ${plan.cw - ctx.latest - 1 === 1 ? 'it' : 'them'} later.`));
    // tiles
    const byP = new Map(); for (const r of live) byP.set(r.p, (byP.get(r.p) || 0) + 1);
    out.push(h('div', 'cend-up-tiles',
      tile('Rows read', live.length, [...byP].map(([p, n]) => `${UI.pkName(p)} ${n}`).join(' · ') || 'none'),
      tile('Continue tracked activities', nLink, `${live.filter((r) => r.how === 'same wording').length} same wording`),
      tile('New activities', nNew, nNew ? 'check below' : 'none', nNew ? 'is-new' : ''),
      tile('Rows left out', rows.length - live.length, `${rows.filter((r) => r.out).length} in sections not tracked · ${plural(parsed.skipped.length, 'sheet')} not read`)));
    // AI line
    out.push(aiLine(ctx));
    // new rows
    const newRows = live.filter((r) => r.match == null).concat(rows.filter((r) => r.skip && !r.out));
    const linkedOdd = live.filter((r) => r.match != null && r.how !== 'same wording');
    if (newRows.length) out.push(section(ctx, 'new', 'New activities', `${plural(nNew, 'row')} didn’t match anything already tracked. If one is a renamed activity, link it so its history carries on.`, newRows.map((r) => rowCard(ctx, r)), true));
    if (linkedOdd.length) out.push(section(ctx, 'odd', 'Linked by similar wording', 'The wording changed a little since the last lookahead. Check each link is right.', linkedOdd.map((r) => rowCard(ctx, r)), true));
    // remarks
    const rems = ctx.remarks.filter((x) => live.some((r) => r.remarks.includes(x.text)));
    if (rems.length) out.push(section(ctx, 'rem', 'New remarks', 'Remarks that sort into a type count as constraints on the dashboard while they stay in the latest lookahead.', rems.map((x) => remarkCard(ctx, x)), true));
    // sections of an electrical sheet that aren't tracked
    const secG = new Map();
    for (const r of rows) if (r.out || ctx.secs[r.secKey]) { if (!secG.has(r.secKey)) secG.set(r.secKey, []); secG.get(r.secKey).push(r); }
    if (secG.size) out.push(section(ctx, 'secs', 'Sections not tracked', 'These sections of an electrical sheet are outside the tracked scope, so their rows are left out. Track a section to add its rows; the choice is remembered for the next uploads.',
      [...secG].map(([key, rs]) => secCard(ctx, key, rs))));
    // same wording (collapsed)
    const same = live.filter((r) => r.how === 'same wording');
    if (same.length) out.push(details(ctx, 'same', `Same wording as before (${same.length})`, groupList(ctx, same)));
    // dropped from the plan
    if (plan.cw > ctx.latest) {
      const linked = new Set(live.filter((r) => r.match != null).map((r) => r.match));
      const dropped = ctx.model.acts.filter((a) => !linked.has(a.id) && a.o.some((o) => o[0] === ctx.latest && o[1].length));
      if (dropped.length) out.push(details(ctx, 'drop', `In CW${ctx.latest} with dates, not in this lookahead (${dropped.length})`,
        h('div', null, h('p', 'cend-muted', 'The dashboard will treat these as finished (Done, inferred) unless they are linked above or you record a site check.'),
          h('ul', 'cend-ul', dropped.map((a) => h('li', null, `${UI.pkName(a.p)} · ${actLabel(a)}`))))));
    }
    // skipped sheets
    if (parsed.skipped.length) out.push(details(ctx, 'skip', `Sheets not read (${parsed.skipped.length})`, h('ul', 'cend-ul', parsed.skipped.map((s) => h('li', null, h('b', null, s.sheet), ` – ${s.why}`)))));
    // actions
    const msg = h('span', 'cend-msg', { role: 'status' });
    const save = h('button', { class: 'cend-btn', type: 'button', disabled: ctx.saving || ctx.ai.state === 'busy' }, ctx.saving ? 'Saving…' : `Save ${wk} for everyone`);
    const other = h('button', { class: 'cend-btn ghost', type: 'button', onclick: () => pickScreen() }, 'Another file');
    save.addEventListener('click', () => doSave(ctx, msg, save));
    ctx.panel.setBody(out);
    ctx.panel.setFoot([h('div', 'cend-actions', save, other, ctx.ai.state === 'busy' ? h('span', 'cend-msg', 'Waiting for Gemini…') : msg)]);
  }

  function tile(k, n, sub, cls) { const { h } = window.CEND_UI; return h('div', `cend-fact ${cls || ''}`, h('span', 'hx-k', k), h('b', null, String(n)), h('span', 'cend-muted cend-small', sub)); }
  function aiLine(ctx) {
    const { h, plural } = window.CEND_UI; const a = ctx.ai;
    if (a.state === 'busy') return h('p', 'cend-ai is-busy', h('i'), `Gemini is checking ${[a.rows ? plural(a.rows, 'new row') : '', a.remarks ? plural(a.remarks, 'new remark') : ''].filter(Boolean).join(' and ')}…`);
    if (a.state === 'off') return h('p', 'cend-ai', 'No Gemini key is set, so new rows are not checked for renamed activities. Link them by hand below, or add a key in Settings.');
    if (a.state === 'error') return h('p', 'cend-alert', `Gemini could not help this time (${a.error}). Review the new rows by hand below.`);
    if (a.state === 'done' || a.state === 'partial') return h('p', 'cend-ai is-done', h('i'),
      `Gemini${a.model ? ` (${a.model})` : ''} checked this upload: ${[a.links != null ? `${plural(a.links, 'possible rename')}` : '', a.cons != null ? `${plural(a.cons, 'new constraint')}` : ''].filter(Boolean).join(', ')}.`, a.state === 'partial' ? ` One check failed: ${a.error}` : '');
    return '';
  }
  function section(ctx, id, title, sub, kids) {
    const { h } = window.CEND_UI;
    return h('div', 'cend-sec cend-up-sec', h('h3', null, title), sub ? h('p', 'cend-muted', sub) : '', h('div', 'cend-up-list', kids));
  }
  function details(ctx, id, title, body) {
    const { h } = window.CEND_UI;
    const d = h('details', 'cend-up-det', h('summary', null, title), body);
    d.open = !!ctx.open[id];
    d.addEventListener('toggle', () => { ctx.open[id] = d.open; });
    return d;
  }
  function groupList(ctx, rows) {
    const { h, pkName } = window.CEND_UI;
    const g = new Map(); for (const r of rows) { if (!g.has(r.p)) g.set(r.p, []); g.get(r.p).push(r); }
    return h('div', 'cend-up-same', [...g].map(([p, rs]) => h('div', null, h('div', 'cend-grp', pkName(p), h('span', null, String(rs.length))),
      h('ul', 'cend-ul', rs.map((r) => h('li', null, r.sub ? h('span', 'cend-muted', `${r.sub}: `) : r.p === 'ROOMS' ? h('span', 'cend-muted', `${r.sec}: `) : '', r.text, h('span', 'cend-muted', ` · ${span(ctx, r.days)}`)))))));
  }

  function rowCard(ctx, r) {
    const UI = window.CEND_UI, { h, pkName } = UI;
    const where = [pkName(r.p), r.sec, r.sub].filter(Boolean).join(' · ');
    const sel = h('select', { class: 'cend-in', 'aria-label': `What to do with: ${r.text}` });
    sel.append(h('option', { value: 'new' }, 'Add as a new activity'), h('option', { value: 'skip' }, 'Leave this row out'));
    const cands = candidates(ctx, r, 80);
    if (r.match != null && !cands.some((a) => a.id === r.match)) { const a = actById(ctx, r.match); if (a) cands.unshift(a); }
    const og = h('optgroup', { label: 'Continues a tracked activity' });
    for (const a of cands) og.append(h('option', { value: String(a.id) }, `${actLabel(a).slice(0, 110)} · last CW${lastCw(a)}`));
    sel.append(og);
    sel.value = r.skip ? 'skip' : r.match != null ? String(r.match) : 'new';
    sel.addEventListener('change', () => {
      r.touched = true;
      if (sel.value === 'skip') { r.skip = true; }
      else if (sel.value === 'new') { r.skip = false; r.match = null; r.how = null; }
      else { r.skip = false; r.match = Number(sel.value); r.how = r.match === r.orig ? r.origHow : (r.suggest && r.suggest.id === r.match ? 'ai' : 'manual'); }
      render();
    });
    const tags = [];
    if (r.skip) tags.push(h('span', 'cend-tag', 'left out'));
    else if (r.match == null) tags.push(h('span', 'cend-tag is-new', 'new'));
    else if (r.how === 'typo') tags.push(h('span', 'cend-tag', `wording ${Math.round(r.score * 100)}% same`));
    else if (r.how === 'ai') tags.push(h('span', 'cend-tag is-ai', 'linked by Gemini'));
    else if (r.how === 'manual') tags.push(h('span', 'cend-tag', 'linked by you'));
    const linked = r.match != null ? actById(ctx, r.match) : null;
    const sug = r.suggest && r.match !== r.suggest.id ? actById(ctx, r.suggest.id) : null;
    const useBtn = sug ? h('button', { class: 'cend-chip', type: 'button', onclick: () => { r.touched = true; r.skip = false; r.match = sug.id; r.how = 'ai'; render(); } }, 'Use this link') : null;
    return h('div', `cend-up-row${r.skip ? ' is-skip' : ''}`,
      h('div', 'cend-up-main',
        h('div', 'cend-up-t', h('b', null, r.text), ...tags),
        h('div', 'cend-rw', where, ' · ', h('span', r.days.length ? 'cend-rwhen' : null, span(ctx, r.days))),
        r.remarks.length ? h('div', 'cend-rem cend-small', `“${r.remarks.join('; ')}”`) : '',
        linked && r.how !== 'same wording' ? h('div', 'cend-up-link', '→ ', h('span', null, actLabel(linked)), h('span', 'cend-muted', ` · last listed CW${lastCw(linked)}`)) : '',
        r.suggest && r.how === 'ai' && r.match === r.suggest.id && r.suggest.why ? h('div', 'cend-muted cend-small', `Gemini: ${r.suggest.why}`) : '',
        sug ? h('div', 'cend-up-sug', h('span', 'cend-tag is-ai', `Gemini · ${r.suggest.confidence}`), h('span', null, ` may continue “${actLabel(sug)}”`), r.suggest.why ? h('span', 'cend-muted', ` – ${r.suggest.why}`) : '', ' ', useBtn) : ''),
      h('div', 'cend-up-act', sel));
  }

  function secCard(ctx, key, rs) {
    const { h, plural } = window.CEND_UI;
    const on = !!ctx.secs[key];
    const dated = rs.filter((r) => r.days.length).length;
    const b = h('button', { class: on ? 'cend-btn ghost' : 'cend-btn', type: 'button', onclick: () => trackSec(ctx, key, !on) }, on ? 'Stop tracking' : 'Track this section');
    return h('div', `cend-up-row${on ? '' : ' is-skip'}`,
      h('div', 'cend-up-main',
        h('div', 'cend-up-t', h('b', null, rs[0].sec), on ? h('span', 'cend-tag is-new', 'tracked from now') : h('span', 'cend-tag', 'not tracked')),
        h('div', 'cend-rw', `${rs[0].sheet} sheet · “${rs[0].secRaw}” · ${plural(rs.length, 'row')}, ${dated} with dates`),
        h('div', 'cend-rem cend-small', rs.slice(0, 6).map((r) => r.text).join(' · ') + (rs.length > 6 ? ` · …and ${rs.length - 6} more` : ''))),
      h('div', 'cend-up-act', b));
  }
  function remarkCard(ctx, x) {
    const { h } = window.CEND_UI;
    const sel = h('select', { class: 'cend-in', 'aria-label': `Type of remark: ${x.text}` }, h('option', { value: '' }, 'Not a constraint'), CATS.map((c) => h('option', { value: c }, c)));
    sel.value = x.cat || '';
    sel.addEventListener('change', () => { x.touched = true; x.cat = sel.value || null; render(); });
    const n = CTX.plan.rows.filter((r) => !r.skip && r.remarks.includes(x.text)).length;
    const src = x.touched ? 'set by you' : x.ai && !x.rule ? 'Gemini' : x.rule ? 'matched a known pattern' : '';
    return h('div', 'cend-up-row',
      h('div', 'cend-up-main', h('div', 'cend-up-t', h('span', null, `“${x.text}”`)),
        h('div', 'cend-rw cend-up-meta', h('span', null, `${n} ${n === 1 ? 'row' : 'rows'}${src ? ` · ${src}` : ''}`), x.cat ? h('span', 'cend-tag is-con', x.cat) : '')),
      h('div', 'cend-up-act', sel));
  }

  // ---------------------------------------------------------------- save
  async function doSave(ctx, msg, btn) {
    const UI = window.CEND_UI, L = window.CEND_LOOK;
    const live = ctx.plan.rows.filter((r) => !r.skip);
    const seen = new Map(); const dup = [];
    for (const r of live) if (r.match != null) { if (seen.has(r.match)) dup.push([seen.get(r.match), r]); else seen.set(r.match, r); }
    if (dup.length) { const [a, b] = dup[0]; msg.textContent = `Two rows are linked to the same activity: “${a.text}” and “${b.text}”. Change one of them.`; return; }
    if (!live.length) { msg.textContent = 'Every row is left out, so there is nothing to save.'; return; }
    const remark_cats = {};
    for (const x of ctx.remarks) if ((x.cat || null) !== (x.rule || null)) remark_cats[x.text] = x.cat || null;
    const final = { cw: ctx.plan.cw, start: ctx.plan.start, end: ctx.plan.end, file: ctx.plan.file, secs: { ...ctx.secs },
      rows: ctx.plan.rows.map((r) => ({ p: r.p, sec: r.sec, sub: r.sub, text: r.text, days: r.days, remarks: r.remarks, match: r.match, skip: !!r.skip })), remark_cats };
    const nNew = live.filter((r) => r.match == null).length;
    const wk = weekLabel(ctx.plan);
    ctx.saving = true; btn.disabled = true; btn.textContent = 'Saving…';
    const ok = await UI.commit((st) => { L.apply(st.model, final); }, `Lookahead ${wk} uploaded: ${live.length - nNew} continued, ${nNew} new`);
    ctx.saving = false;
    if (ok) { CTX = null; UI.closePanel(); UI.showToday(true); UI.toast(`${wk} saved: ${live.length} rows, ${UI.plural(nNew, 'new activity', 'new activities')}. Everyone sees it the next time they open or reload the dashboard.`, 'ok'); }
    else render();
  }

  window.CEND_UPLOAD = { open };
})();
