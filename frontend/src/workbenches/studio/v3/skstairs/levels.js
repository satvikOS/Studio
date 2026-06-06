// Slice 709 — SketchUp depth: scenes (saved camera bookmarks),
// 2D Schematic Floors (level-by-level), Solar Path overlay (sun
// position by date/time/lat/lng), and Section Plan output. Mirrors
// SketchUp's Scenes panel + Solar Toolbar + Section Plan.

import * as THREE from 'three';

const _scenes = new Map();   // name → { camPos, target, fov, near, far }
let _solarMarker = null;
let _solarLight = null;

export function saveScene(name, opts) {
  const v = window.__archdiscViewport;
  if (!v?.camera) return { ok: false };
  const cam = v.camera;
  const tgt = v.controls?.target || new THREE.Vector3();
  _scenes.set(name, {
    camPos: [cam.position.x, cam.position.y, cam.position.z],
    target: [tgt.x, tgt.y, tgt.z],
    fov: cam.isPerspectiveCamera ? cam.fov : 45,
    near: cam.near, far: cam.far,
    desc: opts?.desc || '',
    timestamp: Date.now(),
  });
  return { ok: true };
}

export function recallScene(name, opts) {
  const v = window.__archdiscViewport;
  if (!v?.camera) return { ok: false };
  const sc = _scenes.get(name);
  if (!sc) return { ok: false };
  const cam = v.camera;
  const animate = opts?.animate !== false;
  if (!animate) {
    cam.position.set(...sc.camPos);
    if (v.controls?.target) v.controls.target.set(...sc.target);
    if (cam.isPerspectiveCamera) cam.fov = sc.fov;
    cam.updateProjectionMatrix();
    if (v.controls) v.controls.update();
    return { ok: true };
  }
  const startPos = cam.position.clone();
  const startTgt = v.controls?.target.clone() || new THREE.Vector3();
  const endPos = new THREE.Vector3(...sc.camPos);
  const endTgt = new THREE.Vector3(...sc.target);
  const dur = Number(opts?.duration) || 800;
  const t0 = performance.now();
  function _tick() {
    const t = Math.min(1, (performance.now() - t0) / dur);
    const e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
    cam.position.lerpVectors(startPos, endPos, e);
    if (v.controls?.target) {
      v.controls.target.lerpVectors(startTgt, endTgt, e);
      v.controls.update();
    }
    if (t < 1) requestAnimationFrame(_tick);
  }
  _tick();
  return { ok: true };
}

export function listScenes() {
  return {
    ok: true,
    scenes: Array.from(_scenes.entries()).map(([name, sc]) => ({
      name, desc: sc.desc, timestamp: sc.timestamp,
    })),
  };
}

export function deleteScene(name) {
  return { ok: _scenes.delete(name) };
}

// 2D schematic floor — project geometry below a horizontal plane to
// a top-down floor plan canvas.
export function generateSchematicFloor(opts) {
  const planeY = Number(opts?.planeY) || 0;
  const width = Number(opts?.width) || 1024;
  const height = Number(opts?.height) || 1024;
  const scene = window.__archdiscScene;
  if (!scene) return { ok: false };
  const cv = document.createElement('canvas');
  cv.width = width; cv.height = height;
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#f8f6ee';
  ctx.fillRect(0, 0, width, height);
  // World bounding box for project.
  const box = new THREE.Box3();
  scene.traverseVisible((o) => {
    if (o.isMesh) box.expandByObject(o);
  });
  if (box.isEmpty()) return { ok: true, canvas: cv };
  const sz = box.getSize(new THREE.Vector3());
  const scale = Math.min(width / sz.x, height / sz.z) * 0.85;
  const cx = width / 2, cy = height / 2;
  const center = box.getCenter(new THREE.Vector3());
  ctx.strokeStyle = '#222';
  ctx.lineWidth = 1.5;
  scene.traverseVisible((o) => {
    if (!o.isMesh || !o.geometry?.attributes?.position) return;
    o.updateMatrixWorld(true);
    const pos = o.geometry.attributes.position;
    const idx = o.geometry.index?.array;
    const triCount = idx ? idx.length / 3 : pos.count / 3;
    for (let t = 0; t < triCount; t++) {
      const i0 = idx ? idx[t * 3] : t * 3;
      const i1 = idx ? idx[t * 3 + 1] : t * 3 + 1;
      const i2 = idx ? idx[t * 3 + 2] : t * 3 + 2;
      const v = [i0, i1, i2].map((i) => {
        const x = pos.array[i * 3], y = pos.array[i * 3 + 1], z = pos.array[i * 3 + 2];
        const w = new THREE.Vector3(x, y, z).applyMatrix4(o.matrixWorld);
        return [w.x, w.y, w.z];
      });
      // Crossing the planeY → segment.
      const eds = [[0, 1], [1, 2], [2, 0]];
      const cuts = [];
      for (const [a, b] of eds) {
        if ((v[a][1] - planeY) * (v[b][1] - planeY) < 0) {
          const t2 = (planeY - v[a][1]) / (v[b][1] - v[a][1]);
          cuts.push([
            v[a][0] + t2 * (v[b][0] - v[a][0]),
            v[a][2] + t2 * (v[b][2] - v[a][2]),
          ]);
        }
      }
      if (cuts.length === 2) {
        ctx.beginPath();
        ctx.moveTo(cx + (cuts[0][0] - center.x) * scale, cy + (cuts[0][1] - center.z) * scale);
        ctx.lineTo(cx + (cuts[1][0] - center.x) * scale, cy + (cuts[1][1] - center.z) * scale);
        ctx.stroke();
      }
    }
  });
  return { ok: true, canvas: cv, dataURL: cv.toDataURL('image/png') };
}

// Solar position model — declination + hour angle.
export function setSolar(date, lat, lng) {
  const d = new Date(date);
  const dayOfYear = Math.floor((d - new Date(d.getFullYear(), 0, 0)) / 86400000);
  const decl = 23.44 * Math.sin((360 / 365) * (dayOfYear - 81) * Math.PI / 180);   // °
  const hour = d.getUTCHours() + d.getUTCMinutes() / 60;
  const hourAngle = 15 * (hour - 12) + (Number(lng) || 0);
  const latR = (Number(lat) || 0) * Math.PI / 180;
  const declR = decl * Math.PI / 180;
  const hourR = hourAngle * Math.PI / 180;
  const elev = Math.asin(Math.sin(latR) * Math.sin(declR) + Math.cos(latR) * Math.cos(declR) * Math.cos(hourR));
  const azim = Math.atan2(-Math.sin(hourR), Math.tan(declR) * Math.cos(latR) - Math.sin(latR) * Math.cos(hourR));
  // Build a sun direction (up = +Y, north = -Z).
  const x = Math.cos(elev) * Math.sin(azim);
  const y = Math.sin(elev);
  const z = -Math.cos(elev) * Math.cos(azim);
  const scene = window.__archdiscScene;
  if (scene) {
    if (!_solarLight) {
      _solarLight = new THREE.DirectionalLight(0xfff4d0, 1.2);
      _solarLight.name = 'solar-sun';
      scene.add(_solarLight);
    }
    _solarLight.position.set(x * 10, y * 10, z * 10);
    _solarLight.target.position.set(0, 0, 0);
    if (!_solarMarker) {
      const geo = new THREE.SphereGeometry(0.4, 12, 8);
      const mat = new THREE.MeshBasicMaterial({ color: 0xffe080 });
      _solarMarker = new THREE.Mesh(geo, mat);
      _solarMarker.name = 'solar-marker';
      scene.add(_solarMarker);
    }
    _solarMarker.position.set(x * 12, y * 12, z * 12);
    _solarMarker.visible = y > -0.05;
  }
  return { ok: true, elevation: elev * 180 / Math.PI, azimuth: azim * 180 / Math.PI, dir: [x, y, z] };
}

export function clearSolar() {
  const scene = window.__archdiscScene;
  if (scene) {
    if (_solarLight) scene.remove(_solarLight);
    if (_solarMarker) scene.remove(_solarMarker);
  }
  _solarLight = null; _solarMarker = null;
  return { ok: true };
}
