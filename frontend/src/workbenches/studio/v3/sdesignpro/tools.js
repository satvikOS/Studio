// Slice 702 — Substance Designer power tools: Tile Sampler,
// Pixel Processor, FX-Map, Splatter Circular, Anisotropic Noise.
// All emit Float32Array greyscale or RGB buffers; integrates with the
// slice-696 sdesigner pack via the same buffer convention.

function _make(size, channels) {
  return new Float32Array(size * size * channels);
}

function _rng(seed) {
  let s = (seed | 0) || 1;
  return () => { s = (s * 1664525 + 1013904223) | 0; return ((s >>> 0) % 1e6) / 1e6; };
}

// TileSampler: places a small "stamp" pattern at a regular grid with
// per-stamp random rotation / scale / hue jitter. The stamp is a soft
// disc; user can pass a custom stamp via opts.stamp.
export function tileSampler(opts) {
  const size = Math.max(64, Math.min(1024, Number(opts?.size) || 256));
  const cols = Math.max(2, Math.min(32, Number(opts?.cols) || 8));
  const rows = Math.max(2, Math.min(32, Number(opts?.rows) || 8));
  const sizeJitter = Number(opts?.sizeJitter) || 0.3;
  const posJitter = Number(opts?.posJitter) || 0.15;
  const rotJitter = Number(opts?.rotJitter) || 1.0;
  const colorJitter = Number(opts?.colorJitter) || 0.2;
  const baseColor = opts?.baseColor || [0.8, 0.6, 0.4];
  const rng = _rng(opts?.seed ?? 42);
  const buf = _make(size, 4);   // RGBA
  buf.fill(0);
  // For each cell, paint a stamp.
  const cellW = size / cols, cellH = size / rows;
  for (let cy = 0; cy < rows; cy++) {
    for (let cx = 0; cx < cols; cx++) {
      const jx = (rng() - 0.5) * 2 * posJitter * cellW;
      const jy = (rng() - 0.5) * 2 * posJitter * cellH;
      const cxp = (cx + 0.5) * cellW + jx;
      const cyp = (cy + 0.5) * cellH + jy;
      const scale = 1 + (rng() - 0.5) * 2 * sizeJitter;
      const r = (Math.min(cellW, cellH) * 0.45) * scale;
      const hueShift = (rng() - 0.5) * 2 * colorJitter;
      const cr = Math.max(0, Math.min(1, baseColor[0] + hueShift));
      const cg = Math.max(0, Math.min(1, baseColor[1] + hueShift * 0.5));
      const cb = Math.max(0, Math.min(1, baseColor[2] - hueShift * 0.3));
      const x0 = Math.max(0, Math.floor(cxp - r));
      const x1 = Math.min(size - 1, Math.ceil(cxp + r));
      const y0 = Math.max(0, Math.floor(cyp - r));
      const y1 = Math.min(size - 1, Math.ceil(cyp + r));
      for (let yy = y0; yy <= y1; yy++) {
        for (let xx = x0; xx <= x1; xx++) {
          const dx = xx - cxp, dy = yy - cyp;
          const d = Math.sqrt(dx * dx + dy * dy);
          if (d > r) continue;
          const a = Math.pow(1 - d / r, 2);
          const i = (yy * size + xx) * 4;
          buf[i] = buf[i] * (1 - a) + cr * a;
          buf[i + 1] = buf[i + 1] * (1 - a) + cg * a;
          buf[i + 2] = buf[i + 2] * (1 - a) + cb * a;
          buf[i + 3] = Math.max(buf[i + 3], a);
        }
      }
    }
  }
  return { ok: true, buf, size, channels: 4 };
}

// PixelProcessor: applies a JS expression per pixel. opts.expr is a
// function (or string evaluated as one) over (u, v, r, g, b, a) that
// returns [r, g, b, a]. Used as the catch-all in Substance Designer.
export function pixelProcessor(opts) {
  const size = Math.max(32, Math.min(1024, Number(opts?.size) || 256));
  const buf = opts?.input instanceof Float32Array ? new Float32Array(opts.input) : _make(size, 4);
  const expr = opts?.expr;
  if (!expr) return { ok: false, error: 'no expr' };
  let fn;
  if (typeof expr === 'function') {
    fn = expr;
  } else if (typeof expr === 'string') {
    // eslint-disable-next-line no-new-func
    fn = new Function('u', 'v', 'r', 'g', 'b', 'a', `return (${expr});`);
  } else {
    return { ok: false, error: 'bad expr' };
  }
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const u = x / size, v = y / size;
      const r = buf[i], g = buf[i + 1], b = buf[i + 2], a = buf[i + 3];
      const out = fn(u, v, r, g, b, a);
      if (Array.isArray(out) && out.length >= 3) {
        buf[i] = out[0]; buf[i + 1] = out[1]; buf[i + 2] = out[2];
        buf[i + 3] = out[3] ?? a;
      }
    }
  }
  return { ok: true, buf, size, channels: 4 };
}

// FXMap: hierarchical quad subdivision — Substance Designer's FX-Map
// recursively places stamps with per-level transforms.
export function fxMap(opts) {
  const size = Math.max(64, Math.min(1024, Number(opts?.size) || 256));
  const depth = Math.max(1, Math.min(6, Number(opts?.depth) || 4));
  const splitProb = Number(opts?.splitProb) || 0.7;
  const rng = _rng(opts?.seed ?? 7);
  const buf = _make(size, 4);
  function _stamp(cx, cy, r, color) {
    const x0 = Math.max(0, Math.floor(cx - r));
    const x1 = Math.min(size - 1, Math.ceil(cx + r));
    const y0 = Math.max(0, Math.floor(cy - r));
    const y1 = Math.min(size - 1, Math.ceil(cy + r));
    for (let yy = y0; yy <= y1; yy++) {
      for (let xx = x0; xx <= x1; xx++) {
        const dx = xx - cx, dy = yy - cy;
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d > r) continue;
        const a = 1 - d / r;
        const i = (yy * size + xx) * 4;
        buf[i] = buf[i] * (1 - a) + color[0] * a;
        buf[i + 1] = buf[i + 1] * (1 - a) + color[1] * a;
        buf[i + 2] = buf[i + 2] * (1 - a) + color[2] * a;
        buf[i + 3] = Math.max(buf[i + 3], a);
      }
    }
  }
  function _rec(x, y, w, h, lvl) {
    if (lvl >= depth || rng() > splitProb) {
      const r = Math.min(w, h) * 0.4;
      const c = [rng(), rng(), rng()];
      _stamp(x + w / 2, y + h / 2, r, c);
      return;
    }
    const hw = w / 2, hh = h / 2;
    _rec(x, y, hw, hh, lvl + 1);
    _rec(x + hw, y, hw, hh, lvl + 1);
    _rec(x, y + hh, hw, hh, lvl + 1);
    _rec(x + hw, y + hh, hw, hh, lvl + 1);
  }
  _rec(0, 0, size, size, 0);
  return { ok: true, buf, size, channels: 4 };
}

// SplatterCircular: random points distributed along concentric rings.
export function splatterCircular(opts) {
  const size = Math.max(64, Math.min(1024, Number(opts?.size) || 256));
  const rings = Math.max(2, Math.min(40, Number(opts?.rings) || 10));
  const perRing = Math.max(4, Math.min(120, Number(opts?.perRing) || 16));
  const stampR = Number(opts?.stampR) || 6;
  const rng = _rng(opts?.seed ?? 9);
  const buf = _make(size, 4);
  const cx0 = size / 2, cy0 = size / 2;
  const maxR = size * 0.45;
  for (let ri = 0; ri < rings; ri++) {
    const r = (ri + 1) / rings * maxR;
    for (let k = 0; k < perRing; k++) {
      const a = (k / perRing) * Math.PI * 2 + rng() * 0.1;
      const px = cx0 + Math.cos(a) * r;
      const py = cy0 + Math.sin(a) * r;
      const color = [0.6 + rng() * 0.4, 0.5 + rng() * 0.4, 0.3 + rng() * 0.5];
      const x0 = Math.max(0, Math.floor(px - stampR));
      const x1 = Math.min(size - 1, Math.ceil(px + stampR));
      const y0 = Math.max(0, Math.floor(py - stampR));
      const y1 = Math.min(size - 1, Math.ceil(py + stampR));
      for (let yy = y0; yy <= y1; yy++) {
        for (let xx = x0; xx <= x1; xx++) {
          const dx = xx - px, dy = yy - py;
          const d = Math.sqrt(dx * dx + dy * dy);
          if (d > stampR) continue;
          const aa = 1 - d / stampR;
          const i = (yy * size + xx) * 4;
          buf[i] = buf[i] * (1 - aa) + color[0] * aa;
          buf[i + 1] = buf[i + 1] * (1 - aa) + color[1] * aa;
          buf[i + 2] = buf[i + 2] * (1 - aa) + color[2] * aa;
          buf[i + 3] = Math.max(buf[i + 3], aa);
        }
      }
    }
  }
  return { ok: true, buf, size, channels: 4 };
}

// AnisotropicNoise: stretched gradient noise (long axis controllable).
export function anisotropicNoise(opts) {
  const size = Math.max(64, Math.min(1024, Number(opts?.size) || 256));
  const scaleX = Number(opts?.scaleX) || 0.05;
  const scaleY = Number(opts?.scaleY) || 0.005;
  const rng = _rng(opts?.seed ?? 33);
  const grad = new Float32Array(64);
  for (let i = 0; i < 64; i++) grad[i] = rng() * 2 - 1;
  const buf = _make(size, 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x * scaleX, v = y * scaleY;
      const fu = Math.floor(u), fv = Math.floor(v);
      const a = grad[(fu * 7 + fv * 17) & 63];
      const b = grad[((fu + 1) * 7 + fv * 17) & 63];
      const c = grad[(fu * 7 + (fv + 1) * 17) & 63];
      const d = grad[((fu + 1) * 7 + (fv + 1) * 17) & 63];
      const tx = u - fu, ty = v - fv;
      const top = a * (1 - tx) + b * tx;
      const bot = c * (1 - tx) + d * tx;
      const n = top * (1 - ty) + bot * ty;
      const v01 = n * 0.5 + 0.5;
      const i = (y * size + x) * 4;
      buf[i] = v01; buf[i + 1] = v01; buf[i + 2] = v01; buf[i + 3] = 1;
    }
  }
  return { ok: true, buf, size, channels: 4 };
}
