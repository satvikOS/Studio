// Slice 770 — HDRI environment library.
//
// `generateProceduralHDR(name)` returns a THREE.DataTexture (RGBA float32,
// equirectangular mapping) for one of the 20 procedural environments:
//
//   studio_white / studio_warm / studio_cool / studio_softbox
//   outdoor_sunset / outdoor_noon / outdoor_overcast / outdoor_dawn
//   interior_room / interior_warehouse / interior_kitchen / interior_office
//   dramatic_red / dramatic_blue / dramatic_split / dramatic_neon
//   colorgrade_cinema / colorgrade_vintage / colorgrade_modern /
//   colorgrade_noir
//
// Each preset is synthesised mathematically — no PNG / HDR file loaded —
// from a per-pixel `(theta, phi) -> [r, g, b]` formula that mirrors the
// canonical KeyShot / Polyhaven studio plate or Polyhaven outdoor sky:
//
//   • sky-vs-ground gradient                     (sin(theta) weight)
//   • sun discs                                  (gaussian over angular sep)
//   • soft box / window lights                   (gaussian patches)
//   • star fields                                (deterministic mulberry32)
//   • side-fill lights for studio variants       (gaussian patches)
//   • colour-grade scale on the base outdoor      (matrix or curve)
//
// HDR > 1.0 emit values are written for the sun discs + softbox cores so
// the PMREMGenerator pipeline (called from `index.js`) lights surfaces
// with real specular highlights, not LDR-clipped greys.
//
// All RNG is mulberry32 seeded per-preset — no Math.random — so the same
// preset name always produces the same texture (deterministic e2e).

import * as THREE from 'three';

const W = 256;
const H = 128;

// ─── deterministic RNG ──────────────────────────────────────────────────
function mulberry32(seed) {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6D2B79F5) >>> 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 0x100000000;
  };
}

function hashName(name) {
  let h = 0x811C9DC5;
  for (let i = 0; i < name.length; i++) {
    h ^= name.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

// ─── per-pixel angular helpers ──────────────────────────────────────────
// Equirectangular mapping:
//   u = x/W → phi   ∈ [0, 2π)  (around-the-world)
//   v = y/H → theta ∈ [0, π)   (north pole to south pole, 0 = up)
function pixelToDir(x, y) {
  const u = (x + 0.5) / W;
  const v = (y + 0.5) / H;
  const phi = u * Math.PI * 2;
  const theta = v * Math.PI;
  return {
    phi, theta,
    dx: Math.sin(theta) * Math.cos(phi),
    dy: Math.cos(theta),
    dz: Math.sin(theta) * Math.sin(phi),
  };
}

function angularDistance(a, b) {
  const d = a.dx * b.dx + a.dy * b.dy + a.dz * b.dz;
  return Math.acos(Math.max(-1, Math.min(1, d)));
}

// Gaussian falloff over angle.
function gauss(angle, sigma) {
  return Math.exp(-(angle * angle) / (2 * sigma * sigma));
}

// Spherical direction from horizontal + vertical angles (deg).
function dirFromAngles(azDeg, elDeg) {
  const az = azDeg * Math.PI / 180;
  const el = elDeg * Math.PI / 180;
  return {
    dx: Math.cos(el) * Math.cos(az),
    dy: Math.sin(el),
    dz: Math.cos(el) * Math.sin(az),
  };
}

// ─── per-preset sample functions ────────────────────────────────────────
// Each returns [r, g, b] in linear HDR. Sky/ground gradient is the base;
// light discs + softbox patches are added on top.

function sampleStudioWhite(d) {
  // White cyc with key + fill + back.
  const up = Math.max(0, d.dy);
  const r = 0.85 + 0.05 * up;
  const g = 0.85 + 0.05 * up;
  const b = 0.88 + 0.05 * up;
  // Three softboxes: key (front-up), fill (right-side-up), back (behind-up).
  const key = dirFromAngles(0, 35);
  const fill = dirFromAngles(120, 25);
  const back = dirFromAngles(-150, 40);
  const lk = gauss(angularDistance(d, key), 0.25) * 8.0;
  const lf = gauss(angularDistance(d, fill), 0.35) * 4.0;
  const lb = gauss(angularDistance(d, back), 0.30) * 5.0;
  return [r + lk + lf + lb, g + lk + lf + lb, b + lk + lf + lb];
}

function sampleStudioWarm(d) {
  const up = Math.max(0, d.dy);
  const r = 0.78 + 0.08 * up;
  const g = 0.62 + 0.06 * up;
  const b = 0.45 + 0.03 * up;
  const key = dirFromAngles(0, 30);
  const fill = dirFromAngles(140, 20);
  const back = dirFromAngles(-140, 45);
  const lk = gauss(angularDistance(d, key), 0.25) * 9.5;
  const lf = gauss(angularDistance(d, fill), 0.40) * 3.0;
  const lb = gauss(angularDistance(d, back), 0.30) * 4.0;
  // warm tint of key
  return [r + lk * 1.10 + lf * 1.15 + lb,
    g + lk * 0.95 + lf * 0.85 + lb * 0.90,
    b + lk * 0.65 + lf * 0.55 + lb * 0.75];
}

function sampleStudioCool(d) {
  const up = Math.max(0, d.dy);
  const r = 0.55 + 0.05 * up;
  const g = 0.70 + 0.06 * up;
  const b = 0.85 + 0.10 * up;
  const key = dirFromAngles(0, 35);
  const fill = dirFromAngles(110, 25);
  const back = dirFromAngles(-160, 35);
  const lk = gauss(angularDistance(d, key), 0.25) * 9.0;
  const lf = gauss(angularDistance(d, fill), 0.35) * 3.5;
  const lb = gauss(angularDistance(d, back), 0.30) * 5.0;
  // cool tint
  return [r + lk * 0.70 + lf * 0.60 + lb * 0.70,
    g + lk * 0.90 + lf * 0.85 + lb * 0.95,
    b + lk * 1.15 + lf * 1.20 + lb * 1.10];
}

function sampleStudioSoftbox(d) {
  // One bright softbox + diffuse fill.
  const r = 0.40;
  const g = 0.40;
  const b = 0.42;
  const soft = dirFromAngles(0, 25);
  const fill = dirFromAngles(180, 15);
  const ls = gauss(angularDistance(d, soft), 0.45) * 12.0;
  const lf = gauss(angularDistance(d, fill), 0.50) * 2.5;
  return [r + ls + lf, g + ls + lf, b + ls + lf];
}

function sampleOutdoorSunset(d) {
  // Sky-to-horizon gradient ablaze; sun low + warm.
  const up = Math.max(0, d.dy);
  const horizon = 1 - Math.abs(d.dy);
  const r = 0.40 + 1.20 * horizon + 0.10 * up;
  const g = 0.18 + 0.55 * horizon + 0.10 * up;
  const b = 0.08 + 0.10 * horizon + 0.30 * up;
  const sun = dirFromAngles(45, 8);
  const ls = gauss(angularDistance(d, sun), 0.05) * 35.0; // HDR sun
  return [r + ls * 1.10, g + ls * 0.80, b + ls * 0.45];
}

function sampleOutdoorNoon(d) {
  // Bright blue sky, white horizon, hot sun overhead.
  const up = Math.max(0, d.dy);
  const horizon = 1 - Math.abs(d.dy);
  const r = 0.45 + 0.55 * horizon + 0.30 * up;
  const g = 0.65 + 0.40 * horizon + 0.55 * up;
  const b = 0.90 + 0.20 * horizon + 0.80 * up;
  const sun = dirFromAngles(20, 65);
  const ls = gauss(angularDistance(d, sun), 0.04) * 60.0;
  return [r + ls, g + ls * 0.97, b + ls * 0.90];
}

function sampleOutdoorOvercast(d) {
  // Diffuse grey sky, no sun.
  const up = Math.max(0, d.dy);
  const horizon = 1 - Math.abs(d.dy);
  const base = 0.80 + 0.20 * up + 0.05 * horizon;
  return [base, base + 0.02 * up, base + 0.05 * up];
}

function sampleOutdoorDawn(d) {
  // Cool blue zenith, pink horizon, low cool sun.
  const up = Math.max(0, d.dy);
  const horizon = 1 - Math.abs(d.dy);
  const r = 0.25 + 0.80 * horizon + 0.15 * up;
  const g = 0.22 + 0.45 * horizon + 0.25 * up;
  const b = 0.40 + 0.55 * horizon + 0.55 * up;
  const sun = dirFromAngles(80, 6);
  const ls = gauss(angularDistance(d, sun), 0.06) * 15.0;
  return [r + ls * 1.00, g + ls * 0.85, b + ls * 0.70];
}

function sampleInteriorRoom(d) {
  // Warm walls, ceiling lamp.
  const up = Math.max(0, d.dy);
  const r = 0.30 + 0.15 * up;
  const g = 0.25 + 0.10 * up;
  const b = 0.20 + 0.05 * up;
  const lamp = dirFromAngles(45, 80);
  const win = dirFromAngles(180, 10);
  const ll = gauss(angularDistance(d, lamp), 0.10) * 12.0;
  const lw = gauss(angularDistance(d, win), 0.15) * 5.0;
  return [r + ll * 1.10 + lw * 1.00, g + ll * 0.95 + lw * 1.05, b + ll * 0.70 + lw * 1.15];
}

function sampleInteriorWarehouse(d) {
  // Concrete grey + four ceiling skylights.
  const up = Math.max(0, d.dy);
  const base = 0.18 + 0.04 * up;
  const slights = [
    dirFromAngles(0, 75), dirFromAngles(90, 75),
    dirFromAngles(180, 75), dirFromAngles(-90, 75),
  ];
  let l = 0;
  for (const s of slights) l += gauss(angularDistance(d, s), 0.12) * 9.0;
  return [base + l, base + l * 1.02, base + l * 1.05];
}

function sampleInteriorKitchen(d) {
  // White walls, big window front, warm under-cabinet light.
  const up = Math.max(0, d.dy);
  const r = 0.62 + 0.10 * up;
  const g = 0.62 + 0.10 * up;
  const b = 0.60 + 0.10 * up;
  const win = dirFromAngles(0, 25);
  const under = dirFromAngles(160, -20);
  const lw = gauss(angularDistance(d, win), 0.30) * 7.0;
  const lu = gauss(angularDistance(d, under), 0.20) * 4.0;
  return [r + lw * 1.00 + lu * 1.15,
    g + lw * 1.02 + lu * 0.85,
    b + lw * 1.10 + lu * 0.50];
}

function sampleInteriorOffice(d) {
  // Cool ceiling fluorescents, grey walls.
  const up = Math.max(0, d.dy);
  const r = 0.45 + 0.05 * up;
  const g = 0.48 + 0.05 * up;
  const b = 0.52 + 0.07 * up;
  const fluors = [
    dirFromAngles(-45, 80), dirFromAngles(45, 80),
    dirFromAngles(135, 80), dirFromAngles(-135, 80),
  ];
  let l = 0;
  for (const f of fluors) l += gauss(angularDistance(d, f), 0.20) * 5.0;
  return [r + l * 0.92, g + l * 1.00, b + l * 1.10];
}

function sampleDramaticRed(d) {
  // Deep black room, single red rim light.
  const up = Math.max(0, d.dy);
  const base = 0.02 + 0.01 * up;
  const rim = dirFromAngles(120, 15);
  const lr = gauss(angularDistance(d, rim), 0.20) * 18.0;
  return [base + lr * 1.30, base + lr * 0.10, base + lr * 0.08];
}

function sampleDramaticBlue(d) {
  // Deep black room, single blue rim light.
  const up = Math.max(0, d.dy);
  const base = 0.02 + 0.01 * up;
  const rim = dirFromAngles(120, 15);
  const lr = gauss(angularDistance(d, rim), 0.20) * 18.0;
  return [base + lr * 0.10, base + lr * 0.30, base + lr * 1.40];
}

function sampleDramaticSplit(d) {
  // Two opposing rim lights (red left, blue right) — cyberpunk split.
  const base = 0.02;
  const rimL = dirFromAngles(90, 10);
  const rimR = dirFromAngles(-90, 10);
  const ll = gauss(angularDistance(d, rimL), 0.30) * 14.0;
  const lr = gauss(angularDistance(d, rimR), 0.30) * 14.0;
  return [base + ll * 1.40 + lr * 0.15,
    base + ll * 0.18 + lr * 0.30,
    base + ll * 0.10 + lr * 1.45];
}

function sampleDramaticNeon(d) {
  // Magenta + cyan + lime accent — Tron-style.
  const base = 0.03;
  const m = dirFromAngles(0, 5);
  const c = dirFromAngles(120, 5);
  const lm_ = dirFromAngles(-120, 5);
  const lM = gauss(angularDistance(d, m), 0.18) * 10.0;
  const lC = gauss(angularDistance(d, c), 0.18) * 10.0;
  const lL = gauss(angularDistance(d, lm_), 0.18) * 10.0;
  return [base + lM * 1.30 + lC * 0.10 + lL * 0.40,
    base + lM * 0.20 + lC * 1.20 + lL * 1.40,
    base + lM * 1.40 + lC * 1.30 + lL * 0.20];
}

// colorgrade_* presets build on outdoor_noon but apply a colour matrix.
function applyColorMatrix(rgb, m) {
  // m is 3×3 row-major.
  return [
    rgb[0] * m[0] + rgb[1] * m[1] + rgb[2] * m[2],
    rgb[0] * m[3] + rgb[1] * m[4] + rgb[2] * m[5],
    rgb[0] * m[6] + rgb[1] * m[7] + rgb[2] * m[8],
  ];
}

function sampleColorgradeCinema(d) {
  // Teal-orange cinema grade.
  const base = sampleOutdoorNoon(d);
  return applyColorMatrix(base, [
    1.10, -0.05, 0.00,
    -0.05, 1.00, -0.05,
    0.00, -0.10, 1.20,
  ]);
}

function sampleColorgradeVintage(d) {
  // Lifted blacks, faded look.
  const base = sampleOutdoorNoon(d);
  const lift = [base[0] * 0.85 + 0.08, base[1] * 0.85 + 0.07, base[2] * 0.80 + 0.10];
  return applyColorMatrix(lift, [
    1.05, 0.05, 0.00,
    0.02, 0.98, 0.00,
    -0.05, 0.00, 0.92,
  ]);
}

function sampleColorgradeModern(d) {
  // Crisp, slight cool, saturated.
  const base = sampleOutdoorNoon(d);
  return applyColorMatrix(base, [
    1.05, -0.05, 0.00,
    -0.03, 1.05, -0.02,
    0.00, -0.03, 1.12,
  ]);
}

function sampleColorgradeNoir(d) {
  // Desaturated B&W.
  const base = sampleOutdoorNoon(d);
  const y = base[0] * 0.299 + base[1] * 0.587 + base[2] * 0.114;
  return [y * 1.05, y * 1.05, y * 1.10];
}

// ─── catalogue ──────────────────────────────────────────────────────────
export const PROCEDURAL_ENVS = [
  'studio_white', 'studio_warm', 'studio_cool', 'studio_softbox',
  'outdoor_sunset', 'outdoor_noon', 'outdoor_overcast', 'outdoor_dawn',
  'interior_room', 'interior_warehouse', 'interior_kitchen', 'interior_office',
  'dramatic_red', 'dramatic_blue', 'dramatic_split', 'dramatic_neon',
  'colorgrade_cinema', 'colorgrade_vintage', 'colorgrade_modern', 'colorgrade_noir',
];

const _samplers = {
  studio_white: sampleStudioWhite,
  studio_warm: sampleStudioWarm,
  studio_cool: sampleStudioCool,
  studio_softbox: sampleStudioSoftbox,
  outdoor_sunset: sampleOutdoorSunset,
  outdoor_noon: sampleOutdoorNoon,
  outdoor_overcast: sampleOutdoorOvercast,
  outdoor_dawn: sampleOutdoorDawn,
  interior_room: sampleInteriorRoom,
  interior_warehouse: sampleInteriorWarehouse,
  interior_kitchen: sampleInteriorKitchen,
  interior_office: sampleInteriorOffice,
  dramatic_red: sampleDramaticRed,
  dramatic_blue: sampleDramaticBlue,
  dramatic_split: sampleDramaticSplit,
  dramatic_neon: sampleDramaticNeon,
  colorgrade_cinema: sampleColorgradeCinema,
  colorgrade_vintage: sampleColorgradeVintage,
  colorgrade_modern: sampleColorgradeModern,
  colorgrade_noir: sampleColorgradeNoir,
};

// ─── main generator ─────────────────────────────────────────────────────
export function generateProceduralHDR(name) {
  const sample = _samplers[name];
  if (!sample) return null;
  const rand = mulberry32(hashName(name));

  // Float32 RGBA equirectangular.
  const data = new Float32Array(W * H * 4);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const dir = pixelToDir(x, y);
      const rgb = sample(dir);
      const i = (y * W + x) * 4;
      data[i + 0] = Math.max(0, rgb[0]);
      data[i + 1] = Math.max(0, rgb[1]);
      data[i + 2] = Math.max(0, rgb[2]);
      data[i + 3] = 1.0;
    }
  }

  // Optional star-field overlay for outdoor_dawn (faint stars near zenith).
  if (name === 'outdoor_dawn') {
    for (let n = 0; n < 80; n++) {
      const sx = Math.floor(rand() * W);
      const sy = Math.floor(rand() * H * 0.4); // top 40% only
      const i = (sy * W + sx) * 4;
      data[i + 0] = Math.min(2.0, data[i + 0] + 1.5);
      data[i + 1] = Math.min(2.0, data[i + 1] + 1.5);
      data[i + 2] = Math.min(2.0, data[i + 2] + 1.7);
    }
  }

  const tex = new THREE.DataTexture(
    data, W, H,
    THREE.RGBAFormat,
    THREE.FloatType,
  );
  tex.mapping = THREE.EquirectangularReflectionMapping;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.colorSpace = THREE.LinearSRGBColorSpace;
  tex.needsUpdate = true;
  tex.userData.archdiscStudioHDRLibName = name;
  tex.userData.archdiscStudioHDRLibProcedural = true;
  return tex;
}

// Lightweight catalogue helpers — used by tests + UI surface.
export function listProceduralEnvs() { return [...PROCEDURAL_ENVS]; }
export function isKnownEnv(name) { return !!_samplers[name]; }
