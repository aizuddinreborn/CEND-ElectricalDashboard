// Encrypts a JSON file into the website's data format (gzip + AES-256-GCM, 12-byte IV first),
// or decrypts one back to JSON. Used to seed or inspect data/state.enc outside the browser.
//
//   CEND_KEY=<key> node tools/seal.mjs seal  in.json  data/state.enc
//   CEND_KEY=<key> node tools/seal.mjs open  data/state.enc  out.json
import { readFileSync, writeFileSync } from 'node:fs';
import { gzipSync, gunzipSync } from 'node:zlib';
import { webcrypto as crypto } from 'node:crypto';

const [mode, inp, out] = process.argv.slice(2);
const key = Buffer.from(process.env.CEND_KEY || '', 'base64');
if (key.length !== 32 || !['seal', 'open'].includes(mode) || !inp || !out) { console.error('usage: CEND_KEY=... node tools/seal.mjs seal|open <in> <out>'); process.exit(1); }
const k = await crypto.subtle.importKey('raw', key, 'AES-GCM', false, ['encrypt', 'decrypt']);
if (mode === 'seal') {
  const json = JSON.stringify(JSON.parse(readFileSync(inp, 'utf8')));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = Buffer.from(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, k, gzipSync(Buffer.from(json, 'utf8'))));
  writeFileSync(out, Buffer.concat([Buffer.from(iv), ct]));
  console.log(`${out}: ${ct.length + 12} bytes`);
} else {
  const buf = readFileSync(inp);
  const pt = Buffer.from(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: buf.subarray(0, 12) }, k, buf.subarray(12)));
  writeFileSync(out, gunzipSync(pt));
  console.log(`${out} written`);
}
