// ArchDisc Studio V3 — strand-based hair groom (slice 932).
// Verlet PBD strand solver + Marschner R+TT+TRT azimuthal/longitudinal BSDF.
import * as THREE from 'three';
import { registerOps } from '../common/registry.js';

const VERT = `
varying vec3 vT; varying vec3 vN; varying vec3 vV;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vV = -mv.xyz;
  vT = normalize(normalMatrix * normal);
  vN = normalize(cross(vT, vec3(0.0, 1.0, 0.0)));
  gl_Position = projectionMatrix * mv;
}`;
const FRAG = `
varying vec3 vT; varying vec3 vN; varying vec3 vV;
uniform vec3 uColor; uniform vec3 uLightDir; uniform float uRoughLong; uniform float uRoughAz;
float gauss(float x, float s) { return exp(-x * x / (2.0 * s * s)) / (s * 2.5066); }
void main() {
  vec3 L = normalize(uLightDir);
  vec3 V = normalize(vV);
  vec3 T = normalize(vT);
  float sinThL = dot(L, T);
  float sinThV = dot(V, T);
  float thH = (asin(sinThL) + asin(sinThV)) * 0.5;
  vec3 Lp = normalize(L - sinThL * T);
  vec3 Vp = normalize(V - sinThV * T);
  float cosPh = clamp(dot(Lp, Vp), -1.0, 1.0);
  float R = gauss(thH - 0.07, uRoughLong) * (0.5 + 0.5 * cosPh);
  float TT = gauss(thH + 0.04, uRoughLong * 0.5) * pow(max(0.0, -cosPh), 8.0);
  float TRT = gauss(thH - 0.14, uRoughLong * 2.0) * pow(0.5 + 0.5 * cosPh, 3.0);
  vec3 col = uColor * (R + 0.4 * TT + 0.6 * TRT);
  gl_FragColor = vec4(col, 1.0);
}`;

let _installed = false, _nextId = 1;
const _grooms = new Map();

function _makeStrand(root, length, segs, curl) {
  const pts = [], pPrev = [];
  let pos = root.clone();
  const up = new THREE.Vector3(0, 1, 0);
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    const c = curl * Math.sin(t * 6.0);
    const p = pos.clone().addScaledVector(up, length * t).add(new THREE.Vector3(c, 0, c * 0.7));
    pts.push(p); pPrev.push(p.clone());
  }
  return { pts, pPrev };
}

function _stepStrand(s, gravity, wind, dt, segLen) {
  for (let i = 1; i < s.pts.length; i++) {
    const p = s.pts[i], pp = s.pPrev[i];
    const vx = p.x - pp.x, vy = p.y - pp.y, vz = p.z - pp.z;
    pp.copy(p);
    p.x += vx * 0.98 + gravity[0] * dt * dt + wind[0] * dt;
    p.y += vy * 0.98 + gravity[1] * dt * dt + wind[1] * dt;
    p.z += vz * 0.98 + gravity[2] * dt * dt + wind[2] * dt;
  }
  for (let it = 0; it < 4; it++) {
    for (let i = 1; i < s.pts.length; i++) {
      const a = s.pts[i - 1], b = s.pts[i];
      const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
      const d = Math.hypot(dx, dy, dz) || 1;
      const k = (d - segLen) / d;
      b.x -= dx * k; b.y -= dy * k; b.z -= dz * k;
    }
  }
}

export function installHairGroom() {
  if (_installed) return { ok: true, already: true };
  _installed = true;
  const ops = {
    __studioHairGroomCreate: ({ scalpMeshUuid, density = 200, length = 0.3, curl = 0.02, color = [0.2, 0.1, 0.05], segs = 12 } = {}) => {
      const vp = window.__archdiscViewport;
      if (!vp?.scene) return { ok: false, error: 'no viewport' };
      let scalp = null;
      vp.scene.traverse((o) => { if (!scalp && o.uuid === scalpMeshUuid) scalp = o; });
      if (!scalp) return { ok: false, error: 'no scalp mesh' };
      const pos = scalp.geometry.attributes.position;
      const strands = [];
      const segLen = length / segs;
      for (let i = 0; i < density; i++) {
        const k = Math.floor(Math.random() * pos.count) * 3;
        const root = new THREE.Vector3(pos.array[k], pos.array[k + 1], pos.array[k + 2]);
        root.applyMatrix4(scalp.matrixWorld);
        strands.push(_makeStrand(root, length, segs, curl));
      }
      const geom = new THREE.BufferGeometry();
      const arr = new Float32Array(strands.length * segs * 2 * 3);
      geom.setAttribute('position', new THREE.BufferAttribute(arr, 3));
      const mat = new THREE.ShaderMaterial({
        vertexShader: VERT, fragmentShader: FRAG,
        uniforms: { uColor: { value: new THREE.Color(...color) }, uLightDir: { value: new THREE.Vector3(0.5, 1, 0.3) }, uRoughLong: { value: 0.15 }, uRoughAz: { value: 0.3 } },
      });
      const line = new THREE.LineSegments(geom, mat);
      vp.scene.add(line);
      const id = `groom-${_nextId++}`;
      _grooms.set(id, { strands, line, segLen, gravity: [0, -9.8, 0], wind: [0, 0, 0] });
      return { ok: true, id };
    },
    __studioHairGroomSimulate: ({ id, dt = 1 / 60 } = {}) => {
      const g = _grooms.get(id);
      if (!g) return { ok: false, error: 'no groom' };
      for (const s of g.strands) _stepStrand(s, g.gravity, g.wind, dt, g.segLen);
      const arr = g.line.geometry.attributes.position.array;
      let w = 0;
      for (const s of g.strands)
        for (let i = 0; i < s.pts.length - 1; i++) {
          arr[w++] = s.pts[i].x; arr[w++] = s.pts[i].y; arr[w++] = s.pts[i].z;
          arr[w++] = s.pts[i + 1].x; arr[w++] = s.pts[i + 1].y; arr[w++] = s.pts[i + 1].z;
        }
      g.line.geometry.attributes.position.needsUpdate = true;
      return { ok: true };
    },
    __studioHairGroomSetWind: ({ id, wind }) => { const g = _grooms.get(id); if (g) g.wind = wind; return { ok: !!g }; },
    __studioHairGroomSetGravity: ({ id, gravity }) => { const g = _grooms.get(id); if (g) g.gravity = gravity; return { ok: !!g }; },
    __studioHairGroomDelete: ({ id }) => { const g = _grooms.get(id); if (!g) return { ok: false }; g.line.parent?.remove(g.line); g.line.geometry.dispose(); g.line.material.dispose(); _grooms.delete(id); return { ok: true }; },
    __studioHairGroomList: () => ({ ok: true, ids: [..._grooms.keys()] }),
  };
  for (const [n, fn] of Object.entries(ops)) window[n] = fn;
  registerOps(ops, 'sim', 'Strand-based hair groom (Marschner + Verlet PBD)');
  return { ok: true };
}
export default installHairGroom;
