// Slice 725 — KeyShot Hero Shot animation preset. One-call setups
// that wire (a) slice-713 cinetracks camera path + look-at, (b)
// slice-713 stage 3-point lighting around the selected object, and
// (c) slice-704 hdri or slice-707 light groups. Lets non-experts
// produce a polished hero animation in one button click.

import * as THREE from 'three';

function _meshAt(uuid) {
  return window.__archdiscScene?.getObjectByProperty('uuid', uuid);
}

export function heroOrbit(heroUuid, opts) {
  const mesh = _meshAt(heroUuid);
  if (!mesh) return { ok: false };
  const radius = Number(opts?.radius) || 3;
  const height = Number(opts?.height) || 1.5;
  const duration = Number(opts?.duration) || 8;
  const samples = Number(opts?.waypoints) || 8;
  const box = new THREE.Box3().setFromObject(mesh);
  const center = box.getCenter(new THREE.Vector3());
  // Build camera waypoints.
  const waypoints = [];
  for (let i = 0; i <= samples; i++) {
    const a = (i / samples) * Math.PI * 2;
    waypoints.push([
      center.x + Math.cos(a) * radius,
      center.y + height,
      center.z + Math.sin(a) * radius,
    ]);
  }
  // Build look-at keyframes — always look at hero centroid.
  const lookAtKeys = [];
  for (let i = 0; i <= samples; i++) {
    lookAtKeys.push({ frame: Math.floor((i / samples) * duration * 30), pos: [center.x, center.y, center.z] });
  }
  // Stage lighting.
  if (typeof window.__studioStage3Point === 'function') {
    window.__studioStage3Point({ target: [center.x, center.y, center.z], distance: radius });
  }
  // Cinematic camera.
  if (typeof window.__studioCineCreate === 'function') {
    const r = window.__studioCineCreate({ duration, fps: 30 });
    if (r.ok) {
      window.__studioCineSetCameraPath(r.id, waypoints, { smoothing: 0.4 });
      window.__studioCineSetLookAt(r.id, lookAtKeys);
      window.__studioCineSetDOF(r.id, [
        { frame: 0, focusDistance: radius, aperture: 0.08 },
        { frame: duration * 30, focusDistance: radius, aperture: 0.08 },
      ]);
      window.__studioCinePlay(r.id);
      return { ok: true, cineId: r.id };
    }
  }
  return { ok: true, waypoints, lookAtKeys };
}

export function heroPan(heroUuid, opts) {
  const mesh = _meshAt(heroUuid);
  if (!mesh) return { ok: false };
  const startSide = opts?.startSide || 'left';
  const distance = Number(opts?.distance) || 4;
  const duration = Number(opts?.duration) || 6;
  const box = new THREE.Box3().setFromObject(mesh);
  const center = box.getCenter(new THREE.Vector3());
  const dir = startSide === 'left' ? -1 : 1;
  const waypoints = [
    [center.x + dir * distance, center.y, center.z],
    [center.x, center.y, center.z + distance],
    [center.x - dir * distance, center.y, center.z],
  ];
  const lookAtKeys = [{ frame: 0, pos: [center.x, center.y, center.z] }];
  if (typeof window.__studioStage3Point === 'function') {
    window.__studioStage3Point({ target: [center.x, center.y, center.z], distance });
  }
  if (typeof window.__studioCineCreate === 'function') {
    const r = window.__studioCineCreate({ duration, fps: 30 });
    if (r.ok) {
      window.__studioCineSetCameraPath(r.id, waypoints, { smoothing: 0.5 });
      window.__studioCineSetLookAt(r.id, lookAtKeys);
      window.__studioCinePlay(r.id);
      return { ok: true, cineId: r.id };
    }
  }
  return { ok: true, waypoints };
}

export function heroReveal(heroUuid, opts) {
  // Push in from far → close while spinning the hero.
  const mesh = _meshAt(heroUuid);
  if (!mesh) return { ok: false };
  const farDist = Number(opts?.farDistance) || 8;
  const closeDist = Number(opts?.closeDistance) || 2.5;
  const duration = Number(opts?.duration) || 6;
  const box = new THREE.Box3().setFromObject(mesh);
  const center = box.getCenter(new THREE.Vector3());
  const waypoints = [];
  const samples = 6;
  for (let i = 0; i <= samples; i++) {
    const t = i / samples;
    const r = farDist * (1 - t) + closeDist * t;
    const a = t * Math.PI;
    waypoints.push([
      center.x + Math.cos(a) * r,
      center.y + 0.5 + r * 0.1,
      center.z + Math.sin(a) * r,
    ]);
  }
  const lookAtKeys = [{ frame: 0, pos: [center.x, center.y, center.z] }];
  if (typeof window.__studioStage3Point === 'function') {
    window.__studioStage3Point({ target: [center.x, center.y, center.z], distance: closeDist * 1.5 });
  }
  if (typeof window.__studioCineCreate === 'function') {
    const r = window.__studioCineCreate({ duration, fps: 30 });
    if (r.ok) {
      window.__studioCineSetCameraPath(r.id, waypoints, { smoothing: 0.3 });
      window.__studioCineSetLookAt(r.id, lookAtKeys);
      window.__studioCineSetDOF(r.id, [
        { frame: 0, focusDistance: farDist, aperture: 0.1 },
        { frame: duration * 30, focusDistance: closeDist, aperture: 0.05 },
      ]);
      window.__studioCinePlay(r.id);
      return { ok: true, cineId: r.id };
    }
  }
  return { ok: true };
}
