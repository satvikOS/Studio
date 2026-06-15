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
  GradientEquirectTexture,
  BlurredEnvMapGenerator,
} from 'three-gpu-pathtracer';
import { MATERIALS, resolveMaterial } from '../materialRegistry.js';
import { texturesFor } from './proceduralTextures.js';

// Real-world tile size (metres per texture repeat) per material → UV repeat is
// scaled to each body's actual size so grain/weave reads at a believable scale.
const TILE_M = {
  'wood-oak': 0.6, 'wood-walnut': 0.6, 'fabric-grey': 0.16, 'fabric-linen': 0.16,
  'leather-tan': 0.32, 'marble-white': 1.1, 'steel-brushed': 0.4, 'concrete': 0.85,
  'ceramic-white': 0.5,
  'oak-worn': 0.7, 'steel-anisotropic': 0.4, 'velvet': 0.22, 'terracotta': 0.6,
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
  if (mat.normalMap) { mat.normalScale = new THREE.Vector2(0.7, 0.7); try { geo.computeTangents(); } catch (_) { mat.normalMap = null; } }
}

// Interior-friendly procedural environments (gradient equirect → IBL).
const ENV_PRESETS = Object.freeze({
  studio:  { top: new THREE.Color(0xffffff), bottom: new THREE.Color(0x70707a), exponent: 0.85, intensity: 2.6 },
  golden:  { top: new THREE.Color(0xfff0d6), bottom: new THREE.Color(0x6a5640), exponent: 1.1, intensity: 2.7 },
  daylight:{ top: new THREE.Color(0xeef4ff), bottom: new THREE.Color(0x5c6068), exponent: 0.95, intensity: 2.5 },
  warm:    { top: new THREE.Color(0xffe7c4), bottom: new THREE.Color(0x584a40), exponent: 1.15, intensity: 2.4 },
});
export const STUDIO_ENV_IDS = Object.keys(ENV_PRESETS);

const RESOLUTIONS = Object.freeze({
  '720p':  { w: 1280, h: 720 },
  '1080p': { w: 1920, h: 1080 },
  '1440p': { w: 2560, h: 1440 },
});

function detectWebGL2Compute() {
  if (typeof document === 'undefined') return { ok: false, error: 'needs DOM' };
  const gl = document.createElement('canvas').getContext('webgl2', { antialias: false });
  if (!gl) return { ok: false, error: 'WebGL2 unavailable' };
  if (!gl.getExtension('EXT_color_buffer_float')) return { ok: false, error: 'no EXT_color_buffer_float' };
  if (!gl.getExtension('OES_texture_float_linear')) return { ok: false, error: 'no OES_texture_float_linear' };
  return { ok: true };
}

function buildEnvTexture(presetId, renderer) {
  const p = ENV_PRESETS[presetId] || ENV_PRESETS.studio;
  const tex = new GradientEquirectTexture(1024);
  tex.topColor.copy(p.top); tex.bottomColor.copy(p.bottom); tex.exponent = p.exponent; tex.update();
  if (!renderer) return { tex, intensity: p.intensity };
  const blur = new BlurredEnvMapGenerator(renderer);
  const blurred = blur.generate(tex, 0.18);
  blur.dispose();
  return { tex: blurred, intensity: p.intensity };
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

function harvestScene() {
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
  const span = Math.max(size.x, size.z) * 4 + 2;
  const floorGeo = new THREE.PlaneGeometry(span, span);
  const floorMat = physMatFrom({ color: 0xb8a888, metalness: 0.0, roughness: 0.7 });
  applyProceduralTexture(THREE, floorMat, floorGeo, 'wood-oak', 2.6);  // warm wood floor, larger planks
  const floor = new THREE.Mesh(floorGeo, floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(center.x, box.min.y - 0.002, center.z);
  floor.receiveShadow = true;
  out.add(floor);
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

export async function runStudioPathTracedRender({ envPresetId = 'studio', samples = 64, resolutionId = '1080p', angle = 'hero' } = {}) {
  const cap = detectWebGL2Compute();
  if (!cap.ok) throw new Error('Studio path tracer: ' + cap.error);
  const res = RESOLUTIONS[resolutionId] || RESOLUTIONS['1080p'];
  const wrapper = makeOfflineRenderer();
  const { renderer, canvas } = wrapper;
  renderer.setPixelRatio(1);
  renderer.setSize(res.w, res.h, false);
  canvas.width = res.w; canvas.height = res.h;

  const scene = harvestScene();
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
