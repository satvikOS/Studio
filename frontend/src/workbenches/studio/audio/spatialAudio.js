/*
 * Studio spatial audio (Unreal MetaSounds/Wwise / Unity AudioSource). Real Web
 * Audio graph: each source is a synthesized tone (Oscillator -> Gain ->
 * StereoPanner -> destination) anchored at a world position. A listener (the
 * camera) drives per-source distance ATTENUATION (Unity-style inverse rolloff)
 * and stereo PAN. Tone is synthesized so no audio asset is needed; the spatial
 * math + graph are real (HRTF / occlusion / reverb zones are out of scope).
 */

let _ctx = null;
const _sources = [];
let _listener = [0, 0, 0];

function ctx() {
  if (_ctx === null) {
    try { _ctx = new (window.AudioContext || window.webkitAudioContext)(); }
    catch (e) { _ctx = false; }
  }
  return _ctx || null;
}

export function addSource(opts = {}) {
  const c = ctx();
  const pos = opts.position || [0, 0, 0];
  const freq = opts.freq || 220;
  const refDistance = opts.refDistance != null ? opts.refDistance : 1;
  const rolloff = opts.rolloff != null ? opts.rolloff : 1;
  const baseVolume = opts.volume != null ? opts.volume : 0.5;
  let nodes = null;
  if (c) {
    try {
      const osc = c.createOscillator(); osc.type = opts.type || 'sine'; osc.frequency.value = freq;
      const gain = c.createGain(); gain.gain.value = 0;
      const pan = c.createStereoPanner ? c.createStereoPanner() : null;
      osc.connect(gain); if (pan) { gain.connect(pan); pan.connect(c.destination); } else { gain.connect(c.destination); }
      osc.start();
      nodes = { osc, gain, pan };
    } catch (e) { nodes = null; }
  }
  const src = { pos: [...pos], freq, refDistance, rolloff, baseVolume, nodes, dist: 0, gain: 0, pan: 0 };
  _sources.push(src);
  update();
  return src;
}

export function setListener(pos) { _listener = [pos[0], pos[1], pos[2]]; update(); return _listener; }

export function update() {
  for (const s of _sources) {
    const dx = s.pos[0] - _listener[0], dy = s.pos[1] - _listener[1], dz = s.pos[2] - _listener[2];
    const d = Math.hypot(dx, dy, dz);
    s.dist = d;
    // Unity-style inverse rolloff: full volume within refDistance, falling off beyond.
    const att = s.refDistance / (s.refDistance + s.rolloff * Math.max(0, d - s.refDistance));
    s.gain = att * s.baseVolume;
    // Stereo pan: source x relative to the listener (world-x approximation).
    s.pan = Math.max(-1, Math.min(1, dx / (s.refDistance * 4)));
    if (s.nodes) { try { s.nodes.gain.gain.value = s.gain; if (s.nodes.pan) s.nodes.pan.pan.value = s.pan; } catch (e) { /* */ } }
  }
}

export function audioState() {
  return _sources.map((s) => ({ dist: s.dist, gain: s.gain, pan: s.pan, freq: s.freq, hasNodes: !!s.nodes }));
}
export function sourceCount() { return _sources.length; }
export function clearSources() {
  for (const s of _sources) { if (s.nodes) { try { s.nodes.osc.stop(); } catch (e) { /* */ } } }
  _sources.length = 0;
}
