/* What the chat assistant knows: its instructions plus every piece of dashboard data, written as compact
   text (activities with their full lookahead-by-lookahead history, changes between lookaheads, the
   fortnight's plan by day, constraints, plan reliability, site checks, added activities, the website's
   change log and the Generator U1 reference data). Pure function, so it can be checked outside a browser. */
(function (root) {
  'use strict';
  const DAY = 864e5;
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const D = (s) => { const [y, m, d] = s.split('-').map(Number); return Date.UTC(y, m - 1, d); };
  const iso = (t) => new Date(t).toISOString().slice(0, 10);
  const fmtW = (s) => { if (!s) return '–'; const d = new Date(D(s)); return `${WD[d.getUTCDay()]} ${d.getUTCDate()} ${MON[d.getUTCMonth()]} ${d.getUTCFullYear()}`; };
  const one = (s, n) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim().slice(0, n || 400);
  const WORD = { Completed: 'Completed', 'Done (inferred)': 'Done (inferred)', Active: 'On plan', Slipping: 'Late', 'On hold': 'On hold', Pending: 'No dates yet',
    'Not in latest plan': 'Not in latest plan', 'Not scheduled': 'Never scheduled', Overdue: 'Overdue', Planned: 'Planned later' };
  const SITE = { done: 'done on site', pending: 'pending on site', hold: 'on hold on site' };

  const INSTRUCTIONS = `You are the assistant built into the Resident Engineer Progress View: the electrical progress dashboard for HLEP · SJ Chenderoh, a hydro power station refurbishment in Malaysia. The owner is TNB GenCo, and the people asking are its site team (Resident Engineers and their managers). The main contractor is ANDRITZ (AHC); its plan arrives every week as a two-week lookahead. CW means ISO calendar week: the "CW44–45" lookahead is issued in CW44 and covers CW44 and CW45.

How to answer
- Use only the DATA below. If it doesn't hold the answer, say so in one line and suggest where to find it. Never invent activities, dates, people or numbers.
- You can't change anything on the dashboard. If asked to record a site check, add or edit an activity, or upload a lookahead, explain how: open the activity and use Site check, or go to Today's activities → Add activity / Upload lookahead.
- Reply in the language of the question (English or Bahasa Melayu).
- Be brief and specific. Lead with the answer, then the detail that supports it. Use activity names, CW numbers, dates written like "Mon 26 Oct", and counts. Prefer short bullet lists, grouped by package when that helps; avoid wide tables.
- When you name a tracked activity, put its id straight after the name, like "R05 Lower Bracket: Cleaning & packing (#325)". Once per activity per answer is enough.
- Status words: Completed. Done (inferred) = it left the plan after its dates passed, so it is treated as done. On plan. Late = its latest planned finish is 7 or more days after its first planned finish, or it rolled over (came back with new dates after its dates had passed). On hold = listed with a constraint remark and no dates. No dates yet. Not in latest plan. Never scheduled. A site check ("done / pending / on hold on site", with the date checked) is what the team saw on site, and it overrides the lookahead status.
- Drafting updates (WhatsApp, email, report): write ready-to-paste text, short and factual: what was done, what is in progress, what is late or blocked and why, and what is needed from whom. For WhatsApp use *bold* with single asterisks and "- " bullets, with no headings or tables. For email, start with a subject line.
- Meeting prep: lead with what changed since the previous lookahead (the CHANGES section), then what is late or blocked, then what needs chasing and what it depends on.
- Questions about a past week: use each activity's plan history (its dates in every lookahead) and the CHANGES section.`;

  function context(state, opts) {
    const DS = root.CEND_DATA;
    const today = opts.today;
    const B = DS.build(state, today);
    const M = B.meta, LATEST = M.latest, yr = Number(M.latest_start.slice(0, 4));
    const looks = [...M.lookaheads].sort((a, b) => a.cw - b.cw);
    const wk = (cw, end) => { const w2 = end ? DS.isoWeek(end) : cw + 1; return `CW${cw}${w2 !== cw ? `–${w2}` : ''}`; };
    const lookBy = new Map(looks.map((l) => [l.cw, l]));
    const full = (cw, md) => { const l = lookBy.get(cw); const y0 = Number((l ? l.start : M.latest_start).slice(0, 4)); let s = `${y0}-${md}`; if (l && D(s) < D(l.start) - 60 * DAY) s = `${y0 + 1}-${md}`; return s; };
    const pkName = (p) => (B.pk[p] ? B.pk[p].name : p);
    const out = [];
    const ids = new Map();
    const latest = looks[looks.length - 1];

    // ---- now
    out.push('NOW');
    out.push(`Today is ${fmtW(today)} (Malaysia time). The latest lookahead is ${wk(LATEST, latest.end)}: ${fmtW(latest.start)} – ${fmtW(latest.end)}${latest.file ? ` (file "${one(latest.file, 80)}")` : ''}. Lookaheads on record: ${looks.length}, ${wk(looks[0].cw, looks[0].end)} to ${wk(LATEST, latest.end)}.`);
    out.push(opts.view ? `The person is looking back at the ${wk(opts.view.cw, opts.view.end)} lookahead as it stood on ${fmtW(opts.view.today)}: the dashboard on their screen shows that week. The data below is the latest.`
      : 'The person is looking at the latest week.');

    // ---- packages
    out.push('', 'PACKAGES (code = name: what it covers; contractor)');
    for (const p of B.order) { const k = B.pk[p]; if (k) out.push(`${p} = ${k.name}${k.full && k.full !== k.name ? ` (${k.full})` : ''}: ${one(k.note, 160)}`); }

    // ---- activities
    out.push('', `ACTIVITIES BY ANDRITZ (AHC) (${B.items.filter((a) => !a.custom).length}). Fields: #id | package | section › heading | activity | status now | site check | first → latest planned finish | slip | rollovers | first–last lookahead listed | plan history, one entry per lookahead: CW:first..last planned day (days) "remarks" (a remark is repeated only when it changes)`);
    const dtxt = (cw, mds) => { if (!mds.length) return 'no dates'; const s = [...mds].sort(); return s.length === 1 ? s[0] : `${s[0]}..${s[s.length - 1]}(${s.length})`; };
    for (const a of B.items.filter((x) => !x.custom)) {
      ids.set(a.id, a.k);
      const s = B.site[a.k];
      // one entry per lookahead; a run of lookaheads with the same dates and no new remark is written once ("38–43:no dates")
      let prevRem = '';
      const runs = [];
      for (const o of a.o) {
        const rem = o[2].join('; '), dt = dtxt(o[0], o[1]), r = rem && rem !== prevRem ? ` "${one(rem, 200)}"` : '';
        prevRem = rem;
        const last = runs[runs.length - 1];
        if (last && !r && last.dt === dt && last.to === o[0] - 1) last.to = o[0];
        else runs.push({ from: o[0], to: o[0], dt, r });
      }
      const hist = runs.map((x) => `${x.from}${x.to !== x.from ? `–${x.to}` : ''}:${x.dt}${x.r}`).join(' ; ');
      out.push([`#${a.id}`, a.p, [a.sec, a.sub].filter(Boolean).join(' › ') || '–', one(a.n, 200) + (a.al && a.al.length ? ` (also listed as: ${a.al.map((t) => one(t, 120)).join(' / ')})` : ''),
        `${WORD[a.st] || a.st}${a.d ? ` ${a.d}` : ''}`,
        s ? `${SITE[s.status] || s.status} ${s.checked}${s.note ? ` "${one(s.note, 200)}"` : ''}${s.by_name ? ` (by ${one(s.by_name, 40)})` : ''}` : 'no site check',
        a.bf ? `${a.bf} → ${a.lf}` : 'no dates', `slip ${a.sl > 0 ? '+' : ''}${a.sl || 0}d`, `rolled ${a.r || 0}×`, `CW${a.f}–${a.l}`, hist].join(' | '));
    }

    // ---- activities added on the website
    const custom = B.items.filter((x) => x.custom);
    out.push('', `ACTIVITIES ADDED ON THE WEBSITE (other contractors or extra scope) (${custom.length}). Fields: #id | contractor | package | area | activity | status | site check | planned start → finish (first planned finish) | re-planned | constraint | note | added by`);
    for (const a of custom) {
      ids.set(a.id, a.k);
      const s = B.site[a.k], v = a.raw || {};
      out.push([`#${a.id}`, a.con, pkName(a.p), a.sec, one(a.n, 200), `${WORD[a.st] || a.st}${a.d ? ` ${a.d}` : ''}`,
        s ? `${SITE[s.status]} ${s.checked}${s.note ? ` "${one(s.note, 200)}"` : ''}` : 'no site check', `${a.ls} → ${a.lf} (first ${a.bf})`, `${a.r || 0}×`, a.constraint || 'none', a.remark ? `"${one(a.remark, 300)}"` : '–', `${one(v.by, 40) || '?'} ${String(v.at || '').slice(0, 10)}`].join(' | '));
    }
    if (!custom.length) out.push('(none)');

    // ---- the latest fortnight by day
    out.push('', `PLAN BY DAY IN THE LATEST LOOKAHEAD (${wk(LATEST, latest.end)}). Each: #id activity [status now; site check]`);
    for (let t = D(latest.start); t <= D(latest.end); t += DAY) {
      const d = iso(t);
      const on = B.items.filter((a) => a.days.includes(d));
      out.push(`${fmtW(d)}${d === today ? ' (today)' : ''}: ${on.length ? on.map((a) => { const s = B.site[a.k]; return `#${a.id} ${one(a.sub ? `${a.sub}: ${a.n}` : a.n, 140)} [${WORD[a.st] || a.st}${s ? `; ${SITE[s.status]} ${s.checked}` : ''}]`; }).join(' ; ') : 'nothing planned'}`);
    }

    // ---- changes between lookaheads
    const pairs = looks.slice(-7);
    out.push('', 'CHANGES BETWEEN CONSECUTIVE LOOKAHEADS (latest first; each list capped at 40)');
    const cap = (arr) => (arr.length > 40 ? `${arr.slice(0, 40).join(' ; ')} ; …and ${arr.length - 40} more` : arr.join(' ; ')) || 'none';
    for (let i = pairs.length - 1; i > 0; i--) {
      const P = pairs[i - 1].cw, N = pairs[i].cw;
      const nw = [], gone = [], moved = [], undated = [], rems = [];
      for (const a of B.items.filter((x) => !x.custom)) {
        const oP = a.o.find((o) => o[0] === P), oN = a.o.find((o) => o[0] === N);
        const nm = `#${a.id} ${one(a.sub ? `${a.sub}: ${a.n}` : a.n, 110)} (${a.p})`;
        if (oN && a.o[0][0] === N) nw.push(`${nm}${oN[1].length ? ` ${dtxt(N, oN[1])}` : ' no dates'}`);
        if (oP && oP[1].length && !oN) gone.push(`${nm} was due by ${[...oP[1]].sort().pop()}`);
        if (oP && oP[1].length && oN && oN[1].length) {
          const fP = full(P, [...oP[1]].sort().pop()), fN = full(N, [...oN[1]].sort().pop()), dd = Math.round((D(fN) - D(fP)) / DAY);
          if (dd) moved.push(`${nm} ${dd > 0 ? '+' : ''}${dd}d (${fP.slice(5)} → ${fN.slice(5)})`);
        }
        if (oP && oP[1].length && oN && !oN[1].length) undated.push(`${nm}${oN[2].length ? ` "${one(oN[2].join('; '), 120)}"` : ''}`);
        if (oN) for (const t of oN[2]) if (!(oP && oP[2].includes(t))) rems.push(`${nm}: "${one(t, 150)}"`);
      }
      out.push(`${wk(P, (lookBy.get(P) || {}).end)} → ${wk(N, (lookBy.get(N) || {}).end)}:`);
      out.push(`- New in CW${N} (${nw.length}): ${cap(nw)}`);
      out.push(`- Had dates in CW${P}, not listed in CW${N} (${gone.length}): ${cap(gone)}`);
      out.push(`- Planned finish moved (${moved.length}): ${cap(moved)}`);
      out.push(`- Lost their dates (still listed) (${undated.length}): ${cap(undated)}`);
      out.push(`- New remarks (${rems.length}): ${cap(rems)}`);
    }
    if (looks.length > pairs.length) out.push(`(Earlier changes, ${wk(looks[0].cw)} onward, can be read from each activity's plan history.)`);

    // ---- constraints
    const cons = B.datasets.constraints;
    const nameOf = (id) => { const a = B.byId.get(id); return a ? one(a.sub ? `${a.sub}: ${a.n}` : a.n, 120) : `#${id}`; };
    out.push('', `CONSTRAINTS (from lookahead remarks; open = the remark is in the latest lookahead) (${cons.filter((c) => c.open).length} open, ${cons.filter((c) => !c.open).length} closed). Fields: open/closed | type | #id activity (package) | latest remark | first–last lookahead`);
    for (const c of [...cons].sort((x, y) => Number(y.open) - Number(x.open) || y.last_cw - x.last_cw)) out.push(`${c.open ? 'OPEN' : 'closed'} | ${c.category} | #${c.activity_id} ${nameOf(c.activity_id)} (${c.pkg}) | "${one(c.remark, 200)}" | CW${c.first_cw}–${c.last_cw}`);

    // ---- plan reliability
    out.push('', 'PLAN RELIABILITY (of the activities a lookahead planned to finish in its first week, how many did not come back with dates in the next lookahead). Fields: lookahead | kept/planned (%) | by package kept/planned');
    for (const r of B.ppc) out.push(`CW${r.w} → CW${r.next} | ${r.kept}/${r.planned}${r.pct != null ? ` (${r.pct}%)` : ''} | ${Object.entries(r.byp).filter(([, v]) => v[0]).map(([p, v]) => `${p} ${v[1]}/${v[0]}`).join(', ') || '–'}`);

    // ---- site checks
    const checks = Object.entries(B.site).filter(([k, v]) => v && B.byKey.has(k) && SITE[v.status]).sort((x, y) => String(y[1].checked).localeCompare(String(x[1].checked)));
    out.push('', `SITE CHECKS (what the team recorded on site; latest per activity, newest first) (${checks.length}). Fields: date checked | finding | #id activity (package) | note | by | earlier checks`);
    for (const [k, v] of checks) {
      const a = B.byKey.get(k);
      const prev = (v.history || []).slice(0, 4).map((x) => `${x.checked} ${SITE[x.status] || x.status}`).join(', ');
      out.push(`${v.checked} | ${SITE[v.status]} | #${a.id} ${one(a.sub ? `${a.sub}: ${a.n}` : a.n, 140)} (${a.p}) | ${v.note ? `"${one(v.note, 250)}"` : '–'} | ${one(v.by_name, 40) || '–'} | ${prev || '–'}`);
    }

    // ---- website change log
    const log = (state.log || []).slice(0, 60);
    out.push('', `RECENT CHANGES MADE ON THE WEBSITE (newest first, up to 60). Fields: when (UTC) | by | what`);
    for (const x of log) out.push(`${String(x.at || '').slice(0, 16).replace('T', ' ')} | ${one(x.by, 40) || '–'} | ${one(x.what, 200)}`);
    if (!log.length) out.push('(none yet)');

    // ---- lookaheads on record
    out.push('', 'LOOKAHEADS ON RECORD: ' + looks.map((l) => `${wk(l.cw, l.end)} ${l.start}..${l.end}`).join(' ; '));

    // ---- generator reference data (the 3D model page)
    const S = opts.static || {};
    if (S.gen_facts || S.gen_components || S.gen_parts) {
      out.push('', 'GENERATOR U1 REFERENCE DATA (from the 3D model page and drawings)');
      for (const f of S.gen_facts || []) out.push(`Fact: ${one(f.label, 80)} = ${f.value}${f.unit ? ` ${f.unit}` : ''}${f.detail ? ` (${one(f.detail, 160)})` : ''}`);
      for (const c of S.gen_components || []) out.push(`Component ${c.item}: ${one(c.item_name, 80)} – tracked as "${one(c.component, 80)}"; ${c.drawn ? `drawn in the 3D model as ${one(c.mapped_to, 100)}` : 'not in the 3D model'}${c.note ? `; ${one(c.note, 140)}` : ''}`);
      for (const p of S.gen_parts || []) out.push(`Part: ${one(p.label, 90)} | ${one(p.model_group, 40)}${p.tag ? ` | KKS ${one(p.tag, 40)}` : ''}${p.system_name ? ` | ${one(p.system_name, 60)}` : ''}${p.el_text ? ` | ${one(p.el_text, 60)}` : ''} | ${one(p.desc, 160)}`);
    }
    return { system: `${INSTRUCTIONS}\n\nDATA\n${out.join('\n')}`, ids };
  }

  root.CEND_CHATDATA = { context, INSTRUCTIONS };
})(typeof window !== 'undefined' ? window : globalThis);
