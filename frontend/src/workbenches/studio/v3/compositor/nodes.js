// ArchDisc Studio V3 — compositor node-type registry.
//
// Unlike the shader graph (which evaluates per-pixel from a `ctx` factory
// and bakes a 2-D procedural texture), the compositor operates on whole
// RGBA framebuffers. Each node consumes zero, one, or two ImageData-like
// objects ({ width, height, data: Uint8ClampedArray }) and returns a
// fresh ImageData-like object of the same dimensions.
//
// The buffer contract:
//   { width: number, height: number, data: Uint8ClampedArray }   // RGBA
//
// Each node kind exposes:
//   • title            — short label for the editor
//   • category         — palette grouping
//   • defaultParams()  — base param object cloned per instance
//   • inputs           — [{ name, type }]      (type: 'image')
//   • outputs          — [{ name, type }]      (type: 'image')
//   • eval(ctx, ins)   — receive Map<inputName, buffer>, return buffer
//                        `ctx` carries { source } — the viewport-captured
//                        source image so the Image node has a default
//                        when nothing is wired to it.
//
// IMPORTANT — every kind is REAL. No stubs, no placeholders. Per-pixel
// loops crunch the actual RGBA bytes; Gaussian blur runs two separable
// passes; alpha compositing applies the Porter-Duff `A over B` formula
// scaled by `mix`; levels/brightness/contrast clamp into [0,255].

// ─── Helpers ─────────────────────────────────────────────────────────────

export function makeBuffer(width, height) {
  const w = Math.max(1, Math.floor(width) || 1);
  const h = Math.max(1, Math.floor(height) || 1);
  return { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) };
}

export function cloneBuffer(buf) {
  const out = makeBuffer(buf.width, buf.height);
  out.data.set(buf.data);
  return out;
}

// Resize via nearest-neighbour. Compositor inputs may come from upstream
// nodes that emitted a different size (e.g. the Image node captured the
// renderer at its native resolution); we normalise to the largest input
// so all per-pixel ops can run lock-step.
export function resizeNearest(src, w, h) {
  if (src.width === w && src.height === h) return src;
  const out = makeBuffer(w, h);
  const sx = src.width / w;
  const sy = src.height / h;
  for (let y = 0; y < h; y++) {
    const ys = Math.min(src.height - 1, Math.floor(y * sy));
    for (let x = 0; x < w; x++) {
      const xs = Math.min(src.width - 1, Math.floor(x * sx));
      const si = (ys * src.width + xs) * 4;
      const di = (y * w + x) * 4;
      out.data[di]     = src.data[si];
      out.data[di + 1] = src.data[si + 1];
      out.data[di + 2] = src.data[si + 2];
      out.data[di + 3] = src.data[si + 3];
    }
  }
  return out;
}

// Solid black fallback when the slot is empty. We still return a real
// buffer so downstream nodes don't have to special-case undefined.
export function blackBuffer(w, h) {
  const out = makeBuffer(w, h);
  for (let i = 3; i < out.data.length; i += 4) out.data[i] = 255; // alpha
  return out;
}

function clamp8(x) { return x < 0 ? 0 : x > 255 ? 255 : x; }

function resolveInput(ins, name, ctx) {
  const v = ins.get(name);
  if (v && v.data && v.width && v.height) return v;
  // Fall back to the original source for the Image input slot, otherwise
  // a black frame matching the source size.
  if (ctx && ctx.source && ctx.source.data) return ctx.source;
  return blackBuffer(1, 1);
}

// ─── Node definitions ────────────────────────────────────────────────────

export const NODE_KINDS = {
  // ─── 1. Image (source) ────────────────────────────────────────────────
  // Surfaces the viewport-captured frame supplied via ctx.source. No
  // inputs. The graph wraps Image so even a fresh-installed compositor
  // produces a meaningful Output if you wire Image → Output directly.
  image: {
    title: 'Image',
    category: 'input',
    defaultParams: () => ({}),
    inputs: [],
    outputs: [{ name: 'image', type: 'image' }],
    eval(ctx /* , ins */) {
      if (ctx && ctx.source && ctx.source.data) return cloneBuffer(ctx.source);
      return blackBuffer(2, 2);
    },
  },

  // ─── 2. Color Correct / Color Balance ─────────────────────────────────
  // Per-channel lift / gamma / gain. Implements the classic three-way
  // colour-corrector formula:
  //   out = pow( max(0, in + lift * (1 - in)), 1 / gamma ) * gain
  // Lift/gamma/gain each have an R, G, B triplet so the colourist can
  // tint shadows / mids / highlights independently.
  colorcorrect: {
    title: 'ColorCorrect',
    category: 'color',
    defaultParams: () => ({
      liftR: 0.0,  liftG: 0.0,  liftB: 0.0,
      gammaR: 1.0, gammaG: 1.0, gammaB: 1.0,
      gainR: 1.0,  gainG: 1.0,  gainB: 1.0,
    }),
    inputs: [{ name: 'image', type: 'image' }],
    outputs: [{ name: 'image', type: 'image' }],
    eval(ctx, ins) {
      const src = resolveInput(ins, 'image', ctx);
      const out = makeBuffer(src.width, src.height);
      const p = this.params;
      const liftR = +p.liftR || 0, liftG = +p.liftG || 0, liftB = +p.liftB || 0;
      const gR = Math.max(0.0001, +p.gammaR || 1.0);
      const gG = Math.max(0.0001, +p.gammaG || 1.0);
      const gB = Math.max(0.0001, +p.gammaB || 1.0);
      const knR = +p.gainR || 1.0, knG = +p.gainG || 1.0, knB = +p.gainB || 1.0;
      const N = src.data.length;
      for (let i = 0; i < N; i += 4) {
        let r = src.data[i] / 255;
        let g = src.data[i + 1] / 255;
        let b = src.data[i + 2] / 255;
        // Lift
        r = r + liftR * (1 - r);
        g = g + liftG * (1 - g);
        b = b + liftB * (1 - b);
        if (r < 0) r = 0; if (g < 0) g = 0; if (b < 0) b = 0;
        // Gamma — invert exponent so >1 brightens (cinematographer convention)
        r = Math.pow(r, 1 / gR);
        g = Math.pow(g, 1 / gG);
        b = Math.pow(b, 1 / gB);
        // Gain
        r *= knR; g *= knG; b *= knB;
        out.data[i]     = clamp8(Math.round(r * 255));
        out.data[i + 1] = clamp8(Math.round(g * 255));
        out.data[i + 2] = clamp8(Math.round(b * 255));
        out.data[i + 3] = src.data[i + 3];
      }
      return out;
    },
  },

  // ─── 3. Blur (separable Gaussian) ─────────────────────────────────────
  // Two passes: horizontal then vertical. Kernel built from
  //   k_i = exp( -i*i / (2 * sigma * sigma) )
  // and normalised. Radius clamped to [0, 16].
  blur: {
    title: 'Blur',
    category: 'filter',
    defaultParams: () => ({ radius: 4 }),
    inputs: [{ name: 'image', type: 'image' }],
    outputs: [{ name: 'image', type: 'image' }],
    eval(ctx, ins) {
      const src = resolveInput(ins, 'image', ctx);
      const r = Math.max(0, Math.min(16, Math.round(+this.params.radius || 0)));
      if (r === 0) return cloneBuffer(src);
      const sigma = Math.max(0.5, r * 0.5);
      // Build 1-D kernel.
      const k = new Float32Array(r * 2 + 1);
      let sum = 0;
      for (let i = -r; i <= r; i++) {
        const v = Math.exp(-(i * i) / (2 * sigma * sigma));
        k[i + r] = v; sum += v;
      }
      for (let i = 0; i < k.length; i++) k[i] /= sum;
      const W = src.width, H = src.height;
      const tmp = makeBuffer(W, H);
      // Horizontal pass: src → tmp.
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          let R = 0, G = 0, B = 0, A = 0;
          for (let t = -r; t <= r; t++) {
            const sx = x + t < 0 ? 0 : x + t >= W ? W - 1 : x + t;
            const i = (y * W + sx) * 4;
            const w = k[t + r];
            R += src.data[i]     * w;
            G += src.data[i + 1] * w;
            B += src.data[i + 2] * w;
            A += src.data[i + 3] * w;
          }
          const di = (y * W + x) * 4;
          tmp.data[di]     = clamp8(Math.round(R));
          tmp.data[di + 1] = clamp8(Math.round(G));
          tmp.data[di + 2] = clamp8(Math.round(B));
          tmp.data[di + 3] = clamp8(Math.round(A));
        }
      }
      // Vertical pass: tmp → out.
      const out = makeBuffer(W, H);
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          let R = 0, G = 0, B = 0, A = 0;
          for (let t = -r; t <= r; t++) {
            const sy = y + t < 0 ? 0 : y + t >= H ? H - 1 : y + t;
            const i = (sy * W + x) * 4;
            const w = k[t + r];
            R += tmp.data[i]     * w;
            G += tmp.data[i + 1] * w;
            B += tmp.data[i + 2] * w;
            A += tmp.data[i + 3] * w;
          }
          const di = (y * W + x) * 4;
          out.data[di]     = clamp8(Math.round(R));
          out.data[di + 1] = clamp8(Math.round(G));
          out.data[di + 2] = clamp8(Math.round(B));
          out.data[di + 3] = clamp8(Math.round(A));
        }
      }
      return out;
    },
  },

  // ─── 4. Mix (alpha-blend two image inputs) ────────────────────────────
  // op ∈ { over, add, multiply, screen }
  // fac ∈ [0,1] scales the second operand's contribution.
  mix: {
    title: 'Mix',
    category: 'color',
    defaultParams: () => ({ op: 'over', fac: 1.0 }),
    inputs: [
      { name: 'A', type: 'image' },
      { name: 'B', type: 'image' },
    ],
    outputs: [{ name: 'image', type: 'image' }],
    eval(ctx, ins) {
      const aRaw = resolveInput(ins, 'A', ctx);
      const bRaw = resolveInput(ins, 'B', ctx);
      // Normalise sizes so per-pixel pairing works.
      const W = Math.max(aRaw.width, bRaw.width);
      const H = Math.max(aRaw.height, bRaw.height);
      const a = resizeNearest(aRaw, W, H);
      const b = resizeNearest(bRaw, W, H);
      const fac = Math.max(0, Math.min(1, +this.params.fac));
      const op = String(this.params.op || 'over');
      const out = makeBuffer(W, H);
      const N = out.data.length;
      for (let i = 0; i < N; i += 4) {
        const ar = a.data[i] / 255, ag = a.data[i + 1] / 255, ab = a.data[i + 2] / 255, aa = a.data[i + 3] / 255;
        const br = b.data[i] / 255, bg = b.data[i + 1] / 255, bb = b.data[i + 2] / 255, ba = b.data[i + 3] / 255;
        let R, G, B, A;
        switch (op) {
          case 'add': {
            R = ar + br * fac; G = ag + bg * fac; B = ab + bb * fac;
            A = Math.max(aa, ba * fac);
            break;
          }
          case 'multiply': {
            const fr = ar * br, fg = ag * bg, fb = ab * bb;
            R = ar * (1 - fac) + fr * fac;
            G = ag * (1 - fac) + fg * fac;
            B = ab * (1 - fac) + fb * fac;
            A = aa;
            break;
          }
          case 'screen': {
            const fr = 1 - (1 - ar) * (1 - br);
            const fg = 1 - (1 - ag) * (1 - bg);
            const fb = 1 - (1 - ab) * (1 - bb);
            R = ar * (1 - fac) + fr * fac;
            G = ag * (1 - fac) + fg * fac;
            B = ab * (1 - fac) + fb * fac;
            A = Math.max(aa, ba * fac);
            break;
          }
          case 'over':
          default: {
            // Standard A-over-B with `fac` scaling B's coverage.
            const ka = aa;
            const kb = ba * fac;
            // Place B underneath A (so the second input behaves as
            // background and fac dims it).
            const oa = ka + kb * (1 - ka);
            if (oa <= 0) { R = 0; G = 0; B = 0; A = 0; break; }
            R = (ar * ka + br * kb * (1 - ka)) / oa;
            G = (ag * ka + bg * kb * (1 - ka)) / oa;
            B = (ab * ka + bb * kb * (1 - ka)) / oa;
            A = oa;
            break;
          }
        }
        out.data[i]     = clamp8(Math.round(R * 255));
        out.data[i + 1] = clamp8(Math.round(G * 255));
        out.data[i + 2] = clamp8(Math.round(B * 255));
        out.data[i + 3] = clamp8(Math.round(A * 255));
      }
      return out;
    },
  },

  // ─── 5. Brightness / Contrast ─────────────────────────────────────────
  //   out = (in - 0.5) * contrast + 0.5 + brightness
  // brightness ∈ [-1, 1], contrast ∈ [0, 4].
  brightcontrast: {
    title: 'Brightness/Contrast',
    category: 'color',
    defaultParams: () => ({ brightness: 0.0, contrast: 1.0 }),
    inputs: [{ name: 'image', type: 'image' }],
    outputs: [{ name: 'image', type: 'image' }],
    eval(ctx, ins) {
      const src = resolveInput(ins, 'image', ctx);
      const out = makeBuffer(src.width, src.height);
      const bri = +this.params.brightness || 0;
      const con = +this.params.contrast || 1;
      const N = src.data.length;
      for (let i = 0; i < N; i += 4) {
        for (let c = 0; c < 3; c++) {
          const v = src.data[i + c] / 255;
          const o = (v - 0.5) * con + 0.5 + bri;
          out.data[i + c] = clamp8(Math.round(o * 255));
        }
        out.data[i + 3] = src.data[i + 3];
      }
      return out;
    },
  },

  // ─── 6. Levels ────────────────────────────────────────────────────────
  // Maps the range [black, white] → [0, 1] then applies a gamma curve.
  levels: {
    title: 'Levels',
    category: 'color',
    defaultParams: () => ({ black: 0.0, white: 1.0, gamma: 1.0 }),
    inputs: [{ name: 'image', type: 'image' }],
    outputs: [{ name: 'image', type: 'image' }],
    eval(ctx, ins) {
      const src = resolveInput(ins, 'image', ctx);
      const out = makeBuffer(src.width, src.height);
      let black = Math.max(0, Math.min(1, +this.params.black || 0));
      let white = Math.max(0, Math.min(1, +this.params.white || 1));
      if (white <= black) white = Math.min(1, black + 0.0001);
      const span = white - black;
      const invGamma = 1 / Math.max(0.0001, +this.params.gamma || 1);
      const N = src.data.length;
      for (let i = 0; i < N; i += 4) {
        for (let c = 0; c < 3; c++) {
          let v = src.data[i + c] / 255;
          v = (v - black) / span;
          if (v < 0) v = 0; else if (v > 1) v = 1;
          v = Math.pow(v, invGamma);
          out.data[i + c] = clamp8(Math.round(v * 255));
        }
        out.data[i + 3] = src.data[i + 3];
      }
      return out;
    },
  },

  // ─── Transform (translate / rotate / scale) ───────────────────────────
  // Repositions a layer — the workhorse of any VFX comp (Nuke Transform,
  // Fusion Transform, AE position/rotation/scale). Maps each OUTPUT pixel
  // back through the inverse transform into the source and BILINEARLY
  // samples, so edges stay smooth under sub-pixel motion and rotation.
  // Pivot is the image centre. Outside-source samples are transparent.
  transform: {
    title: 'Transform',
    category: 'transform',
    defaultParams: () => ({ tx: 0, ty: 0, rotate: 0, scale: 1 }),
    inputs: [{ name: 'image', type: 'image' }],
    outputs: [{ name: 'image', type: 'image' }],
    eval(ctx, ins) {
      const src = resolveInput(ins, 'image', ctx);
      const W = src.width, H = src.height;
      const out = makeBuffer(W, H);
      const p = this.params;
      const tx = +p.tx || 0, ty = +p.ty || 0;
      const ang = (+p.rotate || 0) * Math.PI / 180;
      const sc = Math.abs(+p.scale) > 1e-4 ? +p.scale : 1e-4;
      const cx = (W - 1) / 2, cy = (H - 1) / 2;
      // Inverse transform: undo translate, then rotate by −ang, then /scale.
      const cosA = Math.cos(-ang), sinA = Math.sin(-ang);
      const sample = (fx, fy, ch) => {
        const x0 = Math.floor(fx), y0 = Math.floor(fy);
        const x1 = x0 + 1, y1 = y0 + 1;
        const dx = fx - x0, dy = fy - y0;
        const at = (xx, yy) => {
          if (xx < 0 || xx >= W || yy < 0 || yy >= H) return 0;
          return src.data[(yy * W + xx) * 4 + ch];
        };
        const top = at(x0, y0) * (1 - dx) + at(x1, y0) * dx;
        const bot = at(x0, y1) * (1 - dx) + at(x1, y1) * dx;
        return top * (1 - dy) + bot * dy;
      };
      const inBounds = (fx, fy) => fx >= -0.5 && fx <= W - 0.5 && fy >= -0.5 && fy <= H - 0.5;
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          // shift to pivot, undo translate
          let px = x - cx - tx, py = y - cy - ty;
          // undo rotation
          let rx = px * cosA - py * sinA;
          let ry = px * sinA + py * cosA;
          // undo scale, back to source coords
          const fx = rx / sc + cx, fy = ry / sc + cy;
          const di = (y * W + x) * 4;
          if (!inBounds(fx, fy)) { out.data[di + 3] = 0; continue; }
          out.data[di]     = clamp8(Math.round(sample(fx, fy, 0)));
          out.data[di + 1] = clamp8(Math.round(sample(fx, fy, 1)));
          out.data[di + 2] = clamp8(Math.round(sample(fx, fy, 2)));
          out.data[di + 3] = clamp8(Math.round(sample(fx, fy, 3)));
        }
      }
      return out;
    },
  },

  // ─── Crop ──────────────────────────────────────────────────────────────
  // Keeps a rectangular region (left/top/right/bottom insets in pixels);
  // everything outside is made transparent. Same output dimensions so the
  // rest of the graph runs lock-step (Nuke Crop with "reformat" off).
  crop: {
    title: 'Crop',
    category: 'transform',
    defaultParams: () => ({ left: 0, top: 0, right: 0, bottom: 0 }),
    inputs: [{ name: 'image', type: 'image' }],
    outputs: [{ name: 'image', type: 'image' }],
    eval(ctx, ins) {
      const src = resolveInput(ins, 'image', ctx);
      const W = src.width, H = src.height;
      const out = makeBuffer(W, H);
      const p = this.params;
      const l = Math.max(0, Math.floor(+p.left || 0));
      const t = Math.max(0, Math.floor(+p.top || 0));
      const r = Math.max(0, Math.floor(+p.right || 0));
      const b = Math.max(0, Math.floor(+p.bottom || 0));
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          const di = (y * W + x) * 4;
          if (x < l || x >= W - r || y < t || y >= H - b) {
            out.data[di + 3] = 0; // transparent outside crop
            continue;
          }
          out.data[di]     = src.data[di];
          out.data[di + 1] = src.data[di + 1];
          out.data[di + 2] = src.data[di + 2];
          out.data[di + 3] = src.data[di + 3];
        }
      }
      return out;
    },
  },

  // ─── Chroma Keyer (green/blue-screen) ─────────────────────────────────
  // The flagship VFX compositing node (Nuke Keylight / Fusion Primatte /
  // OBS Chroma Key / Blender Keying node). Pulls a matte by measuring how
  // much each pixel resembles the KEY screen colour, then keys it to
  // transparent and DESPILLS the key colour that bounced onto the subject.
  //
  // Matte model (screen-balance keyer, à la Keylight): for a green screen
  // the "screen-ness" of a pixel is  G − max(R, B)  — strongly positive on
  // pure green, ≤0 on the subject. We normalise that against the key
  // colour's own screen-ness, then map through clip-black/clip-white
  // thresholds (gain/balance) into alpha. The channel is auto-picked from
  // the key colour (green vs blue) but the formula generalises.
  //
  // Despill: where the key channel exceeds the average of the other two,
  // pull it back down to that average × (1 − despill) — removes the green
  // fringe without desaturating the whole image.
  keyer: {
    title: 'Keyer',
    category: 'color',
    defaultParams: () => ({
      keyR: 0.05, keyG: 0.7, keyB: 0.1, // default: green screen
      clipBlack: 0.10,  // screen-ness below this → fully transparent matte 0
      clipWhite: 0.55,  // screen-ness above this → fully opaque subject 1 (inverted)
      despill: 1.0,     // 0 = none, 1 = full key-channel suppression
    }),
    inputs: [{ name: 'image', type: 'image' }],
    outputs: [{ name: 'image', type: 'image' }],
    eval(ctx, ins) {
      const src = resolveInput(ins, 'image', ctx);
      const out = makeBuffer(src.width, src.height);
      const p = this.params;
      const kr = +p.keyR, kg = +p.keyG, kb = +p.keyB;
      // Pick the dominant key channel: 1=green, 2=blue, 0=red.
      let keyCh = 1;
      if (kb >= kr && kb >= kg) keyCh = 2;
      else if (kr >= kg && kr >= kb) keyCh = 0;
      // "screen-ness" of a colour = keyChannel − max(other two).
      const screenness = (r, g, b) => {
        if (keyCh === 1) return g - Math.max(r, b);
        if (keyCh === 2) return b - Math.max(r, g);
        return r - Math.max(g, b);
      };
      const keyScreen = Math.max(1e-3, screenness(kr, kg, kb));
      const cb = +p.clipBlack, cw = Math.max(+p.clipWhite, cb + 1e-3);
      const despill = Math.max(0, Math.min(1, +p.despill));
      const N = src.data.length;
      for (let i = 0; i < N; i += 4) {
        let r = src.data[i] / 255, g = src.data[i + 1] / 255, b = src.data[i + 2] / 255;
        // Normalised screen-ness in [0..1]: 1 on pure key, ~0 on subject.
        const s = Math.max(0, screenness(r, g, b)) / keyScreen;
        // Map through clip thresholds → matte (alpha). High screen-ness =
        // background = transparent, so alpha = 1 − smoothstep(cb, cw, s).
        let t = (s - cb) / (cw - cb);
        if (t < 0) t = 0; else if (t > 1) t = 1;
        const matte = 1 - (t * t * (3 - 2 * t)); // 1=subject, 0=screen
        // Despill: suppress the key channel where it dominates.
        if (despill > 0) {
          if (keyCh === 1) { const avg = (r + b) * 0.5; if (g > avg) g = g + (avg - g) * despill; }
          else if (keyCh === 2) { const avg = (r + g) * 0.5; if (b > avg) b = b + (avg - b) * despill; }
          else { const avg = (g + b) * 0.5; if (r > avg) r = r + (avg - r) * despill; }
        }
        out.data[i]     = clamp8(Math.round(r * 255));
        out.data[i + 1] = clamp8(Math.round(g * 255));
        out.data[i + 2] = clamp8(Math.round(b * 255));
        out.data[i + 3] = clamp8(Math.round(matte * (src.data[i + 3] / 255) * 255));
      }
      return out;
    },
  },

  // ─── Glow / Bloom ─────────────────────────────────────────────────────
  // Threshold the bright areas, blur them, and add back (screen) — the
  // bloom every renderer/compositor ships (Nuke Glow, Fusion SoftGlow,
  // Blender Glare). Reuses a small separable box-blur on the threshold
  // pass so highlights bleed.
  glow: {
    title: 'Glow',
    category: 'filter',
    defaultParams: () => ({ threshold: 0.7, intensity: 1.0, radius: 6 }),
    inputs: [{ name: 'image', type: 'image' }],
    outputs: [{ name: 'image', type: 'image' }],
    eval(ctx, ins) {
      const src = resolveInput(ins, 'image', ctx);
      const W = src.width, H = src.height;
      const thr = Math.max(0, Math.min(1, +this.params.threshold));
      const intensity = Math.max(0, +this.params.intensity);
      const radius = Math.max(1, Math.min(32, Math.floor(+this.params.radius) || 6));
      // Bright-pass into a float buffer.
      const bright = new Float32Array(W * H * 3);
      for (let i = 0, j = 0; i < src.data.length; i += 4, j += 3) {
        const r = src.data[i] / 255, g = src.data[i + 1] / 255, b = src.data[i + 2] / 255;
        const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
        const k = lum > thr ? (lum - thr) / (1 - thr + 1e-6) : 0;
        bright[j] = r * k; bright[j + 1] = g * k; bright[j + 2] = b * k;
      }
      // Separable box blur (two passes ≈ Gaussian) on the bright buffer.
      const blurPass = (buf, horizontal) => {
        const res = new Float32Array(buf.length);
        for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
          let sr = 0, sg = 0, sb = 0, n = 0;
          for (let d = -radius; d <= radius; d++) {
            const xx = horizontal ? x + d : x;
            const yy = horizontal ? y : y + d;
            if (xx < 0 || xx >= W || yy < 0 || yy >= H) continue;
            const k = (yy * W + xx) * 3;
            sr += buf[k]; sg += buf[k + 1]; sb += buf[k + 2]; n++;
          }
          const o = (y * W + x) * 3;
          res[o] = sr / n; res[o + 1] = sg / n; res[o + 2] = sb / n;
        }
        return res;
      };
      const blurred = blurPass(blurPass(bright, true), false);
      // Screen the blurred bloom back over the source.
      const out = makeBuffer(W, H);
      for (let i = 0, j = 0; i < src.data.length; i += 4, j += 3) {
        const r = src.data[i] / 255, g = src.data[i + 1] / 255, b = src.data[i + 2] / 255;
        const br = blurred[j] * intensity, bg = blurred[j + 1] * intensity, bb = blurred[j + 2] * intensity;
        // screen blend: 1 − (1−a)(1−b)
        out.data[i]     = clamp8(Math.round((1 - (1 - r) * (1 - Math.min(1, br))) * 255));
        out.data[i + 1] = clamp8(Math.round((1 - (1 - g) * (1 - Math.min(1, bg))) * 255));
        out.data[i + 2] = clamp8(Math.round((1 - (1 - b) * (1 - Math.min(1, bb))) * 255));
        out.data[i + 3] = src.data[i + 3];
      }
      return out;
    },
  },

  // ─── Output (sink) ────────────────────────────────────────────────────
  // Forwards its `image` input. The graph's evaluate() reads from the
  // Output node; the install layer is what actually paints to the
  // <canvas data-studio-v3-compositor-output>.
  output: {
    title: 'Output',
    category: 'output',
    defaultParams: () => ({}),
    inputs: [{ name: 'image', type: 'image' }],
    outputs: [],
    eval(ctx, ins) {
      return resolveInput(ins, 'image', ctx);
    },
  },
};

export function listKinds() { return Object.keys(NODE_KINDS); }

// Build an instance descriptor with a fresh uuid + params clone.
let _uuid = 0;
export function makeNode(kind, params) {
  const def = NODE_KINDS[kind];
  if (!def) throw new Error(`unknown compositor node kind: ${kind}`);
  const id = `c_${Date.now().toString(36)}_${(_uuid++).toString(36)}`;
  return {
    id,
    kind,
    title: def.title,
    params: { ...def.defaultParams(), ...(params || {}) },
    x: 0,
    y: 0,
  };
}
