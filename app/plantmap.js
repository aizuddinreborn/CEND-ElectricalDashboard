/* The 3D plant page's map of the site: the areas of SJ Chenderoh, which area each activity belongs to,
   and each area's progress, worked out from the same statuses and site checks the dashboard shows.
   Pure functions (no DOM), so where every activity lands can be checked outside a browser. */
(function (root) {
  'use strict';

  /* Areas, in the order of the water path and then the power path. `what` says what the area is;
     what is being done there comes from the progress data. */
  const AREAS = [
    { id: 'intake', group: 'Water path', name: 'Intake & head gates', short: 'Intake',
      what: 'Water from Chenderoh Lake enters the power waterways here, through the trash racks and the head gates that can close off each unit. The intake dam distribution board on the crest powers the gate hoists.' },
    { id: 'dam', group: 'Water path', name: 'Dam & spillway', short: 'Dam & spillway', context: true,
      what: 'A hollow concrete buttress dam about 22 m high, completed in 1930. The gated spillway passes floods down a chute to a flip bucket. No electrical activities are tracked here.' },
    { id: 'u1gen', group: 'Main powerhouse', name: 'Unit 1 generator', short: 'U1 generator',
      what: 'The first unit in the programme. The old generator is taken out on site, its parts are refurbished at the workshop, and the unit is rebuilt with the new generator. The Generator U1 3D page shows it part by part.' },
    { id: 'u1elec', group: 'Main powerhouse', name: 'Unit 1 switchgear & boards', short: 'U1 boards',
      what: 'The unit’s 11 kV switchgear, excitation transformer and boards, unit control and governor cubicles, distribution boards and neutral earthing on the generator floor.' },
    { id: 'u2', group: 'Main powerhouse', name: 'Unit 2', short: 'Unit 2',
      what: 'Generating unit 2. It stays in service while Unit 1 is rebuilt; work here so far is integration of the new automation.' },
    { id: 'u3', group: 'Main powerhouse', name: 'Unit 3', short: 'Unit 3',
      what: 'Generating unit 3. It stays in service while Unit 1 is rebuilt; work here so far is integration of the new automation.' },
    { id: 'ph', group: 'Main powerhouse', name: 'Powerhouse common systems', short: 'Common systems',
      what: 'Work that serves the whole station rather than one room: the common outage, isolations, cable trays in the turbine hall, compressed air, cooling water, and load transfers. Activities that name no single area are shown here too.' },
    { id: 'ctrl', group: 'Control building', name: 'New Control Room', short: 'New Control Room',
      what: 'The new control room: SCADA and common control cubicles, operator and engineering stations, the video wall and the DCS.' },
    { id: 'oldctrl', group: 'Control building', name: 'Old control room', short: 'Old control room',
      what: 'The original control room. Its protection and control cables are isolated and taken out as control moves to the new room.' },
    { id: 'acdc', group: 'Control building', name: 'AC/DC (LV) Room', short: 'AC/DC (LV) Room',
      what: 'The low-voltage heart of the station: AC distribution panels, the main DC distribution board and the UPS, on a new raised floor.' },
    { id: 'charger', group: 'Control building', name: 'Battery Charger Room', short: 'Charger Room',
      what: 'The battery chargers (rectifiers) that keep the station batteries charged and feed the DC system.' },
    { id: 'battery', group: 'Control building', name: 'Battery Room', short: 'Battery Room',
      what: 'The station battery banks. They keep protection, control and emergency lighting running when AC supply is lost.' },
    { id: 'sst1', group: 'Station supply', name: 'Station service transformer SST1', short: 'SST1',
      what: 'One of the two transformers that supply the station’s own loads. It is drained, disconnected and removed under the programme.' },
    { id: 'sst2', group: 'Station supply', name: 'Station service transformer SST2', short: 'SST2',
      what: 'The second station service transformer, with its own deluge fire protection (spray nozzles, piping and detection).' },
    { id: 'edg', group: 'Station supply', name: 'Emergency diesel generator', short: 'EDG',
      what: 'The emergency diesel generator that backs up the station supply. A rental set covers the changeover to the permanent one.' },
    { id: 'temp', group: 'Station supply', name: 'Temporary power supply', short: 'Temporary power',
      what: 'The temporary main and sub-distribution boards, panels and the electrical container that keep the site powered during the outage and changeover.' },
    { id: 'fwp', group: 'Station supply', name: 'Fire water pump house', short: 'Fire water pumps',
      what: 'The pumps that feed the station’s fire water system. Only their electrical work is tracked here.' },
    { id: 'trench', group: 'Switchyard', name: 'Cable trench & tray bank', short: 'Cable trench',
      what: 'The routes that carry MV, LV and control cables between the powerhouse, the control building and the switchyard.' },
    { id: 'gt', group: 'Switchyard', name: 'Step-up transformers GT1–GT3', short: 'GT1–GT3',
      what: 'The main transformers that step each unit’s 11 kV output up to 132 kV for the grid.' },
    { id: 'swyd', group: 'Switchyard', name: '132 kV switchyard', short: '132 kV switchyard',
      what: 'Breakers, isolators, surge arresters and busbars that connect the station to the 132 kV grid.' },
    { id: 'u4', group: 'Unit 4', name: 'Unit 4 powerhouse', short: 'Unit 4', rollup: ['crane4', 'u4fire', 'gt4'],
      what: 'The separate powerhouse of Unit 4, reached by pontoon during the works. Its crane and fire systems are refurbished under the programme.' },
    { id: 'crane4', group: 'Unit 4', name: 'Powerhouse crane, Unit 4', short: 'PH crane U4',
      what: 'The overhead crane in the Unit 4 powerhouse: dismantled, its motors and gearboxes overhauled at the workshop, reinstalled and load tested.' },
    { id: 'u4fire', group: 'Unit 4', name: 'Unit 4 fire alarm & fighting', short: 'U4 fire system',
      what: 'Fire detection, alarm and fighting systems in the Unit 4 powerhouse.' },
    { id: 'gt4', group: 'Unit 4', name: 'GT4 transformer & deluge', short: 'GT4 deluge',
      what: 'The Unit 4 step-up transformer and its deluge fire protection.' },
    { id: 'laydown', group: 'Site', name: 'Laydown, warehouse & waste area', short: 'Laydown',
      what: 'Where dismantled equipment, new deliveries and scheduled waste are kept on site.' },
    { id: 'offsite', group: 'Site', name: 'Off-site workshops', short: 'Off-site workshops', virtual: true,
      what: 'Refurbishment away from site: the Unit 1 generator parts (R01–R08) and the Unit 4 crane’s motors and gearboxes. These activities also count in their own areas.' },
  ];
  const AREA = Object.fromEntries(AREAS.map((a) => [a.id, a]));

  /* Rules, first match wins. A rule tests the activity (package `p`, section `sec`) or its wording `t`:
     name, component heading, section and the names it was also listed under, in lower case. */
  const sec = (a) => String(a.sec || '');
  const has = (rx) => (a, t) => rx.test(t);
  const RULES = [
    // whole packages and sections that sit in one place
    ['crane4', (a) => a.p === 'CRANE4'],
    ['u1gen', (a) => a.p === 'GEN'],
    ['u2', (a, t) => a.p === 'AUTO' && /\bunit ?2\b/.test(t)],
    ['u3', (a, t) => a.p === 'AUTO' && /\bunit ?3\b/.test(t)],
    ['ctrl', (a) => a.p === 'AUTO'],
    ['temp', (a) => a.p === 'EPS' && /temporary/i.test(sec(a))],
    ['ctrl', (a) => a.p === 'ROOMS' && /control room/i.test(sec(a))],
    ['charger', (a) => a.p === 'ROOMS' && /charger/i.test(sec(a))],
    ['acdc', (a) => a.p === 'ROOMS' && /ac\s*\/?\s*dc|\blv\b/i.test(sec(a))],
    ['battery', (a) => a.p === 'ROOMS' && /battery/i.test(sec(a))],
    ['sst2', (a) => a.p === 'ROOMS' && /sst\s*2/i.test(sec(a))],
    ['gt4', (a) => a.p === 'ROOMS' && /gt\s*4/i.test(sec(a))],
    ['u4fire', (a) => a.p === 'ROOMS' && /unit\s*4/i.test(sec(a))],
    ['fwp', (a) => a.p === 'ROOMS' && /fire\s*water\s*pump|\bfwp\b/i.test(sec(a))],
    // the wording of the activity
    ['intake', has(/\bintake|head ?gate/)],
    ['u4', has(/\bu(nit)?[\s-]*4\b/)],
    ['edg', has(/\be?dg\b|diesel/)],
    ['sst1', has(/\bsst ?1\b|transformer oil|oil (drainage|barrels)/)],
    ['sst2', has(/\bsst ?2\b/)],
    ['gt', has(/\bgt ?[1-3]\b|step[- ]?up|main step/)],
    ['swyd', has(/switch ?yard|132 ?kv|surge arr/)],
    ['oldctrl', has(/\b(old|existing) control room/)],
    ['u1elec', has(/\bunit ?1\b|unit generator 1|\b1(bja|baa|mkc|cfe|cja|cua)\d|excitation|govern|generator floor|gauge panel|\bngr\b/)],
    ['u2', has(/\bunit ?2\b/)],
    ['u3', has(/\bunit ?3\b/)],
    ['ctrl', has(/control room|scada|video ?wall|operator table|engineering station|common control|\bdcs\b|gps antenna/)],
    ['temp', has(/temporary|\btemp\b|\bmdb\b|\bsdb\b|\be[- ]?container|\bjb\b/)],
    ['charger', has(/charger|recti?fier/)],
    ['battery', has(/batter(y|ies)|48 ?vdc/)],
    ['acdc', has(/ac ?\/? ?dc|\blv room|\bups\b|dc distribution|ac distribution|\bac panels?\b|\bdc (system|load|cable)|raised floor/)],
    ['trench', has(/trench|tray bank|outside power ?house/)],
    ['laydown', has(/laydown|warehouse|schedule(d)? waste|scrap yard/)],
    // anything else: the station's common systems
    ['ph', () => true],
  ];
  // other areas an activity also counts in (it is listed in each)
  const ALSO = [
    ['sst2', (a, t) => /\bsst ?1 ?(&|and) ?2\b|\bsst ?2\b/.test(t)],
    ['u3', (a, t) => /\bunit ?3\b/.test(t)],
    ['offsite', (a) => (a.p === 'GEN' && /refurbish/i.test(sec(a))) || (a.p === 'CRANE4' && /workshop/i.test(sec(a)))],
  ];

  const textOf = (a) => [a.n, a.sub, a.sec, ...(Array.isArray(a.al) ? a.al : [])].filter(Boolean).join(' | ').toLowerCase();
  function areasOf(a) {
    const t = textOf(a);
    const rule = RULES.find(([, test]) => test(a, t));
    const first = rule ? rule[0] : 'ph';
    const out = [first];
    for (const [id, test] of ALSO) if (id !== first && !out.includes(id) && test(a, t)) out.push(id);
    return out;
  }

  /* One activity's state, as the dashboard shows it: a site check wins over the lookahead status.
     done · plan (on plan or planned later) · late · site (pending on site) · hold (on hold, overdue,
     or on hold on site) · uns (no dates yet, not in the latest plan, never scheduled) */
  const LOOK = { Completed: 'done', 'Done (inferred)': 'done', Active: 'plan', Planned: 'plan', Slipping: 'late', Overdue: 'hold', 'On hold': 'hold',
    Pending: 'uns', 'Not in latest plan': 'uns', 'Not scheduled': 'uns' };
  const SITE = { done: 'done', pending: 'site', hold: 'hold' };
  function bucket(a, s) {
    if (s && SITE[s.status]) return SITE[s.status];
    return LOOK[a.st] || 'uns';
  }
  const BUCKETS = ['hold', 'late', 'site', 'plan', 'uns', 'done'];
  const OPEN = ['hold', 'late', 'site', 'plan'];

  function blank() { return { n: 0, done: 0, plan: 0, late: 0, site: 0, hold: 0, uns: 0, fort: 0, items: [], start: null, finish: null, lastDone: null, firstDone: null }; }
  const minD = (x, y) => (!x ? y : !y ? x : x < y ? x : y);
  const maxD = (x, y) => (!x ? y : !y ? x : x > y ? x : y);
  function add(sum, r) {
    sum.n++; sum[r.b]++; if (r.fort) sum.fort++;
    sum.items.push(r);
    sum.start = minD(sum.start, r.a.bs || r.a.ls || null);
    if (OPEN.includes(r.b) || r.b === 'uns') sum.finish = maxD(sum.finish, r.a.lf || null);
    if (r.done) { sum.lastDone = maxD(sum.lastDone, r.done); sum.firstDone = minD(sum.firstDone, r.done); }
  }
  /* The colour an area takes: what needs attention first, then work on plan, then finished work. */
  function statusOf(sum) {
    if (!sum.n) return 'none';
    for (const b of OPEN) if (sum[b]) return b;
    return sum.done ? 'done' : 'uns';
  }
  function close(sum) {
    sum.status = statusOf(sum);
    sum.share = sum.n ? sum.done / sum.n : 0;
    const rank = (b) => BUCKETS.indexOf(b);
    sum.items.sort((x, y) => rank(x.b) - rank(y.b) || (y.fort - x.fort)
      || (x.b === 'done' ? String(y.done || '').localeCompare(String(x.done || '')) : String(x.a.lf || '9').localeCompare(String(y.a.lf || '9')))
      || x.a.id - y.a.id);
    return sum;
  }

  /* Everything the page draws for one state of the data (`B` from CEND_DATA.build). */
  function summarise(B) {
    const areas = Object.fromEntries(AREAS.map((a) => [a.id, blank()]));
    const plant = blank(), pkgs = {};
    for (const a of B.items) {
      const s = (B.site && B.site[a.k]) || null;
      const b = bucket(a, s);
      const done = b === 'done' ? ((s && s.status === 'done' && s.checked) || a.d || a.lf || null) : null;
      const r = { a, b, s, done, fort: b !== 'done' && Array.isArray(a.days) && a.days.length > 0 };
      for (const id of areasOf(a)) add(areas[id], r);
      add(plant, r);
      add(pkgs[a.p] || (pkgs[a.p] = blank()), r);
    }
    // an area that holds others (the Unit 4 powerhouse) also shows their work, each activity once
    for (const ar of AREAS) {
      if (!ar.rollup) continue;
      const sum = areas[ar.id], seen = new Set(sum.items.map((r) => r.a.k));
      for (const id of ar.rollup) for (const r of areas[id].items) if (!seen.has(r.a.k)) { seen.add(r.a.k); add(sum, r); }
    }
    for (const id in areas) close(areas[id]);
    for (const p in pkgs) close(pkgs[p]);
    close(plant);
    return { areas, plant, pkgs, pk: B.pk || {}, latest: B.meta.latest, start: B.meta.latest_start, end: B.meta.latest_end };
  }

  root.CEND_PLANT = { AREAS, AREA, RULES, ALSO, areasOf, bucket, BUCKETS, OPEN, statusOf, summarise };
})(typeof window !== 'undefined' ? window : globalThis);
