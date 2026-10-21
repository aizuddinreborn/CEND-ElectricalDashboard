/* Loading and saving the shared, encrypted state.
   - data/state.enc   all progress data (lookahead model, site checks, added activities)
   - data/secrets.enc the GitHub token and Gemini key, so anyone with the password can edit
   Both are gzip + AES-256-GCM with the content key the password unlocks. Saving goes through
   the GitHub contents API: read the latest file, apply the change, write it back. */
(function (root) {
  'use strict';
  const REPO = 'aizuddinreborn/CEND-ElectricalDashboard';
  const BRANCH = 'main';
  const API = 'https://api.github.com';
  const te = new TextEncoder(), td = new TextDecoder();
  const b64e = (u) => { let s = ''; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000)); return btoa(s); };
  const b64d = (s) => Uint8Array.from(atob(s.replace(/\s+/g, '')), (c) => c.charCodeAt(0));
  let KEY = null;
  async function key() {
    if (KEY) return KEY;
    let s = null; try { s = localStorage.getItem('cend-key') || sessionStorage.getItem('cend-key'); } catch (e) { /* ignore */ }
    if (!s) throw new Error('Signed out');
    KEY = await crypto.subtle.importKey('raw', b64d(s), 'AES-GCM', false, ['encrypt', 'decrypt']);
    return KEY;
  }
  const stream = (u8, t) => new Response(new Blob([u8]).stream().pipeThrough(t)).arrayBuffer().then((b) => new Uint8Array(b));
  async function seal(obj) {
    const gz = await stream(te.encode(JSON.stringify(obj)), new CompressionStream('gzip'));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await key(), gz));
    const out = new Uint8Array(12 + ct.length); out.set(iv); out.set(ct, 12); return out;
  }
  async function open(u8) {
    const gz = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: u8.slice(0, 12) }, await key(), u8.slice(12));
    return JSON.parse(td.decode(await stream(new Uint8Array(gz), new DecompressionStream('gzip'))));
  }

  let SECRETS = null;
  async function loadSecrets() {
    try {
      const r = await fetch('data/secrets.enc?t=' + Date.now(), { cache: 'no-store' });
      if (!r.ok) return null;
      SECRETS = await open(new Uint8Array(await r.arrayBuffer()));
    } catch (e) { SECRETS = null; }
    return SECRETS;
  }
  const canEdit = () => !!(SECRETS && SECRETS.github_token);
  const gh = (path, opts = {}, token) => fetch(`${API}/repos/${REPO}/contents/${path}${opts.method && opts.method !== 'GET' ? '' : `?ref=${BRANCH}&t=${Date.now()}`}`, {
    ...opts, cache: 'no-store',
    headers: { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', Authorization: `Bearer ${token || SECRETS.github_token}`, ...(opts.headers || {}) },
  });
  async function ghGet(path, token) {
    const r = await gh(path, {}, token);
    if (r.status === 404) return { sha: null, bytes: null };
    if (!r.ok) throw apiError(r.status, await r.text());
    const j = await r.json();
    let bytes;
    if (j.content) bytes = b64d(j.content);
    else { const raw = await gh(path, { headers: { Accept: 'application/vnd.github.raw' } }, token); bytes = new Uint8Array(await raw.arrayBuffer()); }
    return { sha: j.sha, bytes };
  }
  async function ghPut(path, bytes, sha, message, token) {
    const r = await gh(path, { method: 'PUT', body: JSON.stringify({ message, content: b64e(bytes), branch: BRANCH, ...(sha ? { sha } : {}) }) }, token);
    if (!r.ok) throw apiError(r.status, await r.text());
    return (await r.json()).content.sha;
  }
  function apiError(status, body) {
    const e = new Error(status === 401 ? 'The GitHub access token was refused. It may have expired; set a new one in Settings.'
      : status === 403 ? 'GitHub refused the change. The token needs "Contents: Read and write" on this repository, or the hourly limit was reached.'
      : status === 409 || status === 422 ? 'Someone else saved at the same moment.'
      : `GitHub answered ${status}.`);
    e.status = status; e.body = body; return e;
  }

  let SHA = null;
  async function loadState() {
    await loadSecrets();
    if (canEdit()) {
      try { const g = await ghGet('data/state.enc'); if (g.bytes) { SHA = g.sha; return await open(g.bytes); } } catch (e) { console.warn('API read failed, using the published copy', e); }
    }
    const r = await fetch('data/state.enc?t=' + Date.now(), { cache: 'no-store' });
    if (!r.ok) throw new Error('The progress data could not be loaded (' + r.status + ').');
    return open(new Uint8Array(await r.arrayBuffer()));
  }

  /* Apply `change(state)` to the latest saved state and write it back; retried if someone saved in between. */
  async function save(change, message, who) {
    if (!canEdit()) throw new Error('Editing is not set up yet. Open Settings and add the GitHub access token.');
    for (let attempt = 0; attempt < 4; attempt++) {
      const g = await ghGet('data/state.enc');
      const state = g.bytes ? await open(g.bytes) : null;
      if (!state) throw new Error('No saved progress data was found in the repository.');
      const res = change(state);
      if (res === false) return { state, unchanged: true };
      state.updated_at = new Date().toISOString();
      state.updated_by = who || '';
      state.log = [{ at: state.updated_at, by: who || '', what: message }, ...(state.log || [])].slice(0, 200);
      try {
        SHA = await ghPut('data/state.enc', await seal(state), g.sha, `${message}${who ? ` (by ${who})` : ''} [website]`);
        return { state };
      } catch (e) {
        if ((e.status === 409 || e.status === 422) && attempt < 3) { await new Promise((r) => setTimeout(r, 400 + attempt * 600)); continue; }
        throw e;
      }
    }
    throw new Error('Could not save after several tries. Reload and try again.');
  }

  async function saveSecrets(next, token) {
    const t = token || (SECRETS && SECRETS.github_token);
    if (!t) throw new Error('A GitHub access token is needed.');
    const merged = { ...(SECRETS || {}), ...next };
    const g = await ghGet('data/secrets.enc', t);
    await ghPut('data/secrets.enc', await seal(merged), g.sha, 'Update editing settings [website]', t);
    SECRETS = merged;
    return merged;
  }
  async function checkToken(token) {
    const r = await fetch(`${API}/repos/${REPO}`, { headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}` }, cache: 'no-store' });
    if (r.status === 401) throw new Error('GitHub did not accept that token.');
    if (!r.ok) throw new Error(`GitHub answered ${r.status} for this repository. Check the token gives access to ${REPO}.`);
    const j = await r.json();
    if (!j.permissions || !j.permissions.push) throw new Error('The token can read the repository but not write to it. Give it "Contents: Read and write".');
    return true;
  }

  root.CEND_STORE = { REPO, loadState, save, loadSecrets, saveSecrets, checkToken, canEdit, secrets: () => SECRETS, seal, open };
})(window);
