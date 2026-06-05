// ArchDisc Studio V3 — simulation public installer.
//
// installSim() binds every cloth / soft-body / fluid op to window.__studioSim*
// (and __studioCloth*, __studioSoftBody*, __studioFluid* convenience
// aliases the sub-modules document), then chains all three sub-sims
// into the existing window.__archdiscViewport.__studioAnimTick chain
// alongside physics / constraints / particles.
//
// Chain semantics (matches the pattern in api.js):
//   chained.__sim = true
//   chained.__prev = prior tick
//   reset/togglePlay splice the chain by walking via __prev.
//
// All registrations are idempotent — re-calling installSim() no-ops.

import {
  clothCreate, clothPinVertex, clothUnpinVertex, clothSetWind,
  clothStep, clothList, clothReset, clothResetAll, clothRemove,
} from './cloth.js';
import {
  softBodyAttach, softBodyDetach, softBodyStep,
  softBodyList, softBodyReset, softBodyResetAll,
} from './softbody.js';
import {
  fluidCreate, fluidStep, fluidList,
  fluidReset, fluidResetAll, fluidRemove,
} from './fluid.js';

function reg(name, fn, description) {
  if (typeof window === 'undefined') return;
  window[name] = fn;
  const tryReg = () => {
    if (typeof window.__studioCommandRegister === 'function') {
      try {
        window.__studioCommandRegister(name, fn, { category: 'sim', description });
        return true;
      } catch (_) { return false; }
    }
    return false;
  };
  if (!tryReg()) {
    // Palette may not be live yet (autoload races registerV3Api).
    setTimeout(() => { tryReg(); }, 0);
  }
}

// ── chain helpers ───────────────────────────────────────────────────────
function hasSimTickIn(viewport) {
  let cur = viewport.__studioAnimTick;
  while (cur) {
    if (cur.__sim) return true;
    cur = cur.__prev;
  }
  return false;
}

function removeSimTick(viewport) {
  // Walk the chain, splicing out every link whose __sim flag is set.
  // Each link's __prev points at the next-older tick; we rebuild the
  // chain top-down skipping sim links.
  const links = [];
  let cur = viewport.__studioAnimTick;
  while (cur) { links.push(cur); cur = cur.__prev; }
  const kept = links.filter((l) => !l.__sim);
  // Re-link in original order: kept[0] is most recent, set its __prev
  // to kept[1], etc.
  for (let i = 0; i < kept.length - 1; i++) kept[i].__prev = kept[i + 1];
  if (kept.length) kept[kept.length - 1].__prev = null;
  viewport.__studioAnimTick = kept[0] || null;
}

// Master state — used by __studioSimTogglePlay so the chain wire-up
// happens exactly once and the sub-sim ticks share a single time base.
const _state = { playing: false, last: 0 };

function ensureSimTick() {
  const v = (typeof window !== 'undefined') ? window.__archdiscViewport : null;
  if (!v) return { ok: false, error: 'no viewport' };
  if (hasSimTickIn(v)) return { ok: true, alreadyChained: true };
  _state.last = (typeof performance !== 'undefined') ? performance.now() : Date.now();
  const prev = v.__studioAnimTick;
  const chained = (now) => {
    const t = (typeof now === 'number') ? now : ((typeof performance !== 'undefined') ? performance.now() : Date.now());
    const dt = Math.min(0.05, (t - _state.last) / 1000) || 0.016;
    _state.last = t;
    try { clothStep(dt); } catch (_) {}
    try { softBodyStep(dt); } catch (_) {}
    try { fluidStep(dt); } catch (_) {}
    if (prev) { try { prev(t); } catch (_) {} }
  };
  chained.__sim = true;
  chained.__prev = prev;
  v.__studioAnimTick = chained;
  return { ok: true, chained: true };
}

function simTogglePlay() {
  const v = (typeof window !== 'undefined') ? window.__archdiscViewport : null;
  if (!v) return { ok: false, error: 'no viewport' };
  if (_state.playing) {
    _state.playing = false;
    removeSimTick(v);
    return { ok: true, playing: false };
  }
  _state.playing = true;
  ensureSimTick();
  return { ok: true, playing: true };
}

function simReset() {
  // Snap every sim back to its initial state AND splice the tick out
  // so further frames don't drift. Mirrors __studioPhysicsReset.
  try { clothResetAll(); } catch (_) {}
  try { softBodyResetAll(); } catch (_) {}
  try { fluidResetAll(); } catch (_) {}
  const v = (typeof window !== 'undefined') ? window.__archdiscViewport : null;
  if (v) removeSimTick(v);
  _state.playing = false;
  return { ok: true };
}

function simStatus() {
  let cloth = 0, soft = 0, fluid = 0;
  try { cloth = clothList().cloths.length; } catch (_) {}
  try { soft  = softBodyList().bodies.length; } catch (_) {}
  try { fluid = fluidList().fluids.length;    } catch (_) {}
  return { ok: true, playing: _state.playing, cloth, soft, fluid };
}

// ── installer ──────────────────────────────────────────────────────────
export function installSim() {
  if (typeof window === 'undefined') return { ok: false, error: 'no window' };
  if (window.__studioSimInstalled) return { ok: true, alreadyInstalled: true };
  window.__studioSimInstalled = true;

  // Cloth.
  reg('__studioClothCreate',     (w, h, segs, opts) => clothCreate(w, h, segs, opts),
    'Spawn a mass-spring cloth on a subdivided plane (segs×segs).');
  reg('__studioClothPinVertex',  (uuid, idx) => clothPinVertex(uuid, idx),
    'Pin a cloth vertex (infinite mass) so it never moves.');
  reg('__studioClothUnpinVertex',(uuid, idx) => clothUnpinVertex(uuid, idx),
    'Release a previously-pinned cloth vertex.');
  reg('__studioClothSetWind',    (vec) => clothSetWind(vec),
    'Set the global wind vector (m/s²) applied to every cloth.');
  reg('__studioClothStep',       (dt) => clothStep(dt),
    'Advance every cloth one semi-implicit Euler step at dt seconds.');
  reg('__studioClothList',       () => clothList(),
    'List every cloth: uuid, name, vertex/spring/pinned counts.');
  reg('__studioClothReset',      (uuid) => clothReset(uuid),
    'Snap a cloth back to its initial flat configuration.');
  reg('__studioClothRemove',     (uuid) => clothRemove(uuid),
    'Remove a cloth from the scene and dispose its GPU buffers.');

  // Soft body.
  reg('__studioSoftBodyAttach',  (uuid, opts) => softBodyAttach(uuid, opts),
    'Attach PBD soft-body sim to a mesh (gravity + ground + edge constraints).');
  reg('__studioSoftBodyDetach',  (uuid) => softBodyDetach(uuid),
    'Detach the soft-body sim and snap the mesh back to rest.');
  reg('__studioSoftBodyStep',    (dt) => softBodyStep(dt),
    'Advance every soft body one PBD step (predict → project → solve).');
  reg('__studioSoftBodyList',    () => softBodyList(),
    'List every active soft body.');
  reg('__studioSoftBodyReset',   (uuid) => softBodyReset(uuid),
    'Snap one soft body back to its baked rest shape.');

  // Fluid.
  reg('__studioFluidCreate',     (count, boxSize, opts) => fluidCreate(count, boxSize, opts),
    'Spawn an SPH-lite particle fluid in an AABB box.');
  reg('__studioFluidStep',       (dt) => fluidStep(dt),
    'Advance every fluid one SPH-lite step (density → pressure → integrate).');
  reg('__studioFluidList',       () => fluidList(),
    'List every fluid: uuid, particle count, box size.');
  reg('__studioFluidReset',      (uuid) => fluidReset(uuid),
    'Snap a fluid back to its initial particle grid.');
  reg('__studioFluidRemove',     (uuid) => fluidRemove(uuid),
    'Remove a fluid from the scene and dispose its GPU buffers.');

  // Master.
  reg('__studioSimTogglePlay',   () => simTogglePlay(),
    'Toggle the master sim tick — chains/splices cloth+soft+fluid stepping into __studioAnimTick.');
  reg('__studioSimReset',        () => simReset(),
    'Snap every cloth/soft/fluid to its initial state and stop the master tick.');
  reg('__studioSimStatus',       () => simStatus(),
    'Report sim playing state + per-type counts.');

  return { ok: true, alreadyInstalled: false };
}

export function uninstallSim() {
  if (typeof window === 'undefined') return { ok: false };
  // Splice ourselves out of the animation chain.
  const v = window.__archdiscViewport;
  if (v) removeSimTick(v);
  _state.playing = false;
  for (const k of [
    '__studioClothCreate', '__studioClothPinVertex', '__studioClothUnpinVertex',
    '__studioClothSetWind', '__studioClothStep', '__studioClothList',
    '__studioClothReset', '__studioClothRemove',
    '__studioSoftBodyAttach', '__studioSoftBodyDetach', '__studioSoftBodyStep',
    '__studioSoftBodyList', '__studioSoftBodyReset',
    '__studioFluidCreate', '__studioFluidStep', '__studioFluidList',
    '__studioFluidReset', '__studioFluidRemove',
    '__studioSimTogglePlay', '__studioSimReset', '__studioSimStatus',
  ]) {
    try { delete window[k]; } catch (_) {}
    if (typeof window.__studioCommandUnregister === 'function') {
      try { window.__studioCommandUnregister(k); } catch (_) {}
    }
  }
  window.__studioSimInstalled = false;
  return { ok: true };
}
