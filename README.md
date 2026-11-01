# CEND Electrical Dashboard

The Resident Engineer Progress View for HLEP · SJ Chenderoh electrical works: a password-protected website on GitHub Pages. It is the main record of electrical progress. Anyone with the password can view it and update it.

## What you can do on the website

- **Lookahead picker** (top of the page): switch to any lookahead on record, from CW18 onwards. Every tab then shows the dashboard as it stood that week: the plan, slips, constraints, plan reliability, and the site checks and added activities as they were on that week's last day. A banner shows you are looking back, editing is off, and **Back to latest** returns to the current week.
- **Ask the dashboard** (round bot button, bottom right): a chat assistant that answers from all the dashboard data, in English or Malay: what's late and why, what changed between lookahead weeks, what to chase, any past week, the Generator U1 reference data, and ready-to-paste WhatsApp or email updates. Activity numbers in an answer open the activity panel, and every answer has a Copy button. It can't change anything. It uses the Gemini key in Settings and keeps the conversation only in that browser tab.
- **Today's activities** tab: lists what the latest lookahead plans for the day, with one-tap **Done / Pending / Hold** site checks. It also lists what was planned earlier in the fortnight and still needs a check, shows the two-week chart, and has a search to find any activity.
- **Activity panel**: open any activity (from Today, the search, the runway or the chase list) to record a site check with a date and note, or clear it. The panel also shows the plan history across lookaheads.
- **Add activity**: add work that isn't in the ANDRITZ lookaheads, such as another contractor's scope. You can edit it, mark it done or delete it later.
- **3D plant** (button beside the lookahead picker): the whole station as a 3D model, with each area coloured by its progress. See [The 3D plant](#the-3d-plant) below.
- **Upload lookahead**: choose the contractor's two-week lookahead workbook (.xlsx) as it is. The website reads it in the browser, links each row to the activity it continues, and shows a review screen before anything is saved (see below).
- **Settings** (gear icon, bottom right): your name, the GitHub token that turns on editing, the Gemini key, and the recent changes.

## Uploading a lookahead

1. **Today's activities → Upload lookahead**, then choose or drop the .xlsx file.
2. The reader takes the electrical sheets: **EPS, GEN, AUTOMATION, PH Crane U4**, and the electrical rooms and fire-water pump electrical work on **FIRE FIGHTING**. A sheet whose dates are for another week (for example a hidden, older AUTOMATION sheet) is left out and listed.
3. Each row is linked to the activity it continues, by section, component heading (R01–R08, Rotor Body / Fan / Assembly) and wording. A remark on a component heading (for example "Ready for Transportation") is copied to every row under it, marked "(whole component)".
4. **Gemini** (if a key is set in Settings) checks the rows that didn't match word for word, in case an activity was renamed, and sorts new remarks into constraint types. Gemini only suggests; a confident rename is pre-linked and marked "linked by Gemini".
5. On the review screen you can link any row to a tracked activity, add it as new, or leave it out, and set the type of each new remark. **Save** writes the lookahead for everyone. Uploading the same week again replaces it.
6. **Sections not tracked** lists any other section of an electrical sheet (for example new FIRE FIGHTING sections such as Unit 4 fire alarm or GT4 deluge). **Track this section** adds its rows, and the choice is remembered for later uploads.

The reader was checked by replaying the CW43–44 workbook onto the CW42 data: the result matched the earlier tracker exactly (103 rows continued, 13 new, every slip, rollover, status, constraint and plan-reliability figure the same).

## The 3D plant

`plant/` is a 3D model of the station: the intake and head gates, the dam and spillway, the main powerhouse (Units 1–3), the control building (New Control Room, old control room, AC/DC (LV), battery charger and battery rooms), the station supply (SST1, SST2, EDG, temporary supply, fire water pumps), the cable trench, GT1–GT3 and the 132 kV switchyard, the Unit 4 powerhouse (crane, fire system, GT4 deluge), the laydown area and the off-site workshops. It opens with the same password and sign-in as the dashboard.

- **Colours**: each area takes the colour of its activities in the lookahead you are viewing, using the dashboard's statuses and site checks: red when something is on hold, amber when late, orange when pending on site, cyan when work is on plan, mint when all done. Grey areas have no tracked work. Below the model you can switch to **% done** or **Package**.
- **Tap an area** (or its label, or a row in **Areas**) to see its activities grouped as needs attention, this fortnight, planned later, no dates and done. Tapping an activity opens it on the dashboard, where you can record a site check.
- **Lookahead slider** and **play**: show the plant as it stood in any lookahead since CW18, the same way the dashboard's lookahead picker does. The dashboard's **3D plant** button opens the week you are viewing.
- **Milestones**: each area's and package's share done, lookahead by lookahead, with first planned start and when the work finished or is planned to finish.
- **Guided tour**: ten stops along the water and power path, each with that week's numbers.
- Links can point at a view: `plant/#cw=40&area=sst2&colour=progress`.

Where each activity belongs is worked out in `app/plantmap.js`. Rules match its package, section and wording, and the first match wins; anything that names no single area goes to **Powerhouse common systems**. The model is stylised and not to scale. It was drawn from public information (dam type and height, spillway gates, unit layout), and the positions of rooms and equipment are illustrative. To correct the layout, edit the builders in `app/plant3d.js`, then rebuild:

```sh
CEND_KEY='<content key>' node tools/build-plant.mjs
```

The page reads the published `data/state.enc` when it opens, so it doesn't need a rebuild when progress changes. A save shows up there once GitHub Pages has published it, usually within a minute.

**Undoing it.** To go back to the site as it was before the 3D plant (commit `53239f1`), revert [pull request #1](https://github.com/aizuddinreborn/CEND-ElectricalDashboard/pull/1) on GitHub: its **Revert** button opens a pull request that undoes only this change. Progress saved since is kept, because this change doesn't touch the data files. Don't reset `main` to that commit instead: that would also throw away the progress saved after it. To bring the 3D plant back, revert the revert.

## How it's protected

Everything is encrypted with AES-256-GCM before it reaches this public repository:
- `index.html` is the app.
- `data/state.enc` holds the progress data.
- `data/secrets.enc` holds the GitHub token and the Gemini key.

The team password unlocks them in the browser (PBKDF2-SHA256, 600,000 rounds). No project data is committed in plain text.

**Keep me signed in** stores the unlock key on that device, and **Lock** (bottom right) signs that device out. The protection is only as strong as the password, so share it only with the team.

## How saving works

GitHub Pages can only serve files. When someone saves a change, the website:
1. reads the latest `data/state.enc` through the GitHub API, using the token from `data/secrets.enc`;
2. applies the change;
3. writes the file back as a new commit, with the editor's name in the message.

If two people save at the same moment, the second save retries on top of the first. Everyone sees the change the next time they open or reload the dashboard.

The token is a fine-grained personal access token with only **Contents: Read and write** on this repository. When it expires, saving stops with a message; paste a new one in Settings.

## Files

| Path | What it is |
| --- | --- |
| `index.html` | The encrypted, password-locked app (generated by `tools/build.mjs`; don't edit by hand) |
| `data/state.enc` | The encrypted progress data, updated by the website |
| `data/secrets.enc` | The encrypted GitHub token and Gemini key, written from Settings |
| `generator/` | The encrypted Generator U1 3D model page and model file (generated by `tools/build-3d.mjs`) |
| `plant/` | The encrypted 3D plant page (generated by `tools/build-plant.mjs`) |
| `keywrap.json` | The content key wrapped by the password (safe to publish) |
| `app/model.js` | Works out status, slip, rollovers, constraints and plan reliability from the lookaheads |
| `app/datasets.js` | Turns the saved data into the dashboard's tables |
| `app/store.js` | Encryption, loading, and saving through the GitHub API |
| `app/ui.js`, `app/ui.css` | Today's activities, the activity panel, forms and settings |
| `app/xlsx-lite.js` | Reads .xlsx workbooks in the browser (no outside library) |
| `app/lookahead.js` | Turns a lookahead workbook into rows and links them to tracked activities |
| `app/gemini.js` | Asks Gemini about renamed activities and new remarks |
| `app/upload.js` | The upload and review screens |
| `app/chatdata.js` | What the assistant reads: its instructions and all the dashboard data as compact text |
| `app/chat.js` | The assistant: bot button, chat panel, answers with activity links |
| `app/plant.html`, `app/plant3d.js` | The 3D plant page and its viewer: the model, colours, labels, panels, timeline and tour |
| `app/plantmap.js` | The plant's areas, which area each activity belongs to, and each area's progress |
| `tools/build.mjs` | Builds `index.html` from the dashboard page and the app files; needs `CEND_KEY` |
| `tools/reseal.mjs` | Re-encrypts `index.html` with the current `app/` files and password, without the dashboard page source; needs `CEND_KEY` |
| `tools/build-plant.mjs` | Builds `plant/index.html` from `app/plant.html` and the app files; needs `CEND_KEY` |
| `tools/seal.mjs` | Encrypts or decrypts a data file; needs `CEND_KEY` |
| `tools/setkey.mjs` | Sets or changes the password and writes `keywrap.json` |
| `tools/page-shell.html`, `tools/dash-shim.js`, `tools/login-shell.html` | The website wrapper and the sign-in page |
| `tools/vendor/d3.min.js`, `vendor/three/` | d3 v7.9.0 (ISC licence), three.js r169 (MIT licence) |

### Changing the password

Ask Claude to do it, or run this with the current content key:

```sh
CEND_PASSWORD='new password' CEND_KEY='<content key>' node tools/setkey.mjs
CEND_KEY='<content key>' node tools/build.mjs <src-dir>
```

Each locked page carries the wrapped key, so rebuild the 3D plant page as well (`node tools/build-plant.mjs`). If the dashboard's page source isn't at hand, `node tools/reseal.mjs` re-encrypts `index.html` with the new password and the current `app/` files.

Keeping the same content key changes only the password, so the saved data and devices that chose "Keep me signed in" carry on as before. If you make a new key instead, every device is signed out and all `.enc` files must be re-encrypted with it.
