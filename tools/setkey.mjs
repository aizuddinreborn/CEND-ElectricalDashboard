// Sets or changes the team password.
//
//   CEND_PASSWORD='new password' [CEND_KEY=<existing base64 key>] node tools/setkey.mjs
//
// Wraps the content key with the password and writes keywrap.json. Without
// CEND_KEY it makes a new random key and prints it once: keep that key private
// (the scheduled sync needs it to rebuild the page). Then run tools/build.mjs.
// Keeping the same CEND_KEY changes only the password; devices that chose
// "Keep me signed in" stay signed in. A new key signs every device out.
import { writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { webcrypto as crypto } from 'node:crypto';

const pw = process.env.CEND_PASSWORD;
if (!pw || pw.length < 10) { console.error('Set CEND_PASSWORD (at least 10 characters).'); process.exit(1); }
const fresh = !process.env.CEND_KEY;
const key = fresh ? crypto.getRandomValues(new Uint8Array(32)) : new Uint8Array(Buffer.from(process.env.CEND_KEY, 'base64'));
if (key.length !== 32) { console.error('CEND_KEY must be 32 bytes, base64'); process.exit(1); }
const iter = 600000;
const salt = crypto.getRandomValues(new Uint8Array(16));
const wrapIv = crypto.getRandomValues(new Uint8Array(12));
const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(pw), 'PBKDF2', false, ['deriveKey']);
const kek = await crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: iter, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt']);
const wrapped = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: wrapIv }, kek, key));
const b = (u) => Buffer.from(u).toString('base64');
writeFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'keywrap.json'), JSON.stringify({ salt: b(salt), iter, wrapIv: b(wrapIv), wrapped: b(wrapped) }, null, 2) + '\n');
console.log('keywrap.json written.');
if (fresh) console.log('NEW CEND_KEY (keep private): ' + b(key));
