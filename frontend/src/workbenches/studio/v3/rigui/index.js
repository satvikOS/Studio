// ArchDisc Studio V3 — rig UI (handle gizmos) public installer.
//
// `installRigUI()` does two things, in this order:
//
//   1. Binds each handle op to `window.__studioRigUI*` AND auto-registers
//      it under category 'rig' with `__studioCommandRegister` so the
//      command palette + menubar discovers them. Mirrors rig/index.js.
//   2. Installs the pointer dragger on the viewport canvas. If the
//      viewport isn't mounted yet (early-import race) we re-attempt on a
//      few macrotasks — the rig op surface is still usable in the meantime
//      via programmatic dragHandle.
//
// Idempotent — re-calls are guarded by window.__studioRigUIInstalled.

import {
  showHandles,
  hideHandles,
  listHandles,
  dragHandle,
  setChainLength,
  refreshHandles,
} from './handles.js';
import {
  install as installDragger,
  uninstall as uninstallDragger,
  isInstalled as draggerIsInstalled,
} from './dragger.js';

function reg(name, fn, description) {
  if (typeof window === 'undefined') return;
  window[name] = fn;
  const tryReg = () => {
    if (typeof window.__studioCommandRegister === 'function') {
      try {
        window.__studioCommandRegister(name, fn, { category: 'rig', description });
        return true;
      } catch (_) { return false; }
    }
    return false;
  };
  if (!tryReg()) {
    // Command registry races registerV3Api — retry on the next macrotask
    // (matches rig/index.js's autoload retry).
    setTimeout(() => { tryReg(); }, 0);
    setTimeout(() => { tryReg(); }, 100);
  }
}

function tryInstallDragger(retries) {
  const r = installDragger();
  if (r.ok || (retries != null && retries <= 0)) return r;
  setTimeout(() => tryInstallDragger((retries == null ? 8 : retries) - 1), 100);
  return r;
}

export function installRigUI() {
  if (typeof window === 'undefined') return { ok: false, error: 'no window' };
  if (window.__studioRigUIInstalled) return { ok: true, alreadyInstalled: true };
  window.__studioRigUIInstalled = true;

  reg('__studioRigUIShowHandles', (armatureUuid, opts) => showHandles(armatureUuid, opts || {}),
    'Drop draggable IK target spheres in the viewport for each end-effector bone.');
  reg('__studioRigUIHideHandles', (armatureUuid) => hideHandles(armatureUuid),
    'Remove IK handle gizmos (optionally filtered by armature uuid).');
  reg('__studioRigUIListHandles', () => listHandles(),
    'List every live IK handle: uuid, boneUuid, world position, chain length.');
  reg('__studioRigUIDragHandle', (handleUuid, worldPos) => dragHandle(handleUuid, worldPos),
    'Programmatically move a handle to a world-space target; re-runs CCD IK.');
  reg('__studioRigUISetChainLength', (handleUuid, n) => setChainLength(handleUuid, n),
    'Set how many parent bones a handle drags via IK (default 3).');
  reg('__studioRigUIRefreshHandles', () => refreshHandles(),
    'Re-sync every handle\'s position to its bone\'s current world position.');

  // Install the pointer dragger; if the viewport hasn't mounted yet,
  // tryInstallDragger schedules a few retries. The op surface above is
  // already live so tests / Archie can drive handles programmatically.
  tryInstallDragger();

  return { ok: true, alreadyInstalled: false, draggerInstalled: draggerIsInstalled() };
}

export function uninstallRigUI() {
  if (typeof window === 'undefined') return { ok: false };
  uninstallDragger();
  for (const k of [
    '__studioRigUIShowHandles', '__studioRigUIHideHandles', '__studioRigUIListHandles',
    '__studioRigUIDragHandle', '__studioRigUISetChainLength', '__studioRigUIRefreshHandles',
  ]) {
    try { delete window[k]; } catch (_) {}
    if (typeof window.__studioCommandUnregister === 'function') {
      try { window.__studioCommandUnregister(k); } catch (_) {}
    }
  }
  window.__studioRigUIInstalled = false;
  return { ok: true };
}
