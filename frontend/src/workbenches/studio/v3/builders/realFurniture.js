// Studio REAL-geometry furniture library — loads the downloaded CC0 glTF models
// (ambientCG / Poly Haven, 2K PBR) from frontend/public/assets/models/<id>/ and
// hands back cloned THREE.Group instances with their REAL PBR materials +
// textures intact (map / normalMap / roughnessMap / aoMap baked into the glTF).
//
// This is the production-grade complement to sceneComposer.js's parametric
// blockout library: instead of building furniture from rounded boxes, we place
// photoscanned/authored models. Every mesh in a loaded model is tagged
//   userData.archdiscStudioPrimitive = true   → harvested by the path tracer
//   userData.archdiscRealMaterial    = true   → harvestScene PRESERVES the real
//                                                glTF material (it does NOT
//                                                synthesize a registry material
//                                                or run the procedural generator
//                                                that would erase the real maps)
//
// URL resolution: Vite copies public/ verbatim into dist/, so at runtime the
// files live at <baseURI>/assets/models/<id>/<id>_2k.gltf. In Electron prod
// document.baseURI is file:///…/frontend/dist/index.html → file:///…/dist/…;
// under the vite dev server it is http://localhost:3100/. `new URL(rel, baseURI)`
// resolves both without hard-coding a scheme (same pattern as proceduralTextures
// assetUrl + PathTracedRender hdri resolution). GLTFLoader fetches the sibling
// .bin and textures/ relative to the .gltf URL automatically.

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

// type → downloaded model id (folder name === gltf basename, file = <id>_2k.gltf).
// Mirrors the task's typeMap. Aliases (coffee_table / coffee-table) both resolve.
export const TYPE_MAP = {
  sofa: 'Sofa_01',
  'sofa-alt': 'sofa_03',
  armchair: 'ArmChair_01',
  'coffee-table': 'CoffeeTable_01',
  coffee_table: 'CoffeeTable_01',
  'dining-chair': 'WoodenChair_01',
  dining_chair: 'WoodenChair_01',
  'dining-table': 'WoodenTable_02',
  dining_table: 'WoodenTable_02',
  bed: 'GothicBed_01',
  desk: 'metal_office_desk',
  bookshelf: 'wooden_bookshelf_worn',
  lamp: 'desk_lamp_arm_01',
  'ceiling-lamp': 'modern_ceiling_lamp_01',
  ceiling_lamp: 'modern_ceiling_lamp_01',
  plant: 'potted_plant_01',
  'plant-alt': 'potted_plant_04',
  console: 'chinese_console_table',
  'console-table': 'chinese_console_table',
  stool: 'wooden_stool_01',
  // 'rug' has no downloaded model — sceneComposer supplies a procedural rug.
};

export const REAL_FURNITURE_TYPES = Object.keys(TYPE_MAP);

// Resolve a public-asset relative path to an absolute URL that works under both
// the Electron file:// dist load and the vite dev server.
function assetUrl(rel) {
  const base = (typeof document !== 'undefined' && document.baseURI)
    ? document.baseURI
    : (typeof location !== 'undefined' ? location.href : 'file:///');
  try { return new URL(rel, base).href; }
  catch (_) { return rel; }
}

function modelUrl(id) {
  return assetUrl(`assets/models/${id}/${id}_2k.gltf`);
}

const _loader = (typeof THREE !== 'undefined') ? new GLTFLoader() : null;
const _cache = {};    // id  -> gltf.scene (the pristine loaded master Group)
const _pending = {};  // id  -> Promise<Group> (dedup concurrent loads)

// Tag every mesh in a (cloned) group so the path tracer harvests it AND keeps
// its real material. Also enable shadows. Idempotent.
function tagGroup(group) {
  group.traverse((o) => {
    if (o.isMesh) {
      o.userData.archdiscStudioPrimitive = true;   // → harvested by harvestScene
      o.userData.archdiscRealMaterial = true;       // → keep the real glTF PBR material
      o.userData.archdiscRealFurniture = true;
      o.castShadow = true;
      o.receiveShadow = true;
    }
  });
  return group;
}

// Await-able: load (once) the master glTF scene for an id and cache it. The
// returned Group is the SHARED master — callers must clone before mutating.
async function loadMaster(id) {
  if (!_loader) throw new Error('realFurniture: THREE/GLTFLoader unavailable');
  if (id in _cache) return _cache[id];
  if (id in _pending) return _pending[id];
  const p = (async () => {
    const gltf = await _loader.loadAsync(modelUrl(id));
    const root = gltf.scene || (gltf.scenes && gltf.scenes[0]);
    if (!root) throw new Error('realFurniture: no scene in glTF ' + id);
    tagGroup(root);
    _cache[id] = root;
    return root;
  })();
  _pending[id] = p;
  try { return await p; }
  finally { delete _pending[id]; }
}

// Deep-clone a loaded master into an independent Group. Object3D.clone(true)
// shares geometry + material refs (cheap; the path tracer clones geometry +
// material itself during harvest), so per-instance transforms are independent
// while the GPU buffers stay deduped. Re-tag the clone (clone copies userData
// by reference-spread, so the flags carry, but we re-assert to be safe).
function cloneMaster(master) {
  const g = master.clone(true);
  return tagGroup(g);
}

// Normalize a freshly cloned model to a clean local frame for placement:
// recompute its world matrix, measure its bounding box, and translate so its
// footprint is centred on (x=0, z=0) and its base sits on y = 0. This lets
// layouts position furniture by floor-anchored real-world coordinates without
// caring about each asset's authored pivot. Returns { group, size }.
function groundAndCenter(group) {
  group.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(group);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  // shift so XZ centre → origin, min.y → 0
  group.position.x -= center.x;
  group.position.z -= center.z;
  group.position.y -= box.min.y;
  group.updateMatrixWorld(true);
  return { group, size };
}

// PUBLIC: load real furniture of a given type → a cloned, tagged, grounded,
// XZ-centred THREE.Group with its real PBR materials + textures intact.
// Awaitable. `opts.center` (default true) grounds + centres; pass false to keep
// the asset's authored pivot. Throws (no silent fallback) if the type/model is
// missing — surfacing the real error per the no-fallback project rule.
export async function loadRealFurniture(type, opts = {}) {
  const id = TYPE_MAP[type] || (REAL_FURNITURE_TYPES.includes(type) ? type : null) || (Object.values(TYPE_MAP).includes(type) ? type : null);
  if (!id) throw new Error('realFurniture: unknown furniture type "' + type + '"');
  const master = await loadMaster(id);
  const g = cloneMaster(master);
  g.name = 'realFurniture:' + type;
  g.userData.archdiscRealFurnitureType = type;
  g.userData.archdiscRealFurnitureId = id;
  const { size } = (opts.center === false) ? { size: null } : groundAndCenter(g);
  if (size) { g.userData.realSize = { x: size.x, y: size.y, z: size.z }; }
  return g;
}

// Await-able warm-up: preload a set of types (or all) so a subsequent compose is
// instant. Resolves once every model is cached. Never throws for a bad id — it
// reports failures so the caller can decide; used by the real-scene composer.
export async function preloadRealFurniture(types = REAL_FURNITURE_TYPES) {
  const results = await Promise.allSettled(
    types.map((t) => loadMaster(TYPE_MAP[t] || t)),
  );
  const failed = [];
  results.forEach((r, i) => { if (r.status === 'rejected') failed.push(types[i]); });
  return { ok: failed.length === 0, loaded: types.length - failed.length, failed };
}

export function clearRealFurnitureCache() {
  for (const k of Object.keys(_cache)) delete _cache[k];
}

export function installRealFurniture() {
  if (typeof window === 'undefined') return;
  window.__studioLoadRealFurniture = loadRealFurniture;
  window.__studioPreloadRealFurniture = preloadRealFurniture;
  window.__studioRealFurnitureTypes = REAL_FURNITURE_TYPES;
}

export default loadRealFurniture;
