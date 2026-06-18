// Studio photoreal render — GPU path tracer (ported from Forge's proven
// PathTracedRender.jsx, which path-traces cleanly in the SAME headless
// Electron demo context).
//
// Why this exists: the Studio demo previously screenshotted the raster
// viewport (flat clay) because the RTGPU offscreen readback returns black
// in headless (float-target readPixels = zeros). This module uses
// three-gpu-pathtracer's WebGLPathTracer with the readback that WORKS:
// renderToCanvas=true → renderSample() → drawImage(canvas) → toDataURL.
// Procedural GradientEquirect IBL + ACES tone-mapping + per-object PBR
// materials → a TRUE photorealistic frame, no HDRI asset required.
//
// Exposes window.__studioRunPathTracedRender({samples,resolutionId,envPresetId})
// → { dataUrl, width, height, samples }. The demo writes the dataUrl to PNG.

import * as THREE from 'three';
import {
  WebGLPathTracer,
  BlurredEnvMapGenerator,
} from 'three-gpu-pathtracer';
import { MATERIALS, resolveMaterial } from '../materialRegistry.js';
import { texturesFor, ABSOLUTE_ROUGHNESS_IDS } from './proceduralTextures.js';

// Real-world tile size (metres per texture repeat) per material → UV repeat is
// scaled to each body's actual size so grain/weave reads at a believable scale.
const TILE_M = {
  'wood-oak': 0.6, 'wood-walnut': 0.6, 'fabric-grey': 0.16, 'fabric-linen': 0.16,
  'leather-tan': 0.32, 'marble-white': 1.1, 'steel-brushed': 0.4, 'concrete': 0.85,
  'ceramic-white': 0.5,
  'oak-worn': 0.7, 'steel-anisotropic': 0.4, 'velvet': 0.22, 'terracotta': 0.6,
  // metals + plastics: fine micro-detail so streaks/speckle read at hardware scale
  'gold-polished': 0.22, 'brass': 0.22, 'copper': 0.22, 'aluminium': 0.25,
  'steel-polished': 0.25, 'cast-iron': 0.35, 'plastic-matte': 0.3, 'rubber-black': 0.2,
};

// Assign procedural color/roughness/normal maps to a material, UV-repeat scaled
// to the body's world size. Textures are cloned per body (shared image source →
// the path tracer dedupes the bitmap, but per-body repeat is honoured).
function applyProceduralTexture(THREE, mat, geo, matId, tileMult = 1) {
  const tex = texturesFor(matId);
  if (!tex) return;
  if (!geo.boundingBox) geo.computeBoundingBox();
  const sz = geo.boundingBox.getSize(new THREE.Vector3());
  const tile = (TILE_M[matId] || 0.5) * tileMult;
  const ru = Math.max(1, Math.round(Math.max(sz.x, sz.z) / tile));
  const rv = Math.max(1, Math.round(Math.max(sz.y, (sz.x + sz.z) / 2) / tile));
  const assign = (slot, t) => {
    if (!t) return;
    const c = t.clone(); c.needsUpdate = true;
    c.wrapS = c.wrapT = THREE.RepeatWrapping; c.repeat.set(ru, rv);
    mat[slot] = c;
  };
  assign('map', tex.map);
  assign('roughnessMap', tex.roughnessMap);
  assign('normalMap', tex.normalMap);
  // The PT does `roughness *= roughnessMap.g`. The metal/plastic microsurface
  // maps encode ABSOLUTE target roughness, so neutralize the scalar to 1 for
  // those ids (else polished metals collapse to mirror-sharp). The organic
  // generators intentionally rely on the multiply → leave their scalar alone.
  if (mat.roughnessMap && ABSOLUTE_ROUGHNESS_IDS.has(matId)) mat.roughness = 1.0;
  if (mat.normalMap) { mat.normalScale = new THREE.Vector2(0.7, 0.7); try { geo.computeTangents(); } catch (_) { mat.normalMap = null; } }
}

// Procedural-HDRI environments (equirect sky → image-based lighting + reflections).
// Each preset is a full sky model — zenith→horizon→ground gradient PLUS a bright
// warm key "sun" lobe the path tracer importance-samples (so surfaces get a real
// directional highlight + soft sky fill, not a flat tint). HDR values (>1) drive
// the key so metals get a punchy specular. `sky`/`horizon`/`ground` are linear
// RGB; `sun*` define the key lobe (azimuth/elevation in deg, angular size, HDR
// color). Aliases keep the older flat-gradient ids working.
const ENV_PRESETS = Object.freeze({
  // neutral white softbox studio: cool-bright sky, mid ground, soft top-key.
  studio: {
    sky: [1.30, 1.34, 1.42], horizon: [0.95, 0.96, 1.00], ground: [0.34, 0.34, 0.38],
    sun: { az: 35, el: 55, sizeDeg: 22, color: [3.2, 3.2, 3.3] }, intensity: 1.7,
  },
  // golden hour: warm amber sky, low warm sun, deep warm ground.
  golden: {
    sky: [1.05, 0.86, 0.62], horizon: [1.35, 0.95, 0.60], ground: [0.30, 0.22, 0.14],
    sun: { az: -60, el: 14, sizeDeg: 14, color: [6.0, 3.6, 1.6] }, intensity: 1.6,
  },
  // overcast: flat soft cool-grey dome, broad weak key (no hard shadows).
  overcast: {
    sky: [1.05, 1.08, 1.14], horizon: [0.92, 0.94, 0.98], ground: [0.42, 0.43, 0.45],
    sun: { az: 20, el: 65, sizeDeg: 50, color: [1.6, 1.65, 1.75] }, intensity: 1.9,
  },
  // clear daylight: blue sky, neutral ground, crisp high sun.
  daylight: {
    sky: [0.70, 0.86, 1.25], horizon: [0.92, 0.95, 1.02], ground: [0.34, 0.36, 0.40],
    sun: { az: 40, el: 50, sizeDeg: 12, color: [5.2, 5.0, 4.6] }, intensity: 1.6,
  },
  // warm interior: amber-neutral, gentle key — pairs with wood/fabric scenes.
  warm: {
    sky: [1.18, 1.04, 0.86], horizon: [1.10, 0.98, 0.84], ground: [0.32, 0.27, 0.21],
    sun: { az: -30, el: 40, sizeDeg: 20, color: [3.4, 2.8, 2.0] }, intensity: 1.6,
  },
});
// Aliases so any caller's envPresetId still resolves.
const ENV_ALIASES = { 'golden-hour': 'golden', 'blue-hour': 'daylight', 'sunset': 'golden', 'cloudy': 'overcast', 'noon': 'daylight' };
export const STUDIO_ENV_IDS = Object.keys(ENV_PRESETS);

const RESOLUTIONS = Object.freeze({
  '720p':  { w: 1280, h: 720 },
  '1080p': { w: 1920, h: 1080 },
  '1440p': { w: 2560, h: 1440 },
  '4k':    { w: 3840, h: 2160 },   // full 4K photoreal hero frame
  'uhd':   { w: 3840, h: 2160 },
});

function detectWebGL2Compute() {
  if (typeof document === 'undefined') return { ok: false, error: 'needs DOM' };
  const gl = document.createElement('canvas').getContext('webgl2', { antialias: false });
  if (!gl) return { ok: false, error: 'WebGL2 unavailable' };
  if (!gl.getExtension('EXT_color_buffer_float')) return { ok: false, error: 'no EXT_color_buffer_float' };
  if (!gl.getExtension('OES_texture_float_linear')) return { ok: false, error: 'no OES_texture_float_linear' };
  return { ok: true };
}

// Build a procedural HDRI as a half-float equirect DataTexture: sky→horizon→
// ground gradient + a Gaussian warm sun lobe (HDR) the PT importance-samples.
// Equirect convention: u = azimuth (0..1 → -π..π), v = 0 at bottom (−Y), 1 top.
function buildProceduralHDRI(preset, w = 1024, h = 512) {
  const data = new Float32Array(w * h * 4);
  const toRad = Math.PI / 180;
  const sun = preset.sun;
  const sunDir = new THREE.Vector3(
    Math.cos(sun.el * toRad) * Math.sin(sun.az * toRad),
    Math.sin(sun.el * toRad),
    Math.cos(sun.el * toRad) * Math.cos(sun.az * toRad),
  ).normalize();
  const sunCos = Math.cos(sun.sizeDeg * toRad);     // hard edge of the lobe
  const sunCore = Math.cos((sun.sizeDeg * 0.35) * toRad); // bright core
  const lerp = (a, b, t) => a + (b - a) * t;
  for (let y = 0; y < h; y++) {
    const v = y / (h - 1);                 // 0 bottom .. 1 top
    const elev = (v - 0.5) * Math.PI;      // -π/2 .. π/2
    const up = Math.max(0, Math.sin(elev));        // sky weight
    const down = Math.max(0, -Math.sin(elev));     // ground weight
    // vertical gradient: ground (below) | horizon band | sky (above)
    const skyMix = Math.pow(up, 0.55);
    for (let x = 0; x < w; x++) {
      const u = x / w;
      const az = (u - 0.5) * 2 * Math.PI;
      const ce = Math.cos(elev);
      const dir = { x: ce * Math.sin(az), y: Math.sin(elev), z: ce * Math.cos(az) };
      let r, g, b;
      if (down > 0) {
        const gm = Math.pow(down, 0.6);
        r = lerp(preset.horizon[0], preset.ground[0], gm);
        g = lerp(preset.horizon[1], preset.ground[1], gm);
        b = lerp(preset.horizon[2], preset.ground[2], gm);
      } else {
        r = lerp(preset.horizon[0], preset.sky[0], skyMix);
        g = lerp(preset.horizon[1], preset.sky[1], skyMix);
        b = lerp(preset.horizon[2], preset.sky[2], skyMix);
      }
      // sun lobe (dot with sun dir): smooth core → soft falloff to the size edge
      const d = dir.x * sunDir.x + dir.y * sunDir.y + dir.z * sunDir.z;
      if (d > sunCos) {
        const t = (d - sunCos) / (1 - sunCos);
        const lobe = Math.pow(t, 1.5) + (d > sunCore ? 1.4 : 0);
        r += preset.sun.color[0] * lobe;
        g += preset.sun.color[1] * lobe;
        b += preset.sun.color[2] * lobe;
      }
      const o = (y * w + x) * 4;
      data[o] = r; data[o + 1] = g; data[o + 2] = b; data[o + 3] = 1;
    }
  }
  const tex = new THREE.DataTexture(data, w, h, THREE.RGBAFormat, THREE.FloatType);
  tex.mapping = THREE.EquirectangularReflectionMapping;
  tex.wrapS = THREE.RepeatWrapping; tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.minFilter = THREE.LinearFilter; tex.magFilter = THREE.LinearFilter;
  tex.colorSpace = THREE.LinearSRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

function buildEnvTexture(presetId, renderer) {
  const key = ENV_ALIASES[presetId] || presetId;
  const p = ENV_PRESETS[key] || ENV_PRESETS.studio;
  const tex = buildProceduralHDRI(p, 1024, 512);
  if (!renderer) return { tex, intensity: p.intensity };
  // Light blur smooths the diffuse IBL while keeping the sun lobe punchy for
  // glossy reflections. Fall back to the raw equirect if the generator throws.
  try {
    const blur = new BlurredEnvMapGenerator(renderer);
    const blurred = blur.generate(tex, 0.035);
    blur.dispose();
    tex.dispose();
    return { tex: blurred, intensity: p.intensity };
  } catch (_) {
    return { tex, intensity: p.intensity };
  }
}

let _rendererSingleton = null;
function makeOfflineRenderer() {
  if (_rendererSingleton && !_rendererSingleton.disposed) return _rendererSingleton;
  const canvas = document.createElement('canvas');
  canvas.width = 1280; canvas.height = 720;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, powerPreference: 'high-performance' });
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.35; // lift the textured-albedo dimness
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  const wrapper = { canvas, renderer, disposed: false, dispose() { this.disposed = true; try { renderer.dispose(); } catch (_) {} } };
  _rendererSingleton = wrapper;
  return wrapper;
}

// Tasteful interior palette for untagged bodies (so a scene reads as
// furnished, not uniform clay). Builders SHOULD tag meshes with
// userData.studioMaterial (a materialRegistry id) for intentional shading.
const FALLBACK_PALETTE = ['wood-walnut', 'fabric-grey', 'wood-oak', 'fabric-linen', 'ceramic-white', 'leather-tan', 'plastic-matte', 'brass'];

function physMatFrom(spec) {
  return new THREE.MeshPhysicalMaterial({
    color: spec.color,
    metalness: spec.metalness ?? 0.0,
    roughness: spec.roughness ?? 0.6,
    clearcoat: spec.clearcoat ?? 0.0,
    clearcoatRoughness: spec.clearcoatRoughness ?? 0.3,
    transmission: spec.transmission ?? 0.0,
    ior: spec.ior ?? 1.5,
  });
}

// Build a tasteful room shell around a measured build: warm wood floor + two
// neutral plaster walls (back + one side, behind/beside the furniture so the
// camera looks INTO a corner), a soft high ceiling, and a glowing window gap on
// the open side that reads as a real daylight source (emissive panel the PT
// importance-samples). Walls are pushed out beyond the footprint with generous
// height so the space feels architectural, not boxy. Returns the meshes to add.
// `enabled=false` (e.g. product/backdrop layouts) → floor only.
function buildRoomShell(box, center, size, { enabled = true } = {}) {
  const meshes = [];
  const footprint = Math.max(size.x, size.z, 0.5);
  const floorY = box.min.y - 0.002;
  // ── floor (kept: warm wood, larger planks) ──
  const span = footprint * 4 + 2;
  const floorGeo = new THREE.PlaneGeometry(span, span);
  const floorMat = physMatFrom({ color: 0xb8a888, metalness: 0.0, roughness: 0.7 });
  applyProceduralTexture(THREE, floorMat, floorGeo, 'wood-oak', 2.6);
  const floor = new THREE.Mesh(floorGeo, floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(center.x, floorY, center.z);
  floor.receiveShadow = true;
  meshes.push(floor);
  if (!enabled) return meshes;

  // Wall placement: a corner behind -Z and -X (the default hero camera looks
  // from +X/+Z toward the centre, so these walls sit behind the build, never
  // between camera and furniture). Generous clearance + a soft ceiling.
  const wallH = Math.max(size.y * 1.8 + 1.2, 2.7);
  const halfW = footprint * 1.6 + 1.0;
  const wallT = 0.08;
  const backZ = center.z - (size.z / 2) - footprint * 0.7 - 0.4;
  const sideX = center.x - (size.x / 2) - footprint * 0.7 - 0.4;
  const wallMat = () => {
    const m = physMatFrom({ color: 0xe6e1d8, metalness: 0.0, roughness: 0.92 }); // neutral matte plaster
    return m;
  };
  // back wall (spans X), faces +Z
  const back = new THREE.Mesh(new THREE.BoxGeometry(halfW * 2, wallH, wallT), wallMat());
  back.position.set(center.x - footprint * 0.2, floorY + wallH / 2, backZ);
  back.receiveShadow = true; meshes.push(back);
  // side wall (spans Z), faces +X
  const side = new THREE.Mesh(new THREE.BoxGeometry(wallT, wallH, halfW * 2), wallMat());
  side.position.set(sideX, floorY + wallH / 2, center.z - footprint * 0.2);
  side.receiveShadow = true; meshes.push(side);
  // soft ceiling (slightly warm, high up) — bounces fill light, not in frame for hero
  const ceil = new THREE.Mesh(new THREE.BoxGeometry(halfW * 2.2, wallT, halfW * 2.2),
    physMatFrom({ color: 0xf0ece4, metalness: 0.0, roughness: 0.95 }));
  ceil.position.set(center.x - footprint * 0.2, floorY + wallH, center.z - footprint * 0.2);
  meshes.push(ceil);

  // window light gap on the back wall: a recessed emissive panel (daylight),
  // bright enough to throw a soft directional fill the PT samples directly.
  const winW = Math.min(halfW * 0.9, footprint * 1.4 + 0.8);
  const winH = Math.min(wallH * 0.6, size.y * 1.2 + 1.0);
  const winMat = new THREE.MeshPhysicalMaterial({
    color: 0xffffff, emissive: new THREE.Color(0xfdf4e3), emissiveIntensity: 6.0,
    roughness: 1.0, metalness: 0.0, side: THREE.DoubleSide,
  });
  const win = new THREE.Mesh(new THREE.PlaneGeometry(winW, winH), winMat);
  // Sit just in front of the back wall, plane normal +Z (emits INTO the room,
  // which lies on the +Z side of the wall). DoubleSide keeps it lit either way.
  win.position.set(center.x - footprint * 0.2, floorY + wallH * 0.52, backZ + wallT / 2 + 0.005);
  // mullion frame so it reads as a window, not a floating glow
  const frameMat = physMatFrom({ color: 0x2a2c30, metalness: 0.1, roughness: 0.6 });
  const fr = (w, h, x, y) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.04), frameMat); m.position.set(center.x - footprint * 0.2 + x, floorY + wallH * 0.52 + y, backZ + wallT / 2 + 0.02); meshes.push(m); };
  fr(0.05, winH, -winW / 2, 0); fr(0.05, winH, winW / 2, 0);
  fr(winW, 0.05, 0, -winH / 2); fr(winW, 0.05, 0, winH / 2); fr(0.04, winH, 0, 0);
  meshes.push(win);
  return meshes;
}

function harvestScene({ room = true } = {}) {
  const out = new THREE.Scene();
  const scene = (typeof window !== 'undefined') && (window.__archdiscScene || (window.__archdiscViewport && window.__archdiscViewport.scene));
  const live = [];
  if (scene) scene.traverse((o) => {
    if (o && o.isMesh && o.geometry && o.userData && o.userData.archdiscStudioPrimitive) {
      o.updateWorldMatrix?.(true, false);
      live.push(o);
    }
  });
  let pi = 0;
  for (const m of live) {
    if (!m || !m.geometry) continue;
    const tag = m.userData && m.userData.studioMaterial;
    const matId = tag || FALLBACK_PALETTE[pi++ % FALLBACK_PALETTE.length];
    const geo = m.geometry.clone();
    const mat = physMatFrom(resolveMaterial(matId));
    applyProceduralTexture(THREE, mat, geo, matId);
    const clone = new THREE.Mesh(geo, mat);
    if (m.matrixWorld) clone.applyMatrix4(m.matrixWorld);
    else { clone.position.copy(m.position); clone.quaternion.copy(m.quaternion); clone.scale.copy(m.scale); }
    clone.castShadow = true; clone.receiveShadow = true;
    out.add(clone);
  }
  if (out.children.length === 0) {
    out.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), physMatFrom(MATERIALS['plastic-matte'])));
  }
  // Measure the build, then add a grounding floor sized to it.
  const box = new THREE.Box3().setFromObject(out);
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  out.userData.sceneCenter = center;
  out.userData.sceneRadius = Math.max(size.length() / 2, 0.5);
  out.userData.sceneFootprint = Math.max(size.x, size.z, 0.5);
  // Grounding room shell (floor + corner walls + ceiling + window light gap).
  // `room=false` → floor only (product / backdrop layouts bring their own set).
  for (const m of buildRoomShell(box, center, size, { enabled: room })) out.add(m);
  return out;
}

const ANGLE_DIRS = {
  hero:    [0.62, 0.42, 0.66],
  front:   [0.02, 0.30, 1.0],
  profile: [1.0, 0.32, 0.10],
  top:     [0.28, 1.1, 0.42],
};

function frameCamera(scene, aspect, fovDeg = 38, angle = 'hero') {
  const center = scene.userData.sceneCenter || new THREE.Vector3();
  const radius = scene.userData.sceneRadius || 2;
  const fov = (fovDeg * Math.PI) / 180;
  // Distance so the bounding sphere fits vertically AND horizontally (wide
  // aspect): use the tighter of the two limits so the build fills the frame
  // without clipping. margin 1.12 for breathing room.
  const vFit = radius / Math.sin(fov / 2);
  const hFov = 2 * Math.atan(Math.tan(fov / 2) * aspect);
  const hFit = radius / Math.sin(hFov / 2);
  // Tight hero: interiors are wide + flat so the bounding SPHERE over-pads
  // vertically with empty air — pull in to 0.84× so the furniture DOMINATES
  // the frame (clipping only the empty top/bottom of the sphere, not geometry).
  const d = Math.max(vFit, hFit) * 0.84;
  const cam = new THREE.PerspectiveCamera(fovDeg, aspect, Math.max(radius * 0.01, 0.02), radius * 200);
  // Eye slightly above the build's vertical mid, looking at centre; the angle
  // picks the (normalized) view direction, scaled to the fit distance d.
  const look = center.clone(); look.y += radius * 0.12;
  const raw = ANGLE_DIRS[angle] || ANGLE_DIRS.hero;
  const dn = new THREE.Vector3(raw[0], raw[1], raw[2]).normalize();
  cam.position.set(look.x + dn.x * d, look.y + dn.y * d, look.z + dn.z * d);
  cam.lookAt(look);
  cam.updateMatrixWorld(true);
  return cam;
}

export async function runStudioPathTracedRender({ envPresetId = 'studio', samples = 64, resolutionId = '1080p', angle = 'hero', room = true } = {}) {
  const cap = detectWebGL2Compute();
  if (!cap.ok) throw new Error('Studio path tracer: ' + cap.error);
  const res = RESOLUTIONS[resolutionId] || RESOLUTIONS['1080p'];
  const wrapper = makeOfflineRenderer();
  const { renderer, canvas } = wrapper;
  renderer.setPixelRatio(1);
  renderer.setSize(res.w, res.h, false);
  canvas.width = res.w; canvas.height = res.h;

  const scene = harvestScene({ room });
  const camera = frameCamera(scene, res.w / res.h, 38, angle);
  const env = buildEnvTexture(envPresetId, renderer);
  scene.environment = env.tex; scene.background = env.tex;
  scene.environmentIntensity = env.intensity; // IBL brightness (honored by the PT)

  const pt = new WebGLPathTracer(renderer);
  pt.tiles.set(3, 3);
  pt.minSamples = 1;
  pt.renderToCanvas = false;
  pt.filterGlossyFactor = 0.5;
  pt.setScene(scene, camera);

  const target = Math.max(1, Math.min(512, samples | 0));
  let s = 0;
  while (s < target) {
    pt.renderSample(); s += 1;
    if (s % 8 === 0) await new Promise((r) => requestAnimationFrame(r));
  }
  // Headless-safe readback: render to the WebGL canvas, drawImage onto 2D.
  const outC = document.createElement('canvas');
  outC.width = res.w; outC.height = res.h;
  const ctx = outC.getContext('2d');
  pt.renderToCanvas = true;
  pt.renderSample();
  ctx.drawImage(canvas, 0, 0, res.w, res.h);

  // Grade: gentle contrast + vignette (renderer already ACES+sRGB; do NOT re-tonemap).
  try {
    const img = ctx.getImageData(0, 0, res.w, res.h); const d = img.data;
    const cx = res.w / 2, cy = res.h / 2, maxd = Math.hypot(cx, cy), contrast = 1.06;
    for (let i = 0; i < d.length; i += 4) {
      const idx = i >> 2, px = idx % res.w, py = (idx / res.w) | 0;
      const vig = 1 - 0.24 * Math.pow(Math.hypot(px - cx, py - cy) / maxd, 2.2);
      for (let c = 0; c < 3; c++) { let v = d[i + c] / 255; v = (v - 0.5) * contrast + 0.5; v *= vig; d[i + c] = Math.max(0, Math.min(255, v * 255)); }
    }
    ctx.putImageData(img, 0, 0);
  } catch (_) {}

  try { pt.dispose?.(); } catch (_) {}
  try { env.tex.dispose?.(); } catch (_) {}
  scene.traverse((o) => { if (o.isMesh) { o.geometry?.dispose?.(); (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => m?.dispose?.()); } });
  try { renderer.forceContextLoss?.(); } catch (_) {}
  try { wrapper.dispose(); } catch (_) {}
  _rendererSingleton = null;

  return { canvas: outC, width: res.w, height: res.h, samples: target };
}

export function installStudioPathTracer() {
  if (typeof window === 'undefined') return;
  window.__studioRunPathTracedRender = async (opts = {}) => {
    const { canvas, width, height, samples } = await runStudioPathTracedRender(opts);
    return { dataUrl: canvas.toDataURL('image/png'), width, height, samples };
  };
}
