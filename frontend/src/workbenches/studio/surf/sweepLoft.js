import * as THREE from 'three';

/*
 * Studio Loft / Sweep — sweep an arbitrary 2D PROFILE (cross-section) along a 3D
 * PATH curve, building a swept surface (3ds Max Loft with a single shape / Rhino
 * Sweep1 / Blender curve bevel). Unlike TubeGeometry (circular section only),
 * this transports a polygonal profile (square / L / star / n-gon) along the path
 * using the curve's Frenet frames, so the cross-section is preserved and
 * orientable. Deterministic — no Math.random.
 */

function profilePoints(kind, size) {
  const s = Math.max(1e-4, size);
  switch (kind) {
    case 'square': return [[-s, -s], [s, -s], [s, s], [-s, s]];
    case 'lshape': return [[-s, -s], [s, -s], [s, 0], [0, 0], [0, s], [-s, s]];
    case 'star': {
      const pts = []; const n = 5;
      for (let i = 0; i < n * 2; i++) { const r = i % 2 === 0 ? s : s * 0.45; const a = (i / (n * 2)) * Math.PI * 2; pts.push([Math.cos(a) * r, Math.sin(a) * r]); }
      return pts;
    }
    case 'circle': default: {
      const pts = []; const n = 16;
      for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2; pts.push([Math.cos(a) * s, Math.sin(a) * s]); }
      return pts;
    }
  }
}

function pathPoints(kind, o) {
  const scale = o.pathScale ?? 1;
  const pts = [];
  switch (kind) {
    case 'arc': {
      const R = (o.radius ?? 0.5) * scale, sweep = (o.sweepDeg ?? 220) * Math.PI / 180, n = 24;
      for (let i = 0; i <= n; i++) { const a = (i / n) * sweep; pts.push(new THREE.Vector3(Math.cos(a) * R, 0, Math.sin(a) * R)); }
      return { pts, closed: false };
    }
    case 'scurve': {
      const L = (o.length ?? 1) * scale, n = 24;
      for (let i = 0; i <= n; i++) { const t = i / n; pts.push(new THREE.Vector3((t - 0.5) * L, Math.sin(t * Math.PI * 2) * 0.18 * scale, Math.cos(t * Math.PI) * 0.12 * scale)); }
      return { pts, closed: false };
    }
    case 'ring': {
      const R = (o.radius ?? 0.4) * scale, n = 32;
      for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2; pts.push(new THREE.Vector3(Math.cos(a) * R, 0, Math.sin(a) * R)); }
      return { pts, closed: true };
    }
    case 'helix': default: {
      const turns = o.turns ?? 3, H = (o.height ?? 0.8) * scale, R = (o.radius ?? 0.3) * scale, n = Math.max(16, turns * 16);
      for (let i = 0; i <= n; i++) { const t = i / n, a = t * Math.PI * 2 * turns; pts.push(new THREE.Vector3(Math.cos(a) * R, H * (t - 0.5), Math.sin(a) * R)); }
      return { pts, closed: false };
    }
  }
}

export function buildSweptGeometry(o = {}) {
  const prof = profilePoints(o.profile || 'square', o.profileSize ?? 0.05);
  const { pts, closed } = pathPoints(o.path || 'helix', o);
  if (pts.length < 2) return null;
  const curve = new THREE.CatmullRomCurve3(pts, closed, 'catmullrom', 0.5);
  const stations = Math.max(8, o.stations ?? 140);
  const frames = curve.computeFrenetFrames(stations, closed);
  const pc = prof.length;
  const rings = closed ? stations : stations + 1;

  const positions = [];
  const nLen = frames.normals.length, bLen = frames.binormals.length;
  for (let i = 0; i < rings; i++) {
    const t = closed ? (i / stations) : (i / stations);
    const P = curve.getPointAt(Math.min(1, Math.max(0, t)));
    const N = frames.normals[Math.min(i, nLen - 1)];
    const B = frames.binormals[Math.min(i, bLen - 1)];
    for (let j = 0; j < pc; j++) {
      const u = prof[j][0], v = prof[j][1];
      positions.push(P.x + N.x * u + B.x * v, P.y + N.y * u + B.y * v, P.z + N.z * u + B.z * v);
    }
  }

  const indices = [];
  const segs = closed ? stations : stations; // ring-to-ring spans
  for (let r = 0; r < segs; r++) {
    const rA = r;
    const rB = closed ? (r + 1) % stations : r + 1;
    if (!closed && rB >= rings) break;
    for (let j = 0; j < pc; j++) {
      const jB = (j + 1) % pc;
      const a = rA * pc + j, b = rA * pc + jB, c = rB * pc + jB, d = rB * pc + j;
      indices.push(a, b, d, b, c, d);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  geo.computeBoundingBox();
  geo.userData.archdiscSweep = { profile: o.profile || 'square', path: o.path || 'helix', profilePoints: pc, rings };
  return geo;
}
