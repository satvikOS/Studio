// Studio REAL-character / REAL-prop / REAL-sky asset loader (Slice 1012).
//
// This is the genuine-CUA asset surface: a typed prompt → the model emits a
// tool_call → executeToolCall → a REAL DOM click on an Asset-library control →
// THIS module loads a real downloaded CC0 asset from frontend/public/assets/.
// NOTHING here calls a React setState (window-API-no-setState rule) — these are
// pure scene mutations + window/data refs only.
//
// Three families, all reached by a click on the Asset library:
//   1. import-character  → loads a rigged human/robot .glb (Soldier / Robot /
//      Xbot), scales to a target height, plays a requested AnimationClip via
//      the existing studioAnimPlayer transport, and tags every mesh so the GPU
//      path tracer harvests it (PathTracedRender.bakeSkinnedGeometry handles the
//      SkinnedMesh deform; archdiscRealMaterial keeps the real glTF PBR).
//   2. place-prop        → loads a Poly Haven CC0 prop (.gltf + .bin + textures)
//      from assets/models/<id>/ and grounds it on the floor.
//   3. set-environment   → loads a real outdoor equirectangular .hdr from
//      assets/hdri/<id>.hdr and sets it as scene.environment + scene.background
//      (the real sky). Reuses the slice-704 RGBELoader IBL path.
//
// URL resolution mirrors realFurniture.js: `new URL(rel, document.baseURI)`
// resolves under BOTH the Electron file:// dist load and the vite dev server,
// so nothing is hard-coded to a scheme. GLTFLoader fetches sibling .bin /
// textures relative to a .gltf automatically; a .glb is fully self-contained.
//
// No new npm deps — only `three` + three/examples loaders already used by
// realFurniture.js (GLTFLoader) and hdri/ibl.js (RGBELoader).

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js';

// ── Character registry ───────────────────────────────────────────────────────
// asset id → { file, height (authored, for default scale), clips }. `clips` maps
// the CUA's generic gait words → the ACTUAL clip name inside that .glb (verified
// headlessly: Soldier=Idle/Run/Walk/TPose, RobotExpressive=Idle/Jump/Walking/
// Running/WalkJump/…, Xbot=idle/run/walk). A human has no authored jump clip, so
// the jump SHOT falls back to RobotExpressive (documented, pragmatic — retarget
// of a jump onto Soldier is out of scope here).
export const CHARACTER_MAP = Object.freeze({
  soldier: {
    file: 'Soldier.glb',
    label: 'Soldier (human)',
    clips: { walk: 'Walk', run: 'Run', idle: 'Idle', jump: null /* no human jump → use robot */ },
    defaultClip: 'Idle',
  },
  robot: {
    file: 'RobotExpressive.glb',
    label: 'Robot',
    clips: { walk: 'Walking', run: 'Running', idle: 'Idle', jump: 'Jump', walkjump: 'WalkJump' },
    defaultClip: 'Idle',
  },
  xbot: {
    file: 'Xbot.glb',
    label: 'Xbot',
    clips: { walk: 'walk', run: 'run', idle: 'idle', jump: null },
    defaultClip: 'idle',
  },
});
export const CHARACTER_ASSETS = Object.keys(CHARACTER_MAP);
export const CHARACTER_CLIP_WORDS = Object.freeze(['idle', 'walk', 'run', 'jump']);

// ── Prop registry ────────────────────────────────────────────────────────────
// Two CC0 families landed in assets/models/:
//   1. Poly Haven 1k glTF props (file resolves to <id>/<id>_1k.gltf — the legacy
//      pattern): outdoor/street dressing (planters, shrubs, street lamps, manhole,
//      crate) with real photoscanned PBR — perfect under a real outdoor HDRI.
//   2. Kenney CC0 .glb kit models (file: '<id>.glb' — self-contained): real
//      VEHICLES (sedan/SUV/van/truck) + TREES/foliage that replace the procedural
//      blockout cars + sphere-stack trees in cityBlock.js. Kenney kits are authored
//      at a small unit scale (a car is ~2.6 m, a kit tree <1 m), so each carries a
//      `targetLen` (longest-axis target in metres) and placeProp uniformly scales
//      the loaded mesh to it → sane real-world footprints, NOT exploded/tiny.
//      These are stylized low-poly CC0 (clean, consistent), not photoreal scans
//      (a free photoreal CC0 car glb is not directly downloadable — noted honestly).
//      A REALISTIC tree upgrade DID land: Poly Haven `fir_sapling` is a 433k-tri
//      photoscanned conifer with real PBR bark/twig maps (legacy <id>_1k.gltf
//      pattern, no `file` key). It coexists with the Kenney trees; the Kenney
//      ones are relabelled "(stylized)" so the UI/CUA can prefer the photoreal
//      fir. Photoreal CC0 CARS remain unreachable for free (the only CC0 cars on
//      Sketchfab are auth-gated vintage scans), so cars stay Kenney + real
//      car-paint PBR. BUILDINGS are no longer procedural-only: clean modern blocks
//      are now generated in-house as REAL B-rep solids by Forge's native OCCT
//      kernel (forge-kernel/test/gen_brep_buildings.mjs) — extruded massing with
//      true BOOLEAN-CUT recessed window grids + cornices/setbacks/parapet/canopy,
//      tessellated to single-mesh .glb with one PBR material (kind:'building').
// `kind` tags the family so cityBlock + the UI can filter vehicle / tree / prop /
// building.
export const PROP_MAP = Object.freeze({
  // — Poly Haven photoscanned props (legacy <id>_1k.gltf) —
  planter_box_01:     { label: 'Planter box',       kind: 'prop' },
  planter_pot_clay:   { label: 'Clay planter pot',  kind: 'prop' },
  potted_plant_04:    { label: 'Potted plant',      kind: 'prop' },
  shrub_03:           { label: 'Shrub',             kind: 'prop' },
  street_lamp_01:     { label: 'Street lamp (tall)',kind: 'prop' },
  street_lamp_02:     { label: 'Street lamp (short)',kind: 'prop' },
  water_manhole_cover:{ label: 'Manhole cover',     kind: 'prop' },
  wooden_crate_01:    { label: 'Wooden crate',      kind: 'prop' },
  // — Kenney CC0 .glb VEHICLES (authored ~2.6 m → scale to real ~4.4 m length) —
  car_sedan:          { label: 'Sedan',  file: 'car_sedan.glb',  kind: 'vehicle', targetLen: 4.5 },
  car_suv:            { label: 'SUV',    file: 'car_suv.glb',    kind: 'vehicle', targetLen: 4.7 },
  car_van:            { label: 'Van',    file: 'car_van.glb',    kind: 'vehicle', targetLen: 4.9 },
  car_truck:          { label: 'Truck',  file: 'car_truck.glb',  kind: 'vehicle', targetLen: 5.4 },
  // — Kenney CC0 .glb TREES / foliage (authored small → scale to real height) —
  tree_large:         { label: 'Tree (tall, stylized)',   file: 'tree_large.glb',    kind: 'tree', targetLen: 7.0 },
  tree_small:         { label: 'Tree (short, stylized)',  file: 'tree_small.glb',    kind: 'tree', targetLen: 4.5 },
  tree_round:         { label: 'Tree (round, stylized)',  file: 'tree_round.glb',    kind: 'tree', targetLen: 6.0 },
  planter_hedge:      { label: 'Hedge planter',           file: 'planter_hedge.glb', kind: 'tree', targetLen: 1.4 },
  // — Poly Haven CC0 photoscanned conifer (legacy <id>_1k.gltf; 433k tris, real
  //   PBR bark/twig). Authored as a 1.3 m sapling → scale to ~3.5 m young fir.
  //   This is the realistic upgrade over the low-poly Kenney trees; prefer it
  //   when the path tracer is on and a believable tree silhouette is wanted. —
  fir_sapling:        { label: 'Fir conifer (photoreal)', kind: 'tree', targetLen: 3.5, realistic: true },
  // — REAL B-rep BUILDINGS — generated headlessly by Forge's native OCCT kernel
  //   (forge-kernel/test/gen_brep_buildings.mjs): extruded massing + true
  //   BOOLEAN-CUT recessed window grids (a real mullion lattice with depth, not a
  //   painted texture) + cornices + setbacks + parapet + entry canopy, tessellated
  //   to a single-mesh .glb with one PBR material. Authored in metres; scaled to a
  //   target HEIGHT (kind:'building' → scaleToTarget uses size.y). 10k–16k tris each.
  //   This is the photoreal/parametric upgrade over the procedural building() box. —
  brep_tower_setback:     { label: 'Setback office tower (B-rep)',     dir: 'brep_buildings', file: 'brep_tower_setback.glb',     kind: 'building', targetLen: 58, realistic: true },
  brep_office_glass:      { label: 'Glass-steel office block (B-rep)', dir: 'brep_buildings', file: 'brep_office_glass.glb',      kind: 'building', targetLen: 42, realistic: true },
  brep_residential_brick: { label: 'Brick residential mid-rise (B-rep)', dir: 'brep_buildings', file: 'brep_residential_brick.glb', kind: 'building', targetLen: 38, realistic: true },
  brep_civic_concrete:    { label: 'Concrete civic block (B-rep)',     dir: 'brep_buildings', file: 'brep_civic_concrete.glb',    kind: 'building', targetLen: 40, realistic: true },
});
export const PROP_ASSETS = Object.keys(PROP_MAP);
// Convenience id lists by family (cityBlock + library headers filter on these).
export const VEHICLE_ASSETS = PROP_ASSETS.filter((id) => PROP_MAP[id].kind === 'vehicle');
export const TREE_ASSETS = PROP_ASSETS.filter((id) => PROP_MAP[id].kind === 'tree');
export const BUILDING_ASSETS = PROP_ASSETS.filter((id) => PROP_MAP[id].kind === 'building');

// ── HDRI registry ────────────────────────────────────────────────────────────
// Real equirectangular outdoor skies that landed in assets/hdri/. id === file
// basename (without .hdr). wide_street_01 is the best daytime street.
export const HDRI_MAP = Object.freeze({
  wide_street_01:     { label: 'Wide street (daytime)' },
  docklands_02:       { label: 'Docklands' },
  german_town_street: { label: 'German town street' },
  canary_wharf:       { label: 'Canary Wharf' },
  daylight:           { label: 'Daylight' },
  golden:             { label: 'Golden hour' },
  studio:             { label: 'Studio' },
});
export const HDRI_ASSETS = Object.keys(HDRI_MAP);

// ── URL resolution (works under file:// dist + vite dev) ──────────────────────
function assetUrl(rel) {
  const base = (typeof document !== 'undefined' && document.baseURI)
    ? document.baseURI
    : (typeof location !== 'undefined' ? location.href : 'file:///');
  try { return new URL(rel, base).href; }
  catch (_) { return rel; }
}

function _studioScene() {
  return (typeof window !== 'undefined')
    ? (window.__archdiscScene || (window.__archdiscViewport && window.__archdiscViewport.scene))
    : null;
}

const _loader = (typeof THREE !== 'undefined') ? new GLTFLoader() : null;

// ── shared helpers ───────────────────────────────────────────────────────────
// Tag every mesh in a group so the path tracer harvests it AND keeps the real
// glTF PBR material (NO synthesized registry material). Mirrors realFurniture's
// tagGroup. Idempotent. Also enables shadows.
function tagGroup(group) {
  group.traverse((o) => {
    if (o.isMesh) {
      o.userData.archdiscStudioPrimitive = true;   // → harvested by harvestScene
      o.userData.archdiscRealMaterial = true;        // → keep the real glTF PBR material
      o.castShadow = true;
      o.receiveShadow = true;
    }
  });
  group.userData.archdiscStudioPrimitive = true;
  group.userData.archdiscRealMaterial = true;
  return group;
}

// Ground a group on y=0 and centre its XZ footprint, returns { size }.
function groundAndCenter(group) {
  group.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(group);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  group.position.x -= center.x;
  group.position.z -= center.z;
  group.position.y -= box.min.y;
  group.updateMatrixWorld(true);
  return { size, box };
}

// ── CHARACTERS ───────────────────────────────────────────────────────────────
const _charCache = {};   // id  -> { scene, animations } (pristine master)
const _charPending = {};

async function loadCharacterMaster(id) {
  if (!_loader) throw new Error('realCharacter: THREE/GLTFLoader unavailable');
  const def = CHARACTER_MAP[id];
  if (!def) throw new Error('realCharacter: unknown character "' + id + '"');
  if (id in _charCache) return _charCache[id];
  if (id in _charPending) return _charPending[id];
  const url = assetUrl('assets/characters/' + def.file);
  const p = (async () => {
    const gltf = await _loader.loadAsync(url);
    const root = gltf.scene || (gltf.scenes && gltf.scenes[0]);
    if (!root) throw new Error('realCharacter: no scene in glb ' + id);
    const master = { scene: root, animations: gltf.animations || [] };
    _charCache[id] = master;
    return master;
  })();
  _charPending[id] = p;
  try { return await p; }
  finally { delete _charPending[id]; }
}

// Resolve a CUA clip word ('walk'|'run'|'jump'|'idle' — or a raw clip name) to an
// actual THREE.AnimationClip for the loaded character. For a human JUMP (no
// authored clip) returns { clip:null, retargetNeeded:true } so the caller can
// surface the honest fallback note.
function resolveClip(def, animations, requested) {
  const want = String(requested || def.defaultClip || 'idle').toLowerCase();
  // 1) generic gait word → mapped clip name
  let targetName = def.clips[want];
  let retargetNeeded = false;
  if (targetName === null && want === 'jump') {
    // human has no jump → caller should have routed to robot; flag it.
    retargetNeeded = true;
  }
  // 2) if no mapping, treat `requested` as a literal clip name (case-insensitive)
  if (!targetName && !retargetNeeded) targetName = def.clips[want] || requested;
  // find the clip (exact, then case-insensitive)
  let clip = null;
  if (targetName) {
    clip = animations.find((a) => a.name === targetName)
        || animations.find((a) => a.name.toLowerCase() === String(targetName).toLowerCase())
        || null;
  }
  // fall back to the default clip if the requested one is absent
  if (!clip) {
    clip = animations.find((a) => a.name === def.defaultClip)
        || animations[0] || null;
  }
  return { clip, retargetNeeded, requestedWord: want };
}

let _charPlaceCount = 0;

// PUBLIC: import a rigged character → add to the live scene, scale to `height`,
// register + play the requested clip via the anim transport. Returns
// { ok, asset, clip, retargetNeeded, group }.
export async function importCharacter(opts = {}) {
  const o = opts || {};
  let asset = String(o.asset || 'soldier').toLowerCase();
  const requestedClip = o.clip != null ? String(o.clip).toLowerCase() : null;
  // Pragmatic JUMP routing: a human (soldier/xbot) has no authored jump clip, so
  // if a jump is requested on one of them, load RobotExpressive (which has Jump).
  let jumpFallbackNote = null;
  if (requestedClip === 'jump' && CHARACTER_MAP[asset] && CHARACTER_MAP[asset].clips.jump === null) {
    jumpFallbackNote = `${asset} has no jump clip → using robot for the jump shot`;
    asset = 'robot';
  }
  const def = CHARACTER_MAP[asset];
  if (!def) throw new Error('import-character: unknown asset "' + (o.asset || '') + '" (have: ' + CHARACTER_ASSETS.join(', ') + ')');
  const scene = _studioScene();
  if (!scene) throw new Error('import-character: no scene');

  const master = await loadCharacterMaster(asset);
  // Clone the rig (clone(true) preserves the skeleton bind for SkinnedMesh).
  // THREE's SkeletonUtils is the gold path, but Object3D.clone(true) is enough
  // for a single standalone instance because the bones are cloned in-tree and
  // the SkinnedMesh re-binds to the cloned skeleton via shared inverses; we
  // re-bind defensively below.
  const group = master.scene.clone(true);
  group.name = 'realCharacter:' + asset;

  // Re-bind each cloned SkinnedMesh to the cloned skeleton (so the clone deforms
  // independently of the master). Find the cloned bones by name.
  const boneByName = {};
  group.traverse((o2) => { if (o2.isBone) boneByName[o2.name] = o2; });
  group.traverse((o2) => {
    if (o2.isSkinnedMesh && o2.skeleton) {
      const bones = o2.skeleton.bones.map((b) => boneByName[b.name] || b);
      const skeleton = new THREE.Skeleton(bones, o2.skeleton.boneInverses);
      o2.bind(skeleton, o2.bindMatrix);
    }
  });

  // Scale to target height (default 1.8 m). Measure current height, derive factor.
  group.updateMatrixWorld(true);
  let box = new THREE.Box3().setFromObject(group);
  let size = box.getSize(new THREE.Vector3());
  const targetH = Number(o.height) > 0 ? Number(o.height) : 1.8;
  if (size.y > 1e-4) {
    const f = targetH / size.y;
    group.scale.multiplyScalar(f);
    group.updateMatrixWorld(true);
  }
  // Ground on floor + centre XZ.
  groundAndCenter(group);

  // Optional explicit position [x,y,z].
  if (Array.isArray(o.position) && o.position.length === 3) {
    group.position.x += Number(o.position[0]) || 0;
    group.position.y += Number(o.position[1]) || 0;
    group.position.z += Number(o.position[2]) || 0;
  } else {
    // Spread successive characters so repeated imports don't stack.
    const n = _charPlaceCount;
    const ang = n * 2.39996;
    const rad = 0.8 * Math.sqrt(n);
    group.position.x += Math.cos(ang) * rad;
    group.position.z += Math.sin(ang) * rad;
  }
  _charPlaceCount++;
  group.updateMatrixWorld(true);

  tagGroup(group);
  scene.add(group);

  // Resolve + register the clip with the existing anim transport so play/scrub/
  // stop work on this character. A clip in the registry is fn(t)->pose; we drive
  // a per-character AnimationMixer at t*duration.
  const { clip, retargetNeeded, requestedWord } = resolveClip(def, master.animations, requestedClip);
  let playedClipName = null;
  if (clip) {
    const mixer = new THREE.AnimationMixer(group);
    const action = mixer.clipAction(clip);
    action.play();
    playedClipName = clip.name;
    group.userData.archdiscCharacterMixer = mixer;
    group.userData.archdiscCharacterClip = clip.name;
    // Register a transport clip keyed by the gait word; its fn(t) seeks the mixer.
    const clipDuration = clip.duration || 1;
    const transportName = requestedWord; // 'walk' | 'run' | 'idle' | 'jump'
    if (typeof window !== 'undefined' && window.__studioAnimPlayer
        && typeof window.__studioAnimPlayer.registerClip === 'function') {
      // Capture this mixer/clip in the closure; the most-recently imported
      // character owns the gait-word clip (later imports replace it — same as
      // __studioLastPlacedGroup semantics).
      window.__studioAnimPlayer.registerClip(transportName, (t) => {
        const phase = ((Number(t) % 1) + 1) % 1;
        mixer.setTime(phase * clipDuration);
        return { ok: true };
      }, { seconds: Math.max(0.4, clipDuration) });
      // Make it the active clip + pose at t=0 so it's visible immediately.
      try { window.__studioAnimPlayer.setClip(transportName); } catch (_) {}
      // Seed one frame so the rig leaves the bind pose right away.
      mixer.setTime(0.001);
    } else {
      // No transport yet — at least pose one frame so it isn't a T-pose.
      mixer.update(0.001);
    }
  }

  // Record as the arrange target so a following set-selection moves THIS root.
  if (typeof window !== 'undefined') window.__studioLastPlacedGroup = group;
  // Frame the camera on the new geometry (best-effort).
  try { if (typeof window !== 'undefined' && typeof window.__studioFrameAll === 'function') window.__studioFrameAll(); } catch (_) {}
  if (typeof window !== 'undefined' && window.__studioToast) {
    window.__studioToast(`Imported ${asset}${playedClipName ? ' · ' + playedClipName : ''}`, 'ok');
  }

  return {
    ok: true,
    asset,
    clip: playedClipName,
    requestedClip,
    retargetNeeded: !!retargetNeeded,
    note: jumpFallbackNote || (retargetNeeded ? 'jump retarget onto human not available' : null),
    group,
    clips: master.animations.map((a) => a.name),
  };
}

// ── WALK-PATH DRIVER (natural organic mocap walk across the forest) ──────────
// window.__studioCharacterWalkPath({ asset, clip, path, speed, height, ... })
//
// Goal (Video-128: a natural walking figure — stride, weight-shift, opposed
// arm-swing): drive a REAL Mixamo-mocap rig along a CatmullRom path through the
// forest clearing so the gait reads organic, not robotic. The naturalness comes
// from the clip itself — the Soldier 'Walk' clip is genuine motion-capture
// (heel-strike → roll → toe-off, hip drop / weight shift, contralateral arm
// swing). We do NOT synthesize the gait; we only TRANSPORT the rig and keep the
// cycle stride-locked to ground speed so there is no foot-slide.
//
// The Mixamo walk clip is authored IN-PLACE (the root does not translate — the
// legs cycle under a stationary pelvis). So travel is the path's job: we advance
// the group along the curve by arc length at `speed` (m/s) and advance the walk
// MIXER so that exactly one stride-pair of clip phase elapses per
// `strideMeters` of ground covered → the planted foot stays put under the body
// (cadence = speed / strideMeters cycles per second). FOOT-PLANT: each frame the
// group's Y is set to the sampled terrain height under its XZ (analytic
// window.__studioTerrainHeight when nature is live, else a raycast against the
// terrain mesh, else y=0), so feet ride the relief — no floating, no sinking.
// HEADING: the group faces the curve TANGENT (yaw only) so it walks where it's
// going. All pure scene mutation (no setState).

// Resolve a terrain-height sampler: prefer the analytic nature sampler, else a
// downward raycast against the tagged terrain mesh, else flat y=0. Returns a
// function (x,z)->y plus a label of which path was used (for honest reporting).
function _makeTerrainSampler(scene) {
  if (typeof window !== 'undefined' && typeof window.__studioTerrainHeight === 'function') {
    return { fn: (x, z) => Number(window.__studioTerrainHeight(x, z)) || 0, mode: 'analytic' };
  }
  // raycast fallback — find the terrain mesh (tagged by natureBuilder) or any
  // large ground-ish mesh, cast straight down from high above.
  let terrainMesh = null;
  if (scene) scene.traverse((o) => {
    if (!terrainMesh && o.isMesh && o.userData && (o.userData.archdiscTerrain || o.userData.studioMaterial === 'grass')) {
      terrainMesh = o;
    }
  });
  if (terrainMesh) {
    const ray = new THREE.Raycaster();
    const down = new THREE.Vector3(0, -1, 0);
    const from = new THREE.Vector3();
    return {
      fn: (x, z) => {
        from.set(x, 1e4, z);
        ray.set(from, down);
        const hits = ray.intersectObject(terrainMesh, true);
        return hits.length ? hits[0].point.y : 0;
      },
      mode: 'raycast',
    };
  }
  return { fn: () => 0, mode: 'flat' };
}

// PUBLIC: import a character (reusing importCharacter) and drive it along a
// CatmullRom path with stride-locked cadence + terrain foot-plant. Returns
// { ok, asset, clip, pathLength, strideMeters, footPlant, advance(u), ... }.
export async function characterWalkPath(opts = {}) {
  const o = opts || {};
  const asset = String(o.asset || 'soldier').toLowerCase();
  const clipWord = o.clip != null ? String(o.clip).toLowerCase() : 'walk';
  const speed = Number(o.speed) > 0 ? Number(o.speed) : 1.4;   // m/s — relaxed adult walk
  const scene = _studioScene();
  if (!scene) throw new Error('character-walk-path: no scene');

  // Default path: a gentle S through the clearing if none supplied.
  let pts = Array.isArray(o.path) ? o.path : null;
  if (!pts || pts.length < 2) {
    pts = [[-8, 0, -6], [-3, 0, -1], [2, 0, 2], [7, 0, 5]];
  }

  // Terrain sampler for foot-plant (resolved BEFORE import so the import's first
  // pose can also be grounded).
  const sampler = _makeTerrainSampler(scene);

  // Build the CatmullRom curve in XZ; Y is sampled from terrain per-point so the
  // control polygon already hugs the ground (the per-frame plant refines it).
  const curvePts = pts.map((p) => {
    const x = Number(p[0]) || 0, z = Number(p[2]) || 0;
    const y = Number.isFinite(p[1]) && p[1] !== 0 ? Number(p[1]) : sampler.fn(x, z);
    return new THREE.Vector3(x, y, z);
  });
  const curve = new THREE.CatmullRomCurve3(curvePts, false, 'catmullrom', 0.5);
  const pathLength = curve.getLength();

  // Import the rig at the path start, playing the requested gait clip. This tags
  // the rig (archdiscStudioPrimitive + archdiscRealMaterial) so the path tracer
  // bakes the skinned pose with the real glTF PBR (skin/cloth), and registers the
  // gait clip + per-character mixer on group.userData.
  const start = curve.getPointAt(0);
  const imported = await importCharacter({
    asset,
    clip: clipWord,
    height: o.height,
    position: [start.x, 0, start.z],   // y handled by foot-plant below
  });
  const group = imported.group;
  const mixer = group.userData.archdiscCharacterMixer || null;
  // FOOT OFFSET: importCharacter's groundAndCenter set group.position.y so the
  // rig's LOWEST geometry point (the feet) sits at world y=0. We captured that
  // offset here; advance() then plants the feet on the terrain by setting
  // group.position.y = terrainY + footOffset (NOT terrainY — that would re-bury
  // the rig by the offset). We passed position:[x,0,z] above so position.y still
  // equals the pure grounding offset.
  const footOffset = group.position.y;
  const clipDuration = (() => {
    // duration of the actual played clip (from the master animation list).
    const m = _charCache[imported.asset];
    const nm = group.userData.archdiscCharacterClip;
    const c = m && m.animations.find((a) => a.name === nm);
    return (c && c.duration) || 1;
  })();

  // STRIDE LOCK: one full walk CLIP loop = two steps = one stride-pair. The
  // ground distance covered by a stride-pair determines cadence so the planted
  // foot does not slide. A relaxed adult covers ~1.4 m per stride-pair; allow an
  // override. cadence (loops/sec) = speed / strideMeters.
  const strideMeters = Number(o.strideMeters) > 0 ? Number(o.strideMeters) : 1.4;
  const cyclesTotal = pathLength / strideMeters;       // walk loops over the whole path
  const travelSeconds = pathLength / speed;            // wall-clock to walk it once

  // Heading helper: yaw the group to face the (XZ-projected) tangent. glTF rigs
  // face -Z by convention; atan2 over (x,z) gives the yaw that points the model's
  // forward down the tangent.
  const _tan = new THREE.Vector3();
  function faceTangent(u) {
    curve.getTangentAt(Math.min(0.9999, Math.max(0, u)), _tan);
    _tan.y = 0;
    if (_tan.lengthSq() < 1e-8) return;
    _tan.normalize();
    // model forward is -Z → yaw = atan2(tan.x, tan.z) puts -Z onto the tangent.
    group.rotation.y = Math.atan2(_tan.x, _tan.z);
  }

  // ADVANCE: place the rig at normalized path parameter u∈[0,1]. Foot-plants Y,
  // faces tangent, and drives the walk mixer to the stride-locked phase so the
  // gait cadence matches ground speed. Returns the world position for verify.
  const _pos = new THREE.Vector3();
  function advance(u) {
    const uu = Math.min(1, Math.max(0, Number(u) || 0));
    curve.getPointAt(uu, _pos);
    const groundY = sampler.fn(_pos.x, _pos.z);
    // plant feet ON the terrain: terrain height + the rig's foot→origin offset
    // (so the lowest geometry point lands exactly on the ground, no float/sink).
    group.position.set(_pos.x, groundY + footOffset, _pos.z);
    faceTangent(uu);
    // stride-locked clip phase: total clip loops over the path × u, wrapped.
    if (mixer && clipDuration > 0) {
      const loops = cyclesTotal * uu;
      const phase = ((loops % 1) + 1) % 1;
      mixer.setTime(phase * clipDuration);
    }
    group.updateMatrixWorld(true);
    // report the GROUND contact Y (terrain) — the foot-plant target — for verify.
    return { x: _pos.x, y: groundY, z: _pos.z, heading: group.rotation.y, footOffset };
  }

  // Pose at the start so the figure is grounded + mid-stride immediately.
  advance(0);

  // Register a TRANSPORT clip ('walk-path') whose fn(t) advances along the path.
  // The transport's normalized phase t∈[0,1) maps directly to path parameter u,
  // so one transport loop = one full traversal of the path. Cadence is set so the
  // loop takes `travelSeconds` (≈ pathLength / speed) → real-time walking pace.
  const transportName = String(o.transportName || 'walk-path');
  if (typeof window !== 'undefined' && window.__studioAnimPlayer
      && typeof window.__studioAnimPlayer.registerClip === 'function') {
    window.__studioAnimPlayer.registerClip(transportName, (t) => {
      const u = ((Number(t) % 1) + 1) % 1;
      advance(u);
      return { ok: true };
    }, { seconds: Math.max(0.5, travelSeconds) });
    try { window.__studioAnimPlayer.setClip(transportName); } catch (_) {}
  }

  // Expose a direct per-traversal driver too (offline capture loop / verify can
  // call advance(u) without the rAF transport).
  if (typeof window !== 'undefined') {
    window.__studioCharacterWalkAdvance = advance;
    window.__studioCharacterWalkPathInfo = {
      asset: imported.asset, clip: group.userData.archdiscCharacterClip,
      pathLength, strideMeters, cyclesTotal, travelSeconds, speed,
      footPlant: sampler.mode, points: pts.length,
    };
  }

  return {
    ok: true,
    asset: imported.asset,
    clip: group.userData.archdiscCharacterClip,
    requestedClip: clipWord,
    group,
    curve,
    advance,
    pathLength,
    strideMeters,
    cyclesTotal,
    travelSeconds,
    speed,
    footPlant: sampler.mode,
    transportName,
    note: imported.note,
  };
}

// ── PROPS ────────────────────────────────────────────────────────────────────
const _propCache = {};
const _propPending = {};
let _propPlaceCount = 0;

// Resolve the on-disk asset URL for a prop id. A `def.file` ending in .glb is a
// self-contained Kenney binary at assets/models/<id>/<file>; otherwise it's a
// legacy Poly Haven bundle at assets/models/<id>/<id>_1k.gltf (loads its sibling
// .bin + textures relative to the .gltf automatically).
function propUrl(id) {
  const def = PROP_MAP[id];
  // `dir` overrides the per-id folder (B-rep buildings live flat under
  // assets/models/<dir>/<file>); otherwise a `file` is at assets/models/<id>/<file>
  // and a legacy bundle is assets/models/<id>/<id>_1k.gltf.
  if (def && def.dir && def.file) return assetUrl(`assets/models/${def.dir}/${def.file}`);
  if (def && def.file) return assetUrl(`assets/models/${id}/${def.file}`);
  return assetUrl(`assets/models/${id}/${id}_1k.gltf`);
}

// PUBLIC (used by cityBlock too): load + cache the pristine master group for a
// prop id, tagged for the path tracer. Callers clone it for each placement.
export async function loadPropMaster(id) {
  if (!_loader) throw new Error('realCharacter: THREE/GLTFLoader unavailable');
  if (!PROP_MAP[id]) throw new Error('place-prop: unknown prop "' + id + '" (have: ' + PROP_ASSETS.join(', ') + ')');
  if (id in _propCache) return _propCache[id];
  if (id in _propPending) return _propPending[id];
  const url = propUrl(id);
  const p = (async () => {
    const gltf = await _loader.loadAsync(url);
    const root = gltf.scene || (gltf.scenes && gltf.scenes[0]);
    if (!root) throw new Error('place-prop: no scene in glTF ' + id);
    tagGroup(root);
    _propCache[id] = root;
    return root;
  })();
  _propPending[id] = p;
  try { return await p; }
  finally { delete _propPending[id]; }
}

// Uniformly scale a group so its LONGEST horizontal/vertical axis matches a
// target length (metres). Kenney kit assets are authored small, so without this
// a "car" would be ~2.6 m and a "tree" <1 m. Vehicles scale to length (Z/X);
// trees scale to height (Y). Returns the applied factor (1 when no target).
export function scaleToTarget(group, def) {
  if (!def || !(Number(def.targetLen) > 0)) return 1;
  group.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(group);
  const size = box.getSize(new THREE.Vector3());
  const cur = (def.kind === 'tree' || def.kind === 'building')
    ? size.y                                  // tree / building → match height
    : Math.max(size.x, size.z);               // vehicle → match longest footprint axis
  if (!(cur > 1e-4)) return 1;
  const f = def.targetLen / cur;
  group.scale.multiplyScalar(f);
  group.updateMatrixWorld(true);
  return f;
}

// PUBLIC: load + place a Poly Haven prop on the floor. Returns { ok, asset, group }.
export async function placeProp(opts = {}) {
  const o = opts || {};
  const asset = String(o.asset || o.id || '').toLowerCase();
  if (!PROP_MAP[asset]) throw new Error('place-prop: unknown prop "' + (o.asset || o.id || '') + '" (have: ' + PROP_ASSETS.join(', ') + ')');
  const scene = _studioScene();
  if (!scene) throw new Error('place-prop: no scene');
  const master = await loadPropMaster(asset);
  const group = tagGroup(master.clone(true));
  group.name = 'realProp:' + asset;
  scaleToTarget(group, PROP_MAP[asset]);   // Kenney kit → real-world size
  groundAndCenter(group);
  if (Array.isArray(o.position) && o.position.length === 3) {
    group.position.x += Number(o.position[0]) || 0;
    group.position.y += Number(o.position[1]) || 0;
    group.position.z += Number(o.position[2]) || 0;
  } else {
    const n = _propPlaceCount;
    const ang = n * 2.39996;
    const rad = 0.7 * Math.sqrt(n);
    group.position.x += Math.cos(ang) * rad;
    group.position.z += Math.sin(ang) * rad;
  }
  _propPlaceCount++;
  group.updateMatrixWorld(true);
  scene.add(group);
  if (typeof window !== 'undefined') window.__studioLastPlacedGroup = group;
  if (typeof window !== 'undefined' && window.__studioToast) window.__studioToast(`Placed ${asset}`, 'ok');
  return { ok: true, asset, group };
}

// ── ENVIRONMENT (real outdoor HDRI sky) ──────────────────────────────────────
const _hdriLoader = (typeof THREE !== 'undefined') ? new RGBELoader() : null;
let _hdriPmrem = null;
const _hdriEnvCache = {};   // id -> PMREM env texture

function _pmrem() {
  if (_hdriPmrem) return _hdriPmrem;
  const r = (typeof window !== 'undefined' && window.__archdiscViewport) ? window.__archdiscViewport.renderer : null;
  if (!r) return null;
  _hdriPmrem = new THREE.PMREMGenerator(r);
  return _hdriPmrem;
}

// PUBLIC: set the scene's environment + background to a real outdoor .hdr.
// Resolves { ok, id, width, height }. Uses PMREM when a renderer is present (so
// reflections + IBL match the sky); falls back to the raw equirect texture as
// background/environment when no renderer (e.g. headless probe).
export async function setEnvironmentHDRI(id) {
  const key = String(id || '').toLowerCase();
  if (!HDRI_MAP[key]) throw new Error('set-environment: unknown hdri "' + id + '" (have: ' + HDRI_ASSETS.join(', ') + ')');
  if (!_hdriLoader) throw new Error('set-environment: RGBELoader unavailable');
  const scene = _studioScene();
  const url = assetUrl(`assets/hdri/${key}.hdr`);
  const texture = await _hdriLoader.setDataType(THREE.FloatType).loadAsync(url);
  texture.mapping = THREE.EquirectangularReflectionMapping;
  let envTex = _hdriEnvCache[key] || null;
  const pmrem = _pmrem();
  if (pmrem) {
    if (!envTex) { envTex = pmrem.fromEquirectangular(texture).texture; _hdriEnvCache[key] = envTex; }
  }
  if (scene) {
    scene.environment = envTex || texture;
    scene.background = envTex || texture;
  }
  if (typeof window !== 'undefined') {
    window.__studioCurrentEnvironmentHDRI = key;
    if (window.__studioToast) window.__studioToast(`Sky: ${HDRI_MAP[key].label}`, 'ok');
  }
  return {
    ok: true,
    id: key,
    width: texture.image && texture.image.width,
    height: texture.image && texture.image.height,
    url,
  };
}

// ── install ──────────────────────────────────────────────────────────────────
export function installRealCharacter() {
  if (typeof window === 'undefined') return { ok: false };
  window.__studioImportCharacter = importCharacter;
  window.__studioCharacterWalkPath = characterWalkPath;
  window.__studioPlaceProp = placeProp;
  window.__studioSetEnvironmentHDRI = setEnvironmentHDRI;
  window.__studioCharacterAssets = CHARACTER_ASSETS;
  window.__studioPropAssets = PROP_ASSETS;
  window.__studioVehicleAssets = VEHICLE_ASSETS;
  window.__studioTreeAssets = TREE_ASSETS;
  window.__studioEnvironmentHDRIs = HDRI_ASSETS;
  return { ok: true };
}

export function uninstallRealCharacter() {
  if (typeof window === 'undefined') return { ok: false };
  for (const k of ['__studioImportCharacter', '__studioCharacterWalkPath', '__studioPlaceProp', '__studioSetEnvironmentHDRI']) {
    try { delete window[k]; } catch (_) { window[k] = undefined; }
  }
  return { ok: true };
}

export default installRealCharacter;
