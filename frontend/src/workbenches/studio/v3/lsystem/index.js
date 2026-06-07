// ArchDisc Studio V3 — L-system foliage generator (slice 801).
import * as THREE from 'three';
import { registerOps } from '../common/registry.js';
let _installed = false;
const _PRESETS = {
  fern:       { axiom: 'F', rules: { F: 'F[+F]F[-F]F' }, iterations: 4, angle: 25 },
  grass:      { axiom: 'F', rules: { F: 'FF[+F][-F]' }, iterations: 3, angle: 20 },
  bush:       { axiom: 'X', rules: { X: 'F-[[X]+X]+F[+FX]-X', F: 'FF' }, iterations: 4, angle: 22 },
  dandelion:  { axiom: 'F', rules: { F: 'F[+F]F[-F][F]' }, iterations: 3, angle: 30 },
  cactus:     { axiom: 'F', rules: { F: 'F[+F][-F]F' }, iterations: 3, angle: 15 },
  algae:      { axiom: 'A', rules: { A: 'AB', B: 'A' }, iterations: 5, angle: 0 },
};
function _expand(axiom, rules, iterations) {
  let s = axiom;
  for (let i = 0; i < iterations; i++) {
    let next = '';
    for (const c of s) next += rules[c] || c;
    s = next;
  }
  return s;
}
function _interpret(str, angleDeg, stepLen) {
  const segments = [];
  const stack = [];
  let pos = new THREE.Vector3(0, 0, 0);
  let dir = new THREE.Vector3(0, 1, 0);
  const angRad = angleDeg * Math.PI / 180;
  for (const c of str) {
    switch (c) {
      case 'F': case 'A': case 'B': case 'X': {
        const next = pos.clone().addScaledVector(dir, stepLen);
        segments.push([pos.clone(), next.clone()]);
        pos = next;
        break;
      }
      case '+': dir.applyAxisAngle(new THREE.Vector3(0, 0, 1), angRad); break;
      case '-': dir.applyAxisAngle(new THREE.Vector3(0, 0, 1), -angRad); break;
      case '[': stack.push({ pos: pos.clone(), dir: dir.clone() }); break;
      case ']': { const st = stack.pop(); if (st) { pos = st.pos; dir = st.dir; } break; }
    }
  }
  return segments;
}
function _generate({ axiom, rules, iterations = 3, angle = 25, stepLen = 0.005 } = {}) {
  const scene = window.__archdiscScene; if (!scene) return { ok: false };
  const finalStr = _expand(String(axiom || 'F'), rules || { F: 'F+F-F' }, iterations | 0);
  const segments = _interpret(finalStr, angle, stepLen);
  const positions = [];
  for (const [a, b] of segments) positions.push(a.x, a.y, a.z, b.x, b.y, b.z);
  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  const mat = new THREE.LineBasicMaterial({ color: 0x44aa44 });
  const lines = new THREE.LineSegments(geom, mat);
  lines.userData.archdiscStudioPrimitive = true;
  lines.userData.archdiscStudioPrimitiveKind = 'lsystem';
  scene.add(lines);
  return { ok: true, uuid: lines.uuid, segmentCount: segments.length };
}
export function installLSystem() {
  if (_installed) return { ok: true, already: true };
  _installed = true;
  const ops = {
    __studioLSystemGenerate: _generate,
    __studioLSystemPreset: ({ preset, iterations } = {}) => {
      const p = _PRESETS[preset]; if (!p) return { ok: false };
      return _generate({ ...p, iterations: iterations ?? p.iterations });
    },
    __studioLSystemListPresets: () => ({ ok: true, presets: Object.keys(_PRESETS) }),
  };
  for (const [n, fn] of Object.entries(ops)) window[n] = fn;
  registerOps(ops, 'foliage', 'L-system foliage generator');
  return { ok: true };
}
export default installLSystem;
