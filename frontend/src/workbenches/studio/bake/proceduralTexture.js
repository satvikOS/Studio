import * as THREE from 'three';

/*
 * Substance Designer / Mari procedural-noise → texture map. Walks every
 * pixel of a sizeXsize canvas, evaluates a chosen procedural (perlin /
 * voronoi / checker / gradient) at that uv, lerps between two colors by
 * the result, then binds the CanvasTexture to the chosen material slot.
 *
 * Self-contained: own seeded RNG + 2D Perlin via integer-hash gradients.
 */

function mulberry32(s) {
  let a = (s >>> 0) || 1;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hexToRgb(h) {
  const s = (h || '#000000').replace('#', '');
  return [parseInt(s.slice(0, 2), 16), parseInt(s.slice(2, 4), 16), parseInt(s.slice(4, 6), 16)];
}

// Hash-based gradient table for integer Perlin grid points. Deterministic.
function gradHash(ix, iy, seed) {
  const h = ((ix * 374761393) ^ (iy * 668265263) ^ (seed | 0)) >>> 0;
  const angle = (h % 65536) / 65536 * Math.PI * 2;
  return [Math.cos(angle), Math.sin(angle)];
}
function fade(t) { return t * t * (3 - 2 * t); }
function perlin2(x, y, seed) {
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = x - ix, fy = y - iy;
  const g00 = gradHash(ix, iy, seed);
  const g10 = gradHash(ix + 1, iy, seed);
  const g01 = gradHash(ix, iy + 1, seed);
  const g11 = gradHash(ix + 1, iy + 1, seed);
  const n00 = g00[0] * fx + g00[1] * fy;
  const n10 = g10[0] * (fx - 1) + g10[1] * fy;
  const n01 = g01[0] * fx + g01[1] * (fy - 1);
  const n11 = g11[0] * (fx - 1) + g11[1] * (fy - 1);
  const u = fade(fx), v = fade(fy);
  const a = n00 + (n10 - n00) * u;
  const b = n01 + (n11 - n01) * u;
  return a + (b - a) * v;
}

export function generateProceduralTexture(mesh, opts = {}) {
  if (!mesh || !mesh.material) return { ok: false, error: 'no mesh/material' };
  const { type = 'perlin', size = 256, channel = 'map', params = {} } = opts;
  const W = Math.max(16, Math.min(1024, size | 0));
  const { freq = 4, octaves = 4, color1 = '#000000', color2 = '#ffffff',
          seed = 1337, cells = 16, angle = 0 } = params;
  const c1 = hexToRgb(color1), c2 = hexToRgb(color2);
  const rng = mulberry32(seed);

  // Pre-seed voronoi cell centres if needed.
  let seeds = null;
  if (type === 'voronoi') {
    seeds = [];
    for (let i = 0; i < cells; i++) seeds.push([rng(), rng()]);
  }

  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = W;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(W, W);
  const data = img.data;
  let mn = 1, mx = 0, sum = 0;

  for (let y = 0; y < W; y++) {
    for (let x = 0; x < W; x++) {
      const u = x / W, v = y / W;
      let n = 0;
      if (type === 'checker') {
        n = (Math.floor(u * freq) + Math.floor(v * freq)) & 1;
      } else if (type === 'gradient') {
        n = Math.max(0, Math.min(1, Math.cos(angle) * u + Math.sin(angle) * v));
      } else if (type === 'voronoi') {
        let d = 2;
        for (const [sx, sy] of seeds) {
          const dx = u - sx, dy = v - sy;
          const dd = dx * dx + dy * dy;
          if (dd < d) d = dd;
        }
        n = Math.min(1, Math.sqrt(d) * freq);
      } else { // perlin fBm
        let amp = 1, f = freq, s = 0, norm = 0;
        const oc = Math.min(octaves | 0, 8);
        for (let o = 0; o < oc; o++) {
          s += perlin2(u * f, v * f, seed + o) * amp;
          norm += amp; amp *= 0.5; f *= 2.03;
        }
        n = 0.5 + 0.5 * (s / Math.max(norm, 1e-6));
      }
      n = Math.max(0, Math.min(1, n));
      const di = (y * W + x) * 4;
      data[di]     = c1[0] + (c2[0] - c1[0]) * n;
      data[di + 1] = c1[1] + (c2[1] - c1[1]) * n;
      data[di + 2] = c1[2] + (c2[2] - c1[2]) * n;
      data[di + 3] = 255;
      if (n < mn) mn = n; if (n > mx) mx = n; sum += n;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  if (channel === 'map') tex.colorSpace = THREE.SRGBColorSpace;
  else tex.colorSpace = THREE.NoColorSpace;
  tex.needsUpdate = true;
  // aoMap requires uv1.
  if (channel === 'aoMap' && mesh.geometry && !mesh.geometry.attributes.uv1 && mesh.geometry.attributes.uv) {
    mesh.geometry.setAttribute('uv1', mesh.geometry.attributes.uv);
  }
  // Dispose any previous texture in this slot.
  const prev = mesh.material[channel];
  if (prev && prev.dispose) prev.dispose();
  mesh.material[channel] = tex;
  mesh.material.needsUpdate = true;
  return {
    ok: true, type, size: W, channel, mean: sum / (W * W), min: mn, max: mx, sum, seed,
  };
}
