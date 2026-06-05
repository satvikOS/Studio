// ArchDisc Studio V3 — Cascadeur-style AutoPose installer + op surface.
//
// `installAutoPose()` is idempotent — re-calls no-op (guarded by
// window.__studioAutoPoseInstalled). It:
//
//   1. Binds the AutoPose ops to window.__studioAutoPose* AND registers
//      each under category 'rig' with __studioCommandRegister so the
//      command palette discovers them alongside the slice-682 rig +
//      slice-693 rigui ops.
//   2. Lazy-mounts the AutoPosePanel into a body-attached host (via
//      common/panel.js) so we never touch StudioShellV3.jsx.
//   3. Wires Esc to close the panel — matches the EeveePanel UX hook.

import React from 'react';

import AutoPosePanel from './AutoPosePanel.jsx';
import { computeCOM } from './com.js';
import { autoBalance } from './balance.js';
import {
  autoContact,
  addAutoContact,
  listAutoContacts,
} from './contact.js';
import {
  fitBallisticTrajectory,
  sampleTrajectory,
  clearTrajectory,
} from './trajectory.js';
import { registerOps, unregisterOps } from '../common/registry.js';
import { mountPanel, unmountPanel } from '../common/panel.js';

const ARM_TAG = 'archdiscStudioRigArmature';
const PANEL_SLUG = 'autopose';

let _open = false;
let _activeArm = null;

function _scene() {
  if (typeof window === 'undefined') return null;
  return window.__archdiscScene
    || (window.__archdiscViewport && window.__archdiscViewport.scene)
    || null;
}

function _listArmatures() {
  const scene = _scene();
  if (!scene) return [];
  const out = [];
  scene.traverse((o) => {
    if (o.userData && o.userData[ARM_TAG]) {
      out.push({ uuid: o.uuid, name: o.name });
    }
  });
  return out;
}

// Default the active armature to the first one we find — saves the user
// a click in the common single-rig case.
function _autoPickArmature() {
  if (_activeArm) return _activeArm;
  const arms = _listArmatures();
  if (arms.length) {
    _activeArm = arms[0].uuid;
    return _activeArm;
  }
  return null;
}

function _renderPanel() {
  const rec = mountPanel(PANEL_SLUG);
  if (!rec) return;
  if (!_open) { rec.render(null); return; }
  rec.render(
    React.createElement(AutoPosePanel, {
      activeArmatureUuid: _activeArm,
      setActiveArmatureUuid: (u) => { _activeArm = u; _renderPanel(); },
      listArmatures: _listArmatures,
      getCOM: (u) => computeCOM(u),
      runBalance: (u, opts) => autoBalance(u, opts || {}),
      runContact: (u, gy) => autoContact(u, gy),
      listContacts: (u) => listAutoContacts(u),
      bakeTrajectory: (u, t0, t1, peak) => fitBallisticTrajectory(u, t0, t1, peak),
      onCloseRequest: () => __studioAutoPosePanelClose(),
    })
  );
}

function __studioAutoPosePanelOpen() {
  _autoPickArmature();
  _open = true;
  _renderPanel();
  return { ok: true, open: true, armature: _activeArm };
}
function __studioAutoPosePanelClose() {
  _open = false;
  _renderPanel();
  return { ok: true, open: false };
}
function __studioAutoPosePanelToggle() {
  return _open ? __studioAutoPosePanelClose() : __studioAutoPosePanelOpen();
}
function __studioAutoPosePanelGetState() {
  return { ok: true, open: _open, armature: _activeArm, armatures: _listArmatures() };
}
function __studioAutoPoseSetActiveArmature(uuid) {
  _activeArm = uuid || null;
  if (_open) _renderPanel();
  return { ok: true, armature: _activeArm };
}

// ── Op surface — each is a thin wrapper that also re-renders the panel
//                so the live readouts stay in sync after a programmatic
//                op call from the agent / cmd palette.
function __studioAutoPoseComputeCOM(armUuid) {
  return computeCOM(armUuid || _activeArm);
}
function __studioAutoPoseBalance(armUuid, opts) {
  const r = autoBalance(armUuid || _activeArm, opts || {});
  if (_open) _renderPanel();
  return r;
}
function __studioAutoPoseAddAutoContact(boneUuid, on) {
  const r = addAutoContact(boneUuid, on);
  if (_open) _renderPanel();
  return r;
}
function __studioAutoPoseListAutoContacts(armUuid) {
  return listAutoContacts(armUuid || _activeArm);
}
function __studioAutoPoseAutoContact(armUuid, groundY) {
  const r = autoContact(armUuid || _activeArm, groundY);
  if (_open) _renderPanel();
  return r;
}
function __studioAutoPoseFitBallisticTrajectory(armUuid, t0, t1, peak, opts) {
  const r = fitBallisticTrajectory(armUuid || _activeArm, t0, t1, peak, opts);
  if (_open) _renderPanel();
  return r;
}
function __studioAutoPoseSampleTrajectory(armUuid, t) {
  return sampleTrajectory(armUuid || _activeArm, t);
}
function __studioAutoPoseClearTrajectory(armUuid) {
  const r = clearTrajectory(armUuid || _activeArm);
  if (_open) _renderPanel();
  return r;
}

const OP_NAMES = [
  '__studioAutoPoseComputeCOM',
  '__studioAutoPoseBalance',
  '__studioAutoPoseAddAutoContact',
  '__studioAutoPoseListAutoContacts',
  '__studioAutoPoseAutoContact',
  '__studioAutoPoseFitBallisticTrajectory',
  '__studioAutoPoseSampleTrajectory',
  '__studioAutoPoseClearTrajectory',
  '__studioAutoPosePanelOpen',
  '__studioAutoPosePanelClose',
  '__studioAutoPosePanelToggle',
  '__studioAutoPosePanelGetState',
  '__studioAutoPoseSetActiveArmature',
];

let _keyHookInstalled = false;

export function installAutoPose() {
  if (typeof window === 'undefined') return { ok: false, error: 'no window' };
  if (window.__studioAutoPoseInstalled) {
    return { ok: true, alreadyInstalled: true };
  }
  window.__studioAutoPoseInstalled = true;

  registerOps({
    __studioAutoPoseComputeCOM: [
      __studioAutoPoseComputeCOM,
      'Volume-weighted center of mass of a rig: { ok, com:[x,y,z], mass }.',
    ],
    __studioAutoPoseBalance: [
      __studioAutoPoseBalance,
      'Bend spine bones until the COM projection lies inside the foot polygon.',
    ],
    __studioAutoPoseAddAutoContact: [
      __studioAutoPoseAddAutoContact,
      'Tag (or untag) a bone as an AutoContact end-effector (snaps to ground).',
    ],
    __studioAutoPoseListAutoContacts: [
      __studioAutoPoseListAutoContacts,
      'List every AutoContact-tagged bone in an armature with its world position.',
    ],
    __studioAutoPoseAutoContact: [
      __studioAutoPoseAutoContact,
      'IK-snap every AutoContact-tagged bone to the ground plane at groundY.',
    ],
    __studioAutoPoseFitBallisticTrajectory: [
      __studioAutoPoseFitBallisticTrajectory,
      'Bake a parabolic root-position track between two times for jump animation.',
    ],
    __studioAutoPoseSampleTrajectory: [
      __studioAutoPoseSampleTrajectory,
      'Sample the baked parabola at a time without mutating the armature.',
    ],
    __studioAutoPoseClearTrajectory: [
      __studioAutoPoseClearTrajectory,
      'Remove a previously-baked ballistic trajectory from an armature.',
    ],
    __studioAutoPosePanelOpen: [
      __studioAutoPosePanelOpen, 'Open the AutoPose side panel.',
    ],
    __studioAutoPosePanelClose: [
      __studioAutoPosePanelClose, 'Close the AutoPose side panel.',
    ],
    __studioAutoPosePanelToggle: [
      __studioAutoPosePanelToggle, 'Toggle the AutoPose side panel.',
    ],
    __studioAutoPosePanelGetState: [
      __studioAutoPosePanelGetState,
      'Read AutoPose panel state: { ok, open, armature, armatures }.',
    ],
    __studioAutoPoseSetActiveArmature: [
      __studioAutoPoseSetActiveArmature,
      'Set which armature the panel + op surface defaults to.',
    ],
  }, 'rig');

  if (!_keyHookInstalled) {
    _keyHookInstalled = true;
    const onKey = (e) => {
      const ae = document.activeElement;
      if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.isContentEditable)) return;
      if (e.key === 'Escape' && _open) { __studioAutoPosePanelClose(); e.preventDefault(); }
    };
    window.addEventListener('keydown', onKey);
  }

  return { ok: true, ops: OP_NAMES.length };
}

export function uninstallAutoPose() {
  if (typeof window === 'undefined') return { ok: false };
  if (!window.__studioAutoPoseInstalled) return { ok: true };
  unregisterOps(OP_NAMES);
  unmountPanel(PANEL_SLUG);
  _open = false;
  _activeArm = null;
  window.__studioAutoPoseInstalled = false;
  return { ok: true };
}

export default installAutoPose;
