// TEMP headless harness — diagnose the Soldier.glb bake explosion.
// No GPU. Pure three geometry math. Loads the glb via GLTFLoader.parse(arraybuffer),
// replicates importCharacter's transforms, then runs the SAME bakeSkinnedGeometry
// math and prints bounding boxes at each stage for several animation times.
//
// Run: node frontend/_bake_harness.mjs

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CHARS = join(__dirname, 'public/assets/characters');

// We only care about GEOMETRY + SKELETON, not textures. GLTFLoader's texture
// path needs `self`/createImageBitmap (browser-only) → stub them to no-op so the
// parser resolves geometry without touching the DOM.
globalThis.self = globalThis;
globalThis.createImageBitmap = () => Promise.resolve({ width: 1, height: 1, close() {} });

// --- load a .glb from disk via GLTFLoader.parse (no fetch / file://) ---
function loadGLB(file) {
  const buf = readFileSync(join(CHARS, file));
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  const loader = new GLTFLoader();
  return new Promise((res, rej) => loader.parse(ab, '', res, rej));
}

function bbox(obj) {
  obj.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(obj);
  const sz = box.getSize(new THREE.Vector3());
  return { box, sz, h: sz.y, maxExtent: Math.max(sz.x, sz.y, sz.z), min: box.min.clone(), max: box.max.clone() };
}

function fmt(v) { return `[${v.x.toFixed(3)}, ${v.y.toFixed(3)}, ${v.z.toFixed(3)}]`; }

// ============================================================================
// (1) replicate importCharacter's clone + rebind + scale-to-height + ground
// ============================================================================
function simulateImport(masterScene, targetH = 1.8) {
  const group = masterScene.clone(true);
  // rebind cloned skinned meshes to cloned bones (as realCharacter.js does)
  const boneByName = {};
  group.traverse((o) => { if (o.isBone) boneByName[o.name] = o; });
  group.traverse((o) => {
    if (o.isSkinnedMesh && o.skeleton) {
      const bones = o.skeleton.bones.map((b) => boneByName[b.name] || b);
      const skeleton = new THREE.Skeleton(bones, o.skeleton.boneInverses);
      o.bind(skeleton, o.bindMatrix);
    }
  });
  // scale to height
  group.updateMatrixWorld(true);
  let box = new THREE.Box3().setFromObject(group);
  let size = box.getSize(new THREE.Vector3());
  if (size.y > 1e-4) { group.scale.multiplyScalar(targetH / size.y); group.updateMatrixWorld(true); }
  // ground + center
  group.updateMatrixWorld(true);
  box = new THREE.Box3().setFromObject(group);
  const center = box.getCenter(new THREE.Vector3());
  group.position.x -= center.x; group.position.z -= center.z; group.position.y -= box.min.y;
  group.updateMatrixWorld(true);
  return group;
}

// ============================================================================
// (2a) CURRENT (broken) bake — copied verbatim from PathTracedRender.js
// ============================================================================
function bakeCURRENT(m) {
  if (!m || !m.isSkinnedMesh || !m.geometry || !m.geometry.attributes.position) {
    return m && m.geometry ? m.geometry.clone() : null;
  }
  m.updateWorldMatrix?.(true, false);
  if (m.skeleton && m.skeleton.update) m.skeleton.update();
  const src = m.geometry;
  const idx = src.index;
  const posAttr = src.attributes.position;
  const triCount = idx ? idx.count : posAttr.count;
  const out = new THREE.BufferGeometry();
  const positions = new Float32Array(triCount * 3);
  const v = new THREE.Vector3();
  const ws = new THREE.Vector3();
  m.getWorldScale(ws);
  const meshScale = (Math.abs(ws.x) + Math.abs(ws.y) + Math.abs(ws.z)) / 3;
  const needsWorld = Math.abs(meshScale - 1) > 0.02;
  const mw = m.matrixWorld;
  for (let i = 0; i < triCount; i++) {
    const vi = idx ? idx.getX(i) : i;
    m.getVertexPosition(vi, v);
    if (needsWorld) v.applyMatrix4(mw);
    positions[i * 3] = v.x; positions[i * 3 + 1] = v.y; positions[i * 3 + 2] = v.z;
  }
  out.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  out.computeVertexNormals();
  out.computeBoundingBox();
  return out;
}

// ============================================================================
// (2b) PROPOSED FIX bake — getVertexPosition returns mesh-LOCAL space;
//      ALWAYS land in world via the mesh's matrixWorld.
// ============================================================================
function bakeFIX(m) {
  if (!m || !m.isSkinnedMesh || !m.geometry || !m.geometry.attributes.position) {
    return m && m.geometry ? m.geometry.clone() : null;
  }
  m.updateWorldMatrix?.(true, false);
  if (m.skeleton && m.skeleton.update) m.skeleton.update();
  const src = m.geometry;
  const idx = src.index;
  const posAttr = src.attributes.position;
  const triCount = idx ? idx.count : posAttr.count;
  const out = new THREE.BufferGeometry();
  const positions = new Float32Array(triCount * 3);
  const v = new THREE.Vector3();
  const mw = m.matrixWorld; // getVertexPosition → mesh-local; matrixWorld → world
  for (let i = 0; i < triCount; i++) {
    const vi = idx ? idx.getX(i) : i;
    m.getVertexPosition(vi, v);
    v.applyMatrix4(mw);
    positions[i * 3] = v.x; positions[i * 3 + 1] = v.y; positions[i * 3 + 2] = v.z;
  }
  out.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  out.computeVertexNormals();
  out.computeBoundingBox();
  return out;
}

function bakeGroup(group, bakeFn) {
  group.updateMatrixWorld(true);
  const out = new THREE.Group();
  group.traverse((o) => {
    if (o.isSkinnedMesh && o.geometry) {
      o.updateWorldMatrix(true, false);
      const geo = bakeFn(o);
      if (geo) out.add(new THREE.Mesh(geo)); // baked is WORLD-space → no transform
    } else if (o.isMesh && o.geometry) {
      const g = o.geometry.clone(); const mesh = new THREE.Mesh(g); mesh.applyMatrix4(o.matrixWorld); out.add(mesh);
    }
  });
  return out;
}

function hasNaN(group) {
  let nan = false;
  group.traverse((o) => {
    if (o.geometry && o.geometry.attributes.position) {
      const a = o.geometry.attributes.position.array;
      for (let i = 0; i < a.length; i++) if (!Number.isFinite(a[i])) { nan = true; break; }
    }
  });
  return nan;
}

// ============================================================================
// Build a STAND-IN procedural humanoid SkinnedMesh (armature scale=1, mesh at
// origin) to confirm the fix doesn't regress it.
// ============================================================================
function buildProceduralHumanoid() {
  // 2 bones along Y: hips (y=0) -> chest (y=0.9). A tall box skinned to them.
  const root = new THREE.Bone(); root.position.set(0, 0, 0);
  const chest = new THREE.Bone(); chest.position.set(0, 0.9, 0); root.add(chest);
  const bones = [root, chest];
  const skeleton = new THREE.Skeleton(bones);

  const geo = new THREE.BoxGeometry(0.4, 1.8, 0.25, 1, 8, 1);
  // shift up so it stands on y=0
  geo.translate(0, 0.9, 0);
  const pos = geo.attributes.position;
  const n = pos.count;
  const skinIndex = new Uint16Array(n * 4);
  const skinWeight = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    const y = pos.getY(i);
    const w = THREE.MathUtils.clamp(y / 1.8, 0, 1); // 0 lower→hips, 1 upper→chest
    skinIndex[i * 4] = 0; skinIndex[i * 4 + 1] = 1;
    skinWeight[i * 4] = 1 - w; skinWeight[i * 4 + 1] = w;
  }
  geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(skinIndex, 4));
  geo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(skinWeight, 4));

  const mesh = new THREE.SkinnedMesh(geo, new THREE.MeshStandardMaterial());
  const armature = new THREE.Group();
  armature.add(root);
  armature.add(mesh);
  mesh.add(root); // ensure bones in tree under mesh's parent chain
  armature.updateMatrixWorld(true);
  mesh.bind(skeleton); // bind at world (identity) → procedural family
  const group = new THREE.Group();
  group.add(armature);

  // a trivial "Run" clip: bend the chest bone back and forth
  const track = new THREE.QuaternionKeyframeTrack(
    chest.uuid + '.quaternion',
    [0, 0.5, 1],
    [
      ...new THREE.Quaternion().setFromEuler(new THREE.Euler(0.3, 0, 0)).toArray(),
      ...new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.3, 0, 0)).toArray(),
      ...new THREE.Quaternion().setFromEuler(new THREE.Euler(0.3, 0, 0)).toArray(),
    ],
  );
  const clip = new THREE.AnimationClip('Run', 1, [track]);
  return { scene: group, animations: [clip], _chest: chest };
}

// ============================================================================
function reportCharacter(label, master) {
  console.log(`\n========== ${label} ==========`);
  // bind-pose bbox of the RAW master
  const mb = bbox(master.scene);
  console.log(`master(raw) bbox h=${mb.h.toFixed(3)} maxExtent=${mb.maxExtent.toFixed(3)} min=${fmt(mb.min)} max=${fmt(mb.max)}`);
  // inspect mesh world scales + bindMatrix
  master.scene.traverse((o) => {
    if (o.isSkinnedMesh) {
      o.updateWorldMatrix(true, false);
      const ws = new THREE.Vector3(); o.getWorldScale(ws);
      const bm = o.bindMatrix.elements;
      const bmScale = Math.hypot(bm[0], bm[1], bm[2]);
      console.log(`  mesh "${o.name}" worldScale=${fmt(ws)} bindMatrixScale=${bmScale.toFixed(4)} bones=${o.skeleton.bones.length}`);
    }
  });

  const clips = master.animations || [];
  const clipNames = clips.map((c) => c.name);
  console.log(`  clips: ${clipNames.join(', ') || '(none)'}`);

  // import (clone + rebind + scale to 1.8 + ground)
  const group = simulateImport(master.scene, 1.8);
  const ib = bbox(group);
  console.log(`  IMPORTED group bbox h=${ib.h.toFixed(3)} maxExtent=${ib.maxExtent.toFixed(3)} (expect h≈1.8)`);

  // pick a clip to animate (prefer Run/run, else first)
  const clip = clips.find((c) => /run/i.test(c.name)) || clips[0] || null;
  let mixer = null;
  if (clip) { mixer = new THREE.AnimationMixer(group); mixer.clipAction(clip).play(); }

  const times = clip ? [0, clip.duration * 0.25, clip.duration * 0.5, clip.duration * 0.75] : [0];
  for (const t of times) {
    if (mixer) { mixer.setTime(t); }
    group.updateMatrixWorld(true);

    const bakedCur = bakeGroup(group, bakeCURRENT);
    const bakedFix = bakeGroup(group, bakeFIX);
    const bc = bbox(bakedCur);
    const bf = bbox(bakedFix);
    const nanCur = hasNaN(bakedCur), nanFix = hasNaN(bakedFix);
    console.log(`  t=${t.toFixed(3)}  CURRENT: h=${bc.h.toFixed(3)} maxExt=${bc.maxExtent.toFixed(3)} nan=${nanCur}  |  FIX: h=${bf.h.toFixed(3)} maxExt=${bf.maxExtent.toFixed(3)} nan=${nanFix}`);
  }
  return group;
}

(async () => {
  const soldier = await loadGLB('Soldier.glb');
  reportCharacter('Soldier.glb (REAL glTF rig)', soldier);

  const proc = buildProceduralHumanoid();
  reportCharacter('Procedural humanoid (stand-in, armature scale=1)', proc);

  // also try Xbot (49+ bone real rig per the registry note) and Robot
  try { reportCharacter('Xbot.glb (REAL glTF rig)', await loadGLB('Xbot.glb')); } catch (e) { console.log('Xbot skip:', e.message); }
  try { reportCharacter('RobotExpressive.glb (REAL glTF rig)', await loadGLB('RobotExpressive.glb')); } catch (e) { console.log('Robot skip:', e.message); }

  console.log('\n[done]');
})().catch((e) => { console.error('HARNESS ERROR:', e); process.exit(1); });
