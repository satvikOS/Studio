// Slice 704 — Additional Cinema 4D MoGraph effectors. Plug into
// slice-692 mograph cloners by mutating per-clone transforms. Each
// effector receives the cloner's clone array and updates them.
// Effectors implemented: Sound, Formula, Shader, Step, Time.

function _audio() {
  // Lazy-init shared AudioContext + analyser. Subsequent calls reuse.
  if (typeof window === 'undefined') return null;
  if (!window.__studioMGEffectAudio) {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const ana = ctx.createAnalyser();
      ana.fftSize = 256;
      window.__studioMGEffectAudio = { ctx, ana, data: new Uint8Array(ana.frequencyBinCount) };
    } catch (_) {
      return null;
    }
  }
  return window.__studioMGEffectAudio;
}

export function soundEffector(clones, opts) {
  const a = _audio();
  if (!a) return { ok: false, error: 'no audio context' };
  a.ana.getByteFrequencyData(a.data);
  const scale = Number(opts?.scale) || 1.0;
  for (let i = 0; i < clones.length; i++) {
    const bin = a.data[i % a.data.length] / 255;
    clones[i].sy = 1 + bin * scale;
  }
  return { ok: true };
}

export function attachAudioElement(audioEl) {
  const a = _audio();
  if (!a) return { ok: false };
  try {
    const src = a.ctx.createMediaElementSource(audioEl);
    src.connect(a.ana);
    a.ana.connect(a.ctx.destination);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

export function formulaEffector(clones, opts) {
  // opts.formula: function(i, t, total) => { x, y, z, rx, ry, rz, sx, sy, sz }
  // or a string expression evaluated with vars i, t, n, sin, cos, time.
  const formula = opts?.formula;
  if (!formula) return { ok: false, error: 'no formula' };
  let fn;
  if (typeof formula === 'function') fn = formula;
  else if (typeof formula === 'string') {
    // eslint-disable-next-line no-new-func
    fn = new Function('i', 't', 'n', `
      const sin = Math.sin, cos = Math.cos;
      const _ret = (${formula});
      return _ret;
    `);
  } else return { ok: false };
  const t = performance.now() * 0.001;
  for (let i = 0; i < clones.length; i++) {
    try {
      const r = fn(i, t, clones.length);
      if (typeof r === 'object' && r !== null) {
        if (typeof r.x === 'number') clones[i].x = r.x;
        if (typeof r.y === 'number') clones[i].y = r.y;
        if (typeof r.z === 'number') clones[i].z = r.z;
        if (typeof r.rx === 'number') clones[i].rx = r.rx;
        if (typeof r.ry === 'number') clones[i].ry = r.ry;
        if (typeof r.rz === 'number') clones[i].rz = r.rz;
        if (typeof r.sx === 'number') clones[i].sx = r.sx;
        if (typeof r.sy === 'number') clones[i].sy = r.sy;
        if (typeof r.sz === 'number') clones[i].sz = r.sz;
      }
    } catch (_) {}
  }
  return { ok: true };
}

export function shaderEffector(clones, opts) {
  // Sample a Canvas / ImageData / 2D function at clone UV-like positions.
  const imageData = opts?.imageData;
  const w = opts?.width || (imageData?.width || 64);
  const h = opts?.height || (imageData?.height || 64);
  const channel = opts?.channel || 'r';   // r|g|b|luma
  const axis = opts?.axis || 'y';         // map sample to which transform
  const scale = Number(opts?.scale) || 1;
  for (let i = 0; i < clones.length; i++) {
    const x = i % w, y = Math.floor(i / w) % h;
    let v = 0.5;
    if (imageData?.data) {
      const idx = (y * w + x) * 4;
      const r = imageData.data[idx] / 255;
      const g = imageData.data[idx + 1] / 255;
      const b = imageData.data[idx + 2] / 255;
      v = channel === 'r' ? r
        : channel === 'g' ? g
        : channel === 'b' ? b
        : (0.299 * r + 0.587 * g + 0.114 * b);
    }
    if (axis === 'x') clones[i].x += v * scale;
    else if (axis === 'y') clones[i].y += v * scale;
    else if (axis === 'z') clones[i].z += v * scale;
    else if (axis === 's') {
      clones[i].sx *= 1 + v * scale;
      clones[i].sy *= 1 + v * scale;
      clones[i].sz *= 1 + v * scale;
    }
  }
  return { ok: true };
}

export function stepEffector(clones, opts) {
  // Per-clone step interpolation between start and end values.
  const start = opts?.start || {};
  const end = opts?.end || {};
  const interp = opts?.interp || 'linear';   // linear|easeIn|easeOut|easeInOut
  for (let i = 0; i < clones.length; i++) {
    const t = clones.length <= 1 ? 0 : i / (clones.length - 1);
    let e = t;
    if (interp === 'easeIn') e = t * t;
    else if (interp === 'easeOut') e = 1 - (1 - t) * (1 - t);
    else if (interp === 'easeInOut') e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
    for (const k of ['x', 'y', 'z', 'rx', 'ry', 'rz', 'sx', 'sy', 'sz']) {
      if (typeof start[k] === 'number' && typeof end[k] === 'number') {
        clones[i][k] = start[k] + (end[k] - start[k]) * e;
      }
    }
  }
  return { ok: true };
}

export function timeEffector(clones, opts) {
  const speed = Number(opts?.speed) || 1;
  const axis = opts?.axis || 'ry';
  const t = performance.now() * 0.001 * speed;
  for (let i = 0; i < clones.length; i++) {
    clones[i][axis] = (clones[i][axis] || 0) + t * 0.05;
  }
  return { ok: true };
}
