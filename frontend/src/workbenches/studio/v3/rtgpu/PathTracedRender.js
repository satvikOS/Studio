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
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js';
import { Sky } from 'three/examples/jsm/objects/Sky.js';
import {
  WebGLPathTracer,
  BlurredEnvMapGenerator,
  PhysicalCamera,
} from 'three-gpu-pathtracer';
import { MATERIALS, resolveMaterial } from '../materialRegistry.js';
import {
  texturesFor, ABSOLUTE_ROUGHNESS_IDS,
  REAL_PBR_IDS, realPbrSetCached, preloadRealPbr,
} from './proceduralTextures.js';

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
  // environment ground / facade sets — large surfaces, real-world tile periods
  'asphalt': 2.0, 'grass': 1.6, 'facade': 0.6, 'sidewalk': 0.6, 'car-paint': 0.35,
};

// Assign procedural color/roughness/normal maps to a material, UV-repeat scaled
// to the body's world size. Textures are cloned per body (shared image source →
// the path tracer dedupes the bitmap, but per-body repeat is honoured).
function applyProceduralTexture(THREE, mat, geo, matId, tileMult = 1) {
  // Prefer the downloaded real CC0 PBR scan (must be preloaded via
  // preloadRealPbr() before render — see runStudioPathTracedRender's prepass);
  // fall back to the local procedural generator when no real set is loaded.
  const real = realPbrSetCached(matId);
  const tex = real || texturesFor(matId);
  if (!tex) return;
  const isReal = !!real;
  if (!geo.boundingBox) geo.computeBoundingBox();
  const sz = geo.boundingBox.getSize(new THREE.Vector3());
  const tile = (TILE_M[matId] || 0.5) * tileMult;
  // Clamp the UV repeat: the PT packs every source map into a 1024² texture-array
  // layer, so a giant surface (e.g. the 82 m asphalt → repeat ~49, or skyline
  // towers → ~190) tiles far below one texel/repeat and aliases to a FLAT average
  // (the "clay" look). Cap the repeat so the grain stays resolvable + textured.
  const REP_MAX = 12;
  const ru = Math.min(REP_MAX, Math.max(1, Math.round(Math.max(sz.x, sz.z) / tile)));
  const rv = Math.min(REP_MAX, Math.max(1, Math.round(Math.max(sz.y, (sz.x + sz.z) / 2) / tile)));
  const assign = (slot, t) => {
    if (!t) return;
    const c = t.clone(); c.needsUpdate = true;
    c.colorSpace = t.colorSpace;           // clone() drops colorSpace on some THREE builds
    c.anisotropy = t.anisotropy || 8;      // preserve anisotropic filtering on the real maps
    c.wrapS = c.wrapT = THREE.RepeatWrapping; c.repeat.set(ru, rv);
    mat[slot] = c;
  };
  assign('map', tex.map);
  assign('roughnessMap', tex.roughnessMap);
  assign('normalMap', tex.normalMap);
  // The PT does `roughness *= roughnessMap.g`. Real scans + the metal/plastic
  // microsurface maps encode ABSOLUTE target roughness, so neutralize the scalar
  // to 1 for those ids (else polished surfaces collapse to mirror-sharp). The
  // organic procedural generators rely on the multiply → leave their scalar alone.
  if (mat.roughnessMap && (isReal || ABSOLUTE_ROUGHNESS_IDS.has(matId))) mat.roughness = 1.0;
  // Real scans carry their own albedo colour; drop the registry tint so it isn't
  // double-multiplied into a muddy result.
  if (isReal && mat.map) mat.color = new THREE.Color(0xffffff);
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

// ── FULLY PROCEDURAL SKY (THREE.Sky — Preetham atmospheric scattering) ───────
// No imported HDRI/EXR/image: a parametric Sky dome (turbidity / rayleigh / mie /
// sun elevation+azimuth) is baked to an equirect environment via PMREMGenerator.
// fromScene(skyScene). The baked equirect drives BOTH the path tracer's IBL/GI
// (scene.environment) and the VISIBLE rendered background (scene.background), and
// we hand back the sun WORLD-DIRECTION so the caller can add a matching directional
// "sun" key light. Cinematic warm low-sun presets for the forest golden hour.
//   elevation° from horizon, azimuth° (compass), turbidity (haze), rayleigh (blue),
//   mieCoefficient (sun-halo density), mieDirectionalG (halo tightness), exposure.
const SKY_PRESETS = Object.freeze({
  // warm golden hour — low sun, hazy, strong warm halo (forest mood). DEFAULT.
  golden:   { elevation: 6,  azimuth: 165, turbidity: 8,  rayleigh: 2.6, mie: 0.018, mieG: 0.86, exposure: 0.42, intensity: 1.25 },
  'golden-hour': { elevation: 6, azimuth: 165, turbidity: 8, rayleigh: 2.6, mie: 0.018, mieG: 0.86, exposure: 0.42, intensity: 1.25 },
  sunset:   { elevation: 4,  azimuth: 195, turbidity: 10, rayleigh: 3.0, mie: 0.022, mieG: 0.88, exposure: 0.40, intensity: 1.25 },
  // clear midday blue sky — high sun, low haze
  daylight: { elevation: 55, azimuth: 130, turbidity: 4,  rayleigh: 1.2, mie: 0.005, mieG: 0.80, exposure: 0.55, intensity: 1.4 },
  // overcast — high turbidity flattens the sun into a bright diffuse dome
  overcast: { elevation: 40, azimuth: 130, turbidity: 16, rayleigh: 0.8, mie: 0.030, mieG: 0.70, exposure: 0.48, intensity: 1.2 },
});

// Build the procedural Sky → equirect environment + sun world-direction.
// Returns { tex, intensity, sunDir, sunColor } or null on failure (caller falls
// back to the gradient). Never throws.
function buildProceduralSkyEnv(presetId, renderer) {
  if (!renderer) return null;
  const key = ENV_ALIASES[presetId] || presetId;
  const sp = SKY_PRESETS[key] || SKY_PRESETS.golden;
  try {
    const sky = new Sky();
    sky.scale.setScalar(450000);
    const u = sky.material.uniforms;
    u.turbidity.value = sp.turbidity;
    u.rayleigh.value = sp.rayleigh;
    u.mieCoefficient.value = sp.mie;
    u.mieDirectionalG.value = sp.mieG;
    // sun position from elevation (from horizon) + azimuth (compass)
    const phi = THREE.MathUtils.degToRad(90 - sp.elevation);   // polar from +Y
    const theta = THREE.MathUtils.degToRad(sp.azimuth);
    const sunDir = new THREE.Vector3().setFromSphericalCoords(1, phi, theta);
    u.sunPosition.value.copy(sunDir);

    const skyScene = new THREE.Scene();
    skyScene.add(sky);

    // Render the procedural Sky into a CUBE render target → a true HDR CubeTexture.
    // The path tracer's WebGLPathTracer detects isCubeTexture and converts it to an
    // equirect for IBL via CubeToEquirectGenerator; three renders a cube background
    // natively (crisp warm sky + sun disc visible). HalfFloat keeps the HDR sun.
    const prevExposure = renderer.toneMappingExposure;
    const prevTone = renderer.toneMapping;
    renderer.toneMapping = THREE.NoToneMapping;          // bake LINEAR HDR radiance
    renderer.toneMappingExposure = sp.exposure;
    const rt = new THREE.WebGLCubeRenderTarget(1024, { type: THREE.HalfFloatType });
    const cubeCam = new THREE.CubeCamera(0.1, 2000, rt);
    cubeCam.update(renderer, skyScene);
    renderer.toneMappingExposure = prevExposure;
    renderer.toneMapping = prevTone;

    const tex = rt.texture;          // true HDR CubeTexture (isCubeTexture === true)
    tex.userData = tex.userData || {};
    tex.userData.__skyRT = rt;       // keep the render target for disposal

    // warm sun light colour ramps with elevation (low sun → amber)
    const warm = Math.max(0, Math.min(1, (12 - sp.elevation) / 12));
    const sunColor = new THREE.Color().setRGB(
      1.0,
      0.78 + 0.20 * (1 - warm),
      0.55 + 0.40 * (1 - warm),
    );
    return { tex, intensity: sp.intensity, sunDir, sunColor, isReal: false, isSky: true, sky, skyScene };
  } catch (e) {
    if (typeof console !== 'undefined') console.warn('[proceduralSky]', presetId, e && e.message ? e.message : e);
    return null;
  }
}

// ── Real downloaded HDRI IBL (Poly Haven, 1k Radiance .hdr) ──────────────────
// frontend/public/assets/hdri/<id>.hdr → copied verbatim into dist/assets/hdri/.
// Maps a preset id (after alias resolution) to a real equirect HDRI; loaded via
// THREE.RGBELoader and used as scene.environment + background, replacing the
// procedural GradientEquirectTexture. Falls back to the gradient on any failure.
// Intensity reuses the matching ENV_PRESETS value so brightness stays consistent.
// NOTE: studio.hdr / golden.hdr / daylight.hdr are INTERIOR environment captures
// (photo-studio rooms) — correct for product/interior lookdev, but they have NO
// SKY, so using them as the background of an OUTDOOR scene (the city flagship)
// renders blurry interior walls instead of a sky. For outdoor scenes we map to
// real outdoor SKY HDRIs (Poly Haven CC0, downloaded to assets/hdri/sky-*.hdr):
//   sky-day.hdr    = kloofendal_43d_clear_puresky (blue sky + sun)
//   sky-golden.hdr = venice_sunset (warm golden-hour sky)
//   sky-city.hdr   = potsdamer_platz (urban overcast sky)
const HDRI_FILES = Object.freeze({
  // outdoor SKY presets → real sky HDRIs (used by the city / any outdoor scene)
  daylight: 'sky-day.hdr',    // clear blue daylight sky + sun
  golden:   'sky-golden.hdr', // warm golden-hour sky
  overcast: 'sky-city.hdr',   // urban overcast sky
  // interior presets keep the photo-studio environment captures (no sky needed)
  studio:   'studio.hdr',     // neutral photo-studio interior
  warm:     'golden.hdr',     // warm interior (brown photostudio)
});
function hdriUrl(file) {
  const base = (typeof document !== 'undefined' && document.baseURI)
    ? document.baseURI
    : (typeof location !== 'undefined' ? location.href : 'file:///');
  try { return new URL('assets/hdri/' + file, base).href; }
  catch (_) { return 'assets/hdri/' + file; }
}
const _hdriCache = {}; // presetKey -> THREE.DataTexture (equirect, FloatType)
// Await-able: load (once) the real HDRI for a preset id. Resolves to a texture
// with EquirectangularReflectionMapping, or null when no HDRI maps to the id /
// the file fails to load (caller then uses the procedural gradient). Never throws.
function loadRealHDRI(presetId) {
  const key = ENV_ALIASES[presetId] || presetId;
  const file = HDRI_FILES[key];
  if (!file) return Promise.resolve(null);
  if (key in _hdriCache) return Promise.resolve(_hdriCache[key]);
  const url = hdriUrl(file);
  return new Promise((resolve) => {
    const loader = new RGBELoader();
    loader.setDataType(THREE.FloatType);
    loader.load(url,
      (tex) => {
        tex.mapping = THREE.EquirectangularReflectionMapping;
        _hdriCache[key] = tex;
        resolve(tex);
      },
      undefined,
      (err) => {
        if (typeof console !== 'undefined') console.warn('[realHDRI]', key, url, err && err.message ? err.message : err);
        _hdriCache[key] = null;
        resolve(null);
      });
  });
}

let _rendererSingleton = null;
function makeOfflineRenderer() {
  if (_rendererSingleton && !_rendererSingleton.disposed) return _rendererSingleton;
  const canvas = document.createElement('canvas');
  canvas.width = 1280; canvas.height = 720;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, powerPreference: 'high-performance' });
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  // Exposure 1.0: the previous 1.35 (combined with the env intensity below) blew
  // the sky + light surfaces to flat white, hiding ALL the PBR texture/albedo. A
  // neutral exposure keeps highlights from clipping so the sky + materials read.
  renderer.toneMappingExposure = 1.0;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  const wrapper = { canvas, renderer, disposed: false, dispose() { this.disposed = true; try { renderer.dispose(); } catch (_) {} } };
  _rendererSingleton = wrapper;
  return wrapper;
}

// Tasteful interior palette for untagged bodies (so a scene reads as
// furnished, not uniform clay). Builders SHOULD tag meshes with
// userData.studioMaterial (a materialRegistry id) for intentional shading.
const FALLBACK_PALETTE = ['wood-walnut', 'fabric-grey', 'wood-oak', 'fabric-linen', 'ceramic-white', 'leather-tan', 'plastic-matte', 'brass'];

// ── RENDER MODES ─────────────────────────────────────────────────────────────
// The SAME scene + animation + camera + HDRI lighting is rendered three ways so a
// reviewer can read the geometry, the form, and the final look side-by-side:
//   • photoreal — the existing path: per-object real PBR + scanned/procedural maps
//       + the true-HDR HDRI sky + ACES grade. The "final look".
//   • clay      — a single uniform matte clay material on EVERY body (no albedo /
//       maps / metal), but we KEEP the HDRI lighting + shadows so it reads as a
//       lit sculpt turntable (form + silhouette, not texture). This is a real
//       material SWAP inside harvestScene, so the path tracer still bounces light.
//   • wireframe — clay surface (faint) UNDER a rasterized edge overlay drawn over
//       the path-traced surface in the 2D readback context. The path tracer traces
//       triangles, not edges, so a true wireframe must come from a fast raster
//       EdgesGeometry pass on the SAME camera — composited on top. The result is
//       "raw but realistic": lit shaded surface you can still recognise, with the
//       topology drawn over it.
export const RENDER_MODES = Object.freeze(['photoreal', 'clay', 'wireframe']);
export const RENDER_MODE_LABELS = Object.freeze({ photoreal: 'Photoreal', clay: 'Clay', wireframe: 'Wireframe' });
function normMode(mode) { return RENDER_MODES.includes(mode) ? mode : 'photoreal'; }

// One neutral matte clay material — the classic light-grey sculpt clay. Kept
// dielectric + rough so the HDRI key throws a soft form-revealing shadow/terminator
// (a turntable look), with no albedo texture or metalness to read as "textured".
// Built fresh per body so the path tracer's per-mesh material dedup stays simple
// and disposal in the teardown loop frees each one.
function clayMaterial() {
  return new THREE.MeshPhysicalMaterial({
    color: 0xc9c6bf, metalness: 0.0, roughness: 0.78,
    clearcoat: 0.0, sheen: 0.0, specularIntensity: 0.4,
  });
}

// Faint shaded clay under the wireframe overlay: same clay but a touch darker +
// rougher so the rasterized edges read clearly on top (the "raw but realistic"
// look — a lit recognisable surface, topology drawn over it).
function wireframeSurfaceMaterial() {
  return new THREE.MeshPhysicalMaterial({
    color: 0x9fa3a8, metalness: 0.0, roughness: 0.9, specularIntensity: 0.25,
  });
}

function physMatFrom(spec) {
  const params = {
    color: spec.color,
    metalness: spec.metalness ?? 0.0,
    roughness: spec.roughness ?? 0.6,
    clearcoat: spec.clearcoat ?? 0.0,
    clearcoatRoughness: spec.clearcoatRoughness ?? 0.3,
    transmission: spec.transmission ?? 0.0,
    ior: spec.ior ?? 1.5,
    // SKIN subsurface approximation: warm light-bleed through thin flesh
    // (thickness + attenuation) + soft diffuse-fresnel sheen. The PT honours
    // these on MeshPhysicalMaterial so 'skin-warm' reads as skin, not clay.
    thickness: spec.thickness ?? 0.0,
    attenuationDistance: spec.attenuationDistance ?? Infinity,
    sheen: spec.sheen ?? 0.0,
    sheenRoughness: spec.sheenRoughness ?? 0.5,
    specularIntensity: spec.specularIntensity ?? 1.0,
  };
  if (spec.attenuationColor != null) params.attenuationColor = new THREE.Color(spec.attenuationColor);
  if (spec.sheenColor != null) params.sheenColor = new THREE.Color(spec.sheenColor);
  return new THREE.MeshPhysicalMaterial(params);
}

// Build a tasteful room shell around a measured build: warm wood floor + two
// neutral plaster walls (back + one side, behind/beside the furniture so the
// camera looks INTO a corner), a soft high ceiling, and a glowing window gap on
// the open side that reads as a real daylight source (emissive panel the PT
// importance-samples). Walls are pushed out beyond the footprint with generous
// height so the space feels architectural, not boxy. Returns the meshes to add.
// `enabled=false` (e.g. product/backdrop layouts) → floor only.
function buildRoomShell(box, center, size, { enabled = true, mode = 'photoreal' } = {}) {
  const meshes = [];
  const clayShell = mode === 'clay' || mode === 'wireframe';
  const footprint = Math.max(size.x, size.z, 0.5);
  const floorY = box.min.y - 0.002;
  // ── floor (kept: warm wood, larger planks) ──
  const span = footprint * 4 + 2;
  const floorGeo = new THREE.PlaneGeometry(span, span);
  // CLAY / WIREFRAME: the shell goes clay too (uniform matte, no wood texture) so
  // the whole frame reads as one sculpt turntable; photoreal keeps the wood floor.
  const floorMat = clayShell ? (mode === 'clay' ? clayMaterial() : wireframeSurfaceMaterial())
    : physMatFrom({ color: 0xb8a888, metalness: 0.0, roughness: 0.7 });
  if (!clayShell) applyProceduralTexture(THREE, floorMat, floorGeo, 'wood-oak', 2.6);
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

// Bake a SkinnedMesh's CURRENT deformed pose into a plain static BufferGeometry
// in WORLD space. The path tracer's BVH baker reads static attribute buffers and
// has no concept of skinning, so for an ANIMATED frame we must evaluate every
// vertex through the live skeleton.
//
// COORDINATE FRAME (subtle — two rig families differ): THREE.SkinnedMesh.
// getVertexPosition → applyBoneTransform returns the deformed vertex in the
// mesh's BIND space (it ends with bindMatrixInverse). For our PROCEDURAL humanoid
// the bones are authored in world space and the mesh sits AT the armature's world
// transform with mesh world-scale ≈ 1, so that bind space IS world space → no
// extra transform needed. But a REAL glTF rig (Soldier/Robot/Xbot) is authored in
// the file's native units (≈ centimetres → an internal ~0.01 node scale) and then
// height-normalised by a parent group, so getVertexPosition returns positions in
// that native, UN-scaled frame (≈ 29× too large here). For those we MUST re-apply
// the mesh's matrixWorld to land in world space; skipping it baked the Soldier at
// ~52 m (building-sized) instead of 1.8 m. We detect the case from the mesh's
// world scale: ≈1 → already world (don't re-transform); far from 1 → apply
// matrixWorld. Normals are recomputed from the deformed positions. Falls back to a
// static clone if the mesh isn't actually skinned.
function bakeSkinnedGeometry(m) {
  if (!m || !m.isSkinnedMesh || !m.geometry || !m.geometry.attributes.position) {
    return m && m.geometry ? m.geometry.clone() : null;
  }
  m.updateWorldMatrix?.(true, false);
  if (m.skeleton && m.skeleton.update) m.skeleton.update();
  const src = m.geometry;
  const idx = src.index;
  const posAttr = src.attributes.position;
  const uvAttr = src.attributes.uv;
  const triCount = idx ? idx.count : posAttr.count;
  const out = new THREE.BufferGeometry();
  const positions = new Float32Array(triCount * 3);
  const uvs = uvAttr ? new Float32Array(triCount * 2) : null;
  const v = new THREE.Vector3();
  // Decide whether getVertexPosition already yields world space. A glTF rig whose
  // mesh carries a non-unit world scale needs matrixWorld re-applied; a unit-scale
  // (procedural) rig is already world (re-applying would double its transform).
  const ws = new THREE.Vector3();
  m.getWorldScale(ws);
  const meshScale = (Math.abs(ws.x) + Math.abs(ws.y) + Math.abs(ws.z)) / 3;
  const needsWorld = Math.abs(meshScale - 1) > 0.02;   // ≈1 → already world
  const mw = m.matrixWorld;
  // Expand indexed → non-indexed so we can write deformed verts directly and let
  // computeVertexNormals derive normals for the pose.
  for (let i = 0; i < triCount; i++) {
    const vi = idx ? idx.getX(i) : i;
    m.getVertexPosition(vi, v);          // deformed vertex in the mesh's bind space
    if (needsWorld) v.applyMatrix4(mw);  // glTF rig: bind space → world space
    positions[i * 3] = v.x; positions[i * 3 + 1] = v.y; positions[i * 3 + 2] = v.z;
    if (uvs) { uvs[i * 2] = uvAttr.getX(vi); uvs[i * 2 + 1] = uvAttr.getY(vi); }
  }
  out.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  if (uvs) out.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  out.computeVertexNormals();
  out.computeBoundingBox();
  return out;
}

// `room`: build the interior room shell (floor + walls + window) around the build.
// `groundless`: scene supplies its OWN ground/floor (e.g. the city's asphalt +
//   streets) → skip the room shell entirely so we don't double a floor on top.
// `mode`: 'photoreal' (default — per-body real PBR), 'clay' (uniform matte clay on
//   every body, lighting/shadows kept), or 'wireframe' (faint shaded clay surface;
//   the edge overlay is drawn later by the raster pass). In clay/wireframe modes
//   the PBR/material synthesis is SKIPPED entirely — every harvested body gets the
//   single override material so the form reads, not the texture.
function harvestScene({ room = true, groundless = false, mode = 'photoreal' } = {}) {
  const rmode = normMode(mode);
  const overrideMat = rmode === 'clay' ? clayMaterial
    : rmode === 'wireframe' ? wireframeSurfaceMaterial
    : null;
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
    // SkinnedMesh (the rigged humanoid): bake the CURRENT animated pose into a
    // world-space static geometry so the path tracer sees the figure mid-stride,
    // not the rest pose. Already in world coords → identity transform below.
    const skinned = !!m.isSkinnedMesh;
    const geo = skinned ? bakeSkinnedGeometry(m) : m.geometry.clone();
    if (!geo) continue;
    let mat;
    if (overrideMat) {
      // CLAY / WIREFRAME: every body gets the SAME uniform override material
      // (skip all PBR synthesis + real-map preservation). Lighting/shadows are
      // unchanged (the HDRI still lights it), so the form reads as a sculpt.
      mat = overrideMat();
      // Even untagged bodies advance the palette counter in photoreal mode; keep
      // pi stable here so a later mode switch wouldn't shift fallback assignment.
    } else if (m.userData && m.userData.archdiscRealMaterial && m.material) {
      // Real downloaded glTF asset (realFurniture loader): the mesh already carries
      // its own MeshStandard/Physical material with the scanned map/normalMap/
      // roughnessMap baked in. Preserve it verbatim (clone so we don't mutate the
      // live scene's material) — DO NOT synthesize a registry material or apply the
      // procedural generator, which would erase the real PBR maps.
      const src = Array.isArray(m.material) ? m.material[0] : m.material;
      mat = src && src.clone ? src.clone() : src;
    } else {
      const tag = m.userData && m.userData.studioMaterial;
      const matId = tag || FALLBACK_PALETTE[pi++ % FALLBACK_PALETTE.length];
      mat = physMatFrom(resolveMaterial(matId));
      applyProceduralTexture(THREE, mat, geo, matId);
    }
    const clone = new THREE.Mesh(geo, mat);
    // Skinned geometry was baked into WORLD space already → leave identity.
    if (!skinned) {
      if (m.matrixWorld) clone.applyMatrix4(m.matrixWorld);
      else { clone.position.copy(m.position); clone.quaternion.copy(m.quaternion); clone.scale.copy(m.scale); }
    }
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
  // `groundless` → the scene is self-grounded (city asphalt/streets) → no shell.
  if (!groundless) for (const m of buildRoomShell(box, center, size, { enabled: room, mode: rmode })) out.add(m);
  return out;
}

const ANGLE_DIRS = {
  hero:    [0.62, 0.42, 0.66],
  front:   [0.02, 0.30, 1.0],
  profile: [1.0, 0.32, 0.10],
  top:     [0.28, 1.1, 0.42],
  // eye-level interior: near-horizontal, low — reads as a real interior photo
  // (not the high "dollhouse" hero view). Paired with a lower look + closer
  // pull-in in frameCamera so furniture sits at human eye height.
  'eye-level': [0.40, 0.06, 0.92],
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
  const isEye = angle === 'eye-level';
  const d = Math.max(vFit, hFit) * (isEye ? 0.60 : 0.84);
  const cam = new THREE.PerspectiveCamera(fovDeg, aspect, Math.max(radius * 0.01, 0.02), radius * 200);
  // Eye slightly above the build's vertical mid, looking at centre; the angle
  // picks the (normalized) view direction, scaled to the fit distance d. For an
  // eye-level interior shot, look LOWER (furniture height) so the camera reads
  // as a person standing in the room rather than hovering above it.
  const look = center.clone(); look.y += radius * (isEye ? -0.14 : 0.12);
  const raw = ANGLE_DIRS[angle] || ANGLE_DIRS.hero;
  const dn = new THREE.Vector3(raw[0], raw[1], raw[2]).normalize();
  cam.position.set(look.x + dn.x * d, look.y + dn.y * d, look.z + dn.z * d);
  cam.lookAt(look);
  cam.updateMatrixWorld(true);
  return cam;
}

// Apply the gentle finishing grade (contrast + radial vignette) in place on a 2D
// context. The renderer already ACES tone-maps + writes sRGB, so we DON'T re-
// tonemap — just an S-curve nudge and a cinematic vignette. Shared by still + seq.
function gradeContext(ctx, w, h, { contrast = 1.06, vignette = 0.24 } = {}) {
  try {
    const img = ctx.getImageData(0, 0, w, h); const d = img.data;
    const cx = w / 2, cy = h / 2, maxd = Math.hypot(cx, cy);
    for (let i = 0; i < d.length; i += 4) {
      const idx = i >> 2, px = idx % w, py = (idx / w) | 0;
      const vig = 1 - vignette * Math.pow(Math.hypot(px - cx, py - cy) / maxd, 2.2);
      for (let c = 0; c < 3; c++) { let v = d[i + c] / 255; v = (v - 0.5) * contrast + 0.5; v *= vig; d[i + c] = Math.max(0, Math.min(255, v * 255)); }
    }
    ctx.putImageData(img, 0, 0);
  } catch (_) {}
}

// Burn a small mode label into the bottom-left of a frame's 2D context. This is
// the ONLY reliable way to label the side-by-side composite columns on machines
// whose ffmpeg lacks drawtext/freetype (the local Homebrew build does) — the
// compositeSideBySide helper then just hstacks the already-labelled columns. A
// dark rounded chip + light text keeps the label legible on any frame content.
function drawLabel(ctx, w, h, text) {
  if (!text) return;
  try {
    const pad = Math.max(10, Math.round(h * 0.014));
    const fontPx = Math.max(16, Math.round(h * 0.030));
    ctx.save();
    ctx.font = `600 ${fontPx}px -apple-system, "Segoe UI", Helvetica, Arial, sans-serif`;
    ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
    const tw = ctx.measureText(text).width;
    const chipH = fontPx + pad, chipW = tw + pad * 2;
    const x = pad, y = h - pad - chipH;
    ctx.globalAlpha = 0.62; ctx.fillStyle = '#0b0d12';
    if (ctx.roundRect) { ctx.beginPath(); ctx.roundRect(x, y, chipW, chipH, Math.round(chipH * 0.22)); ctx.fill(); }
    else ctx.fillRect(x, y, chipW, chipH);
    ctx.globalAlpha = 1.0; ctx.fillStyle = '#f2f3f5';
    ctx.fillText(text, x + pad, y + chipH / 2 + 1);
    ctx.restore();
  } catch (_) { /* labelling is optional */ }
}

// ── WIREFRAME EDGE OVERLAY (raster pass) ─────────────────────────────────────
// The GPU path tracer traces TRIANGLES, not edges — `material.wireframe = true`
// is a rasterizer feature it can't honour. So a true wireframe is produced as a
// second, fast RASTER pass: build EdgesGeometry (crease-angle thresholded so we
// get the topology silhouette, not every internal diagonal) for every harvested
// body, render it as dark LineSegments with the SAME camera onto a transparent
// WebGL canvas, then drawImage that edge layer OVER the path-traced (faint clay)
// surface in the 2D readback context. Raster line rendering reads back reliably
// headless (it's standard rasterization, not the float-target readback that
// returns black) — so this works in the same headless Electron context.
//
// Returns a 2D-drawable source canvas (transparent bg, dark edges) sized w×h, or
// null on any failure (caller then keeps just the shaded clay surface). Reuses a
// throwaway WebGLRenderer with a premultiplied-alpha context so the edges
// composite cleanly. `edgeColor`/`thresholdDeg`/`lineOpacity` tune the look.
function renderWireframeOverlay(scene, camera, w, h, {
  edgeColor = 0x10131a, thresholdDeg = 28, lineOpacity = 0.92,
} = {}) {
  if (typeof document === 'undefined') return null;
  let renderer = null;
  try {
    const lineCanvas = document.createElement('canvas');
    lineCanvas.width = w; lineCanvas.height = h;
    renderer = new THREE.WebGLRenderer({ canvas: lineCanvas, antialias: true, alpha: true, premultipliedAlpha: true });
    renderer.setPixelRatio(1);
    renderer.setSize(w, h, false);
    renderer.setClearColor(0x000000, 0);            // transparent → only edges drawn
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    const edgeScene = new THREE.Scene();
    const lineMat = new THREE.LineBasicMaterial({ color: edgeColor, transparent: true, opacity: lineOpacity });
    let any = false;
    scene.traverse((o) => {
      if (!o.isMesh || !o.geometry) return;
      try {
        const eg = new THREE.EdgesGeometry(o.geometry, thresholdDeg);
        if (!eg.attributes.position || eg.attributes.position.count === 0) { eg.dispose?.(); return; }
        const seg = new THREE.LineSegments(eg, lineMat);
        // The harvested mesh geometry is already in WORLD space (skinned baked /
        // matrix-applied in harvestScene), but copy the mesh's matrix anyway so a
        // body whose transform stayed on the node (not baked) still lines up.
        seg.applyMatrix4(o.matrixWorld);
        edgeScene.add(seg);
        any = true;
      } catch (_) { /* skip un-edge-able geometry */ }
    });
    if (!any) { try { renderer.dispose(); } catch (_) {} return null; }
    renderer.render(edgeScene, camera);
    // Detach the line canvas before disposing the renderer (drawImage source).
    edgeScene.traverse((o) => { if (o.isLineSegments) o.geometry?.dispose?.(); });
    try { lineMat.dispose(); } catch (_) {}
    return lineCanvas;
  } catch (_) {
    return null;
  } finally {
    try { if (renderer) renderer.dispose(); } catch (_) {}
  }
}

// Resolve the env texture for a preset (real Poly Haven HDRI when available, else
// the procedural sky gradient) and bind it onto the scene. `showBackground` keeps
// the equirect sky VISIBLE as the rendered background (the PT samples it as a true
// sky, not a flat clear colour); set false to keep IBL but a neutral backdrop.
// Returns { tex, intensity, isReal } — caller disposes per the isReal flag.
function bindEnvironment(scene, envPresetId, renderer, realHDRI, { showBackground = true, skyEnv = null } = {}) {
  // PRIORITY: a fully-procedural Sky env (THREE.Sky → cube target) when provided —
  // it overrides any real HDRI AND the gradient (this is the "no imported bg" path).
  if (skyEnv && skyEnv.tex) {
    scene.environment = skyEnv.tex;                      // HDR CubeTexture → PT IBL
    scene.background = showBackground ? skyEnv.tex : null; // VISIBLE procedural sky
    const iblI = skyEnv.intensity != null ? skyEnv.intensity : 1.2;
    scene.environmentIntensity = iblI;
    if (showBackground) scene.backgroundIntensity = iblI;
    // Procedural directional "sun" aligned to the Sky's sunPosition → warm rim
    // light on the human + canopy (the cube IBL alone is soft; the key reads form).
    if (skyEnv.sunDir) {
      const sun = new THREE.DirectionalLight(skyEnv.sunColor || 0xfff0d8, 2.6);
      sun.position.copy(skyEnv.sunDir).multiplyScalar(200);
      sun.userData.__proceduralSun = true;
      scene.add(sun);
      scene.add(new THREE.HemisphereLight(0xbcd0ff, 0x3a3326, 0.35)); // sky/ground fill
    }
    return { tex: skyEnv.tex, intensity: iblI, isReal: false, isSky: true };
  }
  const env = buildEnvTexture(envPresetId, renderer);
  if (realHDRI) {
    try { env.tex.dispose?.(); } catch (_) {}      // drop the unused gradient
    env.tex = realHDRI;
    realHDRI.mapping = THREE.EquirectangularReflectionMapping;
  }
  scene.environment = env.tex;
  scene.background = showBackground ? env.tex : null;   // VISIBLE rendered sky
  // Real outdoor sky HDRIs are already physically bright (sun ~20-90 nits in the
  // equirect); multiplying by the procedural preset's 1.6 intensity double-counts
  // and blows the sky/highlights to white. Use ~1.0 for a real HDRI and keep the
  // preset intensity only for the (dimmer) procedural gradient.
  const iblI = realHDRI ? 1.0 : env.intensity;
  scene.environmentIntensity = iblI;                   // IBL brightness (honored by PT)
  if (showBackground) scene.backgroundIntensity = iblI; // sky brightness matches IBL
  env.intensity = iblI;
  env.isReal = !!realHDRI;
  return env;
}

export async function runStudioPathTracedRender({ envPresetId = 'studio', samples = 64, resolutionId = '1080p', angle = 'hero', room = true, groundless = false, showBackground, mode = 'photoreal', label } = {}) {
  const cap = detectWebGL2Compute();
  if (!cap.ok) throw new Error('Studio path tracer: ' + cap.error);
  const rmode = normMode(mode);
  const res = RESOLUTIONS[resolutionId] || RESOLUTIONS['1080p'];
  const wrapper = makeOfflineRenderer();
  const { renderer, canvas } = wrapper;
  renderer.setPixelRatio(1);
  renderer.setSize(res.w, res.h, false);
  canvas.width = res.w; canvas.height = res.h;

  // ── Asset prepass (AWAIT before harvesting/baking) ─────────────────────────
  // The path tracer bakes geometry + material buffers in setScene(); the real
  // texture maps and the real HDRI must therefore be in hand BEFORE harvestScene
  // (which calls applyProceduralTexture → realPbrSetCached) and BEFORE we assign
  // scene.environment. We preload all real PBR sets (11, ~1K each) so any body —
  // whatever registry id it resolves to — gets its scan, plus the real HDRI for
  // this preset. Both fall back gracefully (procedural texture / gradient env).
  const realHDRIPromise = loadRealHDRI(envPresetId);
  await preloadRealPbr([...REAL_PBR_IDS]);
  const realHDRI = await realHDRIPromise;

  const scene = harvestScene({ room, groundless, mode: rmode });
  const camera = frameCamera(scene, res.w / res.h, 38, angle);
  // Stills render the sky/environment as the visible background by default (the
  // prior, unconditional behaviour) — pass showBackground:false to suppress it.
  const showBg = showBackground != null ? showBackground : true;
  const env = bindEnvironment(scene, envPresetId, renderer, realHDRI, { showBackground: showBg });

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
  gradeContext(ctx, res.w, res.h);
  // WIREFRAME: overlay the rasterized edge layer (topology) on the shaded clay
  // surface — the PT can't trace edges, so this is a fast second raster pass.
  if (rmode === 'wireframe') {
    const ov = renderWireframeOverlay(scene, camera, res.w, res.h);
    if (ov) ctx.drawImage(ov, 0, 0, res.w, res.h);
  }
  if (label) drawLabel(ctx, res.w, res.h, label);

  try { pt.dispose?.(); } catch (_) {}
  // Dispose the env texture UNLESS it's the cached real HDRI (kept for reuse
  // across renders; the gradient is single-use and safe to dispose).
  try { if (!env.isReal) env.tex.dispose?.(); } catch (_) {}
  scene.traverse((o) => { if (o.isMesh) { o.geometry?.dispose?.(); (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => m?.dispose?.()); } });
  try { renderer.forceContextLoss?.(); } catch (_) {}
  try { wrapper.dispose(); } catch (_) {}
  _rendererSingleton = null;

  return { canvas: outC, width: res.w, height: res.h, samples: target, mode: rmode };
}

// Build a PhysicalCamera (path-traced thin-lens DOF) from a per-frame camera
// spec: { position:[x,y,z], lookAt:[x,y,z], fov, focusDistance?, fStop? }. When
// focusDistance is omitted it auto-focuses on the lookAt target (so the subject
// is sharp and the city falls into soft bokeh). fStop controls the bokeh size —
// a larger lens (smaller fStop) gives shallower depth for a cinematic separation.
function physicalCameraFrom(spec, aspect) {
  const fov = spec.fov || 38;
  const cam = new PhysicalCamera(fov, aspect, 0.03, 600);
  const pos = spec.position || [0, 1.5, -4];
  const look = spec.lookAt || [0, 1, 0];
  cam.position.set(pos[0], pos[1], pos[2]);
  if (spec.up) cam.up.set(spec.up[0], spec.up[1], spec.up[2]); else cam.up.set(0, 1, 0);
  cam.lookAt(look[0], look[1], look[2]);
  // Auto-focus on the look target unless an explicit focusDistance is given.
  const dx = look[0] - pos[0], dy = look[1] - pos[1], dz = look[2] - pos[2];
  cam.focusDistance = spec.focusDistance != null ? spec.focusDistance : Math.max(0.1, Math.hypot(dx, dy, dz));
  cam.fStop = spec.fStop != null ? spec.fStop : 2.8;   // moderate cinematic DOF
  cam.apertureBlades = spec.apertureBlades != null ? spec.apertureBlades : 6;
  cam.updateProjectionMatrix();
  cam.updateMatrixWorld(true);
  return cam;
}

// ── PATH-TRACED VIDEO SEQUENCE ────────────────────────────────────────────────
// Render a LOCOMOTION (or any animated) sequence through the GPU path tracer,
// frame-by-frame, with the HDRI SKY as a VISIBLE BACKGROUND, ACES/filmic tone-
// mapping, and physical thin-lens DOF (subject sharp, city bokeh). Each frame:
//   1) call poseFrame(i, frameCount) in the LIVE scene — it advances the anim
//      clip / travel and returns a camera spec for that instant,
//   2) re-harvest the live scene (re-baking the SkinnedMesh's deformed pose into
//      world-space static geometry so the figure is captured MID-STRIDE),
//   3) trace `spp` samples and read the frame back to a PNG dataURL.
// The renderer + real HDRI + real-PBR cache are loaded ONCE and reused across all
// frames (the per-frame cost is the harvest + the spp trace).
//
// MEMORY: pass `onFrameData(dataUrl, i, n)` (may be async) to DRAIN each frame to
// disk the instant it finishes — frames are then NOT accumulated, so a long 4K
// sequence stays bounded. Without it, every frame's dataURL is collected into the
// returned `frames` array (fine for a short preview). Returns
// { frames:[dataUrl…]|[], width, height, spp, frameCount }.
//
// spp / frameCount / resolutionId are PARAMETERS so a cheap preview (e.g. 24
// frames @ 32 spp @ 1080p) and a final (e.g. 96 frames @ 160 spp @ 4k) share one
// code path. groundless=true skips the interior room shell (the city is self-
// grounded by its asphalt + streets).
//
// RENDER MODE (TRIPLE-MODE): `mode` selects how the SAME scene+animation+camera is
// rendered — 'photoreal' (real PBR + HDRI + ACES, the default / final look),
// 'clay' (uniform matte clay material on every body, lighting kept → a lit sculpt
// turntable), or 'wireframe' (faint shaded clay + a rasterized edge overlay drawn
// over the path-traced surface — the path tracer can't trace edges, so a fast
// raster EdgesGeometry pass on the SAME camera supplies the topology). Because the
// camera spec comes from poseFrame(i,n) — a pure function of the frame index — the
// three modes, run separately, produce FRAME-SYNCHRONISED sequences (same camera +
// same animation instant per frame), which compositeSideBySide() then stacks into
// one lockstep video. `label` (e.g. 'Clay') is burned into each frame's corner so
// the composite columns are titled even where ffmpeg lacks drawtext.
export async function runStudioPathTracedSequence({
  poseFrame,
  frameCount = 24,
  spp = 32,
  resolutionId = '1080p',
  envPresetId = 'daylight',
  groundless = true,
  showBackground = true,
  fStop = 2.8,
  mode = 'photoreal',
  proceduralSky = false,
  label,
  onFrame,
  onFrameData,
} = {}) {
  if (typeof poseFrame !== 'function') throw new Error('runStudioPathTracedSequence: poseFrame(i,n) required');
  const cap = detectWebGL2Compute();
  if (!cap.ok) throw new Error('Studio path tracer: ' + cap.error);
  const rmode = normMode(mode);
  const res = RESOLUTIONS[resolutionId] || RESOLUTIONS['1080p'];
  const n = Math.max(1, Math.min(600, frameCount | 0));
  const samplesPerFrame = Math.max(1, Math.min(512, spp | 0));

  const wrapper = makeOfflineRenderer();
  const { renderer, canvas } = wrapper;
  renderer.setPixelRatio(1);
  renderer.setSize(res.w, res.h, false);
  canvas.width = res.w; canvas.height = res.h;

  // Load real assets ONCE (all real PBR scans) — reused every frame.
  // proceduralSky=true → build a THREE.Sky cube env ONCE and SKIP the imported
  // HDRI entirely (no .hdr/.exr load for sky or environment). Else fall back to the
  // real Poly Haven sky HDRI for the preset (legacy behaviour).
  const realHDRIPromise = proceduralSky ? Promise.resolve(null) : loadRealHDRI(envPresetId);
  await preloadRealPbr([...REAL_PBR_IDS]);
  const realHDRI = await realHDRIPromise;
  const skyEnv = proceduralSky ? buildProceduralSkyEnv(envPresetId, renderer) : null;
  if (proceduralSky && (!skyEnv || !skyEnv.tex)) {
    throw new Error('runStudioPathTracedSequence: procedural sky build failed (no fallback to imported bg allowed)');
  }

  const outC = document.createElement('canvas');
  outC.width = res.w; outC.height = res.h;
  const ctx = outC.getContext('2d');
  const frames = [];
  const aspect = res.w / res.h;

  for (let i = 0; i < n; i++) {
    // 1) advance the live anim/travel for frame i; caller returns the camera spec.
    const camSpec = (await poseFrame(i, n)) || {};
    // 2) harvest the LIVE scene at this instant (bakes the deformed humanoid).
    //    `rmode` swaps every body's material for clay/wireframe (lighting kept).
    const scene = harvestScene({ room: false, groundless, mode: rmode });
    const env = bindEnvironment(scene, envPresetId, renderer, realHDRI, { showBackground, skyEnv });
    const camera = physicalCameraFrom({ fStop, ...camSpec }, aspect);

    const pt = new WebGLPathTracer(renderer);
    pt.tiles.set(3, 3);
    pt.minSamples = 1;
    pt.renderToCanvas = false;
    pt.filterGlossyFactor = 0.5;
    pt.setScene(scene, camera);

    let s = 0;
    while (s < samplesPerFrame) {
      pt.renderSample(); s += 1;
      if (s % 8 === 0) await new Promise((r) => requestAnimationFrame(r));
    }
    pt.renderToCanvas = true;
    pt.renderSample();
    ctx.clearRect(0, 0, res.w, res.h);
    ctx.drawImage(canvas, 0, 0, res.w, res.h);
    gradeContext(ctx, res.w, res.h);
    // WIREFRAME: draw the rasterized edge layer over the shaded clay surface
    // (same camera) → "raw but realistic". Photoreal/clay skip this.
    if (rmode === 'wireframe') {
      const ov = renderWireframeOverlay(scene, camera, res.w, res.h);
      if (ov) ctx.drawImage(ov, 0, 0, res.w, res.h);
    }
    if (label) drawLabel(ctx, res.w, res.h, label);
    const dataUrl = outC.toDataURL('image/png');
    // Drain immediately if a sink is provided (bounded memory); else accumulate.
    if (typeof onFrameData === 'function') { try { await onFrameData(dataUrl, i, n); } catch (_) {} }
    else frames.push(dataUrl);

    // Per-frame teardown — dispose the harvested geometry + the gradient env (the
    // real HDRI is cached for reuse). Keep the renderer + outC alive across frames.
    try { pt.dispose?.(); } catch (_) {}
    // Dispose the per-frame gradient env, but NEVER the shared sky cube (reused) or
    // the cached real HDRI.
    try { if (!env.isReal && !env.isSky) env.tex.dispose?.(); } catch (_) {}
    scene.traverse((o) => { if (o.isMesh) { o.geometry?.dispose?.(); (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => m?.dispose?.()); } });
    if (typeof onFrame === 'function') { try { onFrame(i, n); } catch (_) {} }
  }

  // Dispose the shared procedural-sky cube render target after all frames.
  try { if (skyEnv && skyEnv.tex && skyEnv.tex.userData && skyEnv.tex.userData.__skyRT) skyEnv.tex.userData.__skyRT.dispose(); } catch (_) {}
  try { renderer.forceContextLoss?.(); } catch (_) {}
  try { wrapper.dispose(); } catch (_) {}
  _rendererSingleton = null;
  return { frames, width: res.w, height: res.h, spp: samplesPerFrame, frameCount: n, mode: rmode };
}

// ── SIDE-BY-SIDE COMPOSITE (ffmpeg) ──────────────────────────────────────────
// Build the ffmpeg argv that stitches N synchronised frame sequences (the SAME
// camera + animation frame per column — e.g. photoreal | clay | wireframe) into
// ONE unified video: each column's PNGs become an input stream, the streams are
// HSTACKed (2-3 columns) or XSTACKed into a grid (4+), and the result is encoded
// to mp4. Because every sequence was rendered from the same poseFrame(i,n), column
// k frame i shows the identical instant → the columns play in LOCKSTEP.
//
// LABELS: ffmpeg's drawtext filter needs libfreetype, which many builds (incl. the
// local Homebrew ffmpeg) DON'T ship — so labels are NOT burned by this helper.
// Instead, render each sequence with its `label` option (runStudioPathTracedSequence
// burns 'Photoreal'/'Clay'/'Wireframe' into the corner of every frame) and this
// helper just stacks them. `labels` is still accepted for API symmetry / docs and
// is recorded on the returned descriptor; when `drawtext:true` is passed AND the
// caller knows their ffmpeg has freetype, a drawtext filter chain is emitted too.
//
// This returns the COMMAND DESCRIPTOR { bin, args, filter, layout, out, inputs }
// — it does NOT spawn ffmpeg (the caller, e.g. the demo spec, runs execFileSync so
// it controls cwd / stdio / error handling). Pattern matches the existing demo
// encode calls. `seqDirs` are the per-mode frame directories; each must contain
// frame-%04d.png (the demo's naming). `fps`, `crf`, `pattern`, `gap`, `bg` tune it.
export function buildSideBySideCommand(seqDirs, labels = [], out, {
  fps = 24, crf = 17, pattern = 'frame-%04d.png', bin = 'ffmpeg',
  drawtext = false, gap = 0, bg = 'black', columns = 0,
} = {}) {
  if (!Array.isArray(seqDirs) || seqDirs.length < 2) throw new Error('compositeSideBySide: need ≥2 seqDirs');
  if (!out) throw new Error('compositeSideBySide: out path required');
  const N = seqDirs.length;
  const sep = (typeof require !== 'undefined') ? '/' : '/';
  const join = (d) => (d.endsWith('/') ? d + pattern : d + sep + pattern);

  // One -framerate/-i input per column.
  const args = ['-y'];
  for (const d of seqDirs) args.push('-framerate', String(fps), '-i', join(d));

  // Each input needs even dimensions (yuv420p) AND a consistent label tag; chain
  // a per-input scale to even + optional drawtext, producing [v0]..[vN-1].
  const parts = [];
  const tags = [];
  for (let i = 0; i < N; i++) {
    let chain = `[${i}:v]scale=trunc(iw/2)*2:trunc(ih/2)*2`;
    // Optional drawtext label (ONLY when the caller's ffmpeg has freetype).
    if (drawtext && labels[i]) {
      const txt = String(labels[i]).replace(/[\\:']/g, (c) => '\\' + c);
      chain += `,drawtext=text='${txt}':fontcolor=white:fontsize=h/24:box=1:boxcolor=black@0.5:boxborderw=10:x=20:y=h-th-20`;
    }
    const tag = `v${i}`;
    parts.push(`${chain}[${tag}]`);
    tags.push(`[${tag}]`);
  }

  // Layout: 2-3 columns → hstack (one row); 4+ → xstack grid (ceil(sqrt) cols).
  let layout;
  let stack;
  const cols = columns > 0 ? columns : (N <= 3 ? N : Math.ceil(Math.sqrt(N)));
  if (cols >= N) {
    // single row
    stack = `${tags.join('')}hstack=inputs=${N}[stacked]`;
    layout = `hstack(${N})`;
  } else {
    // grid via xstack: build the layout cell coords (col*w_, row*h_ as expressions).
    const rows = Math.ceil(N / cols);
    const cells = [];
    for (let i = 0; i < N; i++) {
      const c = i % cols, r = (i / cols) | 0;
      const x = c === 0 ? '0' : Array.from({ length: c }, (_, k) => `w${k}`).join('+');
      const y = r === 0 ? '0' : Array.from({ length: r }, (_, k) => `h${k * cols}`).join('+');
      cells.push(`${x}_${y}`);
    }
    stack = `${tags.join('')}xstack=inputs=${N}:layout=${cells.join('|')}:fill=${bg}[stacked]`;
    layout = `xstack(${cols}x${rows})`;
  }
  const filter = parts.concat(stack).join(';');

  args.push('-filter_complex', filter,
    '-map', '[stacked]',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', String(crf), out);

  return { bin, args, filter, layout, out, inputs: seqDirs.slice(), fps, columns: cols, labels: labels.slice() };
}

// Run buildSideBySideCommand via the host's ffmpeg (Node only — uses child_process
// + fs at call time so the browser bundle never imports them). Returns
// { ok, out, sizeKB, command }. Throws only on a programming error (bad args);
// an ffmpeg failure resolves with ok:false + the captured message.
export async function compositeSideBySide(seqDirs, labels = [], out, opts = {}) {
  const command = buildSideBySideCommand(seqDirs, labels, out, opts);
  // Defer the Node imports so this module stays bundleable for the browser.
  const cp = await import('child_process');
  const fs = await import('fs');
  try {
    cp.execFileSync(command.bin, command.args, { stdio: opts.stdio || 'ignore' });
    const ok = fs.existsSync(out) && fs.statSync(out).size > 0;
    return { ok, out, sizeKB: ok ? Math.round(fs.statSync(out).size / 1024) : 0, command };
  } catch (e) {
    return { ok: false, out, sizeKB: 0, error: String(e && e.message ? e.message : e), command };
  }
}

export function installStudioPathTracer() {
  if (typeof window === 'undefined') return;
  window.__studioRunPathTracedRender = async (opts = {}) => {
    const { canvas, width, height, samples, mode } = await runStudioPathTracedRender(opts);
    return { dataUrl: canvas.toDataURL('image/png'), width, height, samples, mode };
  };
  // Path-traced VIDEO: render an animated sequence (sky background + 4K PBR +
  // baked-skinned humanoid + DOF) frame-by-frame. The caller supplies poseFrame
  // (advance the rig/travel + return the camera spec for each frame) and an
  // optional mode ('photoreal'|'clay'|'wireframe') + label. Returns
  // { frames:[dataUrl…], width, height, spp, frameCount, mode } for the spec to stitch.
  window.__studioRunPathTracedSequence = async (opts = {}) => runStudioPathTracedSequence(opts);
  // The available render modes + their display labels (for the demo / UI to drive
  // the triple-mode + side-by-side flow).
  window.__studioRenderModes = RENDER_MODES.slice();
  window.__studioRenderModeLabels = { ...RENDER_MODE_LABELS };
  // Build the ffmpeg side-by-side command DESCRIPTOR in the page context (pure
  // string-building, no child_process) — the demo spec runs it via Node ffmpeg, or
  // calls the Node-side compositeSideBySide() helper directly. Exposed so a manual
  // run can inspect the exact filter graph that will be used.
  window.__studioBuildSideBySideCommand = (seqDirs, labels, out, opts) => buildSideBySideCommand(seqDirs, labels, out, opts);
}
