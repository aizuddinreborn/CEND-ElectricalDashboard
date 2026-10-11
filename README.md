# CEND Electrical Dashboard

The Resident Engineer Progress View for HLEP · SJ Chenderoh electrical works, published as a password-protected website on GitHub Pages.

## How it's protected

`index.html` holds the whole dashboard (page, charts and data) **encrypted** with AES-256-GCM. The team password unlocks it in the browser (PBKDF2-SHA256, 600,000 rounds), so this public repo only ever contains ciphertext. No project data is committed in plain text.

- **Keep me signed in** stores the unlock key on that device. **Lock** (bottom right) signs that device out.
- The protection is only as strong as the password: share it only with the team, and change it if it leaks.

## How it updates

A scheduled Claude task runs every hour from 7am to 7pm (Malaysia time). It copies the site checks from the Chenderoh Electrical Progress tracker into the Claude dashboard. When anything has changed, it rebuilds `index.html` from the dashboard's page and data, then pushes it here. You can also ask Claude to "update dashboard" at any time.

## Files

| Path | What it is |
| --- | --- |
| `index.html` | The encrypted, password-locked site (generated; don't edit by hand) |
| `keywrap.json` | The content key wrapped by the password (safe to publish) |
| `tools/build.mjs` | Builds `index.html` from a page and data folder; needs `CEND_KEY` |
| `tools/setkey.mjs` | Sets or changes the password and writes `keywrap.json` |
| `tools/page-shell.html`, `tools/dash-shim.js` | The plain-website wrapper around the dashboard page |
| `tools/login-shell.html` | The sign-in page |
| `tools/vendor/d3.min.js` | d3 v7.9.0 (ISC licence) |

### Changing the password

Ask Claude to do it, or run this with the current content key:

```sh
CEND_PASSWORD='new password' CEND_KEY='<content key>' node tools/setkey.mjs
CEND_KEY='<content key>' node tools/build.mjs <src-dir>
```

Devices that chose "Keep me signed in" stay signed in. To sign every device out, leave `CEND_KEY` unset in `setkey.mjs`. That makes a new key, which the scheduled task then needs.
