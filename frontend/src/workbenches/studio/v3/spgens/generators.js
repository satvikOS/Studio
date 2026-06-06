// Slice 719 — Substance Painter mask generators (proper generators
// distinct from slice-703 smartmasks). A generator is a node-style
// source that consumes baked maps (normal / curvature / AO / position
// / thickness) and outputs a parametric mask. Implemented: Curvature
// Generator (sharp + smooth), AO Cavity, Dirt, Position Gradient,
// Procedural Edge Highlight.

function _ensureBuf(size) { return new Float32Array(size * size); }

// CurvatureGenerator — emphasizes positive curvature with adjustable
// contrast/balance/blur. Returns a per-pixel mask.
export function curvatureGenerator(opts) {
  const size = Number(opts?.size) || 512;
  const curv = opts?.curvature instanceof Float32Array ? opts.curvature : null;
  if (!curv) return { ok: false };
  const contrast = Number(opts?.contrast) || 1.0;
  const balance = Number(opts?.balance) || 0.5;
  const blur = Number(opts?.blur) || 2;
  let mask = new Float32Array(size * size);
  for (let i = 0; i < mask.length; i++) {
    const c = curv[i] ?? 0;
    const sign = balance >= 0.5 ? Math.max(0, c) : Math.max(0, -c);
    mask[i] = Math.min(1, sign * contrast);
  }
  // Quick box blur.
  if (blur > 0) {
    const tmp = new Float32Array(mask);
    const r = Math.max(1, Math.min(8, Math.floor(blur)));
    for (let y = r; y < size - r; y++) {
      for (let x = r; x < size - r; x++) {
        let sum = 0, count = 0;
        for (let dy = -r; dy <= r; dy++) {
          for (let dx = -r; dx <= r; dx++) {
            sum += tmp[(y + dy) * size + (x + dx)];
            count++;
          }
        }
        mask[y * size + x] = sum / count;
      }
    }
  }
  return { ok: true, mask, size };
}

export function aoCavityGenerator(opts) {
  const size = Number(opts?.size) || 512;
  const ao = opts?.ao instanceof Float32Array ? opts.ao : null;
  if (!ao) return { ok: false };
  const intensity = Number(opts?.intensity) || 1;
  const threshold = Number(opts?.threshold) || 0.7;
  const mask = _ensureBuf(size);
  for (let i = 0; i < mask.length; i++) {
    const v = ao[i] ?? 1;
    mask[i] = Math.max(0, Math.min(1, (threshold - v) * 2.5 * intensity));
  }
  return { ok: true, mask, size };
}

export function dirtGenerator(opts) {
  const size = Number(opts?.size) || 512;
  const ao = opts?.ao instanceof Float32Array ? opts.ao : null;
  if (!ao) return { ok: false };
  const grain = Number(opts?.grain) || 0.3;
  const intensity = Number(opts?.intensity) || 1;
  const mask = _ensureBuf(size);
  for (let i = 0; i < mask.length; i++) {
    const a = ao[i] ?? 1;
    const noise = ((i * 4787 + 19) % 1009) / 1009;
    mask[i] = Math.max(0, Math.min(1, (1 - a) * intensity * (1 - grain * 0.5 + grain * noise)));
  }
  return { ok: true, mask, size };
}

export function positionGradient(opts) {
  // Vertical gradient — useful for paint-from-top effects.
  const size = Number(opts?.size) || 512;
  const top = Number(opts?.top) || 1;
  const bottom = Number(opts?.bottom) || 0;
  const noise = Number(opts?.noise) || 0.05;
  const mask = _ensureBuf(size);
  for (let y = 0; y < size; y++) {
    const v = y / size;
    const baseT = (v - bottom) / (top - bottom);
    for (let x = 0; x < size; x++) {
      const n = ((x * 113 + y * 67) % 256) / 256;
      mask[y * size + x] = Math.max(0, Math.min(1, baseT + (n - 0.5) * noise));
    }
  }
  return { ok: true, mask, size };
}

export function proceduralEdgeHighlight(opts) {
  const size = Number(opts?.size) || 512;
  const curv = opts?.curvature instanceof Float32Array ? opts.curvature : null;
  if (!curv) return { ok: false };
  const threshold = Number(opts?.threshold) || 0.6;
  const intensity = Number(opts?.intensity) || 2;
  const mask = _ensureBuf(size);
  for (let i = 0; i < mask.length; i++) {
    const c = curv[i] ?? 0;
    mask[i] = Math.max(0, Math.min(1, (c - threshold) * intensity));
  }
  return { ok: true, mask, size };
}

// Mask Editor — combine 2 masks with min/max/blend/sub
export function combineMasks(maskA, maskB, mode) {
  if (!maskA || !maskB) return { ok: false };
  const size = Math.min(maskA.size, maskB.size);
  const out = new Float32Array(size * size);
  for (let i = 0; i < out.length; i++) {
    const a = maskA.mask[i] || 0;
    const b = maskB.mask[i] || 0;
    switch (mode) {
      case 'min':   out[i] = Math.min(a, b); break;
      case 'max':   out[i] = Math.max(a, b); break;
      case 'sub':   out[i] = Math.max(0, a - b); break;
      case 'multiply': out[i] = a * b; break;
      case 'screen':   out[i] = 1 - (1 - a) * (1 - b); break;
      default: out[i] = a + b - a * b;
    }
  }
  return { ok: true, mask: out, size };
}
