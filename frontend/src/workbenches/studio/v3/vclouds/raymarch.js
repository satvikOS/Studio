// ArchDisc Studio V3 — slice 892 — volumetric cloud raymarcher.
//
// REAL volumetric raymarch in pure JS following the canonical Sebastian
// Lague / Andrew Schneider (Horizon Zero Dawn GDC 2015) recipe:
//
//   for each pixel:
//     1. Compute camera ray direction from pinhole camera + pixel.
//     2. Intersect ray with the cloud layer (slab between two horizontal
//        planes y = layerBottom and y = layerTop).
//     3. Step along the ray inside the slab with N=stepCount uniform
//        samples (default 64).
//     4. At each sample evaluate cloudDensity (3-octave Perlin-Worley
//        combiner from noise3D.js) modulated by a vertical height-gradient.
//     5. Beer's law for extinction:  T *= exp(-density * sigma_a * dt)
//        accumulating transmittance T from 1 toward 0.
//     6. In-scattering: at each sample run a SHORT secondary march of
//        kLight=6 steps toward the sun direction, accumulating density
//        along it to compute the sun's shadowed irradiance reaching the
//        sample. Multiply by Henyey-Greenstein phase function evaluated at
//        the cos-angle between view ray and sun.
//     7. Color += T * sigma_s * density * sunColor * (sunVisibility *
//        phase(g, cosTheta) + ambient) * dt
//     8. Break early when T < 0.005.
//   composite over sky background: color += T * skyColor.
//
// Renders to an OffscreenCanvas (Node-fallback to ImageData when off-screen
// rendering isn't available) and returns a `data:image/png;base64,...`
// URL so the op surface is JSON-clean.

import * as THREE from 'three';
import { cloudDensity, heightGradient } from './noise3D.js';

// ─── Henyey-Greenstein phase function ─────────────────────────────────────
//
// Anisotropic scattering — `g` in [-1, +1]; positive = forward-scattering,
// negative = back-scattering. Clouds in the sun-facing direction tend to
// glow brightly (silver lining) → g≈0.6.
export function phaseHG(g, cosTheta) {
  const g2 = g * g;
  const denom = Math.pow(1 + g2 - 2 * g * cosTheta, 1.5);
  return (1 - g2) / Math.max(1e-6, 4 * Math.PI * denom);
}

// Dual-lobe phase function — Schneider HZD uses a HG blend so silver
// lining + diffuse forward scatter coexist.
export function phaseDualHG(gForward, gBack, blend, cosTheta) {
  return blend * phaseHG(gForward, cosTheta) + (1 - blend) * phaseHG(gBack, cosTheta);
}

// ─── Ray-slab intersection ────────────────────────────────────────────────
//
// Cloud layer is horizontal: y ∈ [yLo, yHi]. Returns [tEnter, tExit] along
// the ray, or null if the ray misses the slab.
function _intersectSlab(rayOrigin, rayDir, yLo, yHi) {
  if (Math.abs(rayDir.y) < 1e-6) {
    // Ray is horizontal — inside the slab iff origin.y ∈ [yLo, yHi].
    if (rayOrigin.y < yLo || rayOrigin.y > yHi) return null;
    return [0, 1000]; // arbitrary far cutoff
  }
  const t0 = (yLo - rayOrigin.y) / rayDir.y;
  const t1 = (yHi - rayOrigin.y) / rayDir.y;
  const tEnter = Math.max(0, Math.min(t0, t1));
  const tExit = Math.max(t0, t1);
  if (tExit <= 0) return null; // slab behind camera
  return [tEnter, tExit];
}

// ─── Sky background (gradient from horizon to zenith) ─────────────────────
function _skyBackground(rayDir, sunDir, preset) {
  // Vertical blend between top + horizon colour, plus a soft sun disc.
  const upDot = Math.max(0, rayDir.y);
  const horizon = preset.skyHorizonColor;
  const top = preset.skyTopColor;
  const r = horizon[0] + (top[0] - horizon[0]) * upDot;
  const g = horizon[1] + (top[1] - horizon[1]) * upDot;
  const b = horizon[2] + (top[2] - horizon[2]) * upDot;

  // Soft sun disc — only when ray is close to sun dir.
  const sunDot = Math.max(0, rayDir.x * sunDir.x + rayDir.y * sunDir.y + rayDir.z * sunDir.z);
  const sunGlow = Math.pow(sunDot, 256) * 1.5 + Math.pow(sunDot, 8) * 0.15;
  return [
    Math.min(1.5, r + preset.sunColor[0] * sunGlow),
    Math.min(1.5, g + preset.sunColor[1] * sunGlow),
    Math.min(1.5, b + preset.sunColor[2] * sunGlow),
  ];
}

// ─── Secondary march toward sun for sun-visibility ────────────────────────
//
// Short march from sample point toward sun direction, accumulating density.
// Returns the sun-light transmittance reaching this sample.
function _sunVisibility(samplePos, sunDir, preset, kSteps, seed) {
  const stepSize = (preset.cloudLayerTop - preset.cloudLayerBottom) / Math.max(2, kSteps);
  let opticalDepth = 0;
  for (let i = 0; i < kSteps; i++) {
    const t = (i + 0.5) * stepSize;
    const px = samplePos.x + sunDir.x * t;
    const py = samplePos.y + sunDir.y * t;
    const pz = samplePos.z + sunDir.z * t;
    // Bail once we exit the cloud layer upward.
    if (py > preset.cloudLayerTop || py < preset.cloudLayerBottom) break;
    const h = (py - preset.cloudLayerBottom) / Math.max(1e-3, preset.cloudLayerTop - preset.cloudLayerBottom);
    const hg = heightGradient(h, preset.heightType);
    if (hg <= 0) continue;
    const d = cloudDensity(
      px * preset.baseScale,
      py * preset.baseScale,
      pz * preset.baseScale,
      preset.coverage, hg, seed,
    );
    opticalDepth += d * preset.density * stepSize;
  }
  // Beer's law for the sun-light path.
  return Math.exp(-opticalDepth * preset.sigmaA - opticalDepth * preset.sigmaS * 0.3);
}

// ─── Per-pixel raymarch ───────────────────────────────────────────────────
//
// Returns { r, g, b } in linear [0, 1.5+] (HDR-ish, clamped to LDR at the
// canvas write).
function _marchRay(rayOrigin, rayDir, sunDir, preset, stepCount, seed) {
  const slab = _intersectSlab(rayOrigin, rayDir, preset.cloudLayerBottom, preset.cloudLayerTop);
  if (!slab) {
    return _arrayFromTriple(_skyBackground(rayDir, sunDir, preset));
  }
  const [tEnter, tExit] = slab;
  const totalDist = tExit - tEnter;
  if (totalDist <= 0) {
    return _arrayFromTriple(_skyBackground(rayDir, sunDir, preset));
  }

  // Cosine between view ray and sun — phase function input.
  const cosTheta = rayDir.x * sunDir.x + rayDir.y * sunDir.y + rayDir.z * sunDir.z;
  // Dual-lobe phase: g=0.6 forward (silver lining) + g=-0.2 back-scatter.
  const phase = phaseDualHG(preset.anisotropy, -0.2, 0.7, cosTheta);

  const dt = totalDist / stepCount;
  let transmittance = 1.0;
  let r = 0, g = 0, b = 0;

  for (let i = 0; i < stepCount; i++) {
    const t = tEnter + (i + 0.5) * dt;
    const px = rayOrigin.x + rayDir.x * t;
    const py = rayOrigin.y + rayDir.y * t;
    const pz = rayOrigin.z + rayDir.z * t;

    const h = (py - preset.cloudLayerBottom) / Math.max(1e-3, preset.cloudLayerTop - preset.cloudLayerBottom);
    const hg = heightGradient(h, preset.heightType);
    if (hg <= 0) continue;

    const density = cloudDensity(
      px * preset.baseScale,
      py * preset.baseScale,
      pz * preset.baseScale,
      preset.coverage, hg, seed,
    );
    if (density <= 0.001) continue;

    // Beer's law for extinction along view ray.
    const sigmaT = (preset.sigmaA + preset.sigmaS) * density * preset.density;
    const sampleTrans = Math.exp(-sigmaT * dt);

    // Sun visibility from this sample.
    const sunSamplePoint = { x: px, y: py, z: pz };
    const sunVis = _sunVisibility(sunSamplePoint, sunDir, preset, 6, seed);

    // In-scattering = sigma_s * density * sunColor * phase * sunVis.
    const inscatter = preset.sigmaS * density * preset.density;
    const sunR = preset.sunColor[0] * (sunVis * phase * 4 * Math.PI + preset.ambient);
    const sunG = preset.sunColor[1] * (sunVis * phase * 4 * Math.PI + preset.ambient);
    const sunB = preset.sunColor[2] * (sunVis * phase * 4 * Math.PI + preset.ambient);

    // Energy-conserving Sebastian Lague accumulation —
    //   color += T * inscatter * (1 - sampleTrans) / sigmaT * sun
    // = analytic integral of T(x) * J over the step.
    const stepLight = (1 - sampleTrans) / Math.max(1e-6, sigmaT);
    r += transmittance * inscatter * stepLight * sunR;
    g += transmittance * inscatter * stepLight * sunG;
    b += transmittance * inscatter * stepLight * sunB;

    transmittance *= sampleTrans;

    if (transmittance < 0.005) break;
  }

  // Composite over sky.
  const sky = _skyBackground(rayDir, sunDir, preset);
  r += transmittance * sky[0];
  g += transmittance * sky[1];
  b += transmittance * sky[2];
  return [r, g, b];
}

function _arrayFromTriple(t) { return [t[0], t[1], t[2]]; }

// ─── Main render entry ────────────────────────────────────────────────────
//
// Renders an `width × height` PNG of the cloudscape and returns a data URL.
// `sunDir` is a unit Vector3 from the surface TOWARD the sun (so a sun
// directly overhead is `(0, 1, 0)`).
export function renderClouds({
  width = 192,
  height = 108,
  preset,
  sunDir = { x: -0.35, y: 0.78, z: 0.52 },
  cameraPosition = { x: 0, y: 1, z: 0 },
  cameraTarget = { x: 0, y: 1.5, z: -10 },
  cameraFOV = 65,
  stepCount = 64,
  seed = 1337,
} = {}) {
  const W = Math.max(8, width | 0);
  const H = Math.max(8, height | 0);

  // Build camera basis. The "forward" is from position → target; right =
  // forward × world-up; up = right × forward (right-handed).
  const fwd = _normalize({
    x: cameraTarget.x - cameraPosition.x,
    y: cameraTarget.y - cameraPosition.y,
    z: cameraTarget.z - cameraPosition.z,
  });
  let right = _cross(fwd, { x: 0, y: 1, z: 0 });
  if (_length(right) < 1e-4) right = { x: 1, y: 0, z: 0 };
  right = _normalize(right);
  const up = _normalize(_cross(right, fwd));

  const aspect = W / H;
  const halfFOV = (cameraFOV * Math.PI / 180) * 0.5;
  const tanFOV = Math.tan(halfFOV);

  const sun = _normalize(sunDir);

  // ImageData-style buffer: row-major RGBA, 8-bit.
  const buf = new Uint8ClampedArray(W * H * 4);

  for (let y = 0; y < H; y++) {
    // NDC y from +1 (top) to -1 (bottom).
    const ndcY = 1 - 2 * (y + 0.5) / H;
    for (let x = 0; x < W; x++) {
      const ndcX = 2 * (x + 0.5) / W - 1;
      const dirX = fwd.x + right.x * ndcX * tanFOV * aspect + up.x * ndcY * tanFOV;
      const dirY = fwd.y + right.y * ndcX * tanFOV * aspect + up.y * ndcY * tanFOV;
      const dirZ = fwd.z + right.z * ndcX * tanFOV * aspect + up.z * ndcY * tanFOV;
      const rayDir = _normalize({ x: dirX, y: dirY, z: dirZ });

      const col = _marchRay(cameraPosition, rayDir, sun, preset, stepCount, seed);

      // Tone-map (Reinhard) + gamma 2.2.
      const i = (y * W + x) * 4;
      buf[i    ] = _toSRGB8(col[0]);
      buf[i + 1] = _toSRGB8(col[1]);
      buf[i + 2] = _toSRGB8(col[2]);
      buf[i + 3] = 255;
    }
  }

  return { width: W, height: H, pixels: buf, sunDir: sun };
}

function _toSRGB8(linear) {
  // Reinhard tone map → gamma 2.2 → uint8.
  const tm = linear / (1 + linear);
  const g = Math.pow(tm, 1 / 2.2);
  return Math.max(0, Math.min(255, Math.round(g * 255)));
}

function _length(v) { return Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z); }
function _normalize(v) {
  const L = _length(v);
  if (L < 1e-12) return { x: 0, y: 0, z: 1 };
  return { x: v.x / L, y: v.y / L, z: v.z / L };
}
function _cross(a, b) {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

// ─── Canvas / data URL helper ─────────────────────────────────────────────
//
// Wraps the raw pixel buffer in a Canvas → toDataURL conversion when one is
// available (browser / Electron). Returns null when neither is present
// (pure-Node tests can still consume the raw pixels).
export function pixelsToDataURL({ width, height, pixels }) {
  if (typeof document !== 'undefined' && document.createElement) {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    const imageData = ctx.createImageData(width, height);
    imageData.data.set(pixels);
    ctx.putImageData(imageData, 0, 0);
    return canvas.toDataURL('image/png');
  }
  if (typeof OffscreenCanvas !== 'undefined') {
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext('2d');
    const imageData = ctx.createImageData(width, height);
    imageData.data.set(pixels);
    ctx.putImageData(imageData, 0, 0);
    // OffscreenCanvas → blob → data URL (async; caller can await).
    return canvas.convertToBlob({ type: 'image/png' }).then((blob) => new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.readAsDataURL(blob);
    }));
  }
  return null;
}

// ─── Texture helper (Three.js DataTexture wrapper) ────────────────────────
//
// Builds a THREE.DataTexture from the raw pixel buffer so the renderer can
// blit the result into the scene (e.g. as scene.background).
export function pixelsToDataTexture({ width, height, pixels }) {
  const tex = new THREE.DataTexture(pixels, width, height, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}
