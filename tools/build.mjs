// Builds the encrypted, password-locked index.html from the dashboard page and its data.
//
//   CEND_KEY=<base64 content key> node tools/build.mjs <src-dir>
//
// <src-dir> must hold page.html (the dashboard page) and data/<dataset id>.json
// (one JSON array of rows per dataset). Nothing from <src-dir> is written to the
// repo in plain text: the full page is gzipped and encrypted with AES-256-GCM
// using the content key. keywrap.json holds that key wrapped by the team
// password (PBKDF2-SHA256), so the password opens it in the browser.
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync, constants } from 'node:zlib';
import { webcrypto as crypto } from 'node:crypto';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const src = process.argv[2];
if (!src) { console.error('usage: CEND_KEY=... node tools/build.mjs <src-dir>'); process.exit(1); }
const keyB64 = process.env.CEND_KEY;
if (!keyB64) { console.error('CEND_KEY is not set'); process.exit(1); }
const key = Buffer.from(keyB64, 'base64');
if (key.length !== 32) { console.error('CEND_KEY must be 32 bytes, base64'); process.exit(1); }
const wrap = JSON.parse(readFileSync(join(root, 'keywrap.json'), 'utf8'));

// 1. page: each <script> of the dashboard runs in its own scope, as it does in Claude
let page = readFileSync(join(src, 'page.html'), 'utf8');
page = page.replace(/<script>([\s\S]*?)<\/script>/g, (m, body) => `<script>(() => {\n${body}\n})();</script>`);

// 2. data
const data = {};
for (const f of readdirSync(join(src, 'data')).filter((n) => n.endsWith('.json')).sort()) {
  const rows = JSON.parse(readFileSync(join(src, 'data', f), 'utf8'));
  data[f.replace(/\.json$/, '')] = Array.isArray(rows) ? rows : (rows.rows || rows.data || rows.results || rows);
}
const safe = (s) => s.replace(/<\/(script)/gi, '<\\/$1').replace(/<!--/g, '<\\!--');

const shell = readFileSync(join(here, 'page-shell.html'), 'utf8');
const html = shell
  .replace('/*__D3__*/', () => safe(readFileSync(join(here, 'vendor', 'd3.min.js'), 'utf8')))
  .replace('/*__DATA__*/', () => safe(JSON.stringify(data)))
  .replace('/*__SHIM__*/', () => safe(readFileSync(join(here, 'dash-shim.js'), 'utf8')))
  .replace('<!--__PAGE__-->', () => page);

// 3. encrypt
const gz = gzipSync(Buffer.from(html, 'utf8'), { level: constants.Z_BEST_COMPRESSION });
const iv = crypto.getRandomValues(new Uint8Array(12));
const k = await crypto.subtle.importKey('raw', key, 'AES-GCM', false, ['encrypt']);
const ct = Buffer.from(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, k, gz));
const box = { v: 1, salt: wrap.salt, iter: wrap.iter, wrapIv: wrap.wrapIv, wrapped: wrap.wrapped, iv: Buffer.from(iv).toString('base64'), ct: ct.toString('base64') };
const login = readFileSync(join(here, 'login-shell.html'), 'utf8').replace('/*__BOX__*/', () => JSON.stringify(box));
writeFileSync(join(root, 'index.html'), login);
console.log(`index.html written: page ${html.length} chars, gzip ${gz.length} bytes, datasets ${Object.keys(data).join(', ')}`);
