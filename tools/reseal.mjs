// Re-encrypts index.html with the current app/*.js and app/ui.css, for when the dashboard page source (the
// <src-dir> that tools/build.mjs needs) isn't at hand. It decrypts the published index.html, swaps the app
// scripts and the stylesheet for the versions in app/, and encrypts it again with a fresh IV. The dashboard
// page itself is left exactly as it was, so a later full build from the source gives the same page.
//
//   CEND_KEY=<base64 content key> node tools/reseal.mjs
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync, gunzipSync, constants } from 'node:zlib';
import { webcrypto as crypto } from 'node:crypto';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const key = Buffer.from(process.env.CEND_KEY || '', 'base64');
if (key.length !== 32) { console.error('CEND_KEY must be set: 32 bytes, base64'); process.exit(1); }
const wrap = JSON.parse(readFileSync(join(root, 'keywrap.json'), 'utf8'));
const k = await crypto.subtle.importKey('raw', key, 'AES-GCM', false, ['encrypt', 'decrypt']);
const safe = (s) => s.replace(/<\/(script)/gi, '<\\/$1').replace(/<!--/g, '<\\!--');
// the same app files, in the same order, as tools/build.mjs
const FILES = ['model.js', 'datasets.js', 'store.js', 'xlsx-lite.js', 'lookahead.js', 'gemini.js', 'ui.js', 'upload.js', 'chatdata.js', 'chat.js'].filter((f) => existsSync(join(root, 'app', f)));

// 1. open the published page
const shell = readFileSync(join(root, 'index.html'), 'utf8');
const m = /<script id="cend-box" type="application\/json">([\s\S]*?)<\/script>/.exec(shell);
if (!m) throw new Error('index.html has no encrypted page in it');
const old = JSON.parse(m[1]);
let html = gunzipSync(Buffer.from(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: Buffer.from(old.iv, 'base64') }, k, Buffer.from(old.ct, 'base64')))).toString('utf8');

// 2. the app scripts: the last FILES.length <script> elements before the Lock button, right after the page's </div>
const end = html.indexOf('\n<button class="cend-out"');
if (end < 0) throw new Error('cannot find the end of the app scripts');
let start = end;
for (let i = 0; i < FILES.length; i++) { start = html.lastIndexOf('<script>', start - 1); if (start < 0) break; }
if (start < 0 || html.slice(start - 7, start) !== '</div>\n') throw new Error(`index.html was built with a different set of app files than the ${FILES.length} in app/; rebuild it with tools/build.mjs`);
const app = FILES.map((f) => `<script>${safe(readFileSync(join(root, 'app', f), 'utf8'))}</script>`).join('\n');
const before = html.slice(start, end);
html = html.slice(0, start) + app + html.slice(end);

// 3. the stylesheet: the second <style> in the head
const cssStart = html.indexOf('</style>\n<style>') + '</style>\n<style>'.length;
const cssEnd = html.indexOf('</style>', cssStart);
if (cssStart < 16 || cssEnd < 0) throw new Error('cannot find the stylesheet');
const css = readFileSync(join(root, 'app', 'ui.css'), 'utf8');
const cssChanged = html.slice(cssStart, cssEnd) !== css;
html = html.slice(0, cssStart) + css + html.slice(cssEnd);

// 4. seal it again
const gz = gzipSync(Buffer.from(html, 'utf8'), { level: constants.Z_BEST_COMPRESSION });
const iv = crypto.getRandomValues(new Uint8Array(12));
const ct = Buffer.from(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, k, gz));
const box = { v: 1, salt: wrap.salt, iter: wrap.iter, wrapIv: wrap.wrapIv, wrapped: wrap.wrapped, iv: Buffer.from(iv).toString('base64'), ct: ct.toString('base64') };
const login = readFileSync(join(here, 'login-shell.html'), 'utf8').replace('/*__BOX__*/', () => JSON.stringify(box));
writeFileSync(join(root, 'index.html'), login);
const changed = FILES.filter((f) => !before.includes(`<script>${safe(readFileSync(join(root, 'app', f), 'utf8'))}</script>`));
console.log(`index.html resealed: app ${html.length} chars, gzip ${gz.length} bytes; updated ${changed.length ? changed.join(', ') : 'no scripts'}${cssChanged ? ' and ui.css' : ''}`);
