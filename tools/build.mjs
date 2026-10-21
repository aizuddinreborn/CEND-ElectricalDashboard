// Builds the encrypted, password-locked index.html (the app). Progress data is NOT baked in:
// the app loads data/state.enc at runtime, so edits made on the website never need a rebuild.
//
//   CEND_KEY=<base64 content key> node tools/build.mjs <src-dir>
//
// <src-dir> holds page.html (the dashboard page) and static/<id>.json (reference data that
// doesn't change with progress: gen_parts, gen_components, gen_facts).
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync, constants } from 'node:zlib';
import { webcrypto as crypto } from 'node:crypto';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const src = process.argv[2];
if (!src) { console.error('usage: CEND_KEY=... node tools/build.mjs <src-dir>'); process.exit(1); }
const key = Buffer.from(process.env.CEND_KEY || '', 'base64');
if (key.length !== 32) { console.error('CEND_KEY must be set: 32 bytes, base64'); process.exit(1); }
const wrap = JSON.parse(readFileSync(join(root, 'keywrap.json'), 'utf8'));
const must = (s, a, b) => { if (!s.includes(a)) throw new Error('dashboard page changed, cannot find: ' + a.slice(0, 70)); return s.split(a).join(b); };

// 1. the dashboard page
let page = readFileSync(join(src, 'page.html'), 'utf8');
// the 3D model link opens this site's own locked copy, in the same tab (so one sign-in covers it)
page = page.replace(/href="https:\/\/claude\.ai\/artifact\/W1J8eZVtE8sRwzXQcGoWPn"\s+target="_blank"\s+rel="noopener"/g, 'href="./generator/"');
// the header stamp shows when the data was last changed, not a sync schedule
page = must(page, "'Synced ', when", "'Updated ', when");
page = must(page, 'const stale = (now - at) / 36e5 > 14;', 'const stale = false;');
page = page.replace(/box\.title = '[^']*';/, "box.title = 'When the progress data was last changed on this website.';");
// each <script> of the dashboard runs in its own scope, as it does in Claude
page = page.replace(/<script>([\s\S]*?)<\/script>/g, (m, body) => `<script>(() => {\n${body}\n})();</script>`);

// 2. static reference data
const stat = {};
const sdir = join(src, 'static');
if (existsSync(sdir)) for (const f of readdirSync(sdir).filter((n) => n.endsWith('.json')).sort()) stat[f.replace(/\.json$/, '')] = JSON.parse(readFileSync(join(sdir, f), 'utf8'));
const safe = (s) => s.replace(/<\/(script)/gi, '<\\/$1').replace(/<!--/g, '<\\!--');
const app = ['model.js', 'datasets.js', 'store.js', 'upload.js', 'ui.js'].filter((f) => existsSync(join(root, 'app', f)))
  .map((f) => `<script>${safe(readFileSync(join(root, 'app', f), 'utf8'))}</script>`).join('\n');

const shell = readFileSync(join(here, 'page-shell.html'), 'utf8');
const html = shell
  .replace('/*__D3__*/', () => safe(readFileSync(join(here, 'vendor', 'd3.min.js'), 'utf8')))
  .replace('/*__STATIC__*/', () => safe(JSON.stringify(stat)))
  .replace('/*__SHIM__*/', () => safe(readFileSync(join(here, 'dash-shim.js'), 'utf8')))
  .replace('/*__CSS__*/', () => readFileSync(join(root, 'app', 'ui.css'), 'utf8'))
  .replace('<!--__PAGE__-->', () => page)
  .replace('<!--__APP__-->', () => app);

// 3. encrypt
const gz = gzipSync(Buffer.from(html, 'utf8'), { level: constants.Z_BEST_COMPRESSION });
const iv = crypto.getRandomValues(new Uint8Array(12));
const k = await crypto.subtle.importKey('raw', key, 'AES-GCM', false, ['encrypt']);
const ct = Buffer.from(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, k, gz));
const box = { v: 1, salt: wrap.salt, iter: wrap.iter, wrapIv: wrap.wrapIv, wrapped: wrap.wrapped, iv: Buffer.from(iv).toString('base64'), ct: ct.toString('base64') };
const login = readFileSync(join(here, 'login-shell.html'), 'utf8').replace('/*__BOX__*/', () => JSON.stringify(box));
writeFileSync(join(root, 'index.html'), login);
console.log(`index.html written: app ${html.length} chars, gzip ${gz.length} bytes, static ${Object.keys(stat).join(', ') || 'none'}`);
