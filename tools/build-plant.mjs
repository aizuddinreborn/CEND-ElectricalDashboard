// Builds the encrypted, password-locked 3D plant page at plant/.
//
//   CEND_KEY=<base64 content key> node tools/build-plant.mjs
//
// The page is app/plant.html with the lookahead model (app/model.js, app/datasets.js), the area map
// (app/plantmap.js) and the 3D viewer (app/plant3d.js) written into it. It is gzipped and encrypted with the
// same content key and password as the dashboard, so one sign-in opens both. No progress data is baked in:
// the page reads data/state.enc when it opens, so it always shows the latest saved progress without a rebuild.
// three.js is served from vendor/three (MIT licence).
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync, constants } from 'node:zlib';
import { webcrypto as crypto } from 'node:crypto';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const key = Buffer.from(process.env.CEND_KEY || '', 'base64');
if (key.length !== 32) { console.error('CEND_KEY must be set: 32 bytes, base64'); process.exit(1); }
const wrap = JSON.parse(readFileSync(join(root, 'keywrap.json'), 'utf8'));
const safe = (s) => s.replace(/<\/(script)/gi, '<\\/$1').replace(/<!--/g, '<\\!--');

let page = readFileSync(join(root, 'app', 'plant.html'), 'utf8');
for (const [marker, file] of [['/*__MODEL__*/', 'model.js'], ['/*__DATASETS__*/', 'datasets.js'], ['/*__PLANTMAP__*/', 'plantmap.js'], ['/*__PLANT3D__*/', 'plant3d.js']]) {
  if (!page.includes(marker)) throw new Error(`app/plant.html changed, cannot find ${marker}`);
  page = page.replace(marker, () => safe(readFileSync(join(root, 'app', file), 'utf8')));
}

const gz = gzipSync(Buffer.from(page, 'utf8'), { level: constants.Z_BEST_COMPRESSION });
const iv = crypto.getRandomValues(new Uint8Array(12));
const k = await crypto.subtle.importKey('raw', key, 'AES-GCM', false, ['encrypt']);
const ct = Buffer.from(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, k, gz));
const box = { v: 1, salt: wrap.salt, iter: wrap.iter, wrapIv: wrap.wrapIv, wrapped: wrap.wrapped, iv: Buffer.from(iv).toString('base64'), ct: ct.toString('base64') };
const login = readFileSync(join(here, 'login-shell.html'), 'utf8')
  .replace('<title>Electrical Dashboard · Locked</title>', '<title>Plant 3D · Locked</title>')
  .replace('<h1>Resident Engineer<br>Progress View</h1>', '<h1>SJ Chenderoh<br>Plant 3D</h1>')
  .split('Open dashboard').join('Open 3D plant')
  .replace('/*__BOX__*/', () => JSON.stringify(box));
mkdirSync(join(root, 'plant'), { recursive: true });
writeFileSync(join(root, 'plant', 'index.html'), login);
console.log(`plant/index.html written: page ${page.length} chars, gzip ${gz.length} bytes`);
