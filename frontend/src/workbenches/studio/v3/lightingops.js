// ArchDisc Studio V3 — lighting / shading / environment / material ops.
//
// V3-native ports of V2 sun angle (slice 207), HDRI environment (slice
// 291), shading mode (slice 247), smart material (slice 274), and
// material graph evaluation (slice 195).

import * as THREE from 'three';

function vp() { return window.__archdiscViewport || null; }
function scene() { return window.__archdiscScene || (vp() && vp().scene) || null; }
function activeMesh() {
  const v = vp();
  return (v && v.getSelected && v.getSelected()) || null;
}

// ─── Sun angle (V2 slice 207) ────────────────────────────────────────────
// Drive the viewport keyLight by azimuth + elevation (degrees).
// Slice 510 — Ambient + key intensities exposed so the inspector can
// drive them with sliders.
function setAmbientIntensity(v) {
  const ctx = vp(); if (!ctx) return { ok: false, error: 'no viewport' };
  const amb = ctx.ambient || ctx.ambientLight;
  if (!amb) return { ok: false, error: 'no ambient' };
  amb.intensity = Math.max(0, Math.min(5, Number(v) || 0));
  return { ok: true, intensity: amb.intensity };
}
function getAmbientIntensity() {
  const ctx = vp(); if (!ctx) return 0;
  const amb = ctx.ambient || ctx.ambientLight;
  return amb ? amb.intensity : 0;
}
function setKeyIntensity(v) {
  const ctx = vp(); if (!ctx || !ctx.keyLight) return { ok: false, error: 'no key light' };
  ctx.keyLight.intensity = Math.max(0, Math.min(8, Number(v) || 0));
  return { ok: true, intensity: ctx.keyLight.intensity };
}
function getKeyIntensity() {
  const ctx = vp(); if (!ctx || !ctx.keyLight) return 0;
  return ctx.keyLight.intensity;
}

function setSunAngle(azDeg, elDeg) {
  const v = vp(); if (!v) return { ok: false, error: 'no viewport' };
  const key = v.keyLight; if (!key) return { ok: false, error: 'no key light' };
  if (typeof azDeg !== 'number' || typeof elDeg !== 'number') return { ok: false, error: 'bad angles' };
  const az = azDeg * Math.PI / 180;
  const el = elDeg * Math.PI / 180;
  const r = 5;
  key.position.set(
    r * Math.cos(el) * Math.sin(az),
    r * Math.sin(el),
    r * Math.cos(el) * Math.cos(az),
  );
  key.updateMatrixWorld(true);
  return { ok: true, azDeg, elDeg, position: [key.position.x, key.position.y, key.position.z] };
}

// ─── HDRI environment (V2 slice 291) ─────────────────────────────────────
// V2 wired this to PMREM-baked equirect textures keyed by preset name.
// V3 here switches the scene.environment + scene.background to a procedural
// gradient sky per preset so the API roundtrips without external assets.
// Real PMREM-baked HDR sky lands in a follow-up slice; preset list mirrors
// V2's so callers don't break.
const HDRI_PRESETS = ['off', 'studio', 'sunset', 'neutral'];

function makeProceduralEnv(preset) {
  // 4×1 ramp encoded into a DataTexture acts as a low-frequency sky.
  // Distinct colour profile per preset so the user sees the change.
  let stops;
  if (preset === 'studio')      stops = [[40, 40, 50], [180, 180, 200], [220, 215, 200], [255, 250, 240]];
  else if (preset === 'sunset') stops = [[25, 15, 30], [120, 60, 80], [220, 130, 100], [255, 200, 150]];
  else if (preset === 'neutral')stops = [[60, 60, 65], [120, 120, 125], [180, 180, 185], [220, 220, 225]];
  else                          stops = [[0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0]];
  const data = new Uint8Array(stops.length * 4);
  for (let i = 0; i < stops.length; i++) {
    data[i * 4]     = stops[i][0];
    data[i * 4 + 1] = stops[i][1];
    data[i * 4 + 2] = stops[i][2];
    data[i * 4 + 3] = 255;
  }
  const tex = new THREE.DataTexture(data, stops.length, 1, THREE.RGBAFormat);
  tex.needsUpdate = true;
  tex.mapping = THREE.EquirectangularReflectionMapping;
  return tex;
}
function setHDRIEnvironment(preset) {
  if (!HDRI_PRESETS.includes(preset)) return { ok: false, error: 'unknown preset', valid: HDRI_PRESETS };
  const s = scene(); if (!s) return { ok: false, error: 'no scene' };
  if (preset === 'off') {
    if (s.environment) { s.environment.dispose && s.environment.dispose(); }
    s.environment = null;
    s.background = null;
    return { ok: true, preset: 'off' };
  }
  const tex = makeProceduralEnv(preset);
  if (s.environment && s.environment.dispose) s.environment.dispose();
  s.environment = tex;
  // Background kept as the renderer clear-colour by default; users can
  // opt-in via scene.background = tex later.
  return { ok: true, preset };
}
function listHDRIPresets() { return { ok: true, presets: HDRI_PRESETS.slice() }; }

// ─── Shading mode (V2 slice 247) ─────────────────────────────────────────
// 'wire' | 'solid' | 'material' | 'rendered'. Implementation: toggles
// material.wireframe + flat/smooth shading per mesh as a quick-glance
// stand-in for V2's full shader pipeline.
const SHADING_MODES = ['wire', 'solid', 'material', 'rendered'];
let _currentShading = 'material';
function setShadingMode(mode) {
  if (!SHADING_MODES.includes(mode)) return { ok: false, error: 'unknown mode', valid: SHADING_MODES };
  const s = scene(); if (!s) return { ok: false, error: 'no scene' };
  _currentShading = mode;
  s.traverse((o) => {
    if (!o.userData || !o.userData.archdiscStudioPrimitive) return;
    if (!o.material) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    for (const mat of mats) {
      mat.wireframe = (mode === 'wire');
      if ('flatShading' in mat) mat.flatShading = (mode === 'solid');
      mat.needsUpdate = true;
    }
  });
  return { ok: true, mode };
}
function getShadingMode() { return _currentShading; }

// ─── Smart material (V2 slice 274) ───────────────────────────────────────
// Apply a named preset (basic / metal / glass / matte / wood) to the
// active mesh. Each preset is a small Standard-material parameter pack.
const SMART_MATERIAL_PRESETS = {
  basic:  { color: 0x9aa6b2, metalness: 0.05, roughness: 0.65 },
  metal:  { color: 0xb0b8c0, metalness: 0.95, roughness: 0.25 },
  glass:  { color: 0xc8d8e0, metalness: 0.0,  roughness: 0.05, transmission: 0.95, transparent: true, opacity: 0.35 },
  matte:  { color: 0x6a6a72, metalness: 0.0,  roughness: 0.95 },
  wood:   { color: 0x8a5a3c, metalness: 0.0,  roughness: 0.78 },
  copper: { color: 0xc97a52, metalness: 0.95, roughness: 0.30 },
};
function applySmartMaterial(name) {
  const m = activeMesh(); if (!m) return { ok: false, error: 'no mesh' };
  const preset = SMART_MATERIAL_PRESETS[name];
  if (!preset) return { ok: false, error: 'unknown preset', valid: Object.keys(SMART_MATERIAL_PRESETS) };
  if (window.__studioPushUndo) window.__studioPushUndo();
  if (m.material && m.material.dispose) m.material.dispose();
  m.material = preset.transmission != null
    ? new THREE.MeshPhysicalMaterial(preset)
    : new THREE.MeshStandardMaterial(preset);
  return { ok: true, name, materialType: m.material.type };
}
function listSmartMaterials() { return { ok: true, presets: Object.keys(SMART_MATERIAL_PRESETS) }; }

// ─── Material-graph evaluation (V2 slice 195) ────────────────────────────
// Minimal node-graph evaluator. Nodes:
//   { id, type: 'color' | 'multiply' | 'lerp', params, inputs: { a, b, t } }
// evalNodeGraph(graph, outputId) returns the colour at outputId.
function evalNode(node, graph, memo) {
  if (memo.has(node.id)) return memo.get(node.id);
  let v;
  if (node.type === 'color') v = node.params.value || [1, 1, 1];
  else if (node.type === 'multiply') {
    const a = evalNode(graph.find((n) => n.id === node.inputs.a), graph, memo);
    const b = evalNode(graph.find((n) => n.id === node.inputs.b), graph, memo);
    v = [a[0] * b[0], a[1] * b[1], a[2] * b[2]];
  } else if (node.type === 'lerp') {
    const a = evalNode(graph.find((n) => n.id === node.inputs.a), graph, memo);
    const b = evalNode(graph.find((n) => n.id === node.inputs.b), graph, memo);
    const t = node.params.t == null ? 0.5 : node.params.t;
    v = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  } else v = [0, 0, 0];
  memo.set(node.id, v);
  return v;
}
function evalNodeGraph(graph, outputId) {
  if (!Array.isArray(graph) || !graph.length) return { ok: false, error: 'empty graph' };
  const out = graph.find((n) => n.id === outputId);
  if (!out) return { ok: false, error: 'no output node' };
  try {
    const v = evalNode(out, graph, new Map());
    return { ok: true, output: v };
  } catch (err) { return { ok: false, error: String(err) }; }
}
function applyMaterialGraph(graph, outputId) {
  const m = activeMesh(); if (!m) return { ok: false, error: 'no mesh' };
  const r = evalNodeGraph(graph, outputId);
  if (!r.ok) return r;
  if (window.__studioPushUndo) window.__studioPushUndo();
  if (m.material && m.material.dispose) m.material.dispose();
  const col = new THREE.Color(r.output[0], r.output[1], r.output[2]);
  m.material = new THREE.MeshStandardMaterial({ color: col, metalness: 0.1, roughness: 0.6 });
  return { ok: true, color: [col.r, col.g, col.b] };
}

// ─── Registration ────────────────────────────────────────────────────────
export function registerLightingOps() {
  window.__studioSetSunAngle         = setSunAngle;
  window.__studioSetAmbientIntensity = setAmbientIntensity;
  window.__studioGetAmbientIntensity = getAmbientIntensity;
  window.__studioSetKeyIntensity     = setKeyIntensity;
  window.__studioGetKeyIntensity     = getKeyIntensity;
  window.__studioSetHDRIEnvironment  = setHDRIEnvironment;
  window.__studioListHDRIPresets     = listHDRIPresets;
  window.__studioSetShadingMode      = setShadingMode;
  window.__studioGetShadingMode      = getShadingMode;
  window.__studioApplySmartMaterial  = applySmartMaterial;
  window.__studioListSmartMaterials  = listSmartMaterials;
  window.__studioEvalNodeGraph       = evalNodeGraph;
  window.__studioApplyMaterialGraph  = applyMaterialGraph;
}
export function unregisterLightingOps() {
  for (const k of [
    '__studioSetSunAngle', '__studioSetHDRIEnvironment', '__studioListHDRIPresets',
    '__studioSetAmbientIntensity', '__studioGetAmbientIntensity',
    '__studioSetKeyIntensity', '__studioGetKeyIntensity',
    '__studioSetShadingMode', '__studioGetShadingMode',
    '__studioApplySmartMaterial', '__studioListSmartMaterials',
    '__studioEvalNodeGraph', '__studioApplyMaterialGraph',
  ]) { try { delete window[k]; } catch (_) {} }
}
