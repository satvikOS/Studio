import * as THREE from 'three';
import { evaluateGraph } from './nodeGraphEval.js';

/*
 * Studio Material / Shader node graph registry — the same DAG engine that drives
 * geometry nodes, retargeted to assemble a PBR MeshStandardMaterial. Mirrors the
 * node-based material editors in Substance Designer, Unreal Engine's Material
 * Editor, Unity Shader Graph and Blender's shader nodes: procedural texture
 * generators feed colour / roughness / metalness / emissive channels into a
 * single Output node that emits a material spec.
 *
 * Every generator is deterministic (coordinate-hashed value/Worley noise, no
 * Math.random) so a given graph always produces the identical texture.
 */

const fract = (x) => x - Math.floor(x);
const smooth = (t) => t * t * (3 - 2 * t);
const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);

// Deterministic 2D hash in [0,1) — the canonical sin-dot hash, fully reproducible.
function hash1(x, y) { return fract(Math.sin(x * 127.1 + y * 311.7) * 43758.5453); }

// Bilinearly-interpolated value noise on the integer lattice.
function valueNoise(x, y) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = smooth(x - xi), yf = smooth(y - yi);
  const a = hash1(xi, yi), b = hash1(xi + 1, yi);
  const c = hash1(xi, yi + 1), d = hash1(xi + 1, yi + 1);
  return (a + (b - a) * xf) * (1 - yf) + (c + (d - c) * xf) * yf;
}

// Fractal Brownian motion — 4 octaves of value noise.
function fbm(x, y) {
  let v = 0, amp = 0.5, f = 1;
  for (let o = 0; o < 4; o++) { v += amp * valueNoise(x * f, y * f); f *= 2; amp *= 0.5; }
  return clamp01(v);
}

// Worley (cellular) distance field — nearest deterministic feature point.
function worley(u, v, scale) {
  const px = u * scale, py = v * scale;
  const cx = Math.floor(px), cy = Math.floor(py);
  let best = 1e9;
  for (let oy = -1; oy <= 1; oy++) {
    for (let ox = -1; ox <= 1; ox++) {
      const gx = cx + ox, gy = cy + oy;
      const fx = gx + hash1(gx, gy);
      const fy = gy + hash1(gx + 5.2, gy + 1.3);
      const dx = fx - px, dy = fy - py;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d < best) best = d;
    }
  }
  return clamp01(best);
}

const hexToRgb = (h) => { const n = parseInt(String(h).replace('#', ''), 16) || 0; return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const mixRgb = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

// Render a procedural pattern into a CanvasTexture (256x256).
function makeProceduralTexture(pattern, scale, colorA, colorB) {
  const S = 256;
  const canvas = document.createElement('canvas');
  canvas.width = S; canvas.height = S;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(S, S);
  const A = hexToRgb(colorA), B = hexToRgb(colorB);
  const sc = Math.max(0.5, scale);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const u = x / S, v = y / S;
      let t;
      switch (pattern) {
        case 'checker': t = ((Math.floor(u * sc) + Math.floor(v * sc)) % 2 === 0) ? 0 : 1; break;
        case 'wave': t = 0.5 + 0.5 * Math.sin((u + v) * sc * Math.PI * 2); break;
        case 'gradient': t = u; break;
        case 'voronoi': t = worley(u, v, sc); break;
        case 'noise': default: t = fbm(u * sc, v * sc); break;
      }
      const c = mixRgb(A, B, clamp01(t));
      const o = (y * S + x) * 4;
      img.data[o] = c[0]; img.data[o + 1] = c[1]; img.data[o + 2] = c[2]; img.data[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.needsUpdate = true;
  return { canvas, texture: tex };
}

// ---- Node registry. Each eval returns a typed value: tex | col | val | material.
export const MATERIAL_NODE_TYPES = {
  texture: {
    label: 'Texture',
    inputs: [], outputs: ['tex'],
    params: [
      { key: 'pattern', type: 'enum', options: ['noise', 'voronoi', 'checker', 'wave', 'gradient'], default: 'noise' },
      { key: 'scale', type: 'number', default: 6 },
      { key: 'colorA', type: 'color', default: '#202020' },
      { key: 'colorB', type: 'color', default: '#d8d8d8' },
    ],
    eval(_inp, p) {
      const { canvas, texture } = makeProceduralTexture(p.pattern || 'noise', p.scale ?? 6, p.colorA || '#202020', p.colorB || '#d8d8d8');
      return { kind: 'tex', texture, canvas, pattern: p.pattern || 'noise' };
    },
  },
  color: {
    label: 'Color',
    inputs: [], outputs: ['col'],
    params: [{ key: 'color', type: 'color', default: '#b0b0b0' }],
    eval(_inp, p) { return { kind: 'col', color: new THREE.Color(p.color || '#b0b0b0'), hex: p.color || '#b0b0b0' }; },
  },
  scalar: {
    label: 'Scalar',
    inputs: [], outputs: ['val'],
    params: [{ key: 'value', type: 'number', default: 0.5 }],
    eval(_inp, p) { return { kind: 'val', value: clamp01(p.value ?? 0.5) }; },
  },
  colorMix: {
    label: 'Color Mix',
    inputs: ['a', 'b'], outputs: ['col'],
    params: [{ key: 't', type: 'number', default: 0.5 }],
    eval(inp, p) {
      const a = inp.a && inp.a.color ? inp.a.color : new THREE.Color('#000000');
      const b = inp.b && inp.b.color ? inp.b.color : new THREE.Color('#ffffff');
      const c = a.clone().lerp(b, clamp01(p.t ?? 0.5));
      return { kind: 'col', color: c, hex: `#${c.getHexString()}` };
    },
  },
  output: {
    label: 'Material Output',
    inputs: ['map', 'color', 'roughness', 'metalness', 'emissive'], outputs: [],
    params: [],
    eval(inp) {
      const map = inp.map && inp.map.kind === 'tex' ? inp.map : null;
      const color = inp.color && inp.color.color ? inp.color.color : null;
      const emissive = inp.emissive && inp.emissive.color ? inp.emissive.color : null;
      return {
        kind: 'material',
        spec: {
          colorHex: color ? `#${color.getHexString()}` : (map ? '#ffffff' : '#b0b0b0'),
          roughness: inp.roughness && inp.roughness.kind === 'val' ? inp.roughness.value : 0.6,
          metalness: inp.metalness && inp.metalness.kind === 'val' ? inp.metalness.value : 0.05,
          emissiveHex: emissive ? `#${emissive.getHexString()}` : '#000000',
          hasMap: !!map,
          mapPattern: map ? map.pattern : null,
        },
        mapTexture: map ? map.texture : null,
        mapCanvas: map ? map.canvas : null,
      };
    },
  },
};

// Seed graph: a procedural texture -> base colour map, plus a roughness scalar.
let _mid = 1;
export function materialSeed() {
  const t = { id: `texture${_mid++}`, type: 'texture', x: 40, y: 80, params: { pattern: 'voronoi', scale: 7, colorA: '#1a1a1a', colorB: '#c8c8c8' } };
  const r = { id: `scalar${_mid++}`, type: 'scalar', x: 40, y: 250, params: { value: 0.35 } };
  const o = { id: `output${_mid++}`, type: 'output', x: 320, y: 130, params: {} };
  return {
    nodes: [t, r, o],
    edges: [
      { from: { node: t.id, port: 'tex' }, to: { node: o.id, port: 'map' } },
      { from: { node: r.id, port: 'val' }, to: { node: o.id, port: 'roughness' } },
    ],
  };
}

// Evaluate a material graph -> the assembled material descriptor + textures.
export function evalMaterialGraph(graph) {
  const res = evaluateGraph(graph, MATERIAL_NODE_TYPES);
  if (res.error) return { error: res.error };
  const out = res.geometry; // the output node's emitted value
  if (!out || out.kind !== 'material') return { error: 'no material output' };
  return { spec: out.spec, mapTexture: out.mapTexture, mapCanvas: out.mapCanvas };
}
