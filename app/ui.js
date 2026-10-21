/* Website editing layer on top of the dashboard page:
   Today's activities tab, activity panel with site checks, add/edit activity, settings. */
(function () {
  'use strict';
  const S = window.CEND_STORE, DS = window.CEND_DATA;
  const ROOT = document.querySelector('.hx');
  if (!ROOT) return;
  let STATE = null, B = null, DAYSEL = null, CUR = null;   // CUR: what the panel shows
  const ui = window.CEND_UI = {};

  // ---------------------------------------------------------------- helpers
  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    if (typeof attrs === 'string') el.className = attrs;
    else if (attrs) for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v; else if (k === 'style') el.style.cssText = v;
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const k of kids.flat(Infinity)) {
      if (k == null || k === false || k === '') continue;
      if (typeof k === 'object' && !k.nodeType) { for (const [a, v] of Object.entries(k)) if (v != null && v !== false) { if (a === 'style') el.style.cssText = v; else el.setAttribute(a, v === true ? '' : v); } continue; }
      el.append(k.nodeType ? k : document.createTextNode(String(k)));
    }
    return el;
  }
  const $ = (s, r = ROOT) => r.querySelector(s);
  const DAY = 864e5;
  const D = (s) => { const [y, m, d] = s.split('-').map(Number); return Date.UTC(y, m - 1, d); };
  const iso = (t) => new Date(t).toISOString().slice(0, 10);
  const addD = (s, n) => iso(D(s) + n * DAY);
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const fmt = (s) => { if (!s) return '–'; const d = new Date(D(s)); return `${d.getUTCDate()} ${MON[d.getUTCMonth()]}`; };
  const fmtW = (s) => { if (!s) return '–'; const d = new Date(D(s)); return `${WD[d.getUTCDay()]} ${d.getUTCDate()} ${MON[d.getUTCMonth()]}`; };
  const today = () => DS.localToday();
  const plural = (n, a, b) => `${n} ${n === 1 ? a : (b || a + 's')}`;
  const ISO_RX = /^\d{4}-\d{2}-\d{2}$/;
  const name = () => { try { return localStorage.getItem('cend-name') || ''; } catch (e) { return ''; } };
  const setName = (v) => { try { localStorage.setItem('cend-name', v); } catch (e) { /* ignore */ } };
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const pkName = (p) => (B && B.pk[p] ? B.pk[p].name : p);
  const IC = {
    done: '<svg viewBox="0 0 16 16"><path d="M3.5 8.4l2.9 2.9 6.1-6.6"/></svg>',
    pending: '<svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="5.6"/><path d="M8 5v3.3l2.2 1.4"/></svg>',
    hold: '<svg viewBox="0 0 16 16"><path d="M6 4.5v7M10 4.5v7"/></svg>',
    plus: '<svg viewBox="0 0 16 16"><path d="M8 3v10M3 8h10"/></svg>',
    up: '<svg viewBox="0 0 16 16"><path d="M8 11V3M4.5 6.5L8 3l3.5 3.5M3 13h10"/></svg>',
    gear: '<svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="2.2"/><path d="M8 1.8v1.8M8 12.4v1.8M1.8 8h1.8M12.4 8h1.8M3.6 3.6l1.3 1.3M11.1 11.1l1.3 1.3M12.4 3.6l-1.3 1.3M4.9 11.1l-1.3 1.3"/></svg>',
    cal: '<svg viewBox="0 0 16 16"><rect x="2.5" y="3.5" width="11" height="10" rx="2"/><path d="M2.5 6.8h11M5.5 2v3M10.5 2v3"/><path d="M5.2 9.6h1.4M7.3 9.6h1.4M9.4 9.6h1.4M5.2 11.6h1.4"/></svg>',
    search: '<svg viewBox="0 0 16 16"><circle cx="7" cy="7" r="4.6"/><path d="M10.4 10.4l3.4 3.4"/></svg>',
  };
  const icon = (k) => { const s = h('span', 'cend-ic'); s.innerHTML = IC[k]; return s; };   // constants only

  // ---------------------------------------------------------------- status words
  const SITE_WORD = { done: 'Done on site', pending: 'Pending on site', hold: 'On hold on site' };
  const LOOK_WORD = { Completed: 'Completed', 'Done (inferred)': 'Done (inferred)', Active: 'On plan', Slipping: 'Late', 'On hold': 'On hold', Pending: 'No dates yet',
    'Not in latest plan': 'Not in latest plan', 'Not scheduled': 'Never scheduled', Overdue: 'Overdue', Planned: 'Planned later' };
  const KIND = { done: 'k-done', pending: 'k-site', hold: 'k-hold', Completed: 'k-done', 'Done (inferred)': 'k-done', Active: 'k-plan', Slipping: 'k-late', Overdue: 'k-hold',
    'On hold': 'k-hold', Pending: 'k-uns', 'Not in latest plan': 'k-uns', 'Not scheduled': 'k-uns', Planned: 'k-plan' };
  const siteOf = (a) => (B && B.site[a.k]) || null;
  function stateOf(a) {
    const s = siteOf(a);
    if (s) return { word: SITE_WORD[s.status], kind: KIND[s.status], site: s };
    return { word: LOOK_WORD[a.st] || a.st, kind: KIND[a.st] || 'k-uns', site: null };
  }
  const closed = (a) => { const s = siteOf(a); if (s) return s.status === 'done'; return a.st === 'Completed' || a.st === 'Done (inferred)'; };
  function pill(a) { const s = stateOf(a); return h('span', `cend-pill ${s.kind}`, h('i'), s.word, s.site ? h('small', null, ` · ${fmt(s.site.checked)}`) : ''); }
  const where = (a) => [a.custom ? a.con : null, pkName(a.p), a.sec && a.sec !== 'General' ? a.sec : null, a.sub || null].filter(Boolean).join(' · ');
  const label = (a) => (a.p === 'ROOMS' && a.sec ? `${a.sec}: ${a.n}` : a.sub && (a.p === 'GEN' || a.p === 'CRANE4') ? `${a.sub}: ${a.n}` : a.n);

  // ---------------------------------------------------------------- toast
  const toastEl = h('div', { class: 'cend-toast', role: 'status', 'aria-live': 'polite', hidden: true });
  let toastT = 0;
  function toast(msg, kind) {
    toastEl.textContent = msg; toastEl.className = 'cend-toast' + (kind ? ' is-' + kind : ''); toastEl.hidden = false;
    clearTimeout(toastT); toastT = setTimeout(() => { toastEl.hidden = true; }, kind === 'bad' ? 9000 : 4200);
  }

  // ---------------------------------------------------------------- data cycle
  function refresh() {
    if (!STATE) return;
    try { B = DS.build(STATE, today()); }
    catch (e) { console.error(e); dash.__fail('The saved progress data could not be read.'); return; }
    dash.__setData({ ...(window.__CEND_STATIC || {}), ...B.datasets });
    renderToday();
    const ae = document.activeElement;
    const typing = ae && drawer.contains(ae) && (ae.tagName === 'TEXTAREA' || (ae.tagName === 'INPUT' && ae.type !== 'button'));
    if (CUR && CUR.type === 'act' && !drawer.hidden && !typing) rerenderDrawer();
    updateEditFlags();
  }
  async function boot() {
    try { STATE = await S.loadState(); refresh(); }
    catch (e) { console.error(e); dash.__fail(String(e.message || e)); toast(String(e.message || e), 'bad'); }
  }
  ui.reload = boot;
  ui.state = () => STATE;
  ui.built = () => B;

  /* Save a change for everyone: shown at once here, then written to the repository. */
  async function commit(change, message) {
    if (!S.canEdit()) { openSettings('Editing is not set up on this site yet. Add a GitHub access token below (one time), then try again.'); return false; }
    if (!name()) { const ok = await askName(); if (!ok) return false; }
    const before = STATE;
    const local = clone(STATE); change(local); STATE = local; refresh();
    toast('Saving…');
    try {
      const res = await S.save(change, message, name());
      STATE = res.state; refresh();
      toast('Saved. Everyone sees it the next time they open or reload the dashboard.', 'ok');
      return true;
    } catch (e) {
      console.error(e); STATE = before; refresh();
      toast(`Not saved: ${e.message || e}`, 'bad');
      return false;
    }
  }
  ui.commit = commit;

  // ---------------------------------------------------------------- site checks
  function siteChange(a, rec) {
    return (st) => {
      st.site_checks = st.site_checks || {};
      const prev = st.site_checks[a.k];
      if (!rec) { if (!prev) return false; delete st.site_checks[a.k]; return; }
      const hist = prev ? [{ status: prev.status, checked: prev.checked, note: prev.note || '', by_name: prev.by_name || null, at: prev.at || null }, ...((prev.history || []).slice(0, 11))] : [];
      st.site_checks[a.k] = { status: rec.status, checked: rec.checked, note: rec.note || '', name: label(a).slice(0, 200), pkg: a.p, by_name: name() || null, at: new Date().toISOString(), history: hist };
    };
  }
  function quickCheck(a, status, day) {
    const d = day && day <= today() ? day : today();
    const s = siteOf(a);
    if (s && s.status === status && s.checked === d) { openAct(a.id); return; }
    commit(siteChange(a, { status, checked: d, note: s && s.status === status ? s.note : '' }), `Site check: ${label(a).slice(0, 80)} – ${SITE_WORD[status].toLowerCase()} ${d}`);
  }

  // ---------------------------------------------------------------- tab + page
  const tabBtn = h('button', { class: 'hx-tab', type: 'button', role: 'tab', id: 'tab-today', 'aria-controls': 'today', 'aria-selected': 'false', tabindex: '-1' }, icon('cal'), "Today's activities");
  const page = h('div', { class: 'hx-page cend-page', id: 'today', role: 'tabpanel', 'aria-labelledby': 'tab-today', hidden: true });
  const nav = $('.hx-tabs');
  const ovTab = $('#tab-overview');
  if (ovTab) ovTab.after(tabBtn); else if (nav) nav.append(tabBtn);
  const ov = $('#overview'); if (ov) ov.after(page);
  let todayOn = false;
  function showToday(on, quiet) {
    todayOn = on;
    ROOT.classList.toggle('cend-today-on', on);
    page.hidden = !on;
    if (on) {
      ROOT.querySelectorAll('.hx-tab').forEach((b) => { const me = b === tabBtn; b.setAttribute('aria-selected', String(me)); b.tabIndex = me ? 0 : -1; });
      if (!quiet) dash.setLink('today');
      renderToday();
      const top = page.getBoundingClientRect().top;
      if (!quiet && top < 0) window.scrollBy(0, top - 90);
    } else tabBtn.setAttribute('aria-selected', 'false');
  }
  tabBtn.addEventListener('click', () => showToday(true));
  if (nav) nav.addEventListener('click', (e) => { const b = e.target.closest('.hx-tab'); if (b && b !== tabBtn) showToday(false); }, true);
  if ((location.hash || '') === '#today') setTimeout(() => showToday(true, true), 0);

  // today page skeleton
  const dayTitle = h('h1', 'cend-day');
  const daySub = h('p', 'cend-daysub');
  const btnPrev = h('button', { class: 'cend-icon-btn', type: 'button', 'aria-label': 'Previous day' }, '‹');
  const btnNext = h('button', { class: 'cend-icon-btn', type: 'button', 'aria-label': 'Next day' }, '›');
  const btnToday = h('button', { class: 'cend-chip', type: 'button' }, 'Today');
  const btnAdd = h('button', { class: 'cend-btn', type: 'button' }, icon('plus'), 'Add activity');
  const btnUp = h('button', { class: 'cend-btn ghost', type: 'button' }, icon('up'), 'Upload lookahead');
  const btnSet = h('button', { class: 'cend-btn ghost', type: 'button' }, icon('gear'), 'Settings');
  const q = h('input', { type: 'search', class: 'cend-search', placeholder: 'Find any activity to update, e.g. R05, battery, crane', 'aria-label': 'Find an activity', autocomplete: 'off' });
  const qres = h('div', { class: 'cend-qres', hidden: true });
  const listBox = h('div', 'cend-list');
  const needBox = h('div', 'cend-list');
  const ganttBox = h('div', 'cend-gantt-wrap');
  const fortTitle = h('h2', 'hx-h2');
  page.append(
    h('section', 'hx-panel hx-hud cend-head',
      h('div', 'cend-head-l',
        h('div', 'hx-k', "Today's activities"),
        h('div', 'cend-dayrow', btnPrev, dayTitle, btnNext, btnToday),
        daySub),
      h('div', 'cend-head-r', btnAdd, btnUp, btnSet),
      h('div', 'cend-searchwrap', icon('search'), q, qres)),
    h('div', 'cend-grid',
      h('section', 'hx-panel cend-card', h('div', 'hx-ph', h('div', null, h('div', 'hx-k', 'Planned for the day'), h('h2', 'hx-h2', 'Tap what you saw on site'))), listBox),
      h('section', 'hx-panel cend-card', h('div', 'hx-ph', h('div', null, h('div', 'hx-k', 'Needs a site check'), h('h2', 'hx-h2', 'Planned earlier this fortnight, not confirmed'))), needBox)),
    h('section', 'hx-panel cend-card', h('div', 'hx-ph', h('div', null, h('div', 'hx-k', 'Fortnight'), fortTitle),
      h('div', 'cend-legend', h('span', 'k-plan', h('i'), 'On plan'), h('span', 'k-late', h('i'), 'Late'), h('span', 'k-done', h('i'), 'Done'), h('span', 'k-hold', h('i'), 'On hold'), h('span', 'k-site', h('i'), 'Pending on site'))), ganttBox));
  btnPrev.addEventListener('click', () => { DAYSEL = addD(DAYSEL || today(), -1); renderToday(); });
  btnNext.addEventListener('click', () => { DAYSEL = addD(DAYSEL || today(), 1); renderToday(); });
  btnToday.addEventListener('click', () => { DAYSEL = null; renderToday(); });
  btnAdd.addEventListener('click', () => openForm(null));
  btnUp.addEventListener('click', () => { if (window.CEND_UPLOAD) window.CEND_UPLOAD.open(); else toast('Uploading a lookahead is being finished: Claude needs one sample workbook to build the reader.', 'bad'); });
  btnSet.addEventListener('click', () => openSettings());
  let qT = 0;
  q.addEventListener('input', () => { clearTimeout(qT); qT = setTimeout(renderSearch, 120); });
  q.addEventListener('keydown', (e) => { if (e.key === 'Escape') { q.value = ''; renderSearch(); } });
  function renderSearch() {
    const t = q.value.trim().toLowerCase();
    qres.replaceChildren(); qres.hidden = !t || !B;
    if (!t || !B) return;
    const words = t.split(/\s+/);
    const hits = B.items.filter((a) => { const hay = [a.n, a.sec, a.sub, pkName(a.p), a.p, a.con, ...(a.al || [])].join(' ').toLowerCase(); return words.every((w) => hay.includes(w)); })
      .sort((x, y) => Number(closed(x)) - Number(closed(y)) || (y.lf || '').localeCompare(x.lf || '')).slice(0, 30);
    if (!hits.length) { qres.append(h('div', 'cend-empty', 'No activity matches.')); return; }
    for (const a of hits) qres.append(h('button', { class: 'cend-qrow', type: 'button', onclick: () => { openAct(a.id); } }, h('span', 'cend-qn', label(a)), h('span', 'cend-qw', where(a)), pill(a)));
  }

  function rowFor(a, day, opts = {}) {
    const s = siteOf(a);
    const chips = [];
    if (a.custom) chips.push(h('span', 'cend-tag', a.con));
    if (a.nw) chips.push(h('span', 'cend-tag is-new', 'NEW'));
    if (a.sl > 0 && !closed(a)) chips.push(h('span', 'cend-tag is-late', `+${a.sl} d`));
    for (const c of (B.cons || []).filter((c) => c.act === a.id && c.open)) chips.push(h('span', 'cend-tag is-con', c.cat));
    if (a.custom && a.constraint && a.status !== 'done') chips.push(h('span', 'cend-tag is-con', a.constraint));
    const btn = (st, t) => h('button', { class: `cend-q is-${st}`, type: 'button', 'aria-pressed': String(!!(s && s.status === st)), title: `${SITE_WORD[st]} (${fmtW(day && day <= today() ? day : today())})`,
      onclick: (e) => { e.stopPropagation(); quickCheck(a, st, day); } }, icon(st), h('span', null, t));
    return h('div', { class: `cend-row ${stateOf(a).kind}` },
      h('button', { class: 'cend-rmain', type: 'button', onclick: () => openAct(a.id) },
        h('span', 'cend-rn', label(a)),
        h('span', 'cend-rw', where(a), opts.when ? h('span', 'cend-rwhen', ` · ${opts.when}`) : ''),
        h('span', 'cend-rchips', pill(a), chips)),
      h('div', 'cend-qbtns', btn('done', 'Done'), btn('pending', 'Pending'), btn('hold', 'Hold')));
  }

  function renderToday() {
    if (!B) { dayTitle.textContent = 'Loading…'; return; }
    const t = today(), day = DAYSEL || t;
    dayTitle.textContent = fmtW(day) + (day === t ? '' : '');
    btnToday.hidden = day === t;
    const M = B.meta;
    const planned = B.items.filter((a) => a.days.includes(day));
    const order = B.order;
    planned.sort((x, y) => order.indexOf(x.p) - order.indexOf(y.p) || label(x).localeCompare(label(y)));
    const checked = planned.filter((a) => { const s = siteOf(a); return s && s.checked >= day; }).length;
    const late = planned.filter((a) => !closed(a) && (a.st === 'Slipping' || a.st === 'Overdue')).length;
    daySub.replaceChildren(h('span', null,
      day === t ? 'Today · ' : day < t ? 'Past day · ' : 'Coming up · ',
      `CW${M.latest}–${M.latest + 1} lookahead (${fmt(M.latest_start)} – ${fmt(M.latest_end)}) · `,
      h('b', null, plural(planned.length, 'activity', 'activities')), ' planned',
      planned.length ? [` · ${checked} checked on site`, late ? [' · ', h('span', 'n-amber', `${late} late`)] : ''] : ''));
    listBox.replaceChildren();
    if (!planned.length) listBox.append(h('div', 'cend-empty', D(day) < D(M.latest_start) || D(day) > D(M.latest_end)
      ? `Nothing to show for ${fmtW(day)}: it is outside the CW${M.latest}–${M.latest + 1} lookahead. Upload the next lookahead to plan further ahead.`
      : `Nothing is planned for ${fmtW(day)}.`));
    let lastP = null;
    for (const a of planned) {
      if (a.p !== lastP) { lastP = a.p; listBox.append(h('div', 'cend-grp', pkName(a.p), h('span', null, plural(planned.filter((x) => x.p === a.p).length, 'activity', 'activities')))); }
      listBox.append(rowFor(a, day));
    }
    // planned earlier in the window, not confirmed and not closed
    const need = B.items.filter((a) => a.days.some((d) => d < day && d >= M.latest_start) && !a.days.includes(day) && !closed(a) && !(siteOf(a) && siteOf(a).checked >= a.days.filter((d) => d < day).pop()))
      .sort((x, y) => (x.days.filter((d) => d < day).pop() || '').localeCompare(y.days.filter((d) => d < day).pop() || ''));
    needBox.replaceChildren();
    if (!need.length) needBox.append(h('div', 'cend-empty', 'Everything planned before this day has a site check or is closed.'));
    for (const a of need.slice(0, 40)) { const lastDay = a.days.filter((d) => d < day).pop(); needBox.append(rowFor(a, day, { when: `last planned ${fmtW(lastDay)}` })); }
    renderGantt(day);
    if (q.value) renderSearch();
  }

  function renderGantt(day) {
    const M = B.meta, W0 = M.latest_start, n = Math.max(1, Math.round((D(M.latest_end) - D(W0)) / DAY) + 1);
    const rows = B.items.filter((a) => a.days.length).sort((x, y) => B.order.indexOf(x.p) - B.order.indexOf(y.p) || x.days[0].localeCompare(y.days[0]) || label(x).localeCompare(label(y)));
    fortTitle.textContent = `CW${M.latest}–${M.latest + 1} · ${fmt(W0)} to ${fmt(M.latest_end)} · ${plural(rows.length, 'activity', 'activities')}`;
    const grid = h('div', 'cend-gantt', { style: `--n:${n}` });
    grid.style.setProperty('--n', n);
    const head = h('div', 'cend-gh', h('div', 'cend-glab', h('span', 'hx-k', 'Activity')));
    const t = today();
    for (let i = 0; i < n; i++) { const d = addD(W0, i), dt = new Date(D(d)); head.append(h('div', `cend-gd${dt.getUTCDay() === 0 ? ' sun' : ''}${d === t ? ' now' : ''}${d === day ? ' sel' : ''}`, WD[dt.getUTCDay()].slice(0, 2), h('b', null, dt.getUTCDate()))); }
    grid.append(head);
    let lastP = null;
    for (const a of rows) {
      if (a.p !== lastP) { lastP = a.p; grid.append(h('div', 'cend-ggrp', pkName(a.p))); }
      const k = stateOf(a).kind;
      const track = h('div', 'cend-gt');
      const idx = a.days.map((d) => Math.round((D(d) - D(W0)) / DAY)).filter((i) => i >= 0 && i < n).sort((x, y) => x - y);
      const runs = []; for (const i of idx) { const l = runs[runs.length - 1]; if (l && i === l[1] + 1) l[1] = i; else runs.push([i, i]); }
      for (const [s0, s1] of runs) { const bar = h('i', `cend-gbar ${k}`); bar.style.left = `calc(${(s0 / n) * 100}% + 2px)`; bar.style.width = `calc(${((s1 - s0 + 1) / n) * 100}% - 4px)`; track.append(bar); }
      const ti = Math.round((D(t) - D(W0)) / DAY); if (ti >= 0 && ti < n) { const ln = h('i', 'cend-gnow'); ln.style.left = `${((ti + 0.5) / n) * 100}%`; track.append(ln); }
      grid.append(h('button', { class: `cend-grow ${k}`, type: 'button', onclick: () => openAct(a.id) },
        h('div', 'cend-glab', h('span', 'cend-gn', label(a)), h('span', 'cend-gs', stateOf(a).word, a.sl > 0 && !closed(a) ? ` · +${a.sl} d` : '')), track));
    }
    if (!rows.length) grid.append(h('div', 'cend-empty', 'Nothing is scheduled in this lookahead.'));
    ganttBox.replaceChildren(grid);
  }

  // ---------------------------------------------------------------- panel (drawer)
  const scrim = h('div', { class: 'cend-scrim', hidden: true });
  const drawer = h('aside', { class: 'cend-drawer', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'cend-dt', hidden: true });
  const dCrumb = h('div', 'cend-dcrumb'), dTitle = h('h2', { class: 'cend-dtitle', id: 'cend-dt' }), dStatus = h('div', 'cend-dstatus'), dBody = h('div', 'cend-dbody');
  const dClose = h('button', { class: 'cend-dclose', type: 'button', 'aria-label': 'Close' }, '×');
  drawer.append(h('div', 'cend-dhead', dCrumb, dTitle, dStatus, dClose), dBody);
  ROOT.append(scrim, drawer, toastEl);
  let lastFocus = null;
  function openDrawer() {
    if (drawer.hidden) lastFocus = document.activeElement;
    scrim.hidden = false; drawer.hidden = false; document.documentElement.classList.add('cend-lock');
    requestAnimationFrame(() => dClose.focus());
  }
  function closeDrawer() {
    CUR = null; scrim.hidden = true; drawer.hidden = true; document.documentElement.classList.remove('cend-lock');
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }
  dClose.addEventListener('click', closeDrawer);
  scrim.addEventListener('click', closeDrawer);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !drawer.hidden) closeDrawer(); });
  function rerenderDrawer() {
    if (!CUR) return;
    if (CUR.type === 'act') { const a = B.byId.get(CUR.id) || B.byKey.get(CUR.key); if (a) renderAct(a); else closeDrawer(); }
  }
  ui.openAct = openAct;
  function openAct(id) {
    if (!B) return;
    const a = B.byId.get(Number(id)) || B.byId.get(id); if (!a) return;
    CUR = { type: 'act', id: a.id, key: a.k };
    renderAct(a); openDrawer();
  }
  function fact(k, v, warn) { return h('div', 'cend-fact', h('span', 'hx-k', k), h('b', warn ? 'n-amber' : null, v)); }
  function renderAct(a) {
    dCrumb.replaceChildren(...[a.custom ? a.con : 'ANDRITZ (AHC)', pkName(a.p), a.sec, a.sub].filter(Boolean).map((t, i) => h('span', null, i ? ' · ' : '', t)));
    dTitle.textContent = a.n;
    const s = siteOf(a);
    dStatus.replaceChildren(pill(a), s ? h('span', 'cend-muted', ` lookahead says: ${LOOK_WORD[a.st] || a.st}`) : '', a.custom ? h('span', 'cend-muted', ' · added on the website') : '');
    dBody.replaceChildren();
    // site check
    dBody.append(siteBox(a));
    // facts
    const f = a.custom
      ? [fact('Planned start', fmtW(a.ls)), fact('Planned finish', fmtW(a.lf)), fact('First planned finish', fmtW(a.bf)), fact('Slip', a.sl > 0 ? `+${a.sl} days` : 'none', a.sl >= 7), fact('Re-planned', a.r ? `${a.r}×` : 'no'), fact('Status', a.status === 'done' ? `Done ${fmt(a.d)}` : a.status === 'hold' ? 'On hold' : 'Planned')]
      : [fact('First seen', `CW${a.f}`), fact('First planned finish', fmtW(a.bf)), fact(a.st === 'Completed' && a.d ? 'Completed' : 'Latest planned finish', a.st === 'Completed' && a.d ? fmtW(a.d) : fmtW(a.lf)),
        fact('Slip', a.lf ? (a.sl > 0 ? `+${a.sl} days` : a.sl < 0 ? `${a.sl} days` : 'none') : '–', a.sl >= 7), fact('Rolled over', a.r ? `${a.r}×` : 'no'), fact('Lookaheads', `${a.ns} with dates${a.o.length > a.ns ? `, ${a.o.length - a.ns} without` : ''}`)];
    dBody.append(h('div', 'cend-facts', f));
    if (a.custom) {
      if (a.remark) dBody.append(h('div', 'cend-sec', h('h3', null, 'Note'), h('p', null, a.remark)));
      const msg = h('span', 'cend-msg', { role: 'status' });
      const edit = h('button', { class: 'cend-btn', type: 'button', onclick: () => openForm(a) }, 'Edit');
      const done = a.status !== 'done' ? h('button', { class: 'cend-btn ghost', type: 'button', onclick: () => commit((st) => { const v = st.custom_acts && st.custom_acts[a.doc]; if (!v) return false; v.status = 'done'; v.done_date = today(); v.upd_at = new Date().toISOString(); v.upd_by = name(); }, `Activity done: ${a.n.slice(0, 80)}`) }, 'Mark done today') : null;
      const del = h('button', { class: 'cend-btn ghost danger', type: 'button' }, 'Delete');
      armed(del, 'Delete', 'Select again to delete', async () => { const ok = await commit((st) => { if (!st.custom_acts || !st.custom_acts[a.doc]) return false; delete st.custom_acts[a.doc]; if (st.site_checks) delete st.site_checks[a.k]; }, `Activity deleted: ${a.n.slice(0, 80)}`); if (ok) closeDrawer(); });
      dBody.append(h('div', 'cend-actions', edit, done, del, msg));
    } else {
      // plan history
      const yr = Number(B.meta.latest_start.slice(0, 4));
      const lst = h('ul', 'cend-hist');
      for (const o of [...a.o].reverse()) {
        const ds = o[1].map((m) => `${yr}-${m}`).sort();
        lst.append(h('li', null, h('span', 'cend-mono', `CW${o[0]}`), h('span', null, ds.length ? (ds.length > 1 ? `${fmtW(ds[0])} – ${fmtW(ds[ds.length - 1])} · ${plural(ds.length, 'day')}` : fmtW(ds[0])) : h('span', 'cend-muted', 'listed, no dates'),
          o[2].length ? h('span', 'cend-rem', ` “${o[2].join('; ')}”`) : '')));
      }
      dBody.append(h('div', 'cend-sec', h('h3', null, 'Plan history'), h('p', 'cend-muted', 'Each line is a lookahead that listed the activity, newest first.'), lst));
      if (a.al && a.al.length) dBody.append(h('div', 'cend-sec', h('h3', null, 'Also listed as'), h('ul', 'cend-hist', a.al.map((t) => h('li', null, h('span', null, t))))));
    }
  }
  function armed(btn, text, armedText, fn) {
    let on = false, t = 0;
    btn.addEventListener('click', () => {
      if (!on) { on = true; btn.textContent = armedText; clearTimeout(t); t = setTimeout(() => { on = false; btn.textContent = text; }, 4000); return; }
      on = false; clearTimeout(t); btn.textContent = text; fn();
    });
  }
  function siteBox(a) {
    const s = siteOf(a);
    const box = h('div', 'cend-site');
    box.append(h('div', 'cend-site-h', h('h3', null, 'Site check'), h('span', 'cend-muted', 'Record what you found on site. It overrides the lookahead status for everyone.')));
    if (s) {
      box.append(h('div', 'cend-site-rec', h('span', `cend-pill ${KIND[s.status]}`, h('i'), SITE_WORD[s.status]), ` checked ${fmtW(s.checked)}`, s.by_name ? h('span', 'cend-muted', ` by ${s.by_name}`) : ''),
        s.note ? h('p', 'cend-note', `“${s.note}”`) : '');
      if (s.history && s.history.length) box.append(h('p', 'cend-muted cend-small', 'Earlier: ', s.history.slice(0, 4).map((x, i) => `${i ? ' · ' : ''}${fmt(x.checked)} ${(SITE_WORD[x.status] || x.status).replace(' on site', '').toLowerCase()}`)));
    } else box.append(h('p', 'cend-muted', 'No site check recorded yet. The status comes from the lookaheads.'));
    let choice = s ? s.status : null;
    const chips = ['done', 'pending', 'hold'].map((v) => h('button', { class: `cend-chip is-${v}`, type: 'button', role: 'radio', 'aria-checked': String(choice === v),
      onclick: () => { choice = v; chips.forEach((c) => c.setAttribute('aria-checked', String(c.dataset.v === v))); save.disabled = false; }, 'data-v': v }, icon(v), { done: 'Done on site', pending: 'Still pending', hold: 'On hold' }[v]));
    const date = h('input', { type: 'date', class: 'cend-in', max: today(), 'aria-label': 'Date checked' }); date.value = s ? s.checked : (DAYSEL && DAYSEL <= today() ? DAYSEL : today());
    const note = h('textarea', { class: 'cend-in', rows: 2, maxlength: 500, placeholder: 'What you found, e.g. cable tray at north wall not finished', 'aria-label': 'Note' }); note.value = s && s.note ? s.note : '';
    const save = h('button', { class: 'cend-btn', type: 'button', disabled: !choice }, 'Save site check');
    const clr = h('button', { class: 'cend-btn ghost', type: 'button', hidden: !s }, 'Clear site check');
    save.addEventListener('click', () => { if (!choice) return; const d = ISO_RX.test(date.value) && date.value <= today() ? date.value : today(); commit(siteChange(a, { status: choice, checked: d, note: note.value.trim().slice(0, 500) }), `Site check: ${label(a).slice(0, 80)} – ${SITE_WORD[choice].toLowerCase()} ${d}`); });
    armed(clr, 'Clear site check', 'Select again to clear', () => commit(siteChange(a, null), `Site check cleared: ${label(a).slice(0, 80)}`));
    box.append(h('div', 'cend-form',
      h('div', null, h('span', 'cend-fl', 'Status found on site'), h('div', { class: 'cend-chips', role: 'radiogroup', 'aria-label': 'Status found on site' }, chips)),
      h('div', 'cend-f2', h('label', null, h('span', 'cend-fl', 'Date checked'), date), h('label', null, h('span', 'cend-fl', 'Note (optional)'), note)),
      h('div', 'cend-actions', save, clr)));
    return box;
  }

  // ---------------------------------------------------------------- add / edit activity
  const CON_CATS = ['Material', 'Outage / LOTO', 'Crane & Lifting', 'Manpower', 'Approval', 'Dependency', 'Logistics'];
  function openForm(a) {
    if (!B) return;
    CUR = { type: 'form' };
    const v = a ? { ...a.raw } : { contractor: '', pkg: '', area: '', name: '', start: today(), finish: today(), status: 'planned', done_date: '', constraint: '', note: '' };
    dCrumb.replaceChildren(h('span', null, a ? `${a.con} · ${pkName(a.p)}` : 'Added on the website'));
    dTitle.textContent = a ? 'Edit activity' : 'Add an activity';
    dStatus.replaceChildren(h('p', 'cend-muted', 'For work that isn’t in the ANDRITZ lookaheads, such as another contractor’s scope. It appears in every view, for everyone.'));
    const cons = [...new Set(B.items.filter((x) => x.custom).map((x) => x.con))];
    const field = (lbl, ctrl, hint) => h('label', 'cend-ff', h('span', 'cend-fl', lbl), ctrl, hint ? h('span', 'cend-hint', hint) : '');
    const inp = (val, attrs) => { const i = h('input', { class: 'cend-in', type: 'text', ...attrs }); i.value = val || ''; return i; };
    const con = inp(v.contractor, { list: 'cend-dl-con', maxlength: 60, placeholder: 'e.g. REMACO' });
    const pkg = inp(v.pkg, { list: 'cend-dl-pkg', maxlength: 60, placeholder: 'e.g. GT4, Generator U4, EPS' });
    const area = inp(v.area, { maxlength: 80, placeholder: 'Optional, e.g. Switchyard' });
    const nm = h('textarea', { class: 'cend-in', rows: 2, maxlength: 200, placeholder: 'e.g. GT4 oil filtration and dielectric test' }); nm.value = v.name || '';
    const start = inp(v.start, { type: 'date' }), finish = inp(v.finish, { type: 'date' });
    let status = v.status || 'planned';
    const doneD = inp(v.done_date || today(), { type: 'date', max: today() });
    const doneWrap = field('Done on', doneD); doneWrap.hidden = status !== 'done';
    const stBtns = [['planned', 'Planned'], ['done', 'Done'], ['hold', 'On hold']].map(([k, t]) => h('button', { class: 'cend-chip', type: 'button', role: 'radio', 'aria-checked': String(status === k), 'data-v': k,
      onclick: () => { status = k; stBtns.forEach((b) => b.setAttribute('aria-checked', String(b.dataset.v === k))); doneWrap.hidden = k !== 'done'; } }, t));
    const cons2 = h('select', { class: 'cend-in' }, h('option', { value: '' }, 'None'), CON_CATS.map((c) => h('option', { value: c }, c))); cons2.value = v.constraint || '';
    const note = h('textarea', { class: 'cend-in', rows: 2, maxlength: 500, placeholder: 'Optional, e.g. waiting for TNB outage approval' }); note.value = v.note || '';
    const msg = h('span', 'cend-msg', { role: 'status' });
    const saveB = h('button', { class: 'cend-btn', type: 'button' }, a ? 'Save changes' : 'Add activity');
    const cancel = h('button', { class: 'cend-btn ghost', type: 'button', onclick: () => { if (a) openAct(a.id); else closeDrawer(); } }, 'Cancel');
    saveB.addEventListener('click', async () => {
      const val = { contractor: con.value.trim(), pkg: pkg.value.trim(), area: area.value.trim(), name: nm.value.trim().replace(/\s+/g, ' '), start: start.value, finish: finish.value, status, done_date: status === 'done' ? doneD.value : '', constraint: cons2.value, note: note.value.trim() };
      const miss = [!val.contractor && 'contractor', !val.pkg && 'package', !val.name && 'activity', !ISO_RX.test(val.start) && 'planned start', !ISO_RX.test(val.finish) && 'planned finish'].filter(Boolean);
      if (miss.length) { msg.textContent = `Fill in the ${miss.join(', ')}.`; return; }
      if (val.finish < val.start) { msg.textContent = 'The planned finish is before the planned start.'; return; }
      saveB.disabled = true;
      const now = new Date().toISOString(), who = name();
      const docId = a ? a.doc : 'a' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
      const ok = await commit((st) => {
        st.custom_acts = st.custom_acts || {};
        const prev = st.custom_acts[docId];
        if (!prev) { st.custom_acts[docId] = { ...val, base_start: val.start, base_finish: val.finish, replans: 0, history: [], by: who, at: now, upd_by: who, upd_at: now }; return; }
        const hist = Array.isArray(prev.history) ? prev.history.slice(0, 19) : [];
        let replans = prev.replans || 0;
        if (prev.start !== val.start || prev.finish !== val.finish) { hist.unshift({ start: prev.start, finish: prev.finish, at: now, by: who }); if (prev.finish !== val.finish) replans++; }
        st.custom_acts[docId] = { ...val, base_start: prev.base_start || prev.start, base_finish: prev.base_finish || prev.finish, replans, history: hist, by: prev.by || who, at: prev.at || now, upd_by: who, upd_at: now };
      }, `${a ? 'Activity edited' : 'Activity added'}: ${val.name.slice(0, 80)}`);
      saveB.disabled = false;
      if (ok) { const it = B.items.find((x) => x.doc === docId); if (it) openAct(it.id); else closeDrawer(); }
    });
    dBody.replaceChildren(h('div', 'cend-form',
      h('datalist', { id: 'cend-dl-con' }, cons.map((c) => h('option', { value: c }))),
      h('datalist', { id: 'cend-dl-pkg' }, B.order.map((p) => h('option', { value: pkName(p) }))),
      h('div', 'cend-f2', field('Contractor', con), field('Package', pkg, 'Pick one, or type a new name such as GT4.')),
      field('Area or section', area), field('Activity', nm),
      h('div', 'cend-f2', field('Planned start', start), field('Planned finish', finish, a ? 'Changing the dates keeps the first planned finish, so slip is tracked.' : '')),
      h('div', null, h('span', 'cend-fl', 'Status'), h('div', { class: 'cend-chips', role: 'radiogroup', 'aria-label': 'Status' }, stBtns)), doneWrap,
      h('div', 'cend-f2', field('Constraint', cons2), field('Note', note)),
      h('div', 'cend-actions', saveB, cancel, msg)));
    openDrawer();
  }
  ui.openForm = openForm;

  // ---------------------------------------------------------------- name prompt
  function askName() {
    return new Promise((resolve) => {
      CUR = { type: 'name' };
      dCrumb.replaceChildren(h('span', null, 'Before your first change'));
      dTitle.textContent = 'Your name';
      dStatus.replaceChildren(h('p', 'cend-muted', 'Shown next to the site checks and activities you record, so the team knows who updated what. Saved on this device only.'));
      const inp = h('input', { class: 'cend-in', type: 'text', maxlength: 40, placeholder: 'e.g. Aizuddin', autocomplete: 'name' });
      const ok = h('button', { class: 'cend-btn', type: 'button' }, 'Continue');
      const go = () => { const v = inp.value.trim(); if (!v) { inp.focus(); return; } setName(v); closeDrawer(); resolve(true); };
      ok.addEventListener('click', go); inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
      dBody.replaceChildren(h('div', 'cend-form', h('label', 'cend-ff', h('span', 'cend-fl', 'Name'), inp), h('div', 'cend-actions', ok, h('button', { class: 'cend-btn ghost', type: 'button', onclick: () => { closeDrawer(); resolve(false); } }, 'Cancel'))));
      openDrawer(); setTimeout(() => inp.focus(), 50);
    });
  }

  // ---------------------------------------------------------------- settings
  function openSettings(note) {
    CUR = { type: 'settings' };
    const sec = S.secrets() || {};
    dCrumb.replaceChildren(h('span', null, 'Website'));
    dTitle.textContent = 'Settings';
    dStatus.replaceChildren(note ? h('p', 'cend-alert', note) : h('p', 'cend-muted', S.canEdit() ? 'Editing is on: anyone with the dashboard password can record site checks, add activities and upload lookaheads.' : 'Editing is not set up yet. The dashboard is view-only until a GitHub access token is added.'));
    // name
    const nm = h('input', { class: 'cend-in', type: 'text', maxlength: 40, placeholder: 'e.g. Aizuddin' }); nm.value = name();
    const nmSave = h('button', { class: 'cend-btn ghost', type: 'button', onclick: () => { setName(nm.value.trim()); toast('Name saved on this device.', 'ok'); } }, 'Save name');
    // token
    const tok = h('input', { class: 'cend-in', type: 'password', placeholder: sec.github_token ? 'A token is set. Paste a new one to replace it.' : 'github_pat_…', autocomplete: 'off', spellcheck: 'false' });
    const tokMsg = h('span', 'cend-msg', { role: 'status' });
    const tokSave = h('button', { class: 'cend-btn', type: 'button' }, sec.github_token ? 'Replace token' : 'Turn on editing');
    tokSave.addEventListener('click', async () => {
      const t = tok.value.trim(); if (!t) { tokMsg.textContent = 'Paste the token first.'; return; }
      tokSave.disabled = true; tokMsg.textContent = 'Checking the token…';
      try { await S.checkToken(t); tokMsg.textContent = 'Saving…'; await S.saveSecrets({ github_token: t, set_by: name() || null, set_at: new Date().toISOString() }, t); tokMsg.textContent = 'Editing is on.'; tok.value = ''; updateEditFlags(); await boot(); openSettings(); toast('Editing is on for everyone with the password.', 'ok'); }
      catch (e) { tokMsg.textContent = String(e.message || e); }
      finally { tokSave.disabled = false; }
    });
    // gemini
    const gk = h('input', { class: 'cend-in', type: 'password', placeholder: sec.gemini_key ? 'A key is set. Paste a new one to replace it.' : 'AIza…', autocomplete: 'off', spellcheck: 'false' });
    const gMsg = h('span', 'cend-msg', { role: 'status' });
    const gSave = h('button', { class: 'cend-btn', type: 'button' }, sec.gemini_key ? 'Replace key' : 'Save key');
    gSave.addEventListener('click', async () => {
      const k = gk.value.trim(); if (!k) { gMsg.textContent = 'Paste the key first.'; return; }
      if (!S.canEdit()) { gMsg.textContent = 'Turn on editing first (GitHub token above).'; return; }
      gSave.disabled = true; gMsg.textContent = 'Checking the key…';
      try {
        const model = window.CEND_GEMINI ? await window.CEND_GEMINI.pickModel(k) : null;
        await S.saveSecrets({ gemini_key: k, gemini_model: model }); gk.value = ''; gMsg.textContent = `Saved${model ? `, using ${model}` : ''}.`;
      } catch (e) { gMsg.textContent = String(e.message || e); }
      finally { gSave.disabled = false; }
    });
    const log = (STATE && STATE.log || []).slice(0, 12);
    dBody.replaceChildren(
      h('div', 'cend-sec', h('h3', null, 'Your name'), h('p', 'cend-muted', 'Shown next to what you record. Saved on this device only.'), h('div', 'cend-inline', nm, nmSave)),
      h('div', 'cend-sec', h('h3', null, 'Editing (GitHub access token)'),
        h('p', 'cend-muted', 'Changes are saved as encrypted files in the GitHub repository. A token lets this website write them. It is stored encrypted, so only people with the dashboard password can use it.'),
        h('ol', 'cend-steps',
          h('li', null, 'On GitHub, open Settings → Developer settings → Personal access tokens → ', h('b', null, 'Fine-grained tokens'), ' → Generate new token.'),
          h('li', null, 'Name it “CEND dashboard”. Set the longest expiry you’re allowed (up to a year), and note the date.'),
          h('li', null, 'Repository access: ', h('b', null, 'Only select repositories'), ` → ${S.REPO.split('/')[1]}.`),
          h('li', null, 'Permissions → Repository permissions → ', h('b', null, 'Contents: Read and write'), '. Nothing else is needed.'),
          h('li', null, 'Generate, copy the token (starts with github_pat_) and paste it here.')),
        sec.set_at ? h('p', 'cend-muted cend-small', `Current token set ${fmt(sec.set_at.slice(0, 10))}${sec.set_by ? ` by ${sec.set_by}` : ''}.`) : '',
        h('div', 'cend-inline', tok, tokSave), tokMsg),
      h('div', 'cend-sec', h('h3', null, 'Gemini (for reading lookaheads)'),
        h('p', 'cend-muted', 'Used only when you upload a lookahead: Gemini suggests which new rows are renamed versions of existing activities, and sorts new remarks into constraint types. Get a key at aistudio.google.com → Get API key.'),
        sec.gemini_key ? h('p', 'cend-muted cend-small', `A key is set${sec.gemini_model ? `, model ${sec.gemini_model}` : ''}.`) : '',
        h('div', 'cend-inline', gk, gSave), gMsg),
      h('div', 'cend-sec', h('h3', null, 'Recent changes'),
        log.length ? h('ul', 'cend-hist', log.map((x) => h('li', null, h('span', 'cend-mono', `${fmt(x.at.slice(0, 10))} ${x.at.slice(11, 16)}`), h('span', null, x.what, x.by ? h('span', 'cend-muted', ` · ${x.by}`) : '')))) : h('p', 'cend-muted', 'No changes recorded on the website yet.')));
    openDrawer();
  }
  ui.openSettings = openSettings;

  // ---------------------------------------------------------------- hooks into the dashboard
  ROOT.addEventListener('click', (e) => {
    const r = e.target.closest('#runway .g-row[data-id], #chase tr[data-key]');
    if (!r || !B) return;
    openAct(r.dataset.id || r.dataset.key);
  });
  function updateEditFlags() { ROOT.classList.toggle('cend-ro', !S.canEdit()); }
  // floating settings button beside Lock
  const gearBtn = h('button', { class: 'cend-gear', type: 'button', title: 'Settings', 'aria-label': 'Settings', onclick: () => openSettings() }, icon('gear'));
  document.body.append(gearBtn);

  boot();
})();
