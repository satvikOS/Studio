// Slice 716 — C4D Spline Wrap deformer. Bends a mesh along a target
// spline by mapping the mesh's longest-axis range to the spline's
// arc-length parameter. Each vertex is re-anchored to the spline
// position at its mapped t, plus perpendicular offset preserved
// from the original. Mirrors C4D's Spline Wrap + Spline Rail.

import * as THREE from 'three';

const _bindings = new Map();   // meshUuid → { spline, axis, baseColors, basePositions }

function _sampleSpline(spline, t) {
  if (!spline || spline.length < 2) return new THREE.Vector3();
  const seg = (spline.length - 1) * t;
  const i = Math.min(spline.length - 2, Math.floor(seg));
  const f = seg - i;
  const a = new THREE.Vector3(...spline[i]);
  const b = new THREE.Vector3(...spline[i + 1]);
  return a.lerp(b, f);
}

function _tangent(spline, t) {
  const eps = 1e-3;
  const a = _sampleSpline(spline, Math.max(0, t - eps));
  const b = _sampleSpline(spline, Math.min(1, t + eps));
  return b.sub(a).normalize();
}

export function bind(meshUuid, spline, axis) {
  const scene = window.__archdiscScene;
  if (!scene) return { ok: false };
  const mesh = scene.getObjectByProperty('uuid', meshUuid);
  if (!mesh?.geometry) return { ok: false };
  const pos = mesh.geometry.attributes.position;
  _bindings.set(meshUuid, {
    spline: spline.map((p) => [p[0], p[1], p[2]]),
    axis: axis || 'y',
    basePositions: new Float32Array(pos.array),
  });
  _apply(meshUuid);
  return { ok: true };
}

function _apply(meshUuid) {
  const b = _bindings.get(meshUuid);
  if (!b) return;
  const scene = window.__archdiscScene;
  const mesh = scene?.getObjectByProperty('uuid', meshUuid);
  if (!mesh) return;
  const pos = mesh.geometry.attributes.position;
  // Find axis range.
  const axisIdx = b.axis === 'x' ? 0 : b.axis === 'z' ? 2 : 1;
  let minV = Infinity, maxV = -Infinity;
  for (let i = 0; i < pos.count; i++) {
    const v = b.basePositions[i * 3 + axisIdx];
    if (v < minV) minV = v;
    if (v > maxV) maxV = v;
  }
  const span = maxV - minV || 1;
  for (let i = 0; i < pos.count; i++) {
    const bv = b.basePositions[i * 3 + axisIdx];
    const t = (bv - minV) / span;
    const splinePt = _sampleSpline(b.spline, t);
    const tan = _tangent(b.spline, t);
    const up = new THREE.Vector3(0, 1, 0);
    const right = up.clone().cross(tan).normalize();
    const newUp = tan.clone().cross(right).normalize();
    // Perpendicular offset in original mesh (off-axis components).
    const offA = b.basePositions[i * 3 + ((axisIdx + 1) % 3)];
    const offB = b.basePositions[i * 3 + ((axisIdx + 2) % 3)];
    pos.array[i * 3]     = splinePt.x + right.x * offA + newUp.x * offB;
    pos.array[i * 3 + 1] = splinePt.y + right.y * offA + newUp.y * offB;
    pos.array[i * 3 + 2] = splinePt.z + right.z * offA + newUp.z * offB;
  }
  pos.needsUpdate = true;
  mesh.geometry.computeVertexNormals();
}

export function setSpline(meshUuid, spline) {
  const b = _bindings.get(meshUuid);
  if (!b) return { ok: false };
  b.spline = spline.map((p) => [p[0], p[1], p[2]]);
  _apply(meshUuid);
  return { ok: true };
}

export function unbind(meshUuid) {
  const b = _bindings.get(meshUuid);
  if (!b) return { ok: false };
  const scene = window.__archdiscScene;
  const mesh = scene?.getObjectByProperty('uuid', meshUuid);
  if (mesh?.geometry) {
    const pos = mesh.geometry.attributes.position;
    pos.array.set(b.basePositions);
    pos.needsUpdate = true;
    mesh.geometry.computeVertexNormals();
  }
  _bindings.delete(meshUuid);
  return { ok: true };
}

export function listBindings() {
  return {
    ok: true,
    bindings: Array.from(_bindings.entries()).map(([uuid, b]) => ({
      meshUuid: uuid, axis: b.axis, splineLen: b.spline.length,
    })),
  };
}

// Spline Rail — two splines define a "track"; mesh is mapped between
// them like Sweep2 but as a deformer not a generator.
export function bindRail(meshUuid, splineA, splineB, axis) {
  const scene = window.__archdiscScene;
  if (!scene) return { ok: false };
  const mesh = scene.getObjectByProperty('uuid', meshUuid);
  if (!mesh?.geometry) return { ok: false };
  const basePositions = new Float32Array(mesh.geometry.attributes.position.array);
  _bindings.set(meshUuid, {
    spline: splineA,
    splineB,
    axis: axis || 'y',
    basePositions,
  });
  _applyRail(meshUuid);
  return { ok: true };
}

function _applyRail(meshUuid) {
  const b = _bindings.get(meshUuid);
  if (!b?.splineB) return _apply(meshUuid);
  const scene = window.__archdiscScene;
  const mesh = scene?.getObjectByProperty('uuid', meshUuid);
  if (!mesh) return;
  const pos = mesh.geometry.attributes.position;
  const axisIdx = b.axis === 'x' ? 0 : b.axis === 'z' ? 2 : 1;
  let minV = Infinity, maxV = -Infinity;
  for (let i = 0; i < pos.count; i++) {
    const v = b.basePositions[i * 3 + axisIdx];
    if (v < minV) minV = v;
    if (v > maxV) maxV = v;
  }
  const span = maxV - minV || 1;
  // Width axis range (the other axis).
  const widthIdx = (axisIdx + 1) % 3;
  let minW = Infinity, maxW = -Infinity;
  for (let i = 0; i < pos.count; i++) {
    const v = b.basePositions[i * 3 + widthIdx];
    if (v < minW) minW = v;
    if (v > maxW) maxW = v;
  }
  const widthSpan = maxW - minW || 1;
  for (let i = 0; i < pos.count; i++) {
    const t = (b.basePositions[i * 3 + axisIdx] - minV) / span;
    const u = (b.basePositions[i * 3 + widthIdx] - minW) / widthSpan;
    const pA = _sampleSpline(b.spline, t);
    const pB = _sampleSpline(b.splineB, t);
    const target = pA.clone().lerp(pB, u);
    // Vertical (other axis) offset preserved.
    const verticalIdx = (axisIdx + 2) % 3;
    const offV = b.basePositions[i * 3 + verticalIdx];
    pos.array[i * 3] = target.x;
    pos.array[i * 3 + 1] = target.y;
    pos.array[i * 3 + 2] = target.z;
    pos.array[i * 3 + verticalIdx] += offV;
  }
  pos.needsUpdate = true;
  mesh.geometry.computeVertexNormals();
}
