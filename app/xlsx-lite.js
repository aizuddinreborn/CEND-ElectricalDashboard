/* A small .xlsx reader for the lookahead workbooks: unzips in the browser (DecompressionStream)
   and returns each sheet's cell values (cached formula results included), plus hidden state.
   No outside library, so nothing extra is downloaded or trusted. */
(function (root) {
  'use strict';
  const td = new TextDecoder();
  async function inflateRaw(u8) {
    const ds = new DecompressionStream('deflate-raw');
    return new Uint8Array(await new Response(new Blob([u8]).stream().pipeThrough(ds)).arrayBuffer());
  }
  async function unzip(buf) {
    const u8 = new Uint8Array(buf), dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    let eocd = -1;
    for (let i = u8.length - 22; i >= Math.max(0, u8.length - 70000); i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    if (eocd < 0) throw new Error('This file is not a valid .xlsx workbook.');
    const n = dv.getUint16(eocd + 10, true); let p = dv.getUint32(eocd + 16, true);
    const files = new Map();
    for (let k = 0; k < n; k++) {
      if (dv.getUint32(p, true) !== 0x02014b50) break;
      const method = dv.getUint16(p + 10, true), csize = dv.getUint32(p + 20, true);
      const nlen = dv.getUint16(p + 28, true), xlen = dv.getUint16(p + 30, true), clen = dv.getUint16(p + 32, true), off = dv.getUint32(p + 42, true);
      const name = td.decode(u8.subarray(p + 46, p + 46 + nlen));
      files.set(name, { method, csize, off });
      p += 46 + nlen + xlen + clen;
    }
    return async (name) => {
      const f = files.get(name); if (!f) return null;
      const lnl = dv.getUint16(f.off + 26, true), lxl = dv.getUint16(f.off + 28, true);
      const data = u8.subarray(f.off + 30 + lnl + lxl, f.off + 30 + lnl + lxl + f.csize);
      return td.decode(f.method === 0 ? data : await inflateRaw(data));
    };
  }
  const xmlDoc = (s) => new DOMParser().parseFromString(s, 'application/xml');
  const byTag = (el, tag) => Array.from(el.getElementsByTagNameNS('*', tag));
  const colNum = (ref) => { let c = 0; for (const ch of ref.replace(/\d+$/, '')) c = c * 26 + (ch.charCodeAt(0) - 64); return c; };
  async function read(buf) {
    const get = await unzip(buf);
    const wbx = xmlDoc(await get('xl/workbook.xml'));
    const rels = xmlDoc(await get('xl/_rels/workbook.xml.rels') || '<Relationships/>');
    const relMap = new Map(byTag(rels, 'Relationship').map((r) => [r.getAttribute('Id'), r.getAttribute('Target')]));
    const date1904 = byTag(wbx, 'workbookPr').some((e) => e.getAttribute('date1904') === '1' || e.getAttribute('date1904') === 'true');
    const sstXml = await get('xl/sharedStrings.xml');
    const sst = sstXml ? byTag(xmlDoc(sstXml), 'si').map((si) => byTag(si, 't').map((t) => t.textContent).join('')) : [];
    // styles: which number formats are dates
    const stylesXml = await get('xl/styles.xml');
    const dateStyle = [];
    if (stylesXml) {
      const st = xmlDoc(stylesXml);
      const custom = new Map(byTag(st, 'numFmt').map((f) => [Number(f.getAttribute('numFmtId')), f.getAttribute('formatCode') || '']));
      const xfs = byTag(st, 'cellXfs')[0];
      for (const xf of xfs ? byTag(xfs, 'xf') : []) {
        const id = Number(xf.getAttribute('numFmtId') || 0);
        const code = custom.get(id) || '';
        dateStyle.push((id >= 14 && id <= 22) || (id >= 45 && id <= 47) || /(^|[^"\\])[dmy]{1,4}/i.test(code.replace(/\[[^\]]*\]|"[^"]*"/g, '')));
      }
    }
    const serialToISO = (v) => new Date(Math.round((v - (date1904 ? -1462 : 0) - 25569) * 864e5)).toISOString().slice(0, 10);
    const sheets = [];
    for (const s of byTag(wbx, 'sheet')) {
      const rid = s.getAttribute('r:id') || s.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id');
      let target = relMap.get(rid) || ''; target = target.replace(/^\//, '');
      const path = target.startsWith('xl/') ? target : 'xl/' + target;
      const xml = await get(path); if (!xml) continue;
      const doc = xmlDoc(xml);
      const rows = new Map();
      for (const c of byTag(doc, 'c')) {
        const ref = c.getAttribute('r'); if (!ref) continue;
        const r = Number(ref.replace(/^[A-Z]+/, '')), col = colNum(ref);
        const t = c.getAttribute('t'), sIdx = Number(c.getAttribute('s') || 0);
        const vEl = byTag(c, 'v')[0];
        let v = null;
        if (t === 's') v = vEl ? sst[Number(vEl.textContent)] : null;
        else if (t === 'inlineStr') v = byTag(c, 't').map((x) => x.textContent).join('');
        else if (t === 'str') v = vEl ? vEl.textContent : null;
        else if (t === 'b') v = vEl ? vEl.textContent === '1' : null;
        else if (vEl) { const num = Number(vEl.textContent); v = dateStyle[sIdx] && num > 20000 && num < 80000 ? { date: serialToISO(num) } : num; }
        if (v === null || v === '') continue;
        if (!rows.has(r)) rows.set(r, new Map());
        rows.get(r).set(col, v);
      }
      sheets.push({ name: s.getAttribute('name'), hidden: (s.getAttribute('state') || 'visible') !== 'visible', rows });
    }
    return sheets;
  }
  root.CEND_XLSX = { read };
})(typeof window !== 'undefined' ? window : globalThis);
