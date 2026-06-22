// ArchDisc Studio V3 — ANIMATION PLAYER / transport (play/pause/stop/scrub).
//
// A single requestAnimationFrame-driven transport that advances a NORMALISED
// phase t ∈ [0,1) and, every frame, drives the active CLIP. A clip is just a
// pure mapping  name → function(t) → pose  that, when called, sets the rig at
// phase t. The humanoid locomotion cycles (walk / run / idle) plug straight in
// because window.__studioHumanoidAnimate({cycle,t}) already IS that function:
// we register one clip per cycle whose body calls it.
//
// WHY a rAF loop + module-level refs (NOT React state): per the project's
// window-API-no-setState rule, the transport's window surface and its loop must
// never live in React state — a re-render race would delete the loop / window
// fns mid-play and strand the rig. So all mutable state lives in the module-
// level `S` object; the TransportBar component only READS it (polling) to paint
// the playhead + readout. The bar's buttons call window.__studioAnimPlayer.*,
// which is the same surface the CUA reaches by clicking those buttons.
//
// Public surface (installed on window):
//   __studioAnimPlayer = {
//     play(), pause(), stop(), scrub(t), setClip(name),
//     registerClip(name, fn, opts?), clips(), state()
//   }
//   __studioAnimClips  — live array of clip names (for the bar's <select> + the
//                        executeToolCall validator).
//
// No new npm deps — pure JS + the existing humanoid locomotion window API.

// ── module-level transport state (the "refs") ────────────────────────────────
const S = {
  clip: 'walk',        // active clip name
  t: 0,                // current phase 0..1
  playing: false,
  raf: 0,              // active rAF handle (0 = idle)
  last: 0,             // perf.now() of the previous frame (for dt)
  // seconds per full loop of phase. 1.4s ≈ a natural stride cadence; per-clip
  // overrides come from the clip registry's `seconds`.
  defaultSeconds: 1.4,
  lastError: null,
};

// ── clip registry: name → { fn(t)->pose, seconds } ───────────────────────────
// `fn(t)` MUST set the rig at phase t (side-effecting). Return value is ignored
// for playback but surfaced to callers for honesty (e.g. {ok:false}).
const CLIPS = new Map();

function clipNames() { return Array.from(CLIPS.keys()); }

function syncWindowClipList() {
  if (typeof window !== 'undefined') window.__studioAnimClips = clipNames();
}

/**
 * Register (or replace) a clip.
 * @param {string} name
 * @param {(t:number)=>any} fn  side-effecting pose setter for phase t∈[0,1)
 * @param {{seconds?:number}} [opts]
 */
export function registerClip(name, fn, opts = {}) {
  if (!name || typeof fn !== 'function') {
    return { ok: false, error: 'registerClip needs (name, fn)' };
  }
  CLIPS.set(String(name), { fn, seconds: Number(opts.seconds) || S.defaultSeconds });
  syncWindowClipList();
  return { ok: true, name: String(name), clips: clipNames() };
}

// Register the humanoid locomotion cycles as clips. Each clip body calls the
// already-installed window.__studioHumanoidAnimate({cycle, t}); this is the
// "generic path" the brief asks for — a clip is a function(t)->pose, and these
// just delegate to the locomotion API. Per-cycle cadence mirrors
// CYCLE_DEFAULTS in humanoidLocomotion.js (walk slower than run).
function registerLocomotionClips() {
  // jump is a single bound (one arc per loop) so it runs a touch slower than the
  // looped gaits to read the crouch→launch→flight→land→recover stages clearly.
  const cycleSeconds = { walk: 1.25, run: 0.85, jump: 1.5, idle: 3.6 };
  // window.__studioHumanoidCycles is set by installHumanoidLocomotion(); fall
  // back to the canonical set if it hasn't installed yet (order-independent).
  const cycles = (typeof window !== 'undefined' && Array.isArray(window.__studioHumanoidCycles))
    ? window.__studioHumanoidCycles
    : ['walk', 'run', 'jump', 'idle'];
  for (const cycle of cycles) {
    registerClip(cycle, (t) => {
      if (typeof window === 'undefined' || typeof window.__studioHumanoidAnimate !== 'function') {
        return { ok: false, error: 'humanoid locomotion not installed' };
      }
      return window.__studioHumanoidAnimate({ cycle, t });
    }, { seconds: cycleSeconds[cycle] || S.defaultSeconds });
  }
}

// ── core: apply the active clip at phase t ───────────────────────────────────
function applyAt(t) {
  const entry = CLIPS.get(S.clip);
  if (!entry) { S.lastError = `unknown clip "${S.clip}"`; return { ok: false, error: S.lastError }; }
  let r;
  try {
    r = entry.fn(t);
  } catch (err) {
    S.lastError = String(err && err.message || err);
    return { ok: false, error: S.lastError };
  }
  // honour an explicit {ok:false} from the clip body (e.g. no rig yet) so the
  // bar/CUA can surface an honest failure rather than a silent no-op.
  if (r && r.ok === false) { S.lastError = r.error || 'clip failed'; return r; }
  S.lastError = null;
  return r || { ok: true };
}

function clipSeconds() {
  const entry = CLIPS.get(S.clip);
  return (entry && entry.seconds) || S.defaultSeconds;
}

// ── rAF loop ─────────────────────────────────────────────────────────────────
function loop(now) {
  if (!S.playing) return;
  const dt = S.last ? Math.min(0.1, (now - S.last) / 1000) : 0; // clamp big tab-switch gaps
  S.last = now;
  // advance phase, looping. dt / period = fraction of a loop this frame covered.
  const period = clipSeconds();
  S.t = (S.t + dt / period) % 1;
  if (S.t < 0) S.t += 1;
  applyAt(S.t);
  S.raf = (typeof requestAnimationFrame === 'function')
    ? requestAnimationFrame(loop)
    : 0;
}

function startLoop() {
  if (S.raf) return;
  S.last = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
  S.raf = (typeof requestAnimationFrame === 'function') ? requestAnimationFrame(loop) : 0;
}

function stopLoop() {
  if (S.raf && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(S.raf);
  S.raf = 0;
  S.last = 0;
}

// ── transport ops ────────────────────────────────────────────────────────────
export function play() {
  if (!CLIPS.has(S.clip)) return { ok: false, error: `unknown clip "${S.clip}"`, clips: clipNames() };
  if (S.playing) return { ok: true, playing: true, clip: S.clip, t: S.t };
  S.playing = true;
  startLoop();
  return { ok: true, playing: true, clip: S.clip, t: S.t };
}

export function pause() {
  // halt the loop, KEEP t (resume from here).
  S.playing = false;
  stopLoop();
  return { ok: true, playing: false, clip: S.clip, t: S.t };
}

export function stop() {
  // halt + reset t=0 + re-pose at t=0 (rig returns to the cycle's start frame).
  S.playing = false;
  stopLoop();
  S.t = 0;
  const r = applyAt(0);
  // also reset locomotion travel (so a walked-away figure snaps back to base).
  if (typeof window !== 'undefined' && typeof window.__studioHumanoidLocomotionReset === 'function') {
    try { window.__studioHumanoidLocomotionReset(); } catch (_) { /* best-effort */ }
  }
  return { ok: !!(r && r.ok !== false), playing: false, clip: S.clip, t: 0, error: r && r.error };
}

/** Scrub to phase t∈[0,1) and pose the rig there. Pauses any running loop. */
export function scrub(t) {
  const n = Number(t);
  if (!isFinite(n)) return { ok: false, error: `scrub needs a finite t, got ${t}` };
  // accept t in [0,1); wrap defensively so callers can pass 1.0 / negatives.
  let phase = n % 1; if (phase < 0) phase += 1;
  // scrubbing is a manual seek — stop advancing but DON'T reset.
  if (S.playing) { S.playing = false; stopLoop(); }
  S.t = phase;
  const r = applyAt(phase);
  return { ok: !!(r && r.ok !== false), clip: S.clip, t: phase, error: r && r.error };
}

/** Switch the active clip. If playing, the loop picks it up on the next frame. */
export function setClip(name) {
  const nm = String(name);
  if (!CLIPS.has(nm)) return { ok: false, error: `unknown clip "${nm}"`, clips: clipNames() };
  S.clip = nm;
  // if paused/stopped, re-pose at the current t in the new clip so the change is
  // visible immediately; if playing, the loop will apply it next frame.
  if (!S.playing) applyAt(S.t);
  return { ok: true, clip: nm, t: S.t, clips: clipNames() };
}

/** Live, read-only snapshot for the TransportBar / status (no setState). */
export function state() {
  return {
    clip: S.clip,
    t: S.t,
    playing: S.playing,
    seconds: clipSeconds(),
    clips: clipNames(),
    lastError: S.lastError,
  };
}

// ── install ──────────────────────────────────────────────────────────────────
export function installStudioAnimPlayer() {
  if (typeof window === 'undefined') return { ok: false, error: 'no window' };
  registerLocomotionClips();
  // ensure the active clip exists (locomotion may register after first install).
  if (!CLIPS.has(S.clip)) {
    const first = clipNames()[0];
    if (first) S.clip = first;
  }
  window.__studioAnimPlayer = {
    play, pause, stop, scrub, setClip,
    registerClip, clips: clipNames, state,
  };
  syncWindowClipList();
  // surface in the command palette if present (parity with locomotion install).
  try {
    if (typeof window.__studioCommandRegister === 'function') {
      window.__studioCommandRegister('__studioAnimPlayerPlay', () => play(), 'anim',
        'Start the animation transport (rAF loop advancing phase t over the active clip: walk/run/idle).');
      window.__studioCommandRegister('__studioAnimPlayerPause', () => pause(), 'anim',
        'Pause the animation transport, keeping the current phase t.');
      window.__studioCommandRegister('__studioAnimPlayerStop', () => stop(), 'anim',
        'Stop the animation transport, reset phase t=0 and re-pose the rig at frame 0.');
    }
  } catch (_) { /* palette optional */ }
  return { ok: true, clips: clipNames() };
}

export function uninstallStudioAnimPlayer() {
  pause();
  if (typeof window !== 'undefined') {
    try { delete window.__studioAnimPlayer; } catch (_) { window.__studioAnimPlayer = undefined; }
  }
  return { ok: true };
}

export default installStudioAnimPlayer;
