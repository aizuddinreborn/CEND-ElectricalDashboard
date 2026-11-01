/* The 3D plant page: SJ Chenderoh drawn as a stylised model (dam, intake, powerhouses, control building,
   station supply, switchyard), each area coloured by the dashboard's progress data. The data is the same
   encrypted data/state.enc the dashboard reads, worked out with the same code (app/model.js, app/datasets.js);
   app/plantmap.js says which area each activity belongs to. A lookahead slider shows the plant as it stood
   in any week, and a guided tour walks through the station.
   The layout is drawn from public information and is not to scale: positions are illustrative. */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const BOOT = window.__viewer || { start() {}, fail() {}, done() {}, overlay() {}, hide() {}, ready: false, failed: false };
BOOT.start();
const DS = window.CEND_DATA, PM = window.CEND_PLANT;
const $ = (s, r = document) => r.querySelector(s);
const coarse = matchMedia('(pointer: coarse)').matches;            // phones and tablets: lighter on graphics
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

function h(tag, a, ...kids) {
  const el = document.createElement(tag);
  if (typeof a === 'string') el.className = a;
  else if (a) for (const [k, v] of Object.entries(a)) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  for (const k of kids.flat(Infinity)) if (k != null && k !== false && k !== '') el.append(k instanceof Node ? k : String(k));
  return el;
}

// ---------------------------------------------------------------- words and dates (as the dashboard writes them)
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const D = (s) => { const [y, m, d] = s.split('-').map(Number); return Date.UTC(y, m - 1, d); };
const addD = (s, n) => new Date(D(s) + n * 864e5).toISOString().slice(0, 10);
const fmt = (s) => { if (!s) return '–'; const d = new Date(D(s)); return `${d.getUTCDate()} ${MON[d.getUTCMonth()]}`; };
const fmtW = (s) => { if (!s) return '–'; const d = new Date(D(s)); return `${WD[d.getUTCDay()]} ${d.getUTCDate()} ${MON[d.getUTCMonth()]}`; };
const wkTxt = (cw, end) => { const w2 = end ? DS.isoWeek(end) : cw + 1; return `CW${cw}${w2 !== cw ? `–${w2}` : ''}`; };
const pct = (x) => `${Math.round(x * 100)}%`;
const plural = (n, w, pl) => `${n} ${n === 1 ? w : (pl || `${w}s`)}`;
const B_WORD = { done: 'Done', plan: 'On plan', late: 'Late', site: 'Pending on site', hold: 'On hold', uns: 'No dates', none: 'No tracked work' };
const AREA_WORD = { done: 'All tracked work done', plan: 'Work on plan', late: 'Work running late', site: 'Pending on site', hold: 'Something is on hold', uns: 'Waiting for dates', none: 'No tracked work' };
const LOOK_WORD = { Completed: 'Completed', 'Done (inferred)': 'Done (inferred)', Active: 'On plan', Slipping: 'Late', 'On hold': 'On hold', Pending: 'No dates yet',
  'Not in latest plan': 'Not in latest plan', 'Not scheduled': 'Never scheduled', Overdue: 'Overdue', Planned: 'Planned later' };
const SITE_WORD = { done: 'Done on site', pending: 'Pending on site', hold: 'On hold on site' };
const label = (a) => (a.p === 'ROOMS' && a.sec ? `${a.sec}: ${a.n}` : a.sub && (a.p === 'GEN' || a.p === 'CRANE4') ? `${a.sub}: ${a.n}` : a.n);

// ---------------------------------------------------------------- progress data (loaded while the model is built)
async function loadState() {
  let s = null; try { s = localStorage.getItem('cend-key') || sessionStorage.getItem('cend-key'); } catch (e) { /* ignore */ }
  if (!s) { location.reload(); throw new Error('Signed out'); }
  const b64 = (x) => Uint8Array.from(atob(x), (c) => c.charCodeAt(0));
  const res = await fetch(`../data/state.enc?t=${Date.now()}`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`The progress data could not be loaded (the server answered ${res.status}).`);
  const buf = new Uint8Array(await res.arrayBuffer());
  const key = await crypto.subtle.importKey('raw', b64(s), 'AES-GCM', false, ['decrypt']);
  const gz = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: buf.slice(0, 12) }, key, buf.slice(12));
  return JSON.parse(await new Response(new Blob([gz]).stream().pipeThrough(new DecompressionStream('gzip'))).text());
}
const statePromise = loadState();
statePromise.catch(() => {});                                          // handled where it is awaited

// ---------------------------------------------------------------- renderer
const stage = $('#stage');
let canvas = $('#c');
const GL_TRIES = [
  { antialias: true, powerPreference: 'high-performance' },
  { antialias: false, powerPreference: 'default' },
  { antialias: false, powerPreference: 'low-power' },
];
async function createRenderer() {
  let lastErr;
  for (let i = 0; i < GL_TRIES.length; i++) {
    if (i > 0) {
      BOOT.overlay('Building the 3D plant…', `Waiting for the graphics view (attempt ${i + 1} of ${GL_TRIES.length})…`, { progress: true });
      await new Promise((r) => setTimeout(r, 700 * i));
      const fresh = canvas.cloneNode(false); canvas.replaceWith(fresh); canvas = fresh;
    }
    try { return new THREE.WebGLRenderer({ canvas, ...GL_TRIES[i] }); }
    catch (e) {
      lastErr = e;
      try { const gl = canvas.getContext('webgl2'); const x = gl && gl.getExtension('WEBGL_lose_context'); if (x) x.loseContext(); } catch (_) { /* ignore */ }
    }
  }
  throw lastErr;
}
let renderer;
try { renderer = await createRenderer(); }
catch (e) {
  BOOT.fail('This device could not open the 3D view',
    `The browser did not allow a WebGL graphics view (${String((e && e.message) || e).replace(/\.$/, '')}). This can happen when graphics memory is low or several 3D pages are open. Close some of them, then tap Retry.`);
  throw e;
}
renderer.setPixelRatio(Math.min(devicePixelRatio || 1, coarse ? 1.5 : 2));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.08;
renderer.shadowMap.enabled = !coarse;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
const SKY_TOP = new THREE.Color('#040a15'), SKY_HOR = new THREE.Color('#1e3a56');
scene.fog = new THREE.Fog(SKY_HOR, 650, 1650);
function skyMaterial() {
  return new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false,
    uniforms: { top: { value: SKY_TOP }, hor: { value: SKY_HOR } },
    vertexShader: 'varying vec3 vP; void main() { vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: [
      'uniform vec3 top; uniform vec3 hor; varying vec3 vP;',
      'void main() {',
      '  float t = clamp(vP.y * 1.8, 0.0, 1.0);',
      '  gl_FragColor = vec4(mix(hor, top, pow(t, 0.65)), 1.0);',
      '  #include <tonemapping_fragment>',
      '  #include <colorspace_fragment>',
      '}',
    ].join('\n'),
  });
}
const sky = new THREE.Mesh(new THREE.SphereGeometry(2600, 32, 16), skyMaterial());
sky.renderOrder = -10; scene.add(sky);
// reflections: the same dusk sky, so water and steel pick up its colours
function makeEnvironment() {
  const envScene = new THREE.Scene();
  envScene.add(new THREE.Mesh(new THREE.SphereGeometry(50, 32, 16), skyMaterial()));
  const glow = new THREE.Mesh(new THREE.SphereGeometry(6, 16, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color('#ffe7c4').multiplyScalar(3) }));
  glow.position.set(30, 30, 20); envScene.add(glow);
  const g = new THREE.PMREMGenerator(renderer); const t = g.fromScene(envScene, 0.02).texture; g.dispose(); return t;
}
scene.environment = makeEnvironment();
scene.environmentIntensity = 0.55;
scene.add(new THREE.HemisphereLight(0xa9c8ff, 0x1d2b1e, 0.85));
const sun = new THREE.DirectionalLight(0xfff0dc, 2.3);
sun.position.set(330, 420, 230);
sun.target.position.set(0, 0, 40);
scene.add(sun, sun.target);
if (renderer.shadowMap.enabled) {
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -330, right: 330, top: 300, bottom: -300, near: 50, far: 1300 });
  sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.6;
}
const camera = new THREE.PerspectiveCamera(40, 1, 1, 6000);
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true; controls.dampingFactor = 0.08;
controls.minDistance = 14; controls.maxDistance = 1000;
controls.maxPolarAngle = THREE.MathUtils.degToRad(84);
controls.screenSpacePanning = false;
controls.zoomToCursor = true;
let needsRender = true;
controls.addEventListener('change', () => { needsRender = true; });

let lostTimer = 0;
canvas.addEventListener('webglcontextlost', (e) => {
  e.preventDefault();
  BOOT.overlay('3D view paused', 'The device took back the graphics memory. This happens when the app goes to the background or memory runs low. It normally comes back by itself in a moment.', { retry: true });
  clearTimeout(lostTimer);
  lostTimer = setTimeout(() => BOOT.overlay('3D view paused', 'The graphics view did not come back by itself. Tap Retry to reload the page.', { retry: true }), 8000);
});
canvas.addEventListener('webglcontextrestored', () => { clearTimeout(lostTimer); scene.environment = makeEnvironment(); BOOT.hide(); needsRender = true; });
addEventListener('pagehide', (e) => { if (!e.persisted) { try { renderer.dispose(); renderer.forceContextLoss(); } catch (_) { /* ignore */ } } });

// ---------------------------------------------------------------- materials
const M = (o) => new THREE.MeshStandardMaterial(o);
const MAT = {
  concrete: M({ color: 0xa4aebb, roughness: 0.9 }),
  concrete2: M({ color: 0x7f8b99, roughness: 0.95 }),
  wall: M({ color: 0xc3cbd4, roughness: 0.85 }),
  floor: M({ color: 0x5e6b7b, roughness: 0.8 }),
  roof: M({ color: 0x46596f, roughness: 0.55, metalness: 0.35, side: THREE.DoubleSide }),
  steel: M({ color: 0x8c98a7, roughness: 0.42, metalness: 0.65 }),
  darksteel: M({ color: 0x4b5665, roughness: 0.5, metalness: 0.55 }),
  machine: M({ color: 0x6d8199, roughness: 0.45, metalness: 0.45 }),
  gate: M({ color: 0x5f7d98, roughness: 0.45, metalness: 0.5, side: THREE.DoubleSide }),
  porcelain: M({ color: 0xdde2e8, roughness: 0.35 }),
  cubicle: M({ color: 0x95a0ab, roughness: 0.6, metalness: 0.2 }),
  dark: M({ color: 0x0a0f17, roughness: 0.9 }),
  window: M({ color: 0x0c1826, roughness: 0.2, metalness: 0.6, emissive: 0x16446b, emissiveIntensity: 0.55 }),
  screen: M({ color: 0x0c2236, roughness: 0.3, emissive: 0x3aa8e0, emissiveIntensity: 0.9 }),
  asphalt: M({ color: 0x272c34, roughness: 0.95 }),
  gravel: M({ color: 0x4a504f, roughness: 1 }),
  wood: M({ color: 0x8a6a45, roughness: 0.9 }),
  red: M({ color: 0xd23a45, roughness: 0.55 }),
  yellow: M({ color: 0xd8b03a, roughness: 0.6 }),
  blue: M({ color: 0x2f6aa3, roughness: 0.6 }),
  trunk: M({ color: 0x4a3929, roughness: 1 }),
  leaf: M({ color: 0xffffff, roughness: 0.95, flatShading: true }),
  water: M({ color: 0x23608a, roughness: 0.08, metalness: 0.3, envMapIntensity: 1.7, transparent: true, opacity: 0.9 }),
  foam: new THREE.MeshBasicMaterial({ color: 0xa9d8ff, transparent: true, opacity: 0.22, depthWrite: false }),
};

/* Status colours, the dashboard's: mint done · cyan on plan · amber late · orange pending on site ·
   red on hold · slate no dates. Areas without tracked work stay concrete-grey. */
const SC = { done: '#43e0a3', plan: '#48c9ff', late: '#ffb547', site: '#ff8a45', hold: '#ff4d6a', uns: '#8492a7', none: '#9aa5b3' };
const PKG_C = { EPS: '#48c9ff', GEN: '#a78bfa', AUTO: '#f472b6', ROOMS: '#facc15', CRANE4: '#43e0a3' };
const PKG_OTHER = '#94a3b8';
const PROG_LO = new THREE.Color('#6b778a'), PROG_HI = new THREE.Color(SC.done), NEUTRAL = new THREE.Color(SC.none);
const areaMats = {};
function areaMaterial(id) {
  if (areaMats[id]) return areaMats[id];
  const skin = M({ color: NEUTRAL.clone(), emissive: new THREE.Color(0), roughness: 0.5, metalness: 0.08 });
  const glass = M({ color: NEUTRAL.clone(), emissive: new THREE.Color(0), transparent: true, opacity: 0.46, roughness: 0.25, metalness: 0, depthWrite: false, side: THREE.DoubleSide });
  const edge = new THREE.LineBasicMaterial({ color: NEUTRAL.clone(), transparent: true, opacity: 0.85 });
  return (areaMats[id] = { skin, glass, edge, cur: NEUTRAL.clone(), tgt: NEUTRAL.clone(), glow: 0, glowT: 0 });
}

// ---------------------------------------------------------------- geometry helpers
const parts = new Map();                                                 // 'material|area|flag' -> geometries, merged at the end
function put(mat, area, geo, flag) {
  const k = `${mat}|${area || ''}|${flag || ''}`;
  let list = parts.get(k); if (!list) parts.set(k, (list = []));
  list.push(geo); return geo;
}
function bx(mat, area, x0, y0, z0, x1, y1, z1, flag) {
  const g = new THREE.BoxGeometry(Math.max(0.02, Math.abs(x1 - x0)), Math.max(0.02, Math.abs(y1 - y0)), Math.max(0.02, Math.abs(z1 - z0)));
  g.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
  return put(mat, area, g, flag);
}
function cyl(mat, area, x, y0, z, r, hgt, seg = 18, rTop = r, flag) {
  const g = new THREE.CylinderGeometry(rTop, r, hgt, seg); g.translate(x, y0 + hgt / 2, z); return put(mat, area, g, flag);
}
function cylX(mat, area, x0, x1, y, z, r, seg = 12) {
  const g = new THREE.CylinderGeometry(r, r, Math.abs(x1 - x0), seg); g.rotateZ(Math.PI / 2); g.translate((x0 + x1) / 2, y, z); return put(mat, area, g);
}
function cylZ(mat, area, x, y, z0, z1, r, seg = 12) {
  const g = new THREE.CylinderGeometry(r, r, Math.abs(z1 - z0), seg); g.rotateX(Math.PI / 2); g.translate(x, y, (z0 + z1) / 2); return put(mat, area, g);
}
/* a profile drawn in the z–y plane (pairs [z, y]) and extruded along x from x0 to x1 */
function prismX(mat, area, pts, x0, x1, flag) {
  const shape = new THREE.Shape(pts.map(([z, y]) => new THREE.Vector2(-z, y)));
  const g = new THREE.ExtrudeGeometry(shape, { depth: x1 - x0, bevelEnabled: false, curveSegments: 4 });
  g.rotateY(Math.PI / 2); g.translate(x0, 0, 0);
  return put(mat, area, g, flag);
}
const UP = new THREE.Vector3(0, 1, 0);
function beam(mat, area, a, b, r, seg = 6) {
  const va = new THREE.Vector3(...a), vb = new THREE.Vector3(...b), len = va.distanceTo(vb);
  if (len < 1e-3) return null;
  const g = new THREE.CylinderGeometry(r, r, len, seg);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(UP, vb.clone().sub(va).normalize()));
  g.translate((va.x + vb.x) / 2, (va.y + vb.y) / 2, (va.z + vb.z) / 2);
  return put(mat, area, g);
}

// ---------------------------------------------------------------- terrain and water
const TAIL = 0, RES = 13, CREST = 17, GROUND = 4, BED = -7;
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const lerp = (a, b, t) => a + (b - a) * t;
/* The water's edges across the valley at a given z: the lake upstream of the dam (z < 0), the river below. */
function waterEdges(z) {
  if (z < -10) { const t = smooth(-10, -330, z); return [-150 - 160 * t + 16 * Math.sin(z / 41) * t, 150 + 130 * t + 13 * Math.sin(z / 33 + 1) * t]; }
  if (z < 0) return [-150, 150];
  const t = smooth(20, 260, z);
  return [-150 + 58 * t + 9 * Math.sin(z / 47) * t, 104 - 52 * t + 11 * Math.sin(z / 39 + 2) * t];
}
function noise(x, z) {
  return Math.sin(x * 0.021 + Math.sin(z * 0.013) * 2) * Math.cos(z * 0.017 + Math.sin(x * 0.011)) + 0.5 * Math.sin(x * 0.053 + z * 0.041) * Math.cos(z * 0.037 - x * 0.029);
}
const PADS = [[100, 5, 166, 178], [166, 28, 322, 178], [-224, 4, -150, 72]];   // flat site ground, downstream
const inPad = (x, z) => PADS.some(([x0, z0, x1, z1]) => x > x0 && x < x1 && z > z0 && z < z1);
function ground(x, z) {
  const [xl, xr] = waterEdges(z);
  const sIn = Math.min(x - xl, xr - x);                                  // metres inside the water (negative on land)
  const away = Math.max(0, -sIn);
  const up = 17.5 + Math.min(30, away * 0.05) + 1.6 * noise(x, z);
  const down = GROUND + Math.min(26, Math.max(0, away - 24) * 0.045) + 1.1 * noise(x * 1.3, z * 1.1);
  let bank = lerp(up, down, smooth(0, 10, z));
  if (z > 0) for (const [x0, z0, x1, z1] of PADS) {
    const d = Math.max(x0 - x, x - x1, z0 - z, z - z1);
    bank = lerp(bank, GROUND, 1 - smooth(0, 18, d));
  }
  const wet = smooth(-1, 12, sIn);
  const bed = BED - 3 * smooth(10, 60, sIn) + 0.8 * noise(x * 2, z * 2);
  let y = lerp(bank, bed, wet);
  const r = Math.hypot(x - 20, (z - 40) * 0.9);
  y += 75 * smooth(400, 780, r) * (0.6 + 0.4 * noise(x * 0.4, z * 0.4)) * (sIn > 0 ? 0.25 : 1);
  return y;
}
function buildTerrain() {
  const W = 1500, seg = coarse ? 150 : 230;
  const g = new THREE.PlaneGeometry(W, W, seg, seg); g.rotateX(-Math.PI / 2); g.translate(40, 0, 60);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) p.setY(i, ground(p.getX(i), p.getZ(i)));
  const ng = g.toNonIndexed(); g.dispose();
  ng.computeVertexNormals();
  const q = ng.attributes.position, n = ng.attributes.normal, col = new Float32Array(q.count * 3);
  const mud = new THREE.Color('#18231f'), rock = new THREE.Color('#3a413b'), grass = new THREE.Color('#203d2b'), grass2 = new THREE.Color('#2b4c33'),
    pad = new THREE.Color('#2d3431'), hill = new THREE.Color('#172c20'), c = new THREE.Color();
  for (let i = 0; i < q.count; i += 3) {
    const x = (q.getX(i) + q.getX(i + 1) + q.getX(i + 2)) / 3, y = (q.getY(i) + q.getY(i + 1) + q.getY(i + 2)) / 3, z = (q.getZ(i) + q.getZ(i + 1) + q.getZ(i + 2)) / 3;
    const ny = Math.abs(n.getY(i));
    if (y < -0.6) c.copy(mud);
    else if (ny < 0.82) c.copy(rock).lerp(grass, Math.max(0, (ny - 0.55) / 0.27));
    else if (inPad(x, z) && Math.abs(y - GROUND) < 0.6) c.copy(pad);
    else c.copy(grass).lerp(grass2, 0.5 + 0.5 * noise(x * 2.3, z * 2.1)).lerp(hill, smooth(22, 70, y));
    for (let k = 0; k < 3; k++) col.set([c.r, c.g, c.b], (i + k) * 3);
  }
  ng.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const mesh = new THREE.Mesh(ng, M({ vertexColors: true, flatShading: true, roughness: 1 }));
  mesh.receiveShadow = true; scene.add(mesh);
  // the lake and the river
  const lake = new THREE.Mesh(new THREE.PlaneGeometry(1600, 780), MAT.water);
  lake.rotation.x = -Math.PI / 2; lake.position.set(40, RES, -392); lake.receiveShadow = true; scene.add(lake);
  const river = new THREE.Mesh(new THREE.PlaneGeometry(1600, 800), MAT.water);
  river.rotation.x = -Math.PI / 2; river.position.set(40, TAIL, 403); river.receiveShadow = true; scene.add(river);
  // churned water where the running units discharge (Units 2, 3 and 4; Unit 1 is out for rebuilding)
  for (const [x, z, r] of [[60, 34, 5.5], [74, 34, 5.5], [-131, 34, 5]]) {
    const f = new THREE.Mesh(new THREE.CircleGeometry(r, 20), MAT.foam); f.rotation.x = -Math.PI / 2; f.position.set(x, TAIL + 0.06, z); scene.add(f);
  }
}

// ---------------------------------------------------------------- the station
function buildDam() {
  const crestDeck = (x0, x1) => { bx('asphalt', null, x0, CREST, 0.6, x1, CREST + 0.06, 4.4); bx('concrete2', 'dam', x0, CREST, -3.6, x1, CREST + 1.1, -3.1); bx('concrete2', 'dam', x0, CREST, 4.9, x1, CREST + 1.1, 5.4); };
  // non-overflow buttress sections: an inclined upstream deck carried on buttresses
  for (const [x0, x1] of [[-162, -150], [-112, -104], [20, 34], [104, 162]]) {
    prismX('concrete', 'dam', [[-11, BED], [-4, CREST], [5.4, CREST], [5.4, CREST - 2], [3, BED]], x0, x1);
    for (let x = x0 + 3; x < x1 - 1; x += 6.5) prismX('concrete2', 'dam', [[3, CREST - 2], [3, BED], [16, BED]], x - 0.8, x + 0.8);
    crestDeck(x0, x1);
  }
  // gated spillway: ogee weir, chute and flip bucket, 8 radial gates between piers
  const SX0 = -104, SX1 = 20, bays = 8, pw = 2.4, bw = (SX1 - SX0 - (bays + 1) * pw) / bays;
  prismX('concrete', 'dam', [[-9, BED], [-6, 6], [-3, 8.5], [1, 8.5], [6, 6], [14, 2.5], [24, 0], [32, -1.2], [37, -1], [41, 0.6], [43, 2.2], [44, 2.2], [44, BED]], SX0, SX1);
  for (let i = 0; i <= bays; i++) {
    const px = SX0 + i * (bw + pw);
    bx('concrete', 'dam', px, BED, -9, px + pw, CREST, 10);
    cyl('concrete', 'dam', px + pw / 2, BED, -9, pw / 2, CREST - BED, 12);
  }
  bx('concrete2', 'dam', SX0, CREST - 1.2, -3.6, SX1, CREST, 5.4);
  crestDeck(SX0, SX1);
  for (let i = 0; i < bays; i++) {
    const x0 = SX0 + pw + i * (bw + pw), xc = x0 + bw / 2;
    const g = new THREE.CylinderGeometry(10, 10, bw - 0.3, 10, 1, true, THREE.MathUtils.degToRad(165.5), THREE.MathUtils.degToRad(35));
    g.rotateZ(Math.PI / 2); g.translate(xc, 12, 6); put('gate', 'dam', g);
    for (const ax of [x0 + 0.7, x0 + bw - 0.7]) { beam('darksteel', 'dam', [ax, 12, 6], [ax, 9.2, -3.4], 0.28); beam('darksteel', 'dam', [ax, 12, 6], [ax, 14.4, -3.6], 0.28); }
    bx('steel', 'dam', xc - 1.6, CREST + 0.06, -2.6, xc + 1.6, CREST + 2.6, 0.2);
  }
  bx('concrete', 'dam', SX0 - 1.6, -1.5, 8, SX0, 6.5, 44);
  bx('concrete', 'dam', SX1, -1.5, 8, SX1 + 1.6, 6.5, 44);
  // the intake block in front of the main powerhouse: three bays with trash racks; gate hoist house on the crest
  prismX('concrete', 'dam', [[-10.5, BED], [-10.5, CREST], [6, CREST], [6, BED]], 34, 104);
  crestDeck(34, 104);
  for (const xc of [46, 60, 74]) {
    bx('dark', null, xc - 5, -2, -10.9, xc + 5, 10.5, -10.45);
    for (let b = xc - 4.8; b <= xc + 4.9; b += 0.8) bx('skin:intake', 'intake', b - 0.09, -2, -11.3, b + 0.09, 11, -10.9);
    for (const y of [1.5, 5.5, 9.5]) bx('skin:intake', 'intake', xc - 5, y - 0.12, -11.4, xc + 5, y + 0.12, -10.9);
  }
  bx('skin:intake', 'intake', 38, CREST + 0.06, -9.6, 84, CREST + 4.6, -1.2);
  bx('roof', 'intake', 37.4, CREST + 4.6, -10.2, 84.6, CREST + 5.1, -0.6);
  for (let x = 40; x < 84; x += 4.6) bx('window', 'intake', x, CREST + 2, -1.25, x + 2.2, CREST + 3.4, -1.15);
  bx('skin:intake', 'intake', 25.5, CREST + 0.06, -2.4, 28.7, CREST + 2.7, -0.4);          // intake dam distribution board kiosk
  // Unit 4's own intake
  prismX('concrete', 'u4', [[-10.5, BED], [-10.5, CREST], [6, CREST], [6, BED]], -150, -112);
  crestDeck(-150, -112);
  bx('dark', null, -136, -2, -10.9, -126, 10.5, -10.45);
  for (let b = -135.8; b <= -126.1; b += 0.8) bx('steel', 'u4', b - 0.09, -2, -11.3, b + 0.09, 11, -10.9);
  bx('wall', 'u4', -141, CREST + 0.06, -9, -121, CREST + 4, -1.6);
  bx('roof', 'u4', -141.5, CREST + 4, -9.5, -120.5, CREST + 4.5, -1.1);
}

function generatorUnit(x, z, area, r = 4.6) {
  cyl(area ? `skin:${area}` : 'machine', area, x, GROUND, z, r, 3.4, 32);
  cyl('steel', area, x, GROUND + 3.4, z, r - 0.6, 0.5, 32);
  cyl('darksteel', area, x, GROUND + 3.9, z, 1.3, 1.4, 20);
  cyl('darksteel', area, x, GROUND + 5.3, z, 0.6, 0.5, 12);
  for (let k = 0; k < 8; k++) { const a = k * Math.PI / 4; bx('darksteel', area, x + Math.cos(a) * (r + 0.1) - 0.25, GROUND, z + Math.sin(a) * (r + 0.1) - 0.25, x + Math.cos(a) * (r + 0.1) + 0.25, GROUND + 3.2, z + Math.sin(a) * (r + 0.1) + 0.25); }
}
function hall(area, X0, X1, Z0, Z1, TOP) {
  bx('concrete', area, X0, BED, Z0, X1, GROUND, Z1);
  bx('floor', null, X0 + 1, GROUND, Z0 + 1, X1 - 1, GROUND + 0.04, Z1 - 1);
  bx('wall', area, X0, GROUND, Z0, X1, TOP, Z0 + 1);
  bx('wall', area, X0, GROUND, Z0, X0 + 1, TOP, Z1);
  bx('wall', area, X1 - 1, GROUND, Z0, X1, TOP, Z1);
  bx('wall', area, X0, GROUND, Z1 - 1, X1, TOP, Z1, 'cut');
  for (let x = X0 + 4; x < X1 - 4; x += 5.5) { bx('window', area, x, 9, Z1 + 0.01, x + 3, 15, Z1 + 0.08, 'cut'); bx('window', area, x, 10, Z0 - 0.08, x + 3, 15, Z0 - 0.01); }
  for (let x = X0; x <= X1 + 0.01; x += (X1 - X0) / Math.round((X1 - X0) / 7)) bx('concrete2', area, x - 0.45, GROUND, Z1 - 1.1, x + 0.45, TOP, Z1 + 0.1);
  bx('concrete2', area, X0, TOP - 1, Z1 - 1.1, X1, TOP, Z1 + 0.1);
  const zc = (Z0 + Z1) / 2;
  prismX('roof', area, [[Z0 - 0.8, TOP], [zc, TOP + 2.8], [Z1 + 0.8, TOP], [Z1 + 0.8, TOP - 0.45], [zc, TOP + 2.35], [Z0 - 0.8, TOP - 0.45]], X0 - 0.8, X1 + 0.8, 'cut');
  bx('darksteel', null, X0 + 1, TOP - 3.4, Z0 + 1, X1 - 1, TOP - 3, Z0 + 1.7);
  bx('darksteel', null, X0 + 1, TOP - 3.4, Z1 - 1.7, X1 - 1, TOP - 3, Z1 - 1);
}
function buildPowerhouse() {
  const X0 = 36, X1 = 102, Z0 = 6, Z1 = 30, TOP = 18;
  hall('ph', X0, X1, Z0, Z1, TOP);
  for (const xc of [46, 60, 74]) bx('dark', null, xc - 4, -4.5, Z1, xc + 4, -0.6, Z1 + 0.3);   // draft tube outlets
  generatorUnit(46, 18, 'u1gen'); generatorUnit(60, 18, 'u2'); generatorUnit(74, 18, 'u3');
  for (let i = 0; i < 9; i++) {                                           // unit boards along the north wall
    const x = 40 + i * 1.3; bx('skin:u1elec', 'u1elec', x, GROUND, Z0 + 1.6, x + 1.15, GROUND + 2.3, Z0 + 2.6);
    bx('cubicle', 'u2', 54 + i * 1.3, GROUND, Z0 + 1.6, 55.15 + i * 1.3, GROUND + 2.3, Z0 + 2.6);
    bx('cubicle', 'u3', 68 + i * 1.3, GROUND, Z0 + 1.6, 69.15 + i * 1.3, GROUND + 2.3, Z0 + 2.6);
  }
  bx('skin:u1elec', 'u1elec', 38, GROUND, 21.5, 41.2, GROUND + 2.8, 26);   // excitation transformer and switchgear
  bx('skin:u1elec', 'u1elec', 38, GROUND, 13, 40.4, GROUND + 2.4, 19.5);
  for (let i = 0; i < 10; i++) bx('skin:ph', 'ph', 86 + i * 1.35, GROUND, Z0 + 1.6, 87.2 + i * 1.35, GROUND + 2.3, Z0 + 2.6);   // common panels in the service bay
  for (let i = 0; i < 3; i++) bx('skin:ph', 'ph', 37.2, 9.2 + i * 0.7, Z1 - 2.6, 100.8, 9.36 + i * 0.7, Z1 - 1.6);              // turbine hall cable trays
  for (const [x, z] of [[88, 15], [91, 22], [96, 16], [94, 25]]) bx('wood', null, x, GROUND, z, x + 2.4, GROUND + 1.4, z + 2);   // parts in the service bay
  bx('steel', 'ph', 64, TOP - 3, Z0 + 1, 67, TOP - 1.6, Z1 - 1);          // powerhouse crane
  bx('darksteel', 'ph', 63.4, TOP - 1.6, 16, 67.6, TOP - 0.5, 20);
  beam('darksteel', 'ph', [65.5, TOP - 3, 18], [65.5, 9, 18], 0.08);
}
function buildControlBuilding() {
  const X0 = 106, X1 = 136, Z0 = 12, Z1 = 34, F1 = 9.6, TOP = 15.2;
  bx('concrete2', null, X0, GROUND - 0.3, Z0, X1, GROUND + 0.25, Z1);
  bx('concrete2', null, X0, F1 - 0.25, Z0, X1, F1 + 0.1, Z1);
  bx('roof', null, X0 - 0.4, TOP, Z0 - 0.4, X1 + 0.4, TOP + 0.5, Z1 + 0.4, 'cut');
  for (const x of [X0, X0 + 10, X0 + 20, X1]) for (const z of [Z0, Z1]) bx('concrete', null, x - 0.35, GROUND, z - 0.35, x + 0.35, TOP, z + 0.35);
  const g = 0.3, room = (id, x0, y0, x1, y1) => bx(`glass:${id}`, id, x0 + g, y0, Z0 + 1.2, x1 - g, y1, Z1 - 1.2);
  room('battery', X0, GROUND + 0.25, 115, F1 - 0.3); room('charger', 115, GROUND + 0.25, 124, F1 - 0.3); room('acdc', 124, GROUND + 0.25, X1, F1 - 0.3);
  room('ctrl', X0, F1 + 0.1, 126, TOP - 0.1); room('oldctrl', 126, F1 + 0.1, X1, TOP - 0.1);
  for (let r = 0; r < 3; r++) for (let i = 0; i < 6; i++) bx('darksteel', 'battery', 107.6 + r * 2.4, GROUND + 0.25, 15 + i * 2.6, 108.8 + r * 2.4, GROUND + 1.6, 16.8 + i * 2.6);   // battery racks
  for (let i = 0; i < 5; i++) bx('cubicle', 'charger', 116.2 + i * 1.5, GROUND + 0.25, 14.4, 117.4 + i * 1.5, GROUND + 2.6, 15.4);                             // chargers
  for (let r = 0; r < 2; r++) for (let i = 0; i < 7; i++) bx('cubicle', 'acdc', 125.4 + i * 1.4, GROUND + 0.25, 17 + r * 7, 126.6 + i * 1.4, GROUND + 2.5, 18 + r * 7);  // AC/DC panels
  bx('screen', 'ctrl', 108, F1 + 1.2, 13.6, 124, F1 + 4.2, 13.9);                                                                                        // video wall
  for (const [x, z] of [[110, 20], [116, 20], [113, 25.5]]) { bx('darksteel', 'ctrl', x, F1 + 0.1, z, x + 4, F1 + 0.9, z + 1.4); bx('screen', 'ctrl', x + 0.4, F1 + 0.9, z + 0.2, x + 3.6, F1 + 1.6, z + 0.35); }
  for (let i = 0; i < 4; i++) bx('cubicle', 'ctrl', 108 + i * 1.3, F1 + 0.1, 30.6, 109.1 + i * 1.3, F1 + 2.3, 31.6);                                    // SCADA cubicles
  for (let i = 0; i < 5; i++) bx('darksteel', 'oldctrl', 127.2 + i * 1.6, F1 + 0.1, 14.2, 128.6 + i * 1.6, F1 + 2.4, 15.2);
}
function transformer(area, x, z, s = 1, deluge = false) {
  bx('concrete2', area, x - 3.4 * s, GROUND, z - 2.6 * s, x + 3.4 * s, GROUND + 0.5, z + 2.6 * s);
  bx(`skin:${area}`, area, x - 2.6 * s, GROUND + 0.5, z - 1.8 * s, x + 2.6 * s, GROUND + 0.5 + 3.6 * s, z + 1.8 * s);
  for (let i = -3; i <= 3; i++) for (const side of [-1, 1]) {
    const z0 = z + side * 1.8 * s, z1 = z + side * 2.9 * s;
    bx('steel', area, x + i * 0.72 * s - 0.12, GROUND + 0.9, Math.min(z0, z1), x + i * 0.72 * s + 0.12, GROUND + 3.7 * s, Math.max(z0, z1));
  }
  for (let i = -1; i <= 1; i++) cyl('porcelain', area, x + i * 1.4 * s, GROUND + 0.5 + 3.6 * s, z - 0.6 * s, 0.24 * s, 1.7 * s, 8);
  cylX('steel', area, x - 2 * s, x + 2 * s, GROUND + 0.5 + 4.9 * s, z + 1.1 * s, 0.55 * s);
  if (deluge) for (const y of [GROUND + 1.6, GROUND + 3.4 * s]) {
    const a = 3.4 * s, b = 3.5 * s;
    cylX('red', area, x - a, x + a, y, z - b, 0.12, 6); cylX('red', area, x - a, x + a, y, z + b, 0.12, 6);
    cylZ('red', area, x - a, y, z - b, z + b, 0.12, 6); cylZ('red', area, x + a, y, z - b, z + b, 0.12, 6);
  }
}
function buildStationSupply() {
  bx('darksteel', null, 102.6, GROUND, 8, 102.9, 7.6, 34); bx('darksteel', null, 105.1, GROUND, 8, 105.4, 7.6, 34);       // cable tray bank behind the powerhouse
  for (let i = 0; i < 3; i++) bx('skin:trench', 'trench', 102.6, 6 + i * 0.6, 8, 105.4, 6.14 + i * 0.6, 34);
  bx('skin:trench', 'trench', 104, GROUND - 0.25, 50.2, 170, GROUND + 0.32, 51.8);                                         // covered trench to the switchyard
  transformer('sst1', 113, 42, 0.9); transformer('sst2', 129, 42, 0.9, true);
  bx('concrete', null, 120.7, GROUND, 37, 121.3, 11.5, 47);                                                                 // firewall
  bx('red', 'sst2', 134.5, GROUND, 38.5, 136, GROUND + 1.8, 40);                                                            // deluge valve
  bx('skin:edg', 'edg', 142, GROUND, 14, 154, GROUND + 3.2, 17.5);                                                         // emergency diesel generator
  cyl('darksteel', 'edg', 152.6, GROUND + 3.2, 15.75, 0.32, 2.4, 10);
  for (let x = 143.2; x < 150; x += 1.4) bx('dark', 'edg', x, GROUND + 0.8, 17.52, x + 0.8, GROUND + 2.6, 17.6);
  bx('skin:temp', 'temp', 142, GROUND, 22, 149, GROUND + 2.8, 25);                                                         // temporary supply container and board
  bx('skin:temp', 'temp', 150.5, GROUND, 22.6, 152.2, GROUND + 2.1, 24.4);
  bx('skin:fwp', 'fwp', 112, GROUND, 60, 121, GROUND + 4.2, 66);                                                           // fire water pump house
  prismX('roof', 'fwp', [[59.4, GROUND + 4.2], [63, GROUND + 5.6], [66.6, GROUND + 4.2]], 111.6, 121.4);
  bx('red', 'fwp', 115.4, GROUND, 59.92, 117.4, GROUND + 2.6, 60);
  for (let i = 0; i < 3; i++) cylX('red', 'fwp', 104.5, 112, GROUND + 0.6 + i * 0.01, 62 + i * 1.4, 0.18, 8);
}
function buildSwitchyard() {
  const X0 = 170, X1 = 226, Z0 = 34, Z1 = 98;
  bx('gravel', 'swyd', X0, GROUND - 0.2, Z0, X1, GROUND + 0.2, Z1); kerb('swyd', X0, Z0, X1, Z1);
  for (let x = X0; x <= X1; x += 4) { bx('darksteel', null, x - 0.08, GROUND, Z0 - 0.08, x + 0.08, GROUND + 2.4, Z0 + 0.08); bx('darksteel', null, x - 0.08, GROUND, Z1 - 0.08, x + 0.08, GROUND + 2.4, Z1 + 0.08); }
  for (let z = Z0; z <= Z1; z += 4) { bx('darksteel', null, X0 - 0.08, GROUND, z - 0.08, X0 + 0.08, GROUND + 2.4, z + 0.08); bx('darksteel', null, X1 - 0.08, GROUND, z - 0.08, X1 + 0.08, GROUND + 2.4, z + 0.08); }
  for (const [a, b] of [[[X0, Z0], [X1, Z0]], [[X0, Z1], [X1, Z1]], [[X0, Z0], [X0, Z1]], [[X1, Z0], [X1, Z1]]]) beam('darksteel', null, [a[0], GROUND + 2.3, a[1]], [b[0], GROUND + 2.3, b[1]], 0.05, 4);
  for (const zg of [40, 66, 92]) {                                        // gantries
    for (const xl of [174, 222]) { beam('steel', 'swyd', [xl - 1, GROUND, zg], [xl, 19, zg], 0.22); beam('steel', 'swyd', [xl + 1, GROUND, zg], [xl, 19, zg], 0.22); }
    bx('steel', 'swyd', 173.4, 18.4, zg - 0.4, 222.6, 19.4, zg + 0.4);
  }
  for (const xb of [182, 194, 206, 216]) {
    for (const [z, kind] of [[46, 'iso'], [54, 'cb'], [60, 'ct'], [72, 'iso'], [80, 'cb'], [86, 'ct']]) {
      if (kind === 'cb') { cyl('darksteel', 'swyd', xb, GROUND, z, 0.7, 2.4, 10); cyl('skin:swyd', 'swyd', xb, GROUND + 2.4, z, 0.55, 3.2, 12); cyl('steel', 'swyd', xb, GROUND + 5.6, z, 0.75, 0.6, 12); }
      else if (kind === 'ct') { cyl('darksteel', 'swyd', xb, GROUND, z, 0.5, 2.4, 8); cyl('porcelain', 'swyd', xb, GROUND + 2.4, z, 0.32, 3.2, 10); cyl('steel', 'swyd', xb, GROUND + 5.6, z, 0.5, 0.7, 10); }
      else { bx('darksteel', 'swyd', xb - 1.8, GROUND + 2.2, z - 0.3, xb + 1.8, GROUND + 2.6, z + 0.3); for (const dx of [-1.5, 1.5]) { bx('darksteel', 'swyd', xb + dx - 0.2, GROUND, z - 0.2, xb + dx + 0.2, GROUND + 2.2, z + 0.2); cyl('porcelain', 'swyd', xb + dx, GROUND + 2.6, z, 0.22, 2.4, 8); } bx('steel', 'swyd', xb - 1.5, GROUND + 5, z - 0.08, xb + 1.5, GROUND + 5.16, z + 0.08); }
    }
    beam('steel', null, [xb, 15.6, 40], [xb, GROUND + 6.2, 54], 0.06, 4); beam('steel', null, [xb, GROUND + 6.2, 54], [xb, GROUND + 6.2, 86], 0.06, 4); beam('steel', null, [xb, GROUND + 6.2, 86], [xb, 15.6, 92], 0.06, 4);
    for (let i = 0; i < 3; i++) cyl('porcelain', 'swyd', xb - 1 + i, 16.4, 92, 0.16, 2, 6);
  }
  for (const zb of [44, 48]) beam('steel', 'swyd', [174, 16.2, zb], [222, 16.2, zb], 0.09, 6);
  for (const [z, s] of [[42, 1.25], [58, 1.25], [74, 1.25]]) transformer('gt', 158, z, s);                                      // GT1, GT2, GT3
  for (const z of [49.4, 65.4]) bx('concrete', null, 152, GROUND, z, 164, 12, z + 0.6);
  for (const [z, xb] of [[42, 182], [58, 194], [74, 206]]) beam('steel', null, [161, 10.8, z], [xb, 15.6, 40], 0.06, 4);
  for (const zt of [56, 84]) {                                             // line towers out to the grid
    const x = 262, top = 38;
    for (const [dx, dz] of [[-2.6, -2.6], [2.6, -2.6], [2.6, 2.6], [-2.6, 2.6]]) beam('darksteel', null, [x + dx, GROUND, zt + dz], [x + dx * 0.25, top, zt + dz * 0.25], 0.22, 4);
    for (const y of [10, 18, 26]) bx('darksteel', null, x - 2.4 + y * 0.05, y, zt - 0.15, x + 2.4 - y * 0.05, y + 0.3, zt + 0.15);
    for (const y of [30, 35]) { bx('darksteel', null, x - 7, y, zt - 0.25, x + 7, y + 0.5, zt + 0.25); for (const dx of [-6, 0, 6]) { cyl('porcelain', null, x + dx, y - 2.2, zt, 0.14, 2.2, 6); beam('steel', null, [x + dx, y - 2.2, zt], [222, 17, zt < 70 ? 66 : 92], 0.05, 4); } }
  }
}
function buildUnit4() {
  const X0 = -146, X1 = -116, Z0 = 6, Z1 = 30, TOP = 17;
  hall('u4', X0, X1, Z0, Z1, TOP);
  bx('dark', null, -135, -4.5, Z1, -127, -0.6, Z1 + 0.3);
  generatorUnit(-131, 18, null, 4.2);
  for (const zr of [Z0 + 1.3, Z1 - 1.3]) bx('skin:crane4', 'crane4', -138, TOP - 3.2, zr - 0.5, -124, TOP - 2.6, zr + 0.5);        // end carriages
  for (const xg of [-134, -129.6]) bx('skin:crane4', 'crane4', xg, TOP - 2.6, Z0 + 1, xg + 0.9, TOP - 1.2, Z1 - 1);               // bridge girders
  bx('skin:crane4', 'crane4', -134.4, TOP - 1.2, 15.6, -128.3, TOP - 0.2, 20.4);                                                     // trolley with hoist
  beam('darksteel', 'crane4', [-131.4, TOP - 2.6, 18], [-131.4, 10.2, 18], 0.07);
  bx('skin:crane4', 'crane4', -132.2, 9.2, 17.4, -130.6, 10.2, 18.6);
  bx('skin:u4fire', 'u4fire', -120.4, GROUND, Z0 + 1.1, -118.2, GROUND + 2.3, Z0 + 1.9);                                            // fire alarm panel
  const y = 11.2, t = 0.32;                                                                                                          // alarm wiring around the hall
  bx('skin:u4fire', 'u4fire', X0 + 1, y, Z0 + 1, X1 - 1, y + t, Z0 + 1 + t); bx('skin:u4fire', 'u4fire', X0 + 1, y, Z1 - 1 - t, X1 - 1, y + t, Z1 - 1);
  bx('skin:u4fire', 'u4fire', X0 + 1, y, Z0 + 1, X0 + 1 + t, y + t, Z1 - 1); bx('skin:u4fire', 'u4fire', X1 - 1 - t, y, Z0 + 1, X1 - 1, y + t, Z1 - 1);
  for (const [x, z] of [[-140, 7.4], [-124, 7.4], [-144.6, 18], [-117.4, 18]]) cyl('skin:u4fire', 'u4fire', x, y - 0.8, z, 0.35, 0.8, 10);
  transformer('gt4', -172, 20, 1.1, true);
  bx('red', 'gt4', -178.6, GROUND, 14, -177.2, GROUND + 1.8, 15.6);
  bx('concrete', null, -166.8, GROUND, 13, -166.2, 11, 27);
  bx('steel', null, -134, -0.35, 42, -121, 0.75, 50);                                                                                // the pontoon
  for (const [x, z] of [[-132, 44], [-128.6, 45.4]]) bx('wood', null, x, 0.75, z, x + 2.4, 2.1, z + 1.8);
}
function buildSite() {
  bx('gravel', 'laydown', 168, GROUND - 0.2, 112, 236, GROUND + 0.2, 160); kerb('laydown', 168, 112, 236, 160);                      // laydown, warehouse, waste
  bx('skin:laydown', 'laydown', 204, GROUND, 116, 230, GROUND + 6, 138);
  const roof = new THREE.CylinderGeometry(20, 20, 27, 16, 1, true, Math.PI / 2 - 0.6, 1.2); roof.rotateZ(Math.PI / 2); roof.translate(217, GROUND + 6 - 16.5, 127); put('roof', 'laydown', roof);
  for (let i = 0; i < 6; i++) bx('wood', 'laydown', 174 + (i % 3) * 5, GROUND + 0.2, 118 + Math.floor(i / 3) * 6, 177.6 + (i % 3) * 5, GROUND + 2.2, 121 + Math.floor(i / 3) * 6);
  for (let i = 0; i < 12; i++) cyl(i % 4 ? 'blue' : 'yellow', 'laydown', 176 + (i % 6) * 1.3, GROUND + 0.2, 146 + Math.floor(i / 6) * 1.3, 0.55, 1.3, 10);
  for (let i = 0; i < 3; i++) bx('yellow', 'laydown', 190 + i * 4.6, GROUND + 0.2, 150, 193.6 + i * 4.6, GROUND + 2, 155);
  transformer('laydown', 222, 150, 0.85);                                                                                           // a dismantled transformer in store
  // off-site workshops (not to scale): generator parts and crane parts are refurbished away from site
  bx('gravel', 'offsite', 266, GROUND - 0.1, 118, 306, GROUND + 0.25, 154); kerb('offsite', 266, 118, 306, 154);
  for (const [x0, z0] of [[270, 122], [288, 132]]) {
    bx('skin:offsite', 'offsite', x0, GROUND + 0.25, z0, x0 + 14, GROUND + 6.5, z0 + 16);
    prismX('roof', 'offsite', [[z0 - 0.6, GROUND + 6.5], [z0 + 8, GROUND + 9], [z0 + 16.6, GROUND + 6.5]], x0 - 0.6, x0 + 14.6);
    bx('dark', 'offsite', x0 + 4, GROUND + 0.25, z0 + 15.95, x0 + 10, GROUND + 5, z0 + 16.05);
  }
  // roads
  bx('asphalt', null, 140, GROUND, 102, 340, GROUND + 0.06, 108);
  bx('asphalt', null, 140, GROUND, 30, 146, GROUND + 0.06, 108);
  bx('asphalt', null, 106, GROUND, 35, 146, GROUND + 0.06, 40);
  for (let x = 238; x < 266; x += 6) bx('asphalt', null, x, GROUND, 136, x + 3.6, GROUND + 0.06, 140);
  bx('concrete', null, 103.6, -3, 30, 104.6, GROUND + 0.4, 56);                                                                     // quay wall
  // a truck on the way to the workshops
  bx('blue', null, 248, GROUND + 0.8, 133.6, 251.2, GROUND + 3.4, 136.2); bx('steel', null, 251.4, GROUND + 0.9, 133.6, 260, GROUND + 1.6, 136.2);
  bx('wood', null, 252, GROUND + 1.6, 133.9, 258.6, GROUND + 3.2, 135.9);
}
function kerb(area, x0, z0, x1, z1, t = 0.7, hgt = 0.75) {                // a coloured edge round a yard, so big yards don't flood the view with colour
  bx(`skin:${area}`, area, x0, GROUND, z0, x1, GROUND + hgt, z0 + t); bx(`skin:${area}`, area, x0, GROUND, z1 - t, x1, GROUND + hgt, z1);
  bx(`skin:${area}`, area, x0, GROUND, z0, x0 + t, GROUND + hgt, z1); bx(`skin:${area}`, area, x1 - t, GROUND, z0, x1, GROUND + hgt, z1);
}
function mulberry32(a) { return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function buildTrees() {
  const N = coarse ? 300 : 620, rnd = mulberry32(20261101);
  const cone = new THREE.ConeGeometry(2.7, 7.5, 6); cone.translate(0, 6.3, 0);
  const trunk = new THREE.CylinderGeometry(0.35, 0.45, 2.7, 5); trunk.translate(0, 1.35, 0);
  const leaves = new THREE.InstancedMesh(cone, MAT.leaf, N), trunks = new THREE.InstancedMesh(trunk, MAT.trunk, N);
  const CLEAR = [[96, -16, 330, 182], [-232, -16, -140, 82], [-172, -18, 172, 16]];
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), c = new THREE.Color();
  const tones = ['#2f5a3c', '#356642', '#284f35', '#3d6b3f', '#2a5640'].map((x) => new THREE.Color(x));
  let n = 0;
  for (let tries = 0; n < N && tries < N * 40; tries++) {
    const x = -520 + rnd() * 1100, z = -420 + rnd() * 900;
    const [xl, xr] = waterEdges(z);
    if (Math.min(x - xl, xr - x) > -9) continue;
    if (CLEAR.some(([x0, z0, x1, z1]) => x > x0 && x < x1 && z > z0 && z < z1)) continue;
    const y = ground(x, z), k = 0.7 + rnd() * 0.75;
    m.compose(p.set(x, y - 0.3, z), q.setFromAxisAngle(UP, rnd() * 6.28), s.set(k, k * (0.8 + rnd() * 0.5), k));
    leaves.setMatrixAt(n, m); trunks.setMatrixAt(n, m);
    leaves.setColorAt(n, c.copy(tones[Math.floor(rnd() * tones.length)]).multiplyScalar(0.85 + rnd() * 0.3));
    n++;
  }
  leaves.count = trunks.count = n;
  leaves.castShadow = trunks.castShadow = !coarse; leaves.receiveShadow = true;
  scene.add(leaves, trunks);
}

// ---------------------------------------------------------------- assemble: merge by material and area
const pickables = [], cutMeshes = [], areaBox = {}, skinBox = {};
function finalize() {
  const norm = (g) => { const x = g.index ? g.toNonIndexed() : g; if (x.attributes.uv) x.deleteAttribute('uv'); return x; };
  for (const [k, geos] of parts) {
    const [mk, area, flag] = k.split('|');
    const geo = mergeGeometries(geos.map(norm), false);
    if (!geo) { console.warn('could not merge', k); continue; }
    let mat, kind = 'decor';
    if (mk.startsWith('skin:')) { mat = areaMaterial(mk.slice(5)).skin; kind = 'skin'; }
    else if (mk.startsWith('glass:')) { mat = areaMaterial(mk.slice(6)).glass; kind = 'glass'; }
    else mat = MAT[mk];
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = kind !== 'glass' && !mat.transparent;
    mesh.receiveShadow = kind !== 'glass';
    if (flag === 'cut') cutMeshes.push(mesh);
    scene.add(mesh);
    geo.computeBoundingBox();
    if (area) {
      mesh.userData.area = area; pickables.push(mesh);
      (areaBox[area] || (areaBox[area] = new THREE.Box3())).union(geo.boundingBox);
      if (kind !== 'decor') (skinBox[area] || (skinBox[area] = new THREE.Box3())).union(geo.boundingBox);
    }
    if (kind === 'glass') {
      mesh.renderOrder = 3;
      const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geo, 25), areaMaterial(area).edge);
      edges.renderOrder = 4; scene.add(edges);
    }
  }
  parts.clear();
}
BOOT.overlay('Building the 3D plant…', 'Drawing the dam, powerhouses, control building and switchyard', { progress: true });
buildTerrain(); buildDam(); buildPowerhouse(); buildControlBuilding(); buildStationSupply(); buildSwitchyard(); buildUnit4(); buildSite(); buildTrees();
finalize();
let cutaway = true;
const applyCutaway = () => { for (const m of cutMeshes) m.visible = !cutaway; needsRender = true; };
applyCutaway();

// where each area's label sits, and the camera that frames it
const ANCHOR = { ph: [93, 23.5, 18], u4: [-131, 23, 18], dam: [-42, 21, 0], intake: [61, 24, -5], offsite: [286, 17, 136], swyd: [198, 22, 66], trench: [137, 7, 51] };
const anchors = {}, focus = {};
const INSIDE = ['u1gen', 'u1elec', 'u2', 'u3', 'ph', 'crane4', 'u4fire'];                // areas inside a hall: the camera looks down through the roof
const _c = new THREE.Vector3(), _s = new THREE.Vector3();
for (const ar of PM.AREAS) {
  const all = areaBox[ar.id] || skinBox[ar.id]; if (!all) continue;
  const sk = skinBox[ar.id] || all;
  anchors[ar.id] = ANCHOR[ar.id] ? new THREE.Vector3(...ANCHOR[ar.id]) : new THREE.Vector3((sk.min.x + sk.max.x) / 2, sk.max.y + 1.2, (sk.min.z + sk.max.z) / 2);
  all.getCenter(_c); all.getSize(_s);
  const inside = INSIDE.includes(ar.id), dist = Math.min(420, Math.max(inside ? 58 : 50, _s.length() * 1.05 + 32));
  focus[ar.id] = { target: _c.clone(), pos: _c.clone().add((inside ? new THREE.Vector3(0.32, 1.25, 0.72) : new THREE.Vector3(0.5, 0.85, 0.95)).normalize().multiplyScalar(dist)) };
}
focus.u4 = { target: new THREE.Vector3(-138, 6, 20), pos: new THREE.Vector3(-88, 58, 100) };
focus.dam = { target: new THREE.Vector3(-40, 6, 6), pos: new THREE.Vector3(-10, 70, 150) };

// ---------------------------------------------------------------- camera views
const VIEWS = [
  { id: 'site', label: 'Whole site', pos: [136, 236, 392], target: [30, 0, 64] },
  { id: 'water', label: 'Intake & dam', pos: [96, 92, -168], target: [10, 8, 0] },
  { id: 'ph', label: 'Powerhouse', pos: [96, 64, 102], target: [68, 4, 18] },
  { id: 'ctrl', label: 'Control building', pos: [172, 52, 94], target: [122, 8, 27] },
  { id: 'swyd', label: 'Switchyard', pos: [262, 95, 168], target: [192, 4, 64] },
  { id: 'u4', label: 'Unit 4', pos: [-88, 58, 100], target: [-138, 6, 20] },
];
const fit = (pos, target) => {                                           // pull back on tall, narrow screens so the view still fits
  const a = Math.max(0.35, camera.aspect || 1);
  const k = a < 1.25 ? Math.pow(1.25 / a, 0.75) : 1;
  return target.clone().add(pos.clone().sub(target).multiplyScalar(k));
};
let fly = null, curView = 'site';
function flyTo(pos, target, dur = 1150) {
  const p1 = fit(pos, target);
  if (reduceMotion) { camera.position.copy(p1); controls.target.copy(target); controls.update(); needsRender = true; return; }
  fly = { t0: performance.now(), dur, p0: camera.position.clone(), p1, q0: controls.target.clone(), q1: target.clone(), lift: Math.min(80, camera.position.distanceTo(p1) * 0.18) };
}
function stepFly(now) {
  if (!fly) return false;
  const t = Math.min(1, (now - fly.t0) / fly.dur), e = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  camera.position.lerpVectors(fly.p0, fly.p1, e); camera.position.y += Math.sin(Math.PI * e) * fly.lift;
  controls.target.lerpVectors(fly.q0, fly.q1, e);
  if (t >= 1) fly = null;
  return true;
}
controls.addEventListener('start', () => { fly = null; if (curView) { curView = null; renderViews(); } });
function goView(id) { const v = VIEWS.find((x) => x.id === id); if (!v) return; curView = id; renderViews(); flyTo(new THREE.Vector3(...v.pos), new THREE.Vector3(...v.target)); }
function renderViews() {
  $('#views').replaceChildren(...VIEWS.map((v) => h('button', { type: 'button', 'aria-pressed': String(curView === v.id), onclick: () => goView(v.id) }, v.label)),
    h('button', { type: 'button', 'aria-pressed': String(!cutaway), title: 'Show or hide the roofs and front walls', onclick: () => { cutaway = !cutaway; applyCutaway(); renderViews(); } }, 'Roofs'));
}
{ const v = VIEWS[0]; camera.position.set(...v.pos); controls.target.set(...v.target); }

// ---------------------------------------------------------------- state
let STATE = null, WEEKS = [], WI = 0, S = null, SEL = null, MODE = 'status', TAB = 'areas', FILTER = 'all', PLAYING = 0, LOAD_ERR = null;
const showAll = new Set();

function initWeeks() {
  const looks = [...STATE.model.meta.lookaheads].sort((a, b) => a.cw - b.cw);
  const real = DS.localToday();
  WEEKS = looks.map((l, i) => {
    const latest = i === looks.length - 1, sun = addD(l.start, 6);
    return { cw: l.cw, start: l.start, end: l.end, latest, today: latest ? real : (sun < real ? sun : real), S: null };
  });
}
function summaryAt(i) {
  const w = WEEKS[i];
  if (!w.S) w.S = PM.summarise(w.latest ? DS.build(STATE, w.today) : DS.build(DS.asOf(STATE, w.cw, w.today), w.today));
  return w.S;
}
let weeksDone = 0, weeksTimer = 0;
function computeWeeks() {                                                // the milestone sparklines need every week: work them out a few at a time
  clearTimeout(weeksTimer);
  const next = WEEKS.findIndex((w) => !w.S);
  if (next < 0) { weeksDone = WEEKS.length; if (TAB === 'miles') renderMiles(); return; }
  summaryAt(next); weeksDone = WEEKS.filter((w) => w.S).length;
  if (TAB === 'miles') renderMiles();
  weeksTimer = setTimeout(computeWeeks, 16);
}

// ---------------------------------------------------------------- colours
function dominantPkg(sum) {
  const c = {}; for (const r of sum.items) c[r.a.p] = (c[r.a.p] || 0) + 1;
  let best = null; for (const p in c) if (!best || c[p] > c[best]) best = p; return best;
}
function colourOf(id) {
  const sum = S && S.areas[id];
  if (!sum || !sum.n) return { c: NEUTRAL.clone(), glow: 0 };
  if (MODE === 'progress') return { c: PROG_LO.clone().lerp(PROG_HI, sum.share), glow: 0.22 };
  if (MODE === 'package') { const p = dominantPkg(sum); return { c: new THREE.Color(PKG_C[p] || PKG_OTHER), glow: 0.22 }; }
  return { c: new THREE.Color(SC[sum.status] || SC.none), glow: 0.3 };
}
const kOf = (id) => { const sum = S && S.areas[id]; return sum ? `s-${sum.status}` : 's-none'; };
function recolour() {
  for (const ar of PM.AREAS) {
    const m = areaMats[ar.id]; if (!m) continue;
    const { c, glow } = colourOf(ar.id);
    if (SEL && SEL !== ar.id) { c.lerp(NEUTRAL, 0.55); m.glowT = glow * 0.35; } else m.glowT = glow;
    m.tgt.copy(c);
  }
  needsRender = true;
}
function stepColours(dt, now) {
  let moving = false;
  const k = 1 - Math.exp(-dt * 9);
  for (const id in areaMats) {
    const m = areaMats[id];
    const dr = m.tgt.r - m.cur.r, dg = m.tgt.g - m.cur.g, db = m.tgt.b - m.cur.b, dgl = m.glowT - m.glow;
    if (Math.abs(dr) + Math.abs(dg) + Math.abs(db) + Math.abs(dgl) > 0.002) { m.cur.r += dr * k; m.cur.g += dg * k; m.cur.b += db * k; m.glow += dgl * k; moving = true; }
    else if (m.cur.r !== m.tgt.r || m.glow !== m.glowT) { m.cur.copy(m.tgt); m.glow = m.glowT; moving = true; }
    let glow = m.glow;
    if (id === SEL && !reduceMotion) glow += 0.28 + 0.24 * Math.sin(now * 0.004);
    m.skin.color.copy(m.cur); m.skin.emissive.copy(m.cur).multiplyScalar(glow);
    m.glass.color.copy(m.cur); m.glass.emissive.copy(m.cur).multiplyScalar(glow * 0.9); m.glass.opacity = SEL && SEL !== id ? 0.22 : 0.46;
    m.edge.color.copy(m.cur); m.edge.opacity = SEL && SEL !== id ? 0.35 : 0.9;
  }
  return moving || (SEL && !reduceMotion);
}

// ---------------------------------------------------------------- labels
const labelHost = $('#labels');
const labels = PM.AREAS.filter((ar) => anchors[ar.id]).map((ar) => {
  const el = h('button', { class: 'lbl s-none', type: 'button', tabindex: '-1', 'data-id': ar.id }, h('i'), h('span', null, ar.short), h('b', null, ''));
  el.addEventListener('click', (e) => { e.stopPropagation(); select(ar.id, true); });
  el.addEventListener('pointerenter', () => showTip(ar.id, null));
  el.addEventListener('pointerleave', hideTip);
  labelHost.append(el);
  return { id: ar.id, el, anchor: anchors[ar.id], w: 0, h: 0, rank: 0 };
});
function refreshLabels() {
  for (const L of labels) {
    const sum = S && S.areas[L.id];
    L.el.className = `lbl ${kOf(L.id)}${SEL === L.id ? ' sel' : ''}${SEL && SEL !== L.id ? ' dim' : ''}`;
    L.el.lastChild.textContent = sum && sum.n ? pct(sum.share) : '';
    L.el.title = '';
    L.w = 0;
    const open = sum ? sum.hold + sum.late + sum.site + sum.plan : 0;
    L.rank = (SEL === L.id ? 1e6 : 0) + (open ? 1e4 : 0) + (sum ? sum.n : 0) + (PM.AREA[L.id].context ? 50 : 0);
  }
  labels.sort((a, b) => b.rank - a.rank);
}
const _v = new THREE.Vector3();
const OVERLAYS = ['#legend', '#views', '#compass', '#tour'].map((q) => $(q));
function updateLabels() {
  const W = stage.clientWidth, H = stage.clientHeight, placed = [], sr = stage.getBoundingClientRect();
  for (const o of OVERLAYS) { if (!o || o.hidden) continue; const r = o.getBoundingClientRect(); if (r.width) placed.push([r.left - sr.left - 4, r.top - sr.top - 4, r.right - sr.left + 4, r.bottom - sr.top + 4]); }
  for (const L of labels) {
    _v.copy(L.anchor).project(camera);
    const x = (_v.x + 1) / 2 * W, y = (1 - _v.y) / 2 * H;
    if (_v.z > 1 || x < -60 || x > W + 60 || y < -20 || y > H + 60) { L.el.style.display = 'none'; continue; }
    if (!L.w) { L.el.style.display = ''; L.w = L.el.offsetWidth; L.h = L.el.offsetHeight; }
    const bx0 = x - L.w / 2, by0 = y - L.h - 10, box = [bx0 - 3, by0 - 2, bx0 + L.w + 3, by0 + L.h + 2];
    if (SEL !== L.id && placed.some((b) => !(box[2] < b[0] || box[0] > b[2] || box[3] < b[1] || box[1] > b[3]))) { L.el.style.display = 'none'; continue; }
    placed.push(box);
    L.el.style.display = '';
    L.el.style.transform = `translate(${Math.round(bx0)}px, ${Math.round(by0)}px)`;
  }
}

// ---------------------------------------------------------------- picking and hover
const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
function pickAt(cx, cy) {
  const r = canvas.getBoundingClientRect();
  ndc.set(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1);
  ray.setFromCamera(ndc, camera);
  const hit = ray.intersectObjects(pickables.filter((m) => m.visible), false)[0];
  return hit ? hit.object.userData.area : null;
}
let down = null;
canvas.addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY, t: performance.now() }; });
canvas.addEventListener('pointerup', (e) => {
  if (!down) return;
  const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y); down = null;
  if (moved > 6) return;
  const id = pickAt(e.clientX, e.clientY);
  if (id) select(id, false); else if (SEL) select(null);
});
canvas.addEventListener('dblclick', (e) => { const id = pickAt(e.clientX, e.clientY); if (id && focus[id]) flyTo(focus[id].pos, focus[id].target); });
const tip = $('#tip');
let hoverT = 0;
canvas.addEventListener('pointermove', (e) => {
  if (coarse || e.buttons) { hideTip(); return; }
  const now = performance.now(); if (now - hoverT < 70) return; hoverT = now;
  const id = pickAt(e.clientX, e.clientY);
  canvas.style.cursor = id ? 'pointer' : '';
  if (id) showTip(id, e); else hideTip();
});
canvas.addEventListener('pointerleave', hideTip);
function showTip(id, e) {
  const ar = PM.AREA[id], sum = S && S.areas[id];
  tip.replaceChildren(h('b', null, ar.name), h('span', null, sum && sum.n ? ` · ${AREA_WORD[sum.status].toLowerCase()} · ${sum.done}/${sum.n} done` : ' · no tracked work'));
  const r = stage.getBoundingClientRect();
  if (e) { tip.style.left = `${e.clientX - r.left}px`; tip.style.top = `${e.clientY - r.top}px`; }
  else { const L = labels.find((x) => x.id === id); if (!L) return; const m = /translate\((-?\d+)px, (-?\d+)px\)/.exec(L.el.style.transform || ''); if (!m) return; tip.style.left = `${Number(m[1])}px`; tip.style.top = `${Number(m[2]) + 18}px`; }
  tip.hidden = false;
}
function hideTip() { tip.hidden = true; }

// ---------------------------------------------------------------- selection
function select(id, fromLabel) {
  SEL = id && PM.AREA[id] ? id : null;
  recolour(); refreshLabels(); renderAreas(); renderInfo(); renderMilesSel(); writeHash();
  if (SEL) {
    if (TAB !== 'info') setTab('info');
    if (focus[SEL] && (fromLabel || !TOUR.on)) { curView = null; renderViews(); flyTo(focus[SEL].pos, focus[SEL].target); }
  }
  needsRender = true;
}

// ---------------------------------------------------------------- side panel
const panes = { areas: $('#paneAreas'), info: $('#paneInfo'), miles: $('#paneMiles') };
const tabs = { areas: $('#tabAreas'), info: $('#tabInfo'), miles: $('#tabMiles') };
function setTab(t) {
  TAB = t;
  for (const k in panes) { panes[k].hidden = k !== t; tabs[k].setAttribute('aria-selected', String(k === t)); tabs[k].tabIndex = k === t ? 0 : -1; }
  if (t === 'miles') { renderMiles(); if (weeksDone < WEEKS.length) computeWeeks(); }
}
for (const k in tabs) tabs[k].addEventListener('click', () => setTab(k));
$('#side .tabs').addEventListener('keydown', (e) => {
  const order = ['areas', 'info', 'miles'], i = order.indexOf(TAB);
  if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { const n = order[(i + (e.key === 'ArrowRight' ? 1 : 2)) % 3]; setTab(n); tabs[n].focus(); e.preventDefault(); }
});
const pkName = (p) => (S && S.pk[p] ? S.pk[p].name : p);
function stackBar(sum, thin) {
  const parts2 = ['done', 'plan', 'site', 'late', 'hold', 'uns'].filter((b) => sum[b]);
  return h('div', { class: `bar${thin ? ' thin' : ''}`, role: 'img', 'aria-label': parts2.map((b) => `${sum[b]} ${B_WORD[b].toLowerCase()}`).join(', ') },
    parts2.map((b) => { const i = h('i', `s-${b}`); i.style.width = `${(100 * sum[b]) / sum.n}%`; return i; }));
}
function weekLine() { const w = WEEKS[WI]; return w ? (w.latest ? `latest lookahead ${wkTxt(w.cw, w.end)}` : `${wkTxt(w.cw, w.end)} as of ${fmtW(w.today)}`) : ''; }
function renderAreas() {
  const pane = panes.areas;
  if (!S) { pane.replaceChildren(h('div', 'pad', LOAD_ERR ? h('p', 'note-box', LOAD_ERR) : [h('div', 'sk'), h('div', 'sk'), h('div', 'sk')])); return; }
  const P = S.plant, keep = pane.scrollTop;
  const head = h('div', 'pad',
    h('div', null, h('div', 'k', `Whole plant · ${weekLine()}`), h('h2', 'h2', `${pct(P.share)} of ${P.n} tracked activities done`)),
    stackBar(P),
    h('div', 'stat-row', h('div', 's-done', h('b', null, P.done), h('span', null, 'done')), h('div', 's-plan', h('b', null, P.fort), h('span', null, 'this fortnight')),
      h('div', 's-late', h('b', null, P.late), h('span', null, 'late')), h('div', 's-hold', h('b', null, P.hold), h('span', null, 'on hold'))),
    h('div', { class: 'filters', role: 'group', 'aria-label': 'Show areas' },
      [['all', 'All areas'], ['attn', 'Needs attention'], ['fort', 'Work this fortnight']].map(([f, t]) =>
        h('button', { type: 'button', 'aria-pressed': String(FILTER === f), onclick: () => { FILTER = f; renderAreas(); } }, t))));
  const groups = [];
  let curG = null;
  for (const ar of PM.AREAS) {
    const sum = S.areas[ar.id];
    if (FILTER === 'attn' && !(sum.hold || sum.late || sum.site)) continue;
    if (FILTER === 'fort' && !sum.fort) continue;
    if (ar.group !== curG) { curG = ar.group; groups.push(h('h3', 'grp', curG)); }
    const bits = [];
    if (sum.hold) bits.push(`${sum.hold} on hold`); if (sum.late) bits.push(`${sum.late} late`); if (sum.site) bits.push(`${sum.site} pending on site`);
    if (sum.fort) bits.push(`${sum.fort} this fortnight`);
    groups.push(h('button', { class: `arow s-${sum.status}`, type: 'button', 'aria-current': String(SEL === ar.id), onclick: () => select(ar.id, true) },
      h('i'), h('span', 'n', ar.name), h('span', 'v', sum.n ? `${sum.done}/${sum.n}` : '–'),
      sum.n ? stackBar(sum, true) : null,
      h('span', 'm', sum.n ? (bits.join(' · ') || AREA_WORD[sum.status]) : (ar.context ? 'Context: no electrical activities here' : 'No tracked work yet'))));
  }
  if (groups.length === 0) groups.push(h('p', 'pad muted', FILTER === 'attn' ? 'Nothing is late, on hold or pending on site in this week.' : 'No area has work planned in this fortnight.'));
  pane.replaceChildren(head, ...groups);
  pane.scrollTop = keep;
}
function actRow(r) {
  const a = r.a, s = r.s;
  const word = s ? `${SITE_WORD[s.status]} ${fmt(s.checked)}` : (LOOK_WORD[a.st] || a.st);
  const when = r.b === 'done' ? (r.done && !s ? `finished ${fmt(r.done)}` : '') : (a.lf ? `planned to ${fmt(a.lf)}` : 'no dates');
  const where = [a.custom ? a.con : null, pkName(a.p), a.sec && a.sec !== 'General' ? a.sec : null, a.sub || null].filter(Boolean).join(' · ');
  return h('a', { class: `act s-${r.b}`, href: `../#act=${a.id}`, title: 'Open this activity on the dashboard' },
    h('i'), h('span', 'n', label(a), h('small', null, `#${a.id}`)),
    h('span', 'm', h('b', null, word), [when, r.fort ? 'this fortnight' : ''].filter(Boolean).map((t) => ` · ${t}`).join('')),
    h('span', 'm', where), s && s.note ? h('span', 'note', `“${s.note}”`) : null);
}
function actGroup(key, title, rows, limit) {
  if (!rows.length) return null;
  const open = showAll.has(`${SEL}:${key}`), shown = open ? rows : rows.slice(0, limit);
  return [h('div', 'sec-h', h('h3', null, title), h('span', null, rows.length)),
    h('div', 'alist', shown.map(actRow), rows.length > shown.length ? h('button', { class: 'more', type: 'button', onclick: () => { showAll.add(`${SEL}:${key}`); renderInfo(); } }, `Show all ${rows.length}`) : null)];
}
function renderInfo() {
  const pane = panes.info, keep = pane.scrollTop;
  if (!SEL) { pane.replaceChildren(welcome()); return; }
  const ar = PM.AREA[SEL], sum = S ? S.areas[SEL] : null;
  const body = [h('div', null, h('div', 'k', ar.group), h('h2', 'h2', ar.name))];
  if (sum && sum.n) {
    body.push(h('div', 'chips', h('span', `pill s-${sum.status}`, h('i'), AREA_WORD[sum.status]), h('span', 'pill s-none', `${sum.done} of ${sum.n} done · ${pct(sum.share)}`)));
    body.push(stackBar(sum));
    body.push(h('div', 'stat-row', h('div', 's-done', h('b', null, sum.done), h('span', null, 'done')), h('div', 's-plan', h('b', null, sum.fort), h('span', null, 'this fortnight')),
      h('div', 's-late', h('b', null, sum.late + sum.site), h('span', null, sum.site ? 'late / pending' : 'late')), h('div', 's-hold', h('b', null, sum.hold), h('span', null, 'on hold'))));
    const dates = [sum.start ? `First planned start ${fmt(sum.start)}` : null,
      sum.status === 'done' && sum.lastDone ? `last finished ${fmt(sum.lastDone)}` : sum.finish ? `open work planned to ${fmt(sum.finish)}` : null].filter(Boolean).join(' · ');
    if (dates) body.push(h('p', 'p muted', dates));
  } else if (S) body.push(h('div', 'chips', h('span', 'pill s-none', h('i'), ar.context ? 'Context only' : 'No tracked work in this week')));
  body.push(h('p', 'p', ar.what));
  if (ar.rollup) body.push(h('div', null, h('div', 'k', 'Includes'), h('div', 'links', ar.rollup.map((id) => h('button', { type: 'button', class: kOf(id), onclick: () => select(id, true) }, h('i'), PM.AREA[id].short)))));
  if (ar.virtual) body.push(h('div', 'links', ['u1gen', 'crane4'].map((id) => h('button', { type: 'button', class: kOf(id), onclick: () => select(id, true) }, h('i'), PM.AREA[id].short))));
  const twin = { u1gen: 'offsite', crane4: 'offsite' }[SEL];
  if (twin && S && S.areas[twin].n) body.push(h('div', 'links', h('button', { type: 'button', class: kOf(twin), onclick: () => select(twin, true) }, h('i'), 'Parts at the off-site workshops')));
  if (SEL === 'u1gen') body.push(h('div', 'links', h('a', { class: 'btn sm', href: '../generator/' }, 'Open the Generator U1 3D model')));
  if (sum && sum.n) {
    const by = (f) => sum.items.filter(f);
    body.push(actGroup('attn', 'Needs attention', by((r) => r.b === 'hold' || r.b === 'late' || r.b === 'site'), 8),
      actGroup('fort', 'On plan this fortnight', by((r) => r.b === 'plan' && r.fort), 8),
      actGroup('next', 'Planned later', by((r) => r.b === 'plan' && !r.fort), 5),
      actGroup('uns', 'No dates yet', by((r) => r.b === 'uns'), 5),
      actGroup('done', 'Done', by((r) => r.b === 'done'), 5));
    body.push(h('p', 'p muted', 'Tap an activity to open it on the dashboard, where you can record a site check.'));
  }
  pane.replaceChildren(h('div', 'pad', body));
  pane.scrollTop = keep;
}
function welcome() {
  const kids = [h('div', null, h('div', 'k', 'SJ Chenderoh hydro station'), h('h2', 'h2', 'The plant, coloured by progress'))];
  kids.push(h('p', 'p', 'Each area of the station takes the colour of its electrical works in the lookahead you are viewing, using the same statuses and site checks as the dashboard.'));
  kids.push(h('div', 'empty-art', h('div', 'k', 'How to use it'), h('ol', null,
    h('li', null, 'Tap an area, or a label, to see its activities.'),
    h('li', null, 'Move the lookahead slider, or press play, to see the plant in an earlier week.'),
    h('li', null, 'Switch the colours to % done or package below the model.'),
    h('li', null, 'Take the guided tour for a walk along the water and power path.'))));
  kids.push(h('p', 'note-box', 'The layout is a stylised model drawn from public information, not to scale. Positions of rooms and equipment are illustrative; tell the dashboard team what to correct.'));
  if (LOAD_ERR) kids.push(h('p', 'note-box', LOAD_ERR));
  return h('div', 'pad', kids);
}
// milestones: each area's share done, lookahead by lookahead
function spark(id, getSum) {
  const n = WEEKS.length, W = 128, Hh = 34, pts = [];
  for (let i = 0; i < n; i++) { const s = WEEKS[i].S ? getSum(WEEKS[i].S) : null; pts.push(s && s.n ? s.share : null); }
  const X = (i) => (n > 1 ? (i / (n - 1)) * W : W / 2), Y = (v) => 2 + (1 - v) * (Hh - 4);
  let line = '', area = '', run = [];
  const flush = () => { if (run.length) { line += `M${run.map(([i, v]) => `${X(i).toFixed(1)},${Y(v).toFixed(1)}`).join('L')}`; area += `M${X(run[0][0]).toFixed(1)},${Hh}L${run.map(([i, v]) => `${X(i).toFixed(1)},${Y(v).toFixed(1)}`).join('L')}L${X(run[run.length - 1][0]).toFixed(1)},${Hh}Z`; } run = []; };
  pts.forEach((v, i) => { if (v == null) flush(); else run.push([i, v]); }); flush();
  const NS = 'http://www.w3.org/2000/svg', svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${Hh}`); svg.setAttribute('aria-hidden', 'true');
  const mk = (tag, at) => { const e = document.createElementNS(NS, tag); for (const k in at) e.setAttribute(k, at[k]); svg.append(e); return e; };
  mk('line', { class: 'spark-g', x1: 0, x2: W, y1: Hh - 0.5, y2: Hh - 0.5 });
  mk('line', { class: 'spark-g', x1: 0, x2: W, y1: 2, y2: 2, 'stroke-dasharray': '1 3' });
  if (area) mk('path', { class: 'spark-a', d: area });
  if (line) mk('path', { class: 'spark-l', d: line });
  mk('line', { class: 'spark-now', x1: X(WI), x2: X(WI), y1: 0, y2: Hh });
  if (pts[WI] != null) mk('circle', { class: 'spark-dot', cx: X(WI), cy: Y(pts[WI]), r: 2.6 });
  return svg;
}
function mrow(key, name, sum, getSum, onclick) {
  const d = !sum || !sum.n ? 'No tracked work in this week'
    : [sum.start ? `from ${fmt(sum.start)}` : null, sum.status === 'done' && sum.lastDone ? `all done ${fmt(sum.lastDone)}` : sum.finish ? `open to ${fmt(sum.finish)}` : null, `${pct(sum.share)} done`].filter(Boolean).join(' · ');
  return h('button', { class: `mrow s-${sum ? sum.status : 'none'}`, type: 'button', 'aria-current': String(SEL === key), onclick },
    h('span', 'n', h('i'), h('span', null, name)), h('span', 'd', d), spark(key, getSum));
}
function renderMiles() {
  const pane = panes.miles;
  if (!S) { pane.replaceChildren(h('div', 'pad', LOAD_ERR ? h('p', 'note-box', LOAD_ERR) : h('div', 'sk'))); return; }
  const keep = pane.scrollTop;
  const first = WEEKS[0], last = WEEKS[WEEKS.length - 1];
  const head = h('div', 'pad mhead', h('div', 'k', `Milestones · ${wkTxt(first.cw, first.end)} to ${wkTxt(last.cw, last.end)}`),
    h('h2', 'h2', 'How each area progressed'),
    h('p', 'p', 'Share of each area’s tracked activities done, lookahead by lookahead. The dashed line is the week on the slider; dates are first planned start and when the work finished or is planned to.'),
    weeksDone < WEEKS.length ? h('p', 'p muted', `Working out the earlier weeks… ${weeksDone} of ${WEEKS.length}`) : null);
  const rows = [head, h('h3', 'grp', 'Whole plant'), mrow('plant', 'All tracked activities', S.plant, (s) => s.plant, () => select(null))];
  let curG = null;
  for (const ar of PM.AREAS) {
    if (!WEEKS.some((w) => w.S && w.S.areas[ar.id].n) && !S.areas[ar.id].n) continue;
    if (ar.group !== curG) { curG = ar.group; rows.push(h('h3', 'grp', curG)); }
    rows.push(mrow(ar.id, ar.name, S.areas[ar.id], (s) => s.areas[ar.id], () => select(ar.id, true)));
  }
  rows.push(h('h3', 'grp', 'Packages'));
  const order = ['EPS', 'GEN', 'AUTO', 'ROOMS', 'CRANE4', ...Object.keys(S.pkgs).filter((p) => !PKG_C[p]).sort()];
  for (const p of order) if (S.pkgs[p]) rows.push(mrow(`pkg:${p}`, pkName(p), S.pkgs[p], (s) => s.pkgs[p] || null, null));
  pane.replaceChildren(...rows);
  pane.scrollTop = keep;
}
function renderMilesSel() { if (TAB === 'miles') renderMiles(); }

// ---------------------------------------------------------------- legend, stamp
let legendOpen = !matchMedia('(max-width: 980px)').matches;
function renderLegend() {
  const el = $('#legend');
  el.className = `legend${legendOpen ? '' : ' is-closed'}`;
  const headT = MODE === 'status' ? 'Status' : MODE === 'progress' ? '% done' : 'Package';
  const kids = [h('div', 'legend-h', h('span', null, headT), h('button', { type: 'button', 'aria-expanded': String(legendOpen), onclick: () => { legendOpen = !legendOpen; renderLegend(); } }, legendOpen ? 'Hide' : 'Key'))];
  if (MODE === 'status') {
    const P = S ? S.plant : {};
    kids.push(h('ul', null, ['hold', 'late', 'site', 'plan', 'done', 'uns'].map((b) => h('li', `s-${b}`, h('i'), h('span', null, B_WORD[b]), h('b', null, S ? P[b] : '')))),
      h('ul', null, h('li', 's-none', h('i'), h('span', null, 'No tracked work'), h('b', null, ''))));
  } else if (MODE === 'progress') kids.push(h('div', 'ramp'), h('div', 'ramp-k', h('span', null, '0%'), h('span', null, '50%'), h('span', null, '100%')));
  else {
    const pks = S ? ['EPS', 'GEN', 'AUTO', 'ROOMS', 'CRANE4', ...Object.keys(S.pkgs).filter((p) => !PKG_C[p])] : Object.keys(PKG_C);
    kids.push(h('ul', null, pks.filter((p) => !S || S.pkgs[p]).map((p) => { const li = h('li', null, h('i'), h('span', null, pkName(p)), h('b', null, S && S.pkgs[p] ? S.pkgs[p].n : '')); li.style.setProperty('--k', PKG_C[p] || PKG_OTHER); return li; })));
  }
  el.replaceChildren(...kids);
}
function renderStamp() {
  const w = WEEKS[WI], st = $('#stamp'), v = $('#stampV');
  if (!w) { v.textContent = LOAD_ERR ? 'Not loaded' : 'Loading…'; return; }
  st.classList.toggle('is-past', !w.latest);
  const upd = STATE.updated_at ? new Date(STATE.updated_at) : null;
  v.textContent = w.latest ? `Latest lookahead ${wkTxt(w.cw, w.end)}${upd && !isNaN(upd) ? ` · updated ${upd.getDate()} ${MON[upd.getMonth()]} ${String(upd.getHours()).padStart(2, '0')}:${String(upd.getMinutes()).padStart(2, '0')}` : ''}`
    : `Looking back: ${wkTxt(w.cw, w.end)} as of ${fmtW(w.today)}`;
}

// ---------------------------------------------------------------- timeline
const wk = $('#wk'), wkLabel = $('#wkLabel');
function setWeek(i, quiet) {
  if (!WEEKS.length) return;
  WI = Math.max(0, Math.min(WEEKS.length - 1, i));
  S = summaryAt(WI);
  wk.value = String(WI);
  const w = WEEKS[WI];
  wkLabel.textContent = w.latest ? `${wkTxt(w.cw, w.end)} · latest` : `${wkTxt(w.cw, w.end)} · as of ${fmtW(w.today)}`;
  wkLabel.classList.toggle('is-past', !w.latest);
  wk.setAttribute('aria-valuetext', wkLabel.textContent);
  recolour(); refreshLabels(); renderLegend(); renderStamp(); renderAreas(); renderInfo();
  if (TAB === 'miles') renderMiles();
  if (TOUR.on) renderTour();
  if (!quiet) writeHash();
}
let wkRaf = 0;
wk.addEventListener('input', () => { stopPlay(); cancelAnimationFrame(wkRaf); wkRaf = requestAnimationFrame(() => setWeek(Number(wk.value))); });
const playBtn = $('#play'), playIcon = $('#playIcon');
function stopPlay() { if (!PLAYING) return; clearInterval(PLAYING); PLAYING = 0; playIcon.innerHTML = '<path d="M4 2.5v11l9.5-5.5z"/>'; playBtn.setAttribute('aria-label', 'Play the lookaheads from the start'); }
playBtn.addEventListener('click', () => {
  if (PLAYING) { stopPlay(); return; }
  if (!WEEKS.length) return;
  if (WI >= WEEKS.length - 1) setWeek(0);
  playIcon.innerHTML = '<path d="M4 2.5h3v11H4zM9 2.5h3v11H9z"/>'; playBtn.setAttribute('aria-label', 'Pause');
  PLAYING = setInterval(() => { if (WI >= WEEKS.length - 1) { stopPlay(); return; } setWeek(WI + 1); }, reduceMotion ? 1400 : 850);
});
for (const b of document.querySelectorAll('#colorBy button')) b.addEventListener('click', () => {
  MODE = b.dataset.mode;
  for (const x of document.querySelectorAll('#colorBy button')) x.setAttribute('aria-pressed', String(x === b));
  recolour(); renderLegend(); writeHash();
});

// ---------------------------------------------------------------- guided tour
const areaLine = (id) => { const s = S && S.areas[id]; if (!s || !s.n) return `${PM.AREA[id].short}: no tracked work in this week`; const bits = [`${s.done}/${s.n} done`]; if (s.hold) bits.push(`${s.hold} on hold`); if (s.late) bits.push(`${s.late} late`); if (s.site) bits.push(`${s.site} pending on site`); if (s.fort) bits.push(`${s.fort} this fortnight`); return `${PM.AREA[id].short}: ${bits.join(', ')}`; };
const plantLine = () => { if (!S) return ''; const P = S.plant; return `${P.n} activities tracked in ${weekLine()}: ${pct(P.share)} done, ${P.late} late, ${P.hold} on hold, ${P.fort} planned this fortnight.`; };
const TOUR = { on: false, i: 0, steps: [
  { title: 'SJ Chenderoh hydro station', view: 'site', text: 'Malaysia’s first major hydro station, completed on the Perak River in 1930 and rated about 40.5 MW. Under TNB’s life extension programme, ANDRITZ is uprating the turbines, supplying new generators and rehabilitating the hydromechanical equipment. This model follows the electrical works.', live: plantLine },
  { title: 'Water enters at the intake', area: 'intake', text: 'Water from Chenderoh Lake passes the trash racks and head gates into the units. The intake dam distribution board on the crest powers the gate hoists.', live: () => areaLine('intake') },
  { title: 'The dam and its spillway', area: 'dam', view: 'water', text: 'The hollow concrete buttress dam holds the lake. Floods pass through the gated spillway, down the chute to the flip bucket. No electrical activities are tracked here.' },
  { title: 'Unit 1, the unit being rebuilt', area: 'u1gen', text: 'Units 2 and 3 keep generating while Unit 1 is rebuilt. Its old generator was taken apart on site and the parts went to the workshop for refurbishment.', live: () => `${areaLine('u1gen')}. ${areaLine('offsite')}.` },
  { title: 'Unit 1 switchgear and boards', area: 'u1elec', text: 'The unit’s 11 kV switchgear, excitation, control and distribution boards on the generator floor are replaced.', live: () => areaLine('u1elec') },
  { title: 'The control building', area: 'ctrl', view: 'ctrl', text: 'The New Control Room sits above the low-voltage rooms: AC/DC (LV), battery charger and battery rooms. The old control room is cleared as control moves across.', live: () => ['ctrl', 'acdc', 'charger', 'battery'].map(areaLine).join(' · ') },
  { title: 'Keeping the station powered', area: 'sst2', text: 'Two station service transformers, the emergency diesel generator and the temporary supply carry the station’s own loads through the changeover.', live: () => ['sst1', 'sst2', 'edg', 'temp'].map(areaLine).join(' · ') },
  { title: 'Out to the grid', area: 'swyd', view: 'swyd', text: 'Each unit’s 11 kV output is stepped up by its GT transformer and leaves through the 132 kV switchyard. Cables run there in the trench from the powerhouse.', live: () => ['trench', 'gt', 'swyd'].map(areaLine).join(' · ') },
  { title: 'The Unit 4 powerhouse', area: 'u4', view: 'u4', text: 'Unit 4 has its own powerhouse, reached by pontoon during the works. Its crane is overhauled, and its fire systems and the GT4 deluge are installed.', live: () => ['crane4', 'u4fire', 'gt4'].map(areaLine).join(' · ') },
  { title: 'See the works through time', view: 'site', text: 'Move the lookahead slider below the model, or press play, to see the plant as it stood in any week since the first lookahead. Tap any area for its activities.', live: plantLine },
] };
function renderTour() {
  const el = $('#tour');
  if (!TOUR.on) { el.hidden = true; return; }
  const st = TOUR.steps[TOUR.i], n = TOUR.steps.length;
  el.hidden = false;
  el.replaceChildren(
    h('div', 'row', h('span', 'k', `Guided tour · ${TOUR.i + 1} of ${n}`), h('button', { class: 'btn sm', type: 'button', style: 'margin-left:auto', onclick: endTour, 'aria-label': 'Close the tour' }, 'Close')),
    h('h3', null, st.title), h('p', null, st.text), st.live && S ? h('div', 'live', st.live()) : null,
    h('div', 'row', h('div', 'dots', TOUR.steps.map((_, i) => h('i', i === TOUR.i ? 'on' : null))),
      h('button', { class: 'btn sm', type: 'button', disabled: TOUR.i === 0, onclick: () => tourGo(TOUR.i - 1) }, 'Back'),
      h('button', { class: 'btn sm primary', type: 'button', onclick: () => (TOUR.i === n - 1 ? endTour() : tourGo(TOUR.i + 1)) }, TOUR.i === n - 1 ? 'Finish' : 'Next')));
}
function tourGo(i) {
  TOUR.i = Math.max(0, Math.min(TOUR.steps.length - 1, i));
  const st = TOUR.steps[TOUR.i];
  SEL = st.area || null; recolour(); refreshLabels(); renderAreas(); renderInfo();
  if (st.view) goView(st.view); else if (st.area && focus[st.area]) { curView = null; renderViews(); flyTo(focus[st.area].pos, focus[st.area].target, 1400); }
  renderTour();
}
function startTour() { stopPlay(); TOUR.on = true; if (TAB !== 'info') setTab('info'); tourGo(0); }
function endTour() { TOUR.on = false; renderTour(); }
$('#btnTour').addEventListener('click', () => (TOUR.on ? endTour() : startTour()));
addEventListener('keydown', (e) => {
  if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT')) return;
  if (e.key === 'Escape') { if (TOUR.on) endTour(); else if (SEL) select(null); }
  if (TOUR.on && e.key === 'ArrowRight') tourGo(TOUR.i + 1);
  if (TOUR.on && e.key === 'ArrowLeft') tourGo(TOUR.i - 1);
});

// ---------------------------------------------------------------- link state (#cw=40&area=u1gen&colour=progress)
function readHash() {
  const q = new URLSearchParams((location.hash || '').replace(/^#/, ''));
  return { cw: Number(q.get('cw')) || null, area: q.get('area'), colour: q.get('colour') };
}
function writeHash() {
  const q = new URLSearchParams();
  const w = WEEKS[WI]; if (w && !w.latest) q.set('cw', String(w.cw));
  if (SEL) q.set('area', SEL);
  if (MODE !== 'status') q.set('colour', MODE);
  const s = q.toString();
  try { history.replaceState(history.state, '', s ? `#${s}` : location.pathname + location.search); } catch (e) { /* ignore */ }
}

// ---------------------------------------------------------------- render loop
function resize() {
  const r = stage.getBoundingClientRect();
  renderer.setSize(Math.max(1, r.width), Math.max(1, r.height), false);
  camera.aspect = Math.max(1, r.width) / Math.max(1, r.height);
  camera.updateProjectionMatrix(); needsRender = true;
}
new ResizeObserver(resize).observe(stage);
resize();
{ const v = VIEWS[0]; camera.position.copy(fit(new THREE.Vector3(...v.pos), new THREE.Vector3(...v.target))); controls.update(); }
const compassSvg = $('#compass svg');
let last = performance.now();
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.1, (now - last) / 1000); last = now;
  const flying = stepFly(now);
  const changed = controls.update();
  const colouring = stepColours(dt, now);
  if (needsRender || flying || changed || colouring) {
    renderer.render(scene, camera);
    updateLabels();
    const az = Math.atan2(camera.position.x - controls.target.x, camera.position.z - controls.target.z);
    compassSvg.style.transform = `rotate(${(az * 180) / Math.PI}deg)`;
    needsRender = false;
  }
}
renderViews(); renderLegend(); refreshLabels(); renderAreas(); renderInfo();
requestAnimationFrame(frame);
renderer.render(scene, camera);
BOOT.done();

// ---------------------------------------------------------------- data in
try {
  STATE = await statePromise;
  initWeeks();
  const hs = readHash();
  if (hs.colour && ['status', 'progress', 'package'].includes(hs.colour)) { MODE = hs.colour; for (const x of document.querySelectorAll('#colorBy button')) x.setAttribute('aria-pressed', String(x.dataset.mode === MODE)); }
  wk.max = String(WEEKS.length - 1);
  $('#wkFirst').textContent = wkTxt(WEEKS[0].cw, WEEKS[0].end);
  $('#wkLast').textContent = wkTxt(WEEKS[WEEKS.length - 1].cw, WEEKS[WEEKS.length - 1].end);
  const at = hs.cw ? WEEKS.findIndex((w) => w.cw === hs.cw) : -1;
  setWeek(at >= 0 ? at : WEEKS.length - 1, true);
  if (hs.area && PM.AREA[hs.area]) select(hs.area, true);
  if ('requestIdleCallback' in window) requestIdleCallback(() => computeWeeks(), { timeout: 2500 }); else setTimeout(computeWeeks, 1200);
} catch (e) {
  if (String(e && e.message) !== 'Signed out') {
    console.error(e);
    LOAD_ERR = `The progress data could not be opened: ${String((e && e.message) || e)} The 3D model works, but the areas are not coloured. Reload the page to try again.`;
    renderAreas(); renderInfo(); renderStamp();
  }
}
