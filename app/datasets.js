/* Turns the saved state into the dashboard's datasets (the same tables the Claude
   dashboard used), and gives the editing UI a per-activity view of the same data. */
(function (root) {
  'use strict';
  const DAY = 864e5;
  const D = (s) => { const [y, m, d] = s.split('-').map(Number); return Date.UTC(y, m - 1, d); };
  const iso = (t) => new Date(t).toISOString().slice(0, 10);
  const diff = (a, b) => Math.round((D(a) - D(b)) / DAY);
  const ISO_RX = /^\d{4}-\d{2}-\d{2}$/;
  const LOOK_ORDER = ['EPS', 'GEN', 'AUTO', 'ROOMS', 'CRANE4'];
  const LOOK_CON = 'ANDRITZ (AHC)';
  function isoWeek(s) {
    const t = new Date(D(s)); const dn = (t.getUTCDay() + 6) % 7; t.setUTCDate(t.getUTCDate() - dn + 3);
    const j4 = new Date(Date.UTC(t.getUTCFullYear(), 0, 4));
    return 1 + Math.round(((t - j4) / DAY - 3 + ((j4.getUTCDay() + 6) % 7)) / 7);
  }
  const localToday = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  const str = (v, n) => (typeof v === 'string' ? v.trim().slice(0, n) : '');

  function pkgKeyFor(name, pk) {
    const n = String(name || '').trim().toLowerCase();
    const hit = LOOK_ORDER.find((p) => p.toLowerCase() === n || (pk[p] && (pk[p].name.toLowerCase() === n || pk[p].full.toLowerCase() === n)));
    return hit || 'X-' + n.replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30);
  }

  /* Everything the UI and the dashboard need, worked out once per state. */
  function build(state, today) {
    today = today || localToday();
    const M = root.CEND_MODEL.derive(state.model);
    const meta = M.meta, LATEST = meta.latest;
    const WIN0 = meta.latest_start, WIN1 = meta.latest_end;
    const pk = { ...M.pk };
    const items = [];                 // unified activity list for the UI
    for (const a of M.acts) {
      const cur = a.o.find((o) => o[0] === LATEST);
      const year = Number(WIN0.slice(0, 4));
      const days = cur ? cur[1].map((m) => { let s = `${year}-${m}`; if (D(s) < D(WIN0) - 60 * DAY) s = `${year + 1}-${m}`; return s; }).sort() : [];
      items.push({ ...a, custom: false, con: LOOK_CON, days, remark: cur && cur[2].length ? cur[2].join('; ') : '' });
    }
    // activities added on the website (other contractors, extra scope)
    let n = 0;
    const custom = state.custom_acts || {};
    for (const [docId, v] of Object.entries(custom).sort((x, y) => String(x[1].at || '').localeCompare(String(y[1].at || '')) || x[0].localeCompare(y[0]))) {
      const name = str(v.name, 200), con = str(v.contractor, 60), pkgName = str(v.pkg, 60);
      if (!name || !con || !pkgName || !ISO_RX.test(v.start || '') || !ISO_RX.test(v.finish || '')) continue;
      const start = v.start, finish = v.finish < v.start ? v.start : v.finish;
      const bs = ISO_RX.test(v.base_start || '') ? v.base_start : start, bf = ISO_RX.test(v.base_finish || '') ? v.base_finish : finish;
      const key = pkgKeyFor(pkgName, pk);
      if (!pk[key]) pk[key] = { name: pkgName, full: pkgName, note: `${con} · added on the website`, custom: true };
      const status = ['planned', 'done', 'hold'].includes(v.status) ? v.status : 'planned';
      const doneD = status === 'done' ? (ISO_RX.test(v.done_date || '') ? v.done_date : finish) : null;
      const sl = diff(finish, bf);
      const replans = Number.isFinite(v.replans) ? Math.max(0, Math.min(99, Math.round(v.replans))) : 0;
      const inWin = D(start) <= D(WIN1) && D(finish) >= D(WIN0);
      let st;
      if (status === 'done') st = 'Completed';
      else if (status === 'hold') st = 'On hold';
      else if (finish < today) st = 'Overdue';
      else if (inWin) st = (sl >= 7 || replans >= 1) ? 'Slipping' : 'Active';
      else if (D(start) > D(WIN1)) st = 'Planned';
      else st = (sl >= 7 || replans >= 1) ? 'Slipping' : 'Active';
      const days = [];
      for (let t = Math.max(D(start), D(WIN0)), i = 0; t <= Math.min(D(finish), D(WIN1)) && i < 60; t += DAY, i++) days.push(iso(t));
      const created = ISO_RX.test(String(v.at || '').slice(0, 10)) ? String(v.at).slice(0, 10) : today;
      const id = 100000 + (n++);
      items.push({ id, k: 'c' + docId, doc: docId, custom: true, con, p: key, sec: str(v.area, 80) || 'General', sub: '', n: name, al: [], o: [],
        f: Math.min(LATEST, Math.min(isoWeek(created), isoWeek(bs))), l: LATEST, ns: 0, bs, bf, ls: start, lf: finish, sl, r: replans, st, d: doneD,
        nw: false, days, remark: str(v.note, 500), constraint: str(v.constraint, 40), status, raw: v });
    }
    const byKey = new Map(items.map((a) => [a.k, a]));
    const byId = new Map(items.map((a) => [a.id, a]));
    const site = state.site_checks || {};

    // ---- datasets, as the Claude dashboard had them
    const DASH_ST = { Overdue: 'Slipping', Planned: 'Pending' };
    const activities = items.map((a) => ({
      id: a.id, key: a.k, pkg: a.p, package: pk[a.p] ? pk[a.p].name : a.p,
      area: a.custom ? `${a.sec} · ${a.con}` : a.sec, component: a.sub, activity: a.n,
      first_cw: a.f, last_cw: a.l, first_finish: a.bf, start: a.ls, finish: a.lf,
      slip_days: a.sl, rollovers: a.r, status: DASH_ST[a.st] || a.st, done_date: a.d,
      new_this_week: !!a.nw, fortnight_days: (a.st === 'Active' || a.st === 'Slipping') ? a.days.join(' ') : '', latest_remark: a.remark || '',
    }));
    const order = LOOK_ORDER.concat(Object.keys(pk).filter((p) => !LOOK_ORDER.includes(p)).sort((x, y) => pk[x].name.localeCompare(pk[y].name)));
    const packages = order.filter((p) => pk[p] && (LOOK_ORDER.includes(p) || items.some((a) => a.p === p)))
      .map((p) => ({ pkg: p, name: pk[p].name, full: pk[p].full, covers: pk[p].note, contractor: pk[p].custom ? (items.find((a) => a.p === p) || {}).con || '' : LOOK_CON }));
    const site_checks = Object.entries(site).filter(([k, v]) => v && ['done', 'pending', 'hold'].includes(v.status) && ISO_RX.test(v.checked || '') && byKey.has(k))
      .map(([k, v]) => ({ key: k, activity: v.name || byKey.get(k).n, pkg: byKey.get(k).p, status: v.status, checked: v.checked, note: v.note || '' }))
      .sort((x, y) => x.checked.localeCompare(y.checked) || x.activity.localeCompare(y.activity));
    const constraints = M.cons.map((c) => ({ activity_id: c.act, pkg: c.pkg, category: c.cat, remark: c.texts[c.texts.length - 1], first_cw: c.first, last_cw: c.last, open: !!c.open }));
    for (const a of items) if (a.custom && a.constraint) constraints.push({ activity_id: a.id, pkg: a.p, category: a.constraint, remark: a.remark || a.constraint, first_cw: a.f, last_cw: LATEST, open: a.status !== 'done' });
    const reliability = [];
    for (const r of M.ppc) for (const p of LOOK_ORDER) { const [pl, kp] = r.byp[p] || [0, 0]; reliability.push({ week: r.w, next_week: r.next, pkg: p, planned: pl, kept: kp }); }
    const lookaheads = meta.lookaheads.map((l) => ({ cw: l.cw, start: l.start, end: l.end, file: l.file }));
    const last = site_checks.map((s) => s.checked).sort().pop() || null;
    const sync_log = [{ synced_at: state.updated_at || new Date().toISOString(), site_checks: site_checks.length, last_check: last, new_or_changed: 0,
      added_activities: Object.keys(custom).length, by: state.updated_by || '' }];
    return {
      meta, pk, items, byKey, byId, site, cons: M.cons, ppc: M.ppc, order: packages.map((p) => p.pkg),
      datasets: { activities, packages, site_checks, constraints, reliability, lookaheads, sync_log },
    };
  }

  root.CEND_DATA = { build, isoWeek, localToday, pkgKeyFor, LOOK_ORDER, LOOK_CON };
})(typeof window !== 'undefined' ? window : globalThis);
