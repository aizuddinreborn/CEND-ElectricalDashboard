/* Gemini (Google AI Studio key) for the lookahead upload. Two small questions, both answered as JSON:
   - which new rows are reworded versions of activities already tracked,
   - which constraint type a new remark is.
   Gemini only suggests: everything it says is shown on the review screen before anything is saved. */
(function (root) {
  'use strict';
  const BASE = 'https://generativelanguage.googleapis.com/v1beta';
  const CATS = ['Outage / LOTO', 'Material', 'Crane & Lifting', 'Manpower', 'Approval', 'Logistics', 'Dependency'];
  let picked = null;   // { key, model } found by listing the key's models

  async function req(path, key, body, ms = 90000) {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), ms);
    let r;
    try {
      r = await fetch(BASE + path, {
        method: body ? 'POST' : 'GET', signal: ac.signal, cache: 'no-store',
        headers: { 'x-goog-api-key': key, ...(body ? { 'Content-Type': 'application/json' } : {}) },
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch (e) {
      throw new Error(e.name === 'AbortError' ? 'Gemini took too long to answer.' : 'Gemini could not be reached from this network.');
    } finally { clearTimeout(t); }
    const txt = await r.text();
    let j = null; try { j = JSON.parse(txt); } catch (e) { /* not JSON */ }
    if (!r.ok) {
      const msg = (j && j.error && j.error.message) || txt.slice(0, 160);
      const keyProblem = r.status === 401 || r.status === 403 || (r.status === 400 && /api[ _-]?key|credential|auth/i.test(msg));
      const e = new Error(keyProblem ? `Google did not accept the Gemini key: ${msg}`
        : r.status === 429 ? 'Gemini is busy or the key’s quota is used up. Try again in a minute.'
        : `Gemini answered ${r.status}: ${msg}`);
      e.status = r.status; e.keyProblem = keyProblem; throw e;
    }
    return j || {};
  }

  /* The newest stable Flash model the key can use (falls back to previews, then any Gemini model). */
  function rank(names) {
    const ver = (n) => { const m = /^gemini-(\d+(?:\.\d+)?)/.exec(n); return m ? parseFloat(m[1]) : 0; };
    const odd = /(lite|image|tts|audio|live|embed|thinking|exp|learnlm|robotics|computer|search|nano|banana|veo|imagen)/i;
    const preview = (n) => (/preview|-\d{2}-\d{2}|latest/i.test(n) ? 1 : 0);
    const flash = names.filter((n) => /^gemini-/.test(n) && /flash/i.test(n) && !odd.test(n));
    const pool = flash.length ? flash : names.filter((n) => /^gemini-/.test(n) && !odd.test(n));
    return pool.sort((a, b) => preview(a) - preview(b) || ver(b) - ver(a) || a.length - b.length);
  }
  async function listModels(key) {
    const j = await req('/models?pageSize=1000', key);
    return (j.models || []).filter((m) => (m.supportedGenerationMethods || []).includes('generateContent')).map((m) => String(m.name || '').replace(/^models\//, ''));
  }
  let pending = null;
  function pickModel(key) {
    if (pending && pending.key === key) return pending.p;
    const p = listModels(key).then((names) => {
      const best = rank(names)[0];
      if (!best) throw new Error('This key has no Gemini model that can answer questions.');
      picked = { key, model: best };
      return best;
    }).finally(() => { if (pending && pending.p === p) pending = null; });
    pending = { key, p };
    return p;
  }
  async function modelFor(sec) {
    if (!sec || !sec.gemini_key) throw new Error('No Gemini key is set (Settings).');
    if (picked && picked.key === sec.gemini_key) return picked.model;
    if (sec.gemini_model) return sec.gemini_model;
    return pickModel(sec.gemini_key);
  }

  const S = (type, extra) => ({ type, ...(extra || {}) });
  async function ask(sec, prompt, schema) {
    let model = await modelFor(sec);
    const body = (withSchema) => ({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0, responseMimeType: 'application/json', ...(withSchema ? { responseSchema: schema } : {}) },
    });
    const call = (m, withSchema) => req(`/models/${encodeURIComponent(m)}:generateContent`, sec.gemini_key, body(withSchema));
    let j;
    try { j = await call(model, true); }
    catch (e) {
      if (e.status === 404) { picked = null; model = await pickModel(sec.gemini_key); j = await call(model, true); }   // saved model retired
      else if (e.status === 400 && !e.keyProblem) j = await call(model, false);                                          // schema not supported
      else throw e;
    }
    const c = (j.candidates || [])[0];
    const txt = ((c && c.content && c.content.parts) || []).map((p) => p.text || '').join('').trim();
    if (!txt) throw new Error(`Gemini gave no answer${c && c.finishReason ? ` (${c.finishReason})` : ''}.`);
    try { return { model, out: JSON.parse(txt.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')) }; }
    catch (e) { throw new Error('Gemini’s answer could not be read.'); }
  }

  /* packages: [{ name, rows: [{row, section, headings, text, remarks}], candidates: [{id, section, heading, text, also_listed_as, last_listed, last_dates}] }]
     Returns [{row, id, confidence, why}] (id 0 = new work). */
  async function suggestLinks(sec, packages) {
    const prompt = [
      'You help a site engineer keep a progress tracker for the electrical works of a hydro power station refurbishment (generator parts, electrical power systems, crane, electrical rooms).',
      'A new two-week lookahead schedule from the contractor has been read. The rows below did not match any tracked activity word for word.',
      'For each row, decide whether it is the SAME activity as one of the candidates of the same package (tracked from earlier lookaheads), only reworded: renamed, typo fixed, words added or removed. Otherwise it is new work.',
      'Rules:',
      '- Link only when it is clearly the same scope of work on the same component or area. Different component codes (for example R05 and R06), different rooms or different equipment are never the same activity.',
      '- Each candidate can be linked to at most one row.',
      '- When unsure, answer id 0 (new work).',
      'Answer with JSON only: {"links":[{"row":<row number>,"id":<candidate id or 0>,"confidence":"high"|"medium"|"low","why":"<at most 12 words>"}]}, one entry for every row.',
      '',
      'ROWS AND CANDIDATES BY PACKAGE:',
      JSON.stringify(packages),
    ].join('\n');
    const schema = S('OBJECT', { properties: { links: S('ARRAY', { items: S('OBJECT', { properties: {
      row: S('INTEGER'), id: S('INTEGER'), confidence: S('STRING', { enum: ['high', 'medium', 'low'] }), why: S('STRING') }, required: ['row', 'id', 'confidence'] }) }) }, required: ['links'] });
    const { model, out } = await ask(sec, prompt, schema);
    return { model, links: Array.isArray(out.links) ? out.links : [] };
  }

  /* texts: remark strings. Returns { model, cats: {text: category|null} } (null = not a constraint). */
  async function classifyRemarks(sec, texts) {
    const prompt = [
      'Classify each remark from a contractor’s two-week construction lookahead (electrical works, hydro power station).',
      'A remark is a constraint when it says the work is blocked, held or waiting on something. Categories:',
      '- "Outage / LOTO": needs a plant outage, isolation, shutdown or lock-out',
      '- "Material": waiting for material, parts, spares or a delivery',
      '- "Crane & Lifting": needs a crane, lifting gear, trailer or forklift',
      '- "Manpower": waiting for workers, a foreman, specialists or mobilisation',
      '- "Approval": waiting for an approval, permit, drawing or document acceptance',
      '- "Logistics": pick-up, shipping or transport arrangements still to be made',
      '- "Dependency": waiting for another party (for example TNB) or another task to finish',
      '- "None": not a constraint, for example progress or status notes such as "Completed", "Ready for transportation", "In progress", or a date',
      'Answer with JSON only: {"cats":[{"i":<remark number>,"cat":"<category>"}]}, one entry for every remark.',
      '',
      'REMARKS:',
      ...texts.map((t, i) => `${i}. ${t}`),
    ].join('\n');
    const schema = S('OBJECT', { properties: { cats: S('ARRAY', { items: S('OBJECT', { properties: {
      i: S('INTEGER'), cat: S('STRING', { enum: [...CATS, 'None'] }) }, required: ['i', 'cat'] }) }) }, required: ['cats'] });
    const { model, out } = await ask(sec, prompt, schema);
    const cats = {};
    for (const x of Array.isArray(out.cats) ? out.cats : []) {
      const t = texts[x.i]; if (t == null) continue;
      cats[t] = CATS.includes(x.cat) ? x.cat : null;
    }
    return { model, cats };
  }

  root.CEND_GEMINI = { pickModel, listModels, rank, suggestLinks, classifyRemarks, CATS };
})(window);
