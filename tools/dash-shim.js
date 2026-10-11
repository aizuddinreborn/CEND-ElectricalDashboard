/* Minimal stand-in for the Claude Dashboard runtime (`window.dash`), so the
   dashboard page runs as a plain static website. Data comes from
   window.__CEND_DATA (dataset id -> rows), bundled at build time. */
window.dash = (() => {
  const DATA = window.__CEND_DATA || {};
  const calcs = new Map();
  const cache = new Map();
  const listeners = [];
  let params = {};
  let loaded = false;
  const cols = (rows) => (Array.isArray(rows) && rows.length && rows[0] && typeof rows[0] === 'object' ? Object.keys(rows[0]) : []);
  const BAD = ['error', 'connect', 'declined', 'missing'];
  function data(id) {
    if (Object.prototype.hasOwnProperty.call(DATA, id)) {
      if (!loaded) return { status: 'loading', data: [], columns: [], meta: [], refreshing: false };
      return { status: 'ok', data: DATA[id], columns: cols(DATA[id]), meta: [], refreshing: false };
    }
    const c = calcs.get(id);
    if (!c) return { status: 'missing', data: [], columns: [], meta: [] };
    const ins = c.inputs.map(data);
    if (ins.some((x) => BAD.includes(x.status))) return { status: 'error', data: [], columns: [], meta: [], message: 'An input did not load' };
    if (ins.some((x) => x.status !== 'ok')) return { status: 'loading', data: [], columns: [], meta: [] };
    if (!cache.has(id)) {
      try { cache.set(id, { ok: true, out: c.fn(...ins.map((x) => JSON.parse(JSON.stringify(x.data)))) }); }
      catch (e) { console.error('calc ' + id + ' failed', e); cache.set(id, { ok: false, msg: String(e && e.message || e) }); }
    }
    const r = cache.get(id);
    if (!r.ok) return { status: 'error', data: [], columns: [], meta: [], message: r.msg };
    return { status: 'ok', data: r.out, columns: cols(r.out), meta: [] };
  }
  const fire = () => listeners.forEach((fn) => { try { fn(); } catch (e) { console.error(e); } });
  setTimeout(() => { loaded = true; fire(); }, 30);
  const start = () => {
    const root = document.getElementById('dash-root');
    if (!root || !('ResizeObserver' in window)) return;
    let w = 0;
    new ResizeObserver(() => { const nw = root.clientWidth; if (nw !== w) { w = nw; if (loaded) fire(); } }).observe(root);
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else setTimeout(start, 0);
  return {
    data,
    calc: (id, def) => { calcs.set(id, def); },
    loader: () => {},
    onData: (fn) => { listeners.push(fn); try { fn(); } catch (e) { console.error(e); } },
    params: () => ({ ...params }),
    setParams: (p) => { params = { ...params, ...p }; fire(); },
    resetParams: () => { params = {}; fire(); },
    setLink: (name) => { try { history.replaceState(history.state, '', '#' + name); } catch (e) { /* ignore */ } },
    refresh: () => {},
    colors: ['#48c9ff', '#43e0a3', '#ffb547', '#ff6b6b', '#a78bfa', '#f472b6', '#94a3b8', '#facc15'],
  };
})();
