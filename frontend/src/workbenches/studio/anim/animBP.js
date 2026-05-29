/*
 * Studio Animation State Machine (Unreal Animation Blueprint / Unity Animator
 * Controller / Blender NLA-ish). Named locomotion STATES each define a
 * procedural pose (vertical bob + lateral sway + turn) as a function of time;
 * switching state cross-fades the pose over a blend duration so motion
 * transitions smoothly (Idle -> Walk -> Run). Deterministic — pose is a closed
 * form of (state, t), no Math.random.
 */
export const ANIM_STATES = {
  idle: { bobAmp: 0.02, bobFreq: 1.2, swayAmp: 0.0, spinRate: 0.0 },
  walk: { bobAmp: 0.05, bobFreq: 3.0, swayAmp: 0.03, spinRate: 0.35 },
  run: { bobAmp: 0.09, bobFreq: 6.0, swayAmp: 0.05, spinRate: 0.9 },
};

function statePose(s, t) {
  return {
    dy: Math.sin(t * s.bobFreq * Math.PI * 2) * s.bobAmp,
    dx: Math.sin(t * s.bobFreq * Math.PI) * s.swayAmp,
    ry: t * s.spinRate,
  };
}

export function createAnimBP() {
  return { current: 'idle', prev: null, blend: 1, blendDur: 0.4, t: 0 };
}

export function animBPSetState(m, name, blendDur = 0.4) {
  if (!ANIM_STATES[name] || name === m.current) return m;
  m.prev = m.current; m.current = name; m.blend = 0; m.blendDur = Math.max(1e-3, blendDur);
  return m;
}

// Advance the machine by dt and return the (possibly cross-faded) pose offset.
export function animBPStep(m, dt) {
  m.t += dt;
  if (m.blend < 1) m.blend = Math.min(1, m.blend + dt / m.blendDur);
  const cur = statePose(ANIM_STATES[m.current] || ANIM_STATES.idle, m.t);
  if (m.prev && m.blend < 1) {
    const pv = statePose(ANIM_STATES[m.prev] || ANIM_STATES.idle, m.t);
    const b = m.blend;
    return { dy: pv.dy * (1 - b) + cur.dy * b, dx: pv.dx * (1 - b) + cur.dx * b, ry: pv.ry * (1 - b) + cur.ry * b, blend: b, state: m.current };
  }
  return { ...cur, blend: 1, state: m.current };
}
