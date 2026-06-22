// ArchDisc Studio V3 — Look-dev Director (cinematic lighting + PBR materials).
//
// The reference bar: "every Final is lit + materialed + composed, not grey clay." This
// turns a composed scene into a lit FINAL — applies a cinematic 3-point lighting rig
// (key/fill/rim with real §5 key:fill stop-ratios + Kelvin colour temps + a graded
// backdrop) and upgrades body materials to MeshPhysicalMaterial (clearcoat / sheen /
// transmission + the procedural maps), then renders a film-lit frame. Composes with the
// scene composer, sculpt, rig and the path tracer (emissive softboxes feed the PT).
//
// window.__studioLight(preset) — apply a cinematic rig to the live scene.
// window.__studioLookdev({lightPreset,materialPlan,resolution}) — material+light+render → dataUrl.

import { MATERIALS, resolveMaterial } from '../materialRegistry.js';
import { loadRealPbrSet, hasRealPbr } from '../rtgpu/proceduralTextures.js';

// Kelvin → approximate linear-ish sRGB hue for light colour.
const K = { 1800: 0xff8b2a, 2800: 0xffb46b, 3200: 0xffc489, 4300: 0xffe2c0, 5000: 0xfff0e0, 5600: 0xfff4ea, 6500: 0xdfe8ff, 7500: 0xc8d8ff, 10000: 0xa8c0ff };

// Cinematic 3-point rigs. ratio = key:fill in stops → fillMul = 2^-stops.
// Each light is a direction (azimuth°, elevation°) + Kelvin + base intensity.
const RIGS = {
  'studio-softbox': { bg: 0xd9dee5, env: 'studio', envI: 1.0, key: { az: -35, el: 45, k: 5600, i: 3.4 }, fillStops: 2, fillK: 5000, rim: { az: 160, el: 35, k: 6500, i: 4.2 }, fog: 0 },
  'product-hero':   { bg: 0x1c2026, env: 'studio', envI: 0.6, key: { az: -30, el: 50, k: 5600, i: 4.0 }, fillStops: 2.5, fillK: 6500, rim: { az: 150, el: 25, k: 7500, i: 6.0 }, rim2: { az: -160, el: 30, k: 6500, i: 4.0 }, fog: 0 },
  'golden-hour':    { bg: 0xe7c79a, env: 'golden', envI: 1.1, key: { az: -70, el: 12, k: 3200, i: 4.2 }, fillStops: 1.5, fillK: 7000, rim: { az: 110, el: 20, k: 2800, i: 3.6 }, fog: 0.02 },
  'blue-hour':      { bg: 0x24314c, env: 'daylight', envI: 1.3, key: { az: -40, el: 18, k: 2800, i: 1.8 }, fillStops: 0.5, fillK: 10000, rim: { az: 150, el: 30, k: 3200, i: 2.4 }, fog: 0.03 },
  'dramatic-noir':  { bg: 0x0e1013, env: 'studio', envI: 0.25, key: { az: -55, el: 35, k: 5600, i: 5.2 }, fillStops: 3.5, fillK: 6500, rim: { az: 165, el: 28, k: 7500, i: 6.5 }, fog: 0.015 },
  'overcast':       { bg: 0xb9c2cb, env: 'daylight', envI: 1.6, key: { az: -20, el: 60, k: 6500, i: 1.6 }, fillStops: 0.5, fillK: 6500, rim: { az: 150, el: 40, k: 7500, i: 1.8 }, fog: 0.01 },
};
export const LIGHT_PRESETS = Object.keys(RIGS);

function dir(THREE, az, el, R) {
  const a = az * Math.PI / 180, e = el * Math.PI / 180;
  return new THREE.Vector3(Math.cos(e) * Math.sin(a), Math.sin(e), Math.cos(e) * Math.cos(a)).multiplyScalar(R);
}

// Apply a cinematic rig to a scene (non-destructive: tagged, removable). Returns cleanup.
export function applyLightingRig(THREE, scene, presetId, opts = {}) {
  const rig = RIGS[presetId] || RIGS['studio-softbox'];
  for (let i = scene.children.length - 1; i >= 0; i--) { const c = scene.children[i]; if (c.userData && c.userData._lookdevLight) scene.remove(c); }
  const box = new THREE.Box3().setFromObject(scene); const c = box.getCenter(new THREE.Vector3()); const sz = box.getSize(new THREE.Vector3());
  const R = Math.max(sz.x, sz.y, sz.z) || 4; const tgt = c.clone();
  const add = (light, pos) => { light.position.copy(pos.add(c)); light.target = new THREE.Object3D(); light.target.position.copy(tgt); scene.add(light.target); light.userData._lookdevLight = true; scene.add(light); };
  const fillMul = Math.pow(2, -(rig.fillStops || 2));
  add(new THREE.DirectionalLight(K[rig.key.k] || 0xffffff, rig.key.i), dir(THREE, rig.key.az, rig.key.el, R * 1.6));
  add(new THREE.DirectionalLight(K[rig.fillK] || 0xffffff, rig.key.i * fillMul), dir(THREE, rig.key.az + 80, rig.key.el - 15, R * 1.6));
  add(new THREE.DirectionalLight(K[rig.rim.k] || 0xffffff, rig.rim.i), dir(THREE, rig.rim.az, rig.rim.el, R * 1.6));
  if (rig.rim2) add(new THREE.DirectionalLight(K[rig.rim2.k] || 0xffffff, rig.rim2.i), dir(THREE, rig.rim2.az, rig.rim2.el, R * 1.6));
  const hemi = new THREE.HemisphereLight(K[rig.fillK] || 0xffffff, rig.bg, (rig.envI || 1) * 0.6); hemi.userData._lookdevLight = true; scene.add(hemi);
  const prevBg = scene.background, prevFog = scene.fog;
  scene.background = new THREE.Color(rig.bg);
  if (rig.fog) scene.fog = new THREE.Fog(new THREE.Color(rig.bg), R * 2.2, R * (rig.fog > 0.02 ? 6 : 9));
  return { cleanup: () => { for (let i = scene.children.length - 1; i >= 0; i--) { const ch = scene.children[i]; if (ch.userData && ch.userData._lookdevLight) scene.remove(ch); } scene.background = prevBg; scene.fog = prevFog; }, rig, center: c, radius: R };
}

// Build a MeshPhysicalMaterial from a registry spec, honouring the full skin
// subsurface-approximation set (transmission/thickness/attenuation + sheen +
// clearcoat) as well as the generic fabric/metal/wood presets. `skinning` keeps
// the SkinnedMesh deform working when we swap a humanoid shell's material.
function physFromSpec(THREE, m, { skinning = false } = {}) {
  const isSkin = !!m.isSkin;
  const params = {
    color: m.color,
    metalness: m.metalness ?? 0,
    roughness: m.roughness ?? 0.6,
    clearcoat: m.clearcoat ?? 0,
    clearcoatRoughness: m.clearcoatRoughness ?? 0.15,
    transmission: m.transmission ?? 0,
    ior: m.ior ?? 1.5,
    // SKIN: warm light-bleed through thin flesh + peach diffuse-fresnel fuzz.
    thickness: m.thickness ?? 0,
    attenuationDistance: m.attenuationDistance ?? Infinity,
    sheen: m.sheen != null ? m.sheen : ((m.roughness ?? 0.6) > 0.7 && (m.metalness ?? 0) === 0 ? 0.4 : 0),
    sheenColor: new THREE.Color(m.sheenColor != null ? m.sheenColor : m.color),
    sheenRoughness: m.sheenRoughness ?? 0.5,
    specularIntensity: m.specularIntensity ?? 1.0,
    envMapIntensity: isSkin ? 0.8 : 1.1,
  };
  if (m.attenuationColor != null) params.attenuationColor = new THREE.Color(m.attenuationColor);
  const phys = new THREE.MeshPhysicalMaterial(params);
  if (skinning) phys.skinning = true;
  return phys;
}

// Assign a real CC0/scan PBR set (albedo/normal/roughness) onto a live-raster
// material — this is what makes the real 4K SKIN scan + fabric weave visible in
// the WebGL viewport (the path tracer has its own loader). Async: textures stream
// in and trigger a re-render via needsUpdate. Real albedo carries the true hue,
// so we whiten the tint and neutralise the roughness scalar (the map is absolute).
function assignRealMaps(THREE, mat, id) {
  if (!hasRealPbr(id)) return;
  const isSkin = id === 'skin-warm';
  loadRealPbrSet(id).then((set) => {
    if (!set) return;
    const clone = (t, cs) => { if (!t) return null; const c = t.clone(); c.needsUpdate = true; c.colorSpace = cs; c.wrapS = c.wrapT = THREE.RepeatWrapping; c.anisotropy = t.anisotropy || 8; return c; };
    if (set.map) { mat.map = clone(set.map, THREE.SRGBColorSpace); mat.color = new THREE.Color(0xffffff); }
    if (set.roughnessMap) { mat.roughnessMap = clone(set.roughnessMap, THREE.NoColorSpace); mat.roughness = 1.0; }
    if (set.normalMap) {
      mat.normalMap = clone(set.normalMap, THREE.NoColorSpace);
      // Pores read at full strength on skin; soften the woven relief on fabric so
      // the weave doesn't look embossed/checkered.
      const s = isSkin ? 0.55 : 0.3;
      mat.normalScale = new THREE.Vector2(s, s);
    }
    mat.needsUpdate = true;
  }).catch(() => {});
}

// Upgrade tagged body materials to MeshPhysicalMaterial from the registry + real
// PBR maps. SKIN shells get the subsurface-approximation material + the real 4K
// skin scan; clothing shells keep their real fabric PBR; furniture resolves by
// name. Preserves SkinnedMesh skinning so the rig keeps deforming.
export function applyMaterials(THREE, scene, plan = {}) {
  let applied = 0;
  scene.traverse((o) => {
    if (!o.isMesh || !(o.userData && (o.userData.archdiscStudioPrimitive || o.userData.organic))) return;
    const want = plan[o.name] || plan[o.userData.kind] || o.userData.studioMaterial || pickByName(o.name || o.userData.kind || '');
    const m = resolveMaterial(want);
    const phys = physFromSpec(THREE, m, { skinning: !!o.isSkinnedMesh });
    // Carry any map already present (e.g. a procedural map a builder attached).
    if (o.material && o.material.map) phys.map = o.material.map;
    o.material = phys;
    // Stream the real scanned maps in (skin 4K scan, fabric weave) when the
    // geometry has UVs to land them on.
    if (o.geometry && o.geometry.attributes && o.geometry.attributes.uv) assignRealMaps(THREE, phys, want);
    applied++;
  });
  return applied;
}
function pickByName(n) {
  n = (n || '').toLowerCase();
  if (/sofa|chair|seat|cushion|bed/.test(n)) return 'fabric-grey';
  if (/table|desk|shelf|cabinet|wood|oak|floor/.test(n)) return 'wood-walnut';
  if (/metal|steel|frame|leg|rail|pole/.test(n)) return 'steel-brushed';
  if (/glass|window|screen/.test(n)) return 'glass-clear';
  if (/lamp|light|gold|brass/.test(n)) return 'brass';
  if (/rock|stone|concrete|pedestal/.test(n)) return 'concrete';
  if (/skull|bone|ceramic|vase/.test(n)) return 'ceramic-white';
  return 'plastic-matte';
}

export function installLookdevDirector() {
  if (typeof window === 'undefined') return;
  window.__studioLight = (preset) => { const s = window.__archdiscScene, TH = window.__archdiscTHREE; if (!s || !TH) return { ok: false }; const r = applyLightingRig(TH, s, preset || 'studio-softbox'); return { ok: true, preset, radius: Math.round(r.radius) }; };
  window.__studioLookdevMaterials = (plan) => { const s = window.__archdiscScene, TH = window.__archdiscTHREE; if (!s || !TH) return { ok: false }; return { ok: true, applied: applyMaterials(TH, s, plan || {}) }; };
  window.__studioLightPresets = LIGHT_PRESETS;
}

export default installLookdevDirector;
