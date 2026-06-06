// ArchDisc Studio V3 — glTF KHR-extension injector (slice 768).
//
// THREE's stock `GLTFExporter` understands the following extensions when
// it sees the right *concrete* material/light classes:
//
//   - KHR_lights_punctual          → PointLight / DirectionalLight / SpotLight
//   - KHR_materials_unlit          → MeshBasicMaterial
//   - KHR_materials_clearcoat      → MeshPhysicalMaterial with clearcoat > 0
//   - KHR_materials_emissive_strength
//                                  → MeshStandardMaterial with emissiveIntensity ≠ 1
//
// But Studio scenes regularly use `MeshStandardMaterial` for everything
// and tag intent on `material.userData` (e.g. `userData.unlit = true`,
// `userData.clearcoat = 0.7`, `userData.emissiveStrength = 4.2`). When
// such a material is exported as-is, none of the KHR extensions show up
// in the resulting JSON.
//
// `injectKHRExtensions(gltfJson, scene)` walks the *output JSON*
// produced by `GLTFExporter.parse(..., onDone, ..., { binary: false })`
// alongside the original `THREE.Scene`, and:
//
//   1) For every `THREE.Light` whose three-mapped node is present in
//      `gltfJson.nodes`, ensures `KHR_lights_punctual` exists in the
//      top-level `extensions.KHR_lights_punctual.lights[]` array with a
//      light def derived from the live `THREE.Light` instance, then
//      points the node's `extensions.KHR_lights_punctual.light` at it.
//      Idempotent if THREE already wrote it.
//
//   2) For every `THREE.Material` referenced by a `gltfJson.materials[]`
//      entry, applies the appropriate KHR extension based on either the
//      concrete material class (existing THREE behaviour) or the
//      `material.userData` markers:
//
//        userData.unlit            (truthy)           → KHR_materials_unlit
//        userData.clearcoat        (0..1)             → KHR_materials_clearcoat
//        userData.clearcoatRoughness (0..1)           → tracked
//        userData.emissiveStrength (>0)               → KHR_materials_emissive_strength
//
// All injection is JSON-only — we never mutate the live THREE scene.
// All writes are idempotent; calling the function twice on the same JSON
// produces a stable structural result.
//
// Returns the JSON object passed in (mutated in place) plus a summary:
//   { lights: <n>, unlit: <n>, clearcoat: <n>, emissive: <n>, used: [...] }
//
// Pure-JS, no new deps; only reads/writes plain objects.

const EXT_LIGHTS    = 'KHR_lights_punctual';
const EXT_UNLIT     = 'KHR_materials_unlit';
const EXT_CLEARCOAT = 'KHR_materials_clearcoat';
const EXT_EMISSIVE  = 'KHR_materials_emissive_strength';

export const SUPPORTED_EXTENSIONS = [
  EXT_LIGHTS,
  EXT_UNLIT,
  EXT_CLEARCOAT,
  EXT_EMISSIVE,
];

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function _markUsed(json, name) {
  if (!Array.isArray(json.extensionsUsed)) json.extensionsUsed = [];
  if (!json.extensionsUsed.includes(name)) json.extensionsUsed.push(name);
}

function _ensureTopLightsExt(json) {
  if (!json.extensions) json.extensions = {};
  if (!json.extensions[EXT_LIGHTS]) json.extensions[EXT_LIGHTS] = { lights: [] };
  if (!Array.isArray(json.extensions[EXT_LIGHTS].lights)) {
    json.extensions[EXT_LIGHTS].lights = [];
  }
  return json.extensions[EXT_LIGHTS].lights;
}

function _colorToArray(c) {
  if (!c) return [1, 1, 1];
  if (typeof c.toArray === 'function') return c.toArray();
  if (typeof c.r === 'number') return [c.r, c.g, c.b];
  if (Array.isArray(c)) return [Number(c[0]) || 0, Number(c[1]) || 0, Number(c[2]) || 0];
  return [1, 1, 1];
}

// Build the per-light def per KHR_lights_punctual spec.
function buildLightDef(light) {
  if (!light || !light.isLight) return null;
  const def = {};
  if (light.name) def.name = light.name;
  def.color = _colorToArray(light.color);
  def.intensity = Number.isFinite(light.intensity) ? light.intensity : 1.0;
  if (light.isDirectionalLight) {
    def.type = 'directional';
  } else if (light.isPointLight) {
    def.type = 'point';
    if (Number.isFinite(light.distance) && light.distance > 0) def.range = light.distance;
  } else if (light.isSpotLight) {
    def.type = 'spot';
    if (Number.isFinite(light.distance) && light.distance > 0) def.range = light.distance;
    const angle = Number.isFinite(light.angle) ? light.angle : Math.PI / 4;
    const penumbra = Number.isFinite(light.penumbra) ? light.penumbra : 0;
    def.spot = {
      innerConeAngle: (1.0 - penumbra) * angle,
      outerConeAngle: angle,
    };
  } else {
    return null;
  }
  return def;
}

// Walk the THREE scene graph in the same depth-first order GLTFExporter
// uses to populate `json.nodes`. We use this to map node-index → THREE
// object regardless of whether the scene was filtered.
function _collectThreeObjects(scene) {
  const out = [];
  if (!scene) return out;
  function visit(obj) {
    out.push(obj);
    if (obj.children) for (const c of obj.children) visit(c);
  }
  if (scene.children) for (const c of scene.children) visit(c);
  return out;
}

// Match GLTF node-index → THREE Light by name (GLTFExporter writes
// `nodeDef.name = obj.name`). Stable + idempotent: each light is matched
// at most once. Falls back to position-based matching if names collide.
function _matchLightNodes(json, threeObjects) {
  if (!Array.isArray(json.nodes)) return [];
  const lights = threeObjects.filter((o) => o && o.isLight);
  if (!lights.length) return [];
  const matches = [];
  const used = new Set();
  for (const light of lights) {
    let bestIdx = -1;
    for (let i = 0; i < json.nodes.length; i++) {
      if (used.has(i)) continue;
      const n = json.nodes[i];
      if (!n) continue;
      // GLTFExporter sets node.name to the THREE object name. Lights with
      // matching name + no mesh ref are our target.
      if (light.name && n.name === light.name && n.mesh === undefined) {
        bestIdx = i;
        break;
      }
    }
    if (bestIdx < 0) {
      for (let i = 0; i < json.nodes.length; i++) {
        if (used.has(i)) continue;
        const n = json.nodes[i];
        if (!n) continue;
        if (n.mesh !== undefined) continue;
        // Empty leaf node with no children and no mesh — best guess.
        if (!n.children || n.children.length === 0) { bestIdx = i; break; }
      }
    }
    if (bestIdx >= 0) {
      used.add(bestIdx);
      matches.push({ light, nodeIndex: bestIdx });
    }
  }
  return matches;
}

// Best-effort material→materialIndex map. We track by reference identity
// then fall back to name match. GLTFExporter writes `materialDef.name`
// from `material.name` when set.
function _matchMaterials(json, threeObjects) {
  if (!Array.isArray(json.materials)) return [];
  const mats = [];
  const seen = new WeakSet();
  for (const o of threeObjects) {
    if (!o || !o.material) continue;
    const matList = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of matList) {
      if (!m || seen.has(m)) continue;
      seen.add(m);
      mats.push(m);
    }
  }
  // Build name → indices map for resolution.
  const nameToIdx = new Map();
  for (let i = 0; i < json.materials.length; i++) {
    const def = json.materials[i];
    if (!def) continue;
    const key = def.name || `__unnamed_${i}__`;
    if (!nameToIdx.has(key)) nameToIdx.set(key, []);
    nameToIdx.get(key).push(i);
  }
  const used = new Set();
  const matches = [];
  for (const m of mats) {
    const key = m.name || null;
    let idx = -1;
    if (key && nameToIdx.has(key)) {
      const candidates = nameToIdx.get(key);
      for (const c of candidates) { if (!used.has(c)) { idx = c; break; } }
    }
    if (idx < 0) {
      for (let i = 0; i < json.materials.length; i++) {
        if (!used.has(i)) { idx = i; break; }
      }
    }
    if (idx >= 0) {
      used.add(idx);
      matches.push({ material: m, materialIndex: idx });
    }
  }
  return matches;
}

// ---------------------------------------------------------------------------
// Per-extension injectors. Each is idempotent. Each returns true iff it
// wrote anything new into the JSON.
// ---------------------------------------------------------------------------

function _injectLight(json, light, nodeIndex) {
  if (!json.nodes || !json.nodes[nodeIndex]) return false;
  const node = json.nodes[nodeIndex];
  // If THREE already wired KHR_lights_punctual on this node, leave it.
  if (node.extensions && node.extensions[EXT_LIGHTS]
      && typeof node.extensions[EXT_LIGHTS].light === 'number') {
    _markUsed(json, EXT_LIGHTS);
    return false;
  }
  const def = buildLightDef(light);
  if (!def) return false;
  const lights = _ensureTopLightsExt(json);
  const lightIdx = lights.push(def) - 1;
  if (!node.extensions) node.extensions = {};
  node.extensions[EXT_LIGHTS] = { light: lightIdx };
  _markUsed(json, EXT_LIGHTS);
  return true;
}

function _injectUnlit(json, material, materialIndex) {
  if (!json.materials || !json.materials[materialIndex]) return false;
  const u = material && material.userData;
  // Trigger if the material is BasicMaterial (THREE-native) OR userData
  // is flagged.
  const want = !!(material && (material.isMeshBasicMaterial || (u && u.unlit)));
  if (!want) return false;
  const def = json.materials[materialIndex];
  if (def.extensions && def.extensions[EXT_UNLIT]) {
    _markUsed(json, EXT_UNLIT);
    return false;
  }
  if (!def.extensions) def.extensions = {};
  def.extensions[EXT_UNLIT] = {};
  if (!def.pbrMetallicRoughness) def.pbrMetallicRoughness = {};
  def.pbrMetallicRoughness.metallicFactor = 0.0;
  def.pbrMetallicRoughness.roughnessFactor = 0.9;
  _markUsed(json, EXT_UNLIT);
  return true;
}

function _injectClearcoat(json, material, materialIndex) {
  if (!json.materials || !json.materials[materialIndex]) return false;
  const u = material && material.userData;
  let clearcoat = 0;
  let clearcoatRoughness = 0;
  if (material && typeof material.clearcoat === 'number') {
    clearcoat = material.clearcoat;
    clearcoatRoughness = Number(material.clearcoatRoughness) || 0;
  }
  if (u && typeof u.clearcoat === 'number') {
    clearcoat = u.clearcoat;
    if (typeof u.clearcoatRoughness === 'number') clearcoatRoughness = u.clearcoatRoughness;
  }
  if (!(clearcoat > 0)) return false;
  const def = json.materials[materialIndex];
  if (!def.extensions) def.extensions = {};
  if (def.extensions[EXT_CLEARCOAT]) {
    _markUsed(json, EXT_CLEARCOAT);
    return false;
  }
  def.extensions[EXT_CLEARCOAT] = {
    clearcoatFactor: Math.max(0, Math.min(1, clearcoat)),
    clearcoatRoughnessFactor: Math.max(0, Math.min(1, clearcoatRoughness)),
  };
  _markUsed(json, EXT_CLEARCOAT);
  return true;
}

function _injectEmissive(json, material, materialIndex) {
  if (!json.materials || !json.materials[materialIndex]) return false;
  const u = material && material.userData;
  let strength = null;
  if (u && typeof u.emissiveStrength === 'number' && u.emissiveStrength !== 1) {
    strength = u.emissiveStrength;
  } else if (material && material.isMeshStandardMaterial
             && typeof material.emissiveIntensity === 'number'
             && material.emissiveIntensity !== 1) {
    strength = material.emissiveIntensity;
  }
  if (strength == null || !Number.isFinite(strength)) return false;
  const def = json.materials[materialIndex];
  if (!def.extensions) def.extensions = {};
  if (def.extensions[EXT_EMISSIVE]) {
    _markUsed(json, EXT_EMISSIVE);
    return false;
  }
  def.extensions[EXT_EMISSIVE] = { emissiveStrength: strength };
  _markUsed(json, EXT_EMISSIVE);
  return true;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function injectKHRExtensions(gltfJson, scene) {
  if (!gltfJson || typeof gltfJson !== 'object') {
    return { ok: false, error: 'no gltf json' };
  }
  if (!scene) {
    return { ok: false, error: 'no scene' };
  }
  const threeObjects = _collectThreeObjects(scene);

  const summary = {
    lights: 0,
    unlit: 0,
    clearcoat: 0,
    emissive: 0,
    used: [],
  };

  // Lights
  const lightMatches = _matchLightNodes(gltfJson, threeObjects);
  for (const { light, nodeIndex } of lightMatches) {
    if (_injectLight(gltfJson, light, nodeIndex)) summary.lights++;
  }

  // Materials
  const matMatches = _matchMaterials(gltfJson, threeObjects);
  for (const { material, materialIndex } of matMatches) {
    if (_injectUnlit(gltfJson, material, materialIndex)) summary.unlit++;
    if (_injectClearcoat(gltfJson, material, materialIndex)) summary.clearcoat++;
    if (_injectEmissive(gltfJson, material, materialIndex)) summary.emissive++;
  }

  // Mirror the canonical extensions used list.
  if (Array.isArray(gltfJson.extensionsUsed)) {
    summary.used = gltfJson.extensionsUsed.slice();
  }

  return { ok: true, summary };
}

// Standalone single-extension injectors so tests and other modules can
// drive them piecewise.
export const _testing = {
  buildLightDef,
  injectLight: _injectLight,
  injectUnlit: _injectUnlit,
  injectClearcoat: _injectClearcoat,
  injectEmissive: _injectEmissive,
  matchLightNodes: _matchLightNodes,
  matchMaterials: _matchMaterials,
  SUPPORTED_EXTENSIONS,
};
