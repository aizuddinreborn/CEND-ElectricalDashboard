// Builds the encrypted, password-locked Generator U1 3D model page at generator/.
//
//   CEND_KEY=<base64 content key> node tools/build-3d.mjs <src-dir>
//
// <src-dir> must hold page.html (the 3D viewer page) and model.json (the model,
// as {data: <GLB in base64>}). Both are gzipped and encrypted with the same
// content key and password as the dashboard, so one sign-in opens both.
// three.js is served from vendor/three (MIT licence) instead of a CDN.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync, constants } from 'node:zlib';
import { webcrypto as crypto } from 'node:crypto';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const out = join(root, 'generator');
const src = process.argv[2];
if (!src) { console.error('usage: CEND_KEY=... node tools/build-3d.mjs <src-dir>'); process.exit(1); }
const key = Buffer.from(process.env.CEND_KEY || '', 'base64');
if (key.length !== 32) { console.error('CEND_KEY must be set: 32 bytes, base64'); process.exit(1); }
const wrap = JSON.parse(readFileSync(join(root, 'keywrap.json'), 'utf8'));
const k = await crypto.subtle.importKey('raw', key, 'AES-GCM', false, ['encrypt']);
async function seal(buf) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = Buffer.from(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, k, gzipSync(buf, { level: constants.Z_BEST_COMPRESSION })));
  return { iv: Buffer.from(iv), ct };
}
const must = (s, a, b) => { if (!s.includes(a)) throw new Error('page changed, cannot find: ' + a.slice(0, 60)); return s.replace(a, b); };

let page = readFileSync(join(src, 'page.html'), 'utf8');
// three.js from this site instead of the CDN
page = must(page, 'https://cdn.jsdelivr.net/npm/three@0.169.0/build/three.module.min.js', '../vendor/three/build/three.module.min.js');
page = must(page, 'https://cdn.jsdelivr.net/npm/three@0.169.0/examples/jsm/', '../vendor/three/examples/jsm/');
// the start-up guard's messages: the engine now comes from this site, not the CDN
page = page.replace("t.src.indexOf('cdn.jsdelivr.net')", "t.src.indexOf('/vendor/three/')");
page = page.replace(/from cdn\.jsdelivr\.net\. Check the internet connection \(some office networks block this site\)/g, 'from this website. Check the internet connection');
page = page.replace(/It comes from cdn\.jsdelivr\.net and has not arrived/g, 'It has not arrived');
// the model comes from the encrypted model.bin
page = must(page, 'const res = await fetch(MODEL_URL);', 'const res = await window.__cendModel();');
page = must(page, '<script type="importmap">', `<script>
window.__cendModel = async () => {
  let s = null; try { s = localStorage.getItem('cend-key') || sessionStorage.getItem('cend-key'); } catch (e) { /* ignore */ }
  if (!s) { location.reload(); throw new Error('Signed out'); }
  const b64 = (x) => Uint8Array.from(atob(x), (c) => c.charCodeAt(0));
  const res = await fetch('model.bin', { cache: 'no-cache' });
  if (!res.ok) throw new Error('Server answered ' + res.status);
  const buf = new Uint8Array(await res.arrayBuffer());
  const key = await crypto.subtle.importKey('raw', b64(s), 'AES-GCM', false, ['decrypt']);
  const gz = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: buf.slice(0, 12) }, key, buf.slice(12));
  return new Response(new Blob([gz]).stream().pipeThrough(new DecompressionStream('gzip')));
};
</script>
<script type="importmap">`);
// a way back to the dashboard
page = must(page, '<button class="btn primary" id="btnTour" type="button">Guided tour</button>',
  '<a class="btn" href="../" style="text-decoration:none">← Dashboard</a>\n      <button class="btn primary" id="btnTour" type="button">Guided tour</button>');
const model = readFileSync(join(src, 'model.json'));
mkdirSync(out, { recursive: true });
const m = await seal(model);
writeFileSync(join(out, 'model.bin'), Buffer.concat([m.iv, m.ct]));
const p = await seal(Buffer.from(page, 'utf8'));
const box = { v: 1, salt: wrap.salt, iter: wrap.iter, wrapIv: wrap.wrapIv, wrapped: wrap.wrapped, iv: p.iv.toString('base64'), ct: p.ct.toString('base64') };
let login = readFileSync(join(here, 'login-shell.html'), 'utf8')
  .replace('<title>Electrical Dashboard · Locked</title>', '<title>Generator U1 3D · Locked</title>')
  .replace('<h1>Resident Engineer<br>Progress View</h1>', '<h1>Generator U1<br>3D model</h1>')
  .replace('/*__BOX__*/', () => JSON.stringify(box));
writeFileSync(join(out, 'index.html'), login);
console.log(`generator/ written: page ${page.length} chars, model.bin ${m.ct.length + 12} bytes`);
