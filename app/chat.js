/* The dashboard assistant: a round bot button that opens a chat. Gemini answers from all the dashboard
   data (CEND_CHATDATA builds it) and can't change anything. Answers stream in, activity ids in an answer
   open the activity panel, and every answer can be copied as plain text. The conversation is kept for
   this browser tab only. */
(function () {
  'use strict';
  const UI = window.CEND_UI;
  const ROOT = document.querySelector('.hx');
  if (!UI || !ROOT) return;
  const { h } = UI;
  const KEEP = 'cend-chat-v1';
  const MAX_TURNS = 16;
  let MSGS = load();
  let busy = null;            // AbortController while an answer is coming
  let IDS = new Map();        // activity id -> key, from the last context
  const BOT = '<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M16 4.6v3.6"/><circle cx="16" cy="3.9" r="1.5" class="f"/><rect x="7.5" y="8.2" width="17" height="14" rx="5.5"/><circle cx="12.6" cy="14.6" r="1.8" class="f"/><circle cx="19.4" cy="14.6" r="1.8" class="f"/><path d="M12.8 18.6c1.9 1.4 4.5 1.4 6.4 0"/><path d="M5 13.2v4.4M27 13.2v4.4"/><path d="M11.5 22.2v3.2h9v-3.2"/></svg>';
  const IC = {
    send: '<svg viewBox="0 0 16 16"><path d="M2.5 8h9M8 4l4 4-4 4"/></svg>',
    stop: '<svg viewBox="0 0 16 16"><rect x="4" y="4" width="8" height="8" rx="1.5"/></svg>',
    fresh: '<svg viewBox="0 0 16 16"><path d="M13 8a5 5 0 1 1-1.5-3.6M13 2.8v2.6h-2.6"/></svg>',
    copy: '<svg viewBox="0 0 16 16"><rect x="5.5" y="5.5" width="8" height="8" rx="1.6"/><path d="M10.5 5.5V3.8c0-.7-.6-1.3-1.3-1.3H3.8c-.7 0-1.3.6-1.3 1.3v5.4c0 .7.6 1.3 1.3 1.3h1.7"/></svg>',
    open: '<svg viewBox="0 0 16 16"><path d="M6 3.5H3.5v9h9V10M9 2.5h4.5V7M13.5 2.5 7.5 8.5"/></svg>',
  };
  const svg = (s, cls) => { const e = h('span', cls || 'cend-ic'); e.innerHTML = s; return e; };   // constants only

  function load() { try { const v = JSON.parse(sessionStorage.getItem(KEEP) || '[]'); return Array.isArray(v) ? v.filter((m) => m && typeof m.text === 'string' && ['user', 'model', 'error'].includes(m.role)) : []; } catch (e) { return []; } }
  function keep() { try { sessionStorage.setItem(KEEP, JSON.stringify(MSGS.filter((m) => !m.pending).slice(-40))); } catch (e) { /* storage off */ } }

  // ---------------------------------------------------------------- elements
  const btn = h('button', { class: 'cend-bot', type: 'button', title: 'Ask the dashboard', 'aria-label': 'Ask the dashboard (AI assistant)', 'aria-expanded': 'false', 'aria-controls': 'cend-chat' });
  btn.append(svg(BOT, 'cend-bot-ic'));
  const log = h('div', { class: 'cend-chat-log', 'aria-live': 'polite' });
  const ta = h('textarea', { class: 'cend-chat-in', rows: 1, maxlength: 2000, placeholder: 'Ask about progress, delays, constraints…', 'aria-label': 'Your question' });
  const sendB = h('button', { class: 'cend-chat-send', type: 'button', 'aria-label': 'Send' }, svg(IC.send));
  const freshB = h('button', { class: 'cend-chat-hbtn', type: 'button', title: 'New chat', 'aria-label': 'New chat' }, svg(IC.fresh));
  const closeB = h('button', { class: 'cend-chat-hbtn', type: 'button', title: 'Close', 'aria-label': 'Close' }, '×');
  const sub = h('div', 'cend-chat-sub', 'Gemini · reads all the dashboard data · can’t change anything');
  const panel = h('section', { class: 'cend-chat', id: 'cend-chat', role: 'dialog', 'aria-label': 'Ask the dashboard', hidden: true },
    h('header', 'cend-chat-head', svg(BOT, 'cend-chat-logo'), h('div', 'cend-chat-ttl', h('b', null, 'Ask the dashboard'), sub), freshB, closeB),
    log,
    h('div', 'cend-chat-foot', h('div', 'cend-chat-box', ta, sendB), h('p', 'cend-chat-note', 'Answers come from the dashboard data and can be wrong. Check before sending them on.')));
  ROOT.append(panel, btn);

  function open(on) {
    panel.hidden = !on;
    btn.setAttribute('aria-expanded', String(on));
    btn.classList.toggle('is-on', on);
    document.documentElement.classList.toggle('cend-chat-on', on);
    if (on) { render(); setTimeout(() => { ta.focus(); log.scrollTop = log.scrollHeight; }, 30); }
  }
  btn.addEventListener('click', () => open(panel.hidden));
  closeB.addEventListener('click', () => { open(false); btn.focus(); });
  freshB.addEventListener('click', () => { if (busy) busy.abort(); MSGS = []; keep(); render(); ta.focus(); });
  panel.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !document.querySelector('.cend-drawer:not([hidden])')) { e.stopPropagation(); open(false); btn.focus(); } });
  ta.addEventListener('input', grow);
  ta.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(ta.value); } });
  sendB.addEventListener('click', () => { if (busy) busy.abort(); else send(ta.value); });
  function grow() { ta.style.height = 'auto'; ta.style.height = `${Math.min(140, ta.scrollHeight)}px`; }

  // ---------------------------------------------------------------- suggested questions
  function prompts() {
    const st = UI.state(); if (!st) return [];
    const cws = st.model.meta.lookaheads.map((l) => l.cw).sort((a, b) => a - b);
    const L = cws[cws.length - 1], P = cws[cws.length - 2];
    const v = UI.view();
    return [
      v ? `What was planned in the CW${v.cw} lookahead, and what happened to it afterwards?` : null,
      'What’s late right now, by package, and why?',
      'Draft today’s progress update for WhatsApp.',
      P ? `What changed from the CW${P} to the CW${L} lookahead?` : null,
      'Which constraints are open, and what do I need to chase this week?',
      'How is the Generator U1 refurbishment at Vantage going?',
    ].filter(Boolean);
  }

  // ---------------------------------------------------------------- answers as safe formatted text
  const CHIP_RX = /\((#\d{1,6}(?:\s*,\s*#\d{1,6})*)\)/;
  function inline(el, text) {
    const RX = /(`[^`\n]+`)|(\*\*[^*\n]+\*\*)|(__[^_\n]+__)|(\*[^*\s\n][^*\n]*\*)|(\[[^\]\n]+\]\(https?:\/\/[^)\s]+\))|(\((?:#\d{1,6}(?:\s*,\s*#\d{1,6})*)\))/g;
    let at = 0, m;
    while ((m = RX.exec(text))) {
      if (m.index > at) el.append(document.createTextNode(text.slice(at, m.index)));
      const t = m[0];
      if (m[1]) el.append(h('code', null, t.slice(1, -1)));
      else if (m[2] || m[3]) { const b = h('strong'); inline(b, t.slice(2, -2)); el.append(b); }
      else if (m[4]) { const i = h('em'); inline(i, t.slice(1, -1)); el.append(i); }
      else if (m[5]) { const mm = /^\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)$/.exec(t); el.append(h('a', { href: mm[2], target: '_blank', rel: 'noopener noreferrer' }, mm[1])); }
      else if (m[6]) {
        const nums = CHIP_RX.exec(t)[1].split(',').map((x) => Number(x.trim().slice(1)));
        if (!nums.every((n) => IDS.has(n))) el.append(document.createTextNode(t));
        else nums.forEach((n) => el.append(' ', h('button', { class: 'cend-ref', type: 'button', title: 'Open this activity', onclick: () => UI.openAct(IDS.get(n)) }, svg(IC.open), `#${n}`)));
      }
      at = m.index + t.length;
    }
    if (at < text.length) el.append(document.createTextNode(text.slice(at)));
  }
  const ITEM = /^(\s*)([-*•]|\d{1,3}[.)])\s+(.*)$/;
  const ind = (l) => /^\s*/.exec(l)[0].replace(/\t/g, '  ').length;
  function list(lines, i) {
    const base = ind(lines[i]);
    const el = h(/^\s*\d/.test(lines[i]) ? 'ol' : 'ul');
    let li = null;
    while (i < lines.length) {
      const l = lines[i];
      if (!l.trim()) { if (i + 1 < lines.length && ITEM.test(lines[i + 1]) && ind(lines[i + 1]) >= base) { i++; continue; } break; }
      const m = ITEM.exec(l), n = ind(l);
      if (m && n === base) { li = h('li'); inline(li, m[3]); el.append(li); i++; continue; }
      if (m && n > base && li) { const [s2, ni] = list(lines, i); li.append(s2); i = ni; continue; }
      if (!m && n > base && li) { li.append(h('br')); inline(li, l.trim()); i++; continue; }
      break;
    }
    return [el, i];
  }
  function table(rows) {
    const cells = (r) => r.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
    const body = rows.filter((r) => !/^\s*\|?\s*:?-{2,}/.test(r));
    const t = h('table');
    body.forEach((r, k) => { const tr = h('tr'); for (const c of cells(r)) { const td = h(k === 0 ? 'th' : 'td'); inline(td, c); tr.append(td); } t.append(tr); });
    return h('div', 'cend-md-tw', t);
  }
  function md(src) {
    const out = document.createDocumentFragment();
    const lines = String(src).replace(/\r/g, '').split('\n');
    const para = [];
    const flush = () => { if (!para.length) return; const p = h('p'); para.forEach((l, k) => { if (k) p.append(h('br')); inline(p, l); }); out.append(p); para.length = 0; };
    for (let i = 0; i < lines.length;) {
      const l = lines[i]; let m;
      if (!l.trim()) { flush(); i++; continue; }
      if (/^\s*```/.test(l)) { flush(); const buf = []; i++; while (i < lines.length && !/^\s*```/.test(lines[i])) buf.push(lines[i++]); i++; out.append(h('pre', null, buf.join('\n'))); continue; }
      if ((m = /^\s{0,3}#{1,6}\s+(.*)$/.exec(l))) { flush(); const e = h('h4'); inline(e, m[1].replace(/\s*#+\s*$/, '')); out.append(e); i++; continue; }
      if (/^\s*\|.*\|\s*$/.test(l)) { flush(); const rows = []; while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) rows.push(lines[i++]); out.append(table(rows)); continue; }
      if (ITEM.test(l)) { flush(); const [e, ni] = list(lines, i); out.append(e); i = ni; continue; }
      if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(l)) { flush(); out.append(h('hr')); i++; continue; }
      para.push(l); i++;
    }
    flush();
    return out;
  }

  // ---------------------------------------------------------------- drawing the conversation
  async function copy(text, b) {
    let ok = false;
    try { await navigator.clipboard.writeText(text); ok = true; }
    catch (e) { const t = h('textarea', { style: 'position:fixed;left:-9999px;top:0' }); t.value = text; document.body.append(t); t.select(); try { ok = document.execCommand('copy'); } catch (e2) { ok = false; } t.remove(); }
    const was = b.lastChild.textContent; b.lastChild.textContent = ok ? 'Copied' : 'Copy failed'; setTimeout(() => { b.lastChild.textContent = was; }, 1600);
  }
  function bubble(m, i) {
    if (m.role === 'user') return h('div', 'cend-msg is-u', h('p', null, m.text));
    if (m.role === 'error') {
      return h('div', 'cend-msg is-e', h('p', null, m.text),
        h('div', 'cend-msg-a', m.retry ? h('button', { class: 'cend-chip', type: 'button', onclick: () => { MSGS.splice(i, 1); const u = MSGS[i - 1]; if (u && u.role === 'user' && u.text === m.retry) MSGS.splice(i - 1, 1); send(m.retry); } }, 'Try again') : '',
          /key/i.test(m.text) ? h('button', { class: 'cend-chip', type: 'button', onclick: () => { open(false); UI.openSettings(); } }, 'Open Settings') : ''));
    }
    const body = h('div', 'cend-md');
    if (m.text) body.append(md(m.text)); else body.append(h('span', 'cend-typing', h('i'), h('i'), h('i')));
    const acts = m.pending ? '' : h('div', 'cend-msg-a',
      h('button', { class: 'cend-chip', type: 'button', onclick: (e) => copy(m.text, e.currentTarget) }, svg(IC.copy), h('span', null, 'Copy')),
      m.stopped ? h('span', 'cend-muted cend-small', 'Stopped') : m.cut ? h('span', 'cend-muted cend-small', 'Answer cut short; ask “continue”') : '');
    return h('div', `cend-msg is-b${m.pending ? ' is-live' : ''}`, body, acts);
  }
  function empty() {
    const sec = (window.CEND_STORE.secrets && window.CEND_STORE.secrets()) || {};
    if (!sec.gemini_key) return h('div', 'cend-chat-empty', h('p', null, 'The assistant needs a Gemini API key. Add one in Settings → Gemini; everyone with the dashboard password can then use it.'),
      h('button', { class: 'cend-btn', type: 'button', onclick: () => { open(false); UI.openSettings(); } }, 'Open Settings'));
    return h('div', 'cend-chat-empty',
      h('p', 'cend-chat-hi', 'Ask anything about the electrical progress, in English or Malay: the latest lookahead, any past week, site checks, constraints, slips or the Generator U1 refurbishment.'),
      h('div', 'cend-chat-sugs', prompts().map((t) => h('button', { class: 'cend-chat-sug', type: 'button', onclick: () => send(t) }, t))));
  }
  function render() {
    if (panel.hidden) return;
    if (!IDS.size && UI.state()) { try { IDS = new Map(window.CEND_DATA.build(UI.state(), window.CEND_DATA.localToday()).items.map((a) => [a.id, a.k])); } catch (e) { /* drawn without links */ } }
    const near = log.scrollHeight - log.scrollTop - log.clientHeight < 80;
    log.replaceChildren(...(MSGS.length ? MSGS.map(bubble) : [empty()]));
    sendB.replaceChildren(svg(busy ? IC.stop : IC.send)); sendB.setAttribute('aria-label', busy ? 'Stop' : 'Send'); sendB.classList.toggle('is-stop', !!busy);
    if (near || busy) log.scrollTop = log.scrollHeight;
  }
  let raf = 0;
  const soon = () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; render(); }); };

  // ---------------------------------------------------------------- asking
  function turns() {
    // the conversation for Gemini: user/model turns only, alternating, starting with the person
    const out = [];
    for (const m of MSGS) {
      if (m.pending || m.role === 'error' || !m.text) continue;
      const last = out[out.length - 1];
      if (last && last.role === m.role) last.text += `\n\n${m.text}`; else out.push({ role: m.role, text: m.text });
    }
    while (out.length && out[0].role !== 'user') out.shift();
    return out.slice(-MAX_TURNS * 2);
  }
  async function send(text) {
    text = String(text || '').trim();
    if (!text || busy) return;
    const S = window.CEND_STORE, G = window.CEND_GEMINI, DS = window.CEND_DATA, CD = window.CEND_CHATDATA;
    const sec = (S.secrets && S.secrets()) || {};
    ta.value = ''; grow();
    MSGS.push({ role: 'user', text });
    if (!sec.gemini_key) { MSGS.push({ role: 'error', text: 'No Gemini key is set. Add one in Settings → Gemini.' }); keep(); render(); return; }
    const msg = { role: 'model', text: '', pending: true };
    MSGS.push(msg);
    busy = new AbortController();
    render();
    try {
      const st = UI.state();
      if (!st) throw new Error('The dashboard data has not loaded yet.');
      const ctx = CD.context(st, { today: DS.localToday(), view: UI.view(), static: window.__CEND_STATIC || {} });
      IDS = ctx.ids;
      const res = await G.chatStream(sec, { system: ctx.system, history: turns(), signal: busy.signal, onText: (t) => { msg.text = t; soon(); } });
      msg.text = res.text; msg.model = res.model; if (res.finish === 'MAX_TOKENS') msg.cut = true;
      sub.textContent = `${res.model} · reads all the dashboard data · can’t change anything`;
    } catch (e) {
      if (e && e.name === 'AbortError') { msg.stopped = true; if (!msg.text) MSGS.splice(MSGS.indexOf(msg), 1); }
      else { console.warn(e); MSGS.splice(MSGS.indexOf(msg), 1); MSGS.push({ role: 'error', text: String((e && e.message) || e), retry: text }); }
    } finally {
      delete msg.pending; busy = null; keep(); render();
    }
  }

  window.CEND_CHAT = { open: () => open(true), ask: (t) => { open(true); send(t); } };
})();
