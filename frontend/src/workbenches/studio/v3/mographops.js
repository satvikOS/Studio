// ArchDisc Studio V3 — mograph / IK family.
//
// V3-native ports of:
//   __studioSolveIK2        — analytic 2-bone IK solver (Maya ikRPSolver
//                             / Blender Bone Constraint IK / Spine)
//   __studioMoSpline        — C4D MoSpline-style parametric curve
//                             (helix/lissajous/spiral/sine)
//   __studioMoText          — C4D MoText / Blender Text — TextGeometry
//                             with lazy font load + plane fallback
//   __studioMashDistribute  — Maya MASH Distribute / C4D Cloner —
//                             grid/sphere/line instanced grid
//   __studioParticleEmitter — Unreal Niagara CPU emitter — rAF-driven
//                             gravity + lifetime ring buffer of points

import * as THREE from 'three';
import { TextGeometry } from 'three/examples/jsm/geometries/TextGeometry.js';
import { FontLoader } from 'three/examples/jsm/loaders/FontLoader.js';

const PRIMITIVE_SIZE = 0.03;

function scene() {
  return window.__archdiscScene || (window.__archdiscViewport && window.__archdiscViewport.scene) || null;
}
function attachAndSelect(mesh) {
  const s = scene(); if (!s) return;
  s.add(mesh);
  if (window.__studioSelectMesh) { try { window.__studioSelectMesh(mesh); } catch (_) {} }
}

// ─── IK ─────────────────────────────────────────────────────────────────
function solveIK2(opts) {
  const { rootPos, midPos, endPos, targetPos, poleHint = [0, 0, 1] } = (opts || {});
  if (!rootPos || !midPos || !endPos || !targetPos) return { ok: false, error: 'missing rootPos/midPos/endPos/targetPos' };
  const root = new THREE.Vector3().fromArray(rootPos);
  const mid  = new THREE.Vector3().fromArray(midPos);
  const end  = new THREE.Vector3().fromArray(endPos);
  const tgt  = new THREE.Vector3().fromArray(targetPos);
  const L1 = mid.distanceTo(root);
  const L2 = end.distanceTo(mid);
  if (L1 <= 0 || L2 <= 0) return { ok: false, error: 'zero-length bone' };
  const total = L1 + L2;
  const toTgt = tgt.clone().sub(root);
  let D = toTgt.length();
  let clamped = false;
  if (D > total - 1e-6) { D = total - 1e-6; clamped = true; toTgt.setLength(D); }
  if (D < 1e-6) { D = 1e-6; toTgt.set(0, 1e-6, 0); }
  const cosT = Math.max(-1, Math.min(1, (L1 * L1 + L2 * L2 - D * D) / (2 * L1 * L2)));
  const bend = Math.PI - Math.acos(cosT);
  const cosA = Math.max(-1, Math.min(1, (L1 * L1 + D * D - L2 * L2) / (2 * L1 * D)));
  const shoulderOffset = Math.acos(cosA);
  const dirN = toTgt.clone().normalize();
  let pole = new THREE.Vector3().fromArray(poleHint);
  let bendAxis = new THREE.Vector3().crossVectors(dirN, pole);
  if (bendAxis.lengthSq() < 1e-8) {
    pole.set(0, 0, 1);
    bendAxis = new THREE.Vector3().crossVectors(dirN, pole);
    if (bendAxis.lengthSq() < 1e-8) {
      pole.set(1, 0, 0);
      bendAxis = new THREE.Vector3().crossVectors(dirN, pole);
    }
  }
  bendAxis.normalize();
  const yAxis = new THREE.Vector3(0, 1, 0);
  const aim = new THREE.Quaternion().setFromUnitVectors(yAxis, dirN);
  const shoulder = new THREE.Quaternion().setFromAxisAngle(bendAxis, -shoulderOffset);
  const rootQ = new THREE.Quaternion().multiplyQuaternions(aim, shoulder);
  const midQ = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), bend);
  const rE = new THREE.Euler().setFromQuaternion(rootQ, 'XYZ');
  const mE = new THREE.Euler().setFromQuaternion(midQ, 'XYZ');
  const tipLocal = new THREE.Vector3(0, L1, 0).add(new THREE.Vector3(0, L2, 0).applyEuler(mE));
  const solvedEnd = tipLocal.applyQuaternion(rootQ).add(root);
  return {
    ok: true,
    rootRot: [rE.x, rE.y, rE.z],
    midRot:  [mE.x, mE.y, mE.z],
    L1, L2, totalLen: total, reach: tgt.distanceTo(root),
    clamped, bendAngle: bend,
    solvedEnd: [solvedEnd.x, solvedEnd.y, solvedEnd.z],
  };
}

// ─── MoSpline ───────────────────────────────────────────────────────────
function moSpline(opts = {}) {
  const s = scene(); if (!s) return { ok: false, error: 'no scene' };
  const { type = 'helix', segments = 100, radius = 1, height = 1, turns = 1 } = opts;
  const N = Math.max(2, segments | 0);
  const points = [];
  for (let i = 0; i < N; i++) {
    const t = i / (N - 1);
    const a = t * Math.PI * 2 * turns;
    let p;
    if (type === 'helix')      p = [radius * Math.cos(a), (t - 0.5) * height, radius * Math.sin(a)];
    else if (type === 'lissajous') p = [radius * Math.sin(3 * t * Math.PI * 2), radius * Math.sin(5 * t * Math.PI * 2 + Math.PI / 4), 0];
    else if (type === 'spiral') p = [radius * t * Math.cos(a), 0, radius * t * Math.sin(a)];
    else if (type === 'sine')   p = [(t - 0.5) * height, radius * Math.sin(a), 0];
    else return { ok: false, error: 'unknown type: ' + type };
    points.push(p);
  }
  const arr = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) {
    arr[i * 3] = points[i][0]; arr[i * 3 + 1] = points[i][1]; arr[i * 3 + 2] = points[i][2];
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(arr, 3));
  const mat = new THREE.LineBasicMaterial({ color: 0xffcc55 });
  const line = new THREE.Line(g, mat);
  line.userData.archdiscStudioPrimitive = true;
  line.userData.archdiscStudioPrimitiveKind = 'mospline';
  line.userData.archdiscMoSpline = { type, segments: N, radius, height, turns };
  line.userData.pickable = true;
  line.name = `studio-primitive-mospline-${type}`;
  attachAndSelect(line);
  return { ok: true, uuid: line.uuid, type, segments: N, points };
}

// ─── MoText ─────────────────────────────────────────────────────────────
// Lazy font load. V2 keeps a fontRef and rejects until ready; V3 here
// loads on first call and caches.
let _font = null;
let _fontLoading = null;
async function loadFont() {
  if (_font) return _font;
  if (_fontLoading) return _fontLoading;
  _fontLoading = new Promise((resolve) => {
    const loader = new FontLoader();
    loader.load(
      'https://threejs.org/examples/fonts/helvetiker_regular.typeface.json',
      (f) => { _font = f; resolve(f); },
      undefined,
      () => { _font = null; resolve(null); },
    );
  });
  return _fontLoading;
}

async function moText(opts = {}) {
  const s = scene(); if (!s) return { ok: false, error: 'no scene' };
  const { text = 'Studio', size = 0.05, color = '#dddddd' } = opts;
  if (!text || !text.length) return { ok: false, error: 'empty text' };
  let geometry;
  let usedFont = false;
  try {
    const font = await loadFont();
    if (font) {
      geometry = new TextGeometry(String(text), {
        font, size, depth: size * 0.3,
        curveSegments: 6,
        bevelEnabled: true,
        bevelThickness: size * 0.02,
        bevelSize: size * 0.015,
        bevelSegments: 2,
      });
      geometry.center();
      usedFont = true;
    } else {
      geometry = new THREE.PlaneGeometry(size * text.length * 0.6, size);
    }
  } catch (_) {
    geometry = new THREE.PlaneGeometry(size * text.length * 0.6, size);
  }
  const material = new THREE.MeshStandardMaterial({ color, metalness: 0.25, roughness: 0.45 });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = true; mesh.receiveShadow = true;
  mesh.userData.archdiscStudioPrimitive = true;
  mesh.userData.archdiscStudioPrimitiveKind = 'motext';
  mesh.userData.archdiscMoText = { text: String(text), size, usedFont };
  mesh.userData.pickable = true;
  mesh.name = 'studio-primitive-motext';
  attachAndSelect(mesh);
  return { ok: true, uuid: mesh.uuid, text: String(text), size, usedFont };
}

// ─── MashDistribute ─────────────────────────────────────────────────────
function mashDistribute(opts) {
  const s = scene(); if (!s) return { ok: false, error: 'no scene' };
  const { sourceUuid, count, mode = 'grid', target = [0, 0, 0],
          posJitter = 0, rotJitter = 0, seed = 1 } = (opts || {});
  let src = null;
  s.traverse((o) => { if (o.isMesh && o.uuid === sourceUuid) src = o; });
  if (!src || !src.geometry || !src.material) return { ok: false, error: 'no source mesh by sourceUuid' };
  let a = (seed >>> 0) || 1;
  const rng = () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const N = mode === 'grid' ? count * count : count;
  const inst = new THREE.InstancedMesh(src.geometry, src.material, N);
  const dummy = new THREE.Object3D();
  const STEP = 0.08;
  for (let i = 0; i < N; i++) {
    let px = 0, py = 0, pz = 0;
    if (mode === 'grid') {
      const c = count, ix = i % c, iz = (i / c) | 0;
      px = (ix - (c - 1) / 2) * STEP; pz = (iz - (c - 1) / 2) * STEP;
    } else if (mode === 'sphere') {
      const phi = Math.acos(1 - 2 * (i + 0.5) / N);
      const theta = Math.PI * (1 + Math.sqrt(5)) * i;
      const R = STEP * count * 0.4;
      px = R * Math.sin(phi) * Math.cos(theta);
      py = R * Math.cos(phi);
      pz = R * Math.sin(phi) * Math.sin(theta);
    } else { px = (i - (N - 1) / 2) * STEP; }
    dummy.position.set(
      target[0] + px + (rng() * 2 - 1) * posJitter,
      target[1] + py + (rng() * 2 - 1) * posJitter,
      target[2] + pz + (rng() * 2 - 1) * posJitter,
    );
    dummy.rotation.set((rng() * 2 - 1) * rotJitter, (rng() * 2 - 1) * rotJitter, (rng() * 2 - 1) * rotJitter);
    dummy.scale.setScalar(1);
    dummy.updateMatrix();
    inst.setMatrixAt(i, dummy.matrix);
  }
  inst.instanceMatrix.needsUpdate = true;
  inst.userData.archdiscStudioPrimitive = true;
  inst.userData.archdiscStudioPrimitiveKind = 'mash-distribute';
  inst.userData.archdiscStudioMash = { sourceUuid, mode, count: N, seed };
  inst.userData.pickable = true;
  inst.name = `studio-primitive-mash-${mode}-${N}`;
  s.add(inst);
  if (window.__studioSelectMesh) { try { window.__studioSelectMesh(inst); } catch (_) {} }
  return { ok: true, uuid: inst.uuid, count: N, mode };
}

// ─── ParticleEmitter ────────────────────────────────────────────────────
function particleEmitter(opts) {
  const s = scene(); if (!s) return { ok: false, error: 'no scene' };
  const { position = [0, 0, 0], rate = 100, lifetime = 1.0,
          gravity = [0, -1, 0], initialVelocity = [0, 1, 0] } = (opts || {});
  const MAX = 5000;
  const positions = new Float32Array(MAX * 3);
  const velocities = new Float32Array(MAX * 3);
  const ages = new Float32Array(MAX);
  const alive = new Uint8Array(MAX);
  for (let i = 0; i < MAX; i++) ages[i] = -1;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const points = new THREE.Points(geo, new THREE.PointsMaterial({ size: 0.02, color: 0xffffff, sizeAttenuation: true, transparent: true, opacity: 0.9 }));
  points.userData.archdiscStudioParticleEmitter = true;
  s.add(points);
  let spawnPtr = 0, accum = 0, last = performance.now(), rafId = null, paused = false, stopped = false;
  const px0 = position[0], py0 = position[1], pz0 = position[2];
  const vx0 = initialVelocity[0], vy0 = initialVelocity[1], vz0 = initialVelocity[2];
  const gx = gravity[0], gy = gravity[1], gz = gravity[2];
  function jit() { return (Math.random() - 0.5) * 0.4; }
  function tick(now) {
    if (stopped) return;
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (!paused) {
      accum += rate * dt;
      const toSpawn = Math.floor(accum);
      accum -= toSpawn;
      for (let n = 0; n < toSpawn; n++) {
        const i = spawnPtr; spawnPtr = (spawnPtr + 1) % MAX;
        positions[i * 3] = px0; positions[i * 3 + 1] = py0; positions[i * 3 + 2] = pz0;
        velocities[i * 3] = vx0 + jit(); velocities[i * 3 + 1] = vy0 + jit(); velocities[i * 3 + 2] = vz0 + jit();
        ages[i] = 0; alive[i] = 1;
      }
      for (let i = 0; i < MAX; i++) {
        if (!alive[i]) continue;
        ages[i] += dt;
        if (ages[i] > lifetime) { alive[i] = 0; positions[i * 3 + 1] = 1e6; continue; }
        velocities[i * 3] += gx * dt; velocities[i * 3 + 1] += gy * dt; velocities[i * 3 + 2] += gz * dt;
        positions[i * 3] += velocities[i * 3] * dt;
        positions[i * 3 + 1] += velocities[i * 3 + 1] * dt;
        positions[i * 3 + 2] += velocities[i * 3 + 2] * dt;
      }
      geo.attributes.position.needsUpdate = true;
    }
    rafId = requestAnimationFrame(tick);
  }
  rafId = requestAnimationFrame(tick);
  return {
    ok: true, uuid: points.uuid,
    stop() {
      stopped = true;
      if (rafId != null) cancelAnimationFrame(rafId);
      rafId = null;
      s.remove(points);
      if (geo && geo.dispose) geo.dispose();
    },
    pause() { paused = !paused; return paused; },
    state() { let c = 0; for (let i = 0; i < MAX; i++) c += alive[i]; return { alive: c, paused, stopped }; },
  };
}

export function registerMographOps() {
  window.__studioSolveIK2        = solveIK2;
  window.__studioMoSpline        = moSpline;
  window.__studioMoText          = moText;
  window.__studioMashDistribute  = mashDistribute;
  window.__studioParticleEmitter = particleEmitter;
}

export function unregisterMographOps() {
  for (const k of [
    '__studioSolveIK2', '__studioMoSpline', '__studioMoText',
    '__studioMashDistribute', '__studioParticleEmitter',
  ]) { try { delete window[k]; } catch (_) {} }
}
