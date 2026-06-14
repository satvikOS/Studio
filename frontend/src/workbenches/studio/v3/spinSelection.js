// Spin / Screw (parity #55, Blender Spin / Maya revolve-of-selection) —
// pure functions, DOM/THREE-free, node-testable. Revolve a profile
// polyline around an axis through `center` by `angle` in `steps`,
// generating a surface of revolution as an indexed triangle mesh.
// Optional `screw` (pitch) translates along the axis per full turn for a
// helical sweep. The viewport op feeds it the selected boundary later.
//
// Built adversarially: guards empty/short profiles, zero steps, NaN
// inputs, zero-length axis — never throws, returns an empty mesh.

function _normAxis(axis) {
  const a = Array.isArray(axis) ? axis : [0, 1, 0];
  const len = Math.hypot(a[0] || 0, a[1] || 0, a[2] || 0);
  if (!(len > 1e-12)) return [0, 1, 0];
  return [a[0] / len, a[1] / len, a[2] / len];
}

// Rodrigues rotation of point p about unit axis k through origin by θ.
function _rotate(p, k, theta) {
  const c = Math.cos(theta), s = Math.sin(theta);
  const dot = p[0] * k[0] + p[1] * k[1] + p[2] * k[2];
  const cross = [k[1] * p[2] - k[2] * p[1], k[2] * p[0] - k[0] * p[2], k[0] * p[1] - k[1] * p[0]];
  return [
    p[0] * c + cross[0] * s + k[0] * dot * (1 - c),
    p[1] * c + cross[1] * s + k[1] * dot * (1 - c),
    p[2] * c + cross[2] * s + k[2] * dot * (1 - c),
  ];
}

// profile: flat [x,y,z,...] polyline. Returns {positions:Float32Array,
// indices:Uint32Array, rings, perRing}.
export function spinProfile(profile, opts = {}) {
  const {
    axis = [0, 1, 0], center = [0, 0, 0], angle = Math.PI * 2,
    steps = 16, screwPitch = 0,
  } = opts;
  const prof = profile && profile.length != null ? profile : [];
  const perRing = Math.floor(prof.length / 3);
  const nSteps = Math.floor(steps);
  const empty = { positions: new Float32Array(0), indices: new Uint32Array(0), rings: 0, perRing: 0 };
  if (perRing < 2 || !(nSteps >= 1) || !Number.isFinite(angle) || angle === 0) return empty;
  const k = _normAxis(axis);
  const cx = Number(center[0]) || 0, cy = Number(center[1]) || 0, cz = Number(center[2]) || 0;
  // A full 360° spin closes the loop (last ring == first), so it needs
  // nSteps rings; a partial spin needs nSteps+1 (both ends explicit).
  const closed = Math.abs(Math.abs(angle) - Math.PI * 2) < 1e-9;
  const rings = closed ? nSteps : nSteps + 1;
  const positions = new Float32Array(rings * perRing * 3);
  for (let r = 0; r < rings; r++) {
    const t = r / nSteps;
    const theta = angle * t;
    const lift = screwPitch * (theta / (Math.PI * 2)); // helix advance
    for (let v = 0; v < perRing; v++) {
      const px = prof[v * 3] - cx, py = prof[v * 3 + 1] - cy, pz = prof[v * 3 + 2] - cz;
      const rot = _rotate([px, py, pz], k, theta);
      const o = (r * perRing + v) * 3;
      positions[o] = rot[0] + cx + k[0] * lift;
      positions[o + 1] = rot[1] + cy + k[1] * lift;
      positions[o + 2] = rot[2] + cz + k[2] * lift;
    }
  }
  // Stitch quads between consecutive rings (two tris each).
  const quadRings = closed ? nSteps : nSteps; // segments either way
  const idx = [];
  for (let r = 0; r < quadRings; r++) {
    const r0 = r % rings;
    const r1 = (r + 1) % rings;
    for (let v = 0; v < perRing - 1; v++) {
      const a = r0 * perRing + v, b = r0 * perRing + v + 1;
      const c = r1 * perRing + v, d = r1 * perRing + v + 1;
      idx.push(a, c, b, b, c, d);
    }
  }
  return { positions, indices: new Uint32Array(idx), rings, perRing };
}
