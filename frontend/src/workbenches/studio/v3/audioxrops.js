// ArchDisc Studio V3 — spatial audio + WebXR family.
//
// V3-native ports of V2's Unity-/Wwise-style positional audio and the
// WebXR session bridge. Audio sources land in the scene as a tiny
// wireframe icosahedron gizmo so they're outliner-visible. XR ops are
// thin wrappers around navigator.xr that flip the viewport renderer's
// xr.enabled flag and call setSession on the active session.

import * as THREE from 'three';
import {
  addSource as audioAddSource,
  setListener as audioSetListener,
  audioState,
  sourceCount as audioSourceCount,
} from '../audio/spatialAudio.js';

function scene() {
  return window.__archdiscScene || (window.__archdiscViewport && window.__archdiscViewport.scene) || null;
}
function activeMesh() {
  const vp = window.__archdiscViewport;
  return (vp && vp.getSelected && vp.getSelected()) || null;
}

function addAudioSource(opts) {
  const s = scene(); if (!s) return { ok: false, error: 'no scene' };
  const o = opts || {};
  const sel = activeMesh();
  const pos = o.position || (sel ? [sel.position.x, sel.position.y, sel.position.z] : [0, 0, 0]);
  audioAddSource({ ...o, position: pos });
  const giz = new THREE.Mesh(
    new THREE.IcosahedronGeometry(0.03, 0),
    new THREE.MeshBasicMaterial({ color: 0xbcbcbc, wireframe: true }),
  );
  giz.position.set(pos[0], pos[1], pos[2]);
  giz.userData.archdiscAudioGizmo = true;
  giz.name = `studio-audio-source-${audioSourceCount()}`;
  s.add(giz);
  const vp = window.__archdiscViewport;
  const ctrl = vp && (vp.orbitControls || vp.controls);
  const t = ctrl && ctrl.target;
  audioSetListener(t ? [t.x, t.y, t.z] : [0, 0, 0]);
  return { ok: true, count: audioSourceCount(), state: audioState() };
}

function setListener(pos) {
  audioSetListener(pos);
  return { ok: true, state: audioState() };
}

function getAudioState() {
  return { ok: true, ...audioState() };
}

async function xrSupport(mode) {
  const xr = (typeof navigator !== 'undefined') ? navigator.xr : null;
  if (!xr) return { ok: true, hasXR: false, supported: false, mode: mode || 'immersive-vr' };
  let supported = false;
  try { supported = await xr.isSessionSupported(mode || 'immersive-vr'); }
  catch (_) { supported = false; }
  return { ok: true, hasXR: true, supported, mode: mode || 'immersive-vr' };
}

async function enterXR(mode) {
  const m = mode || 'immersive-ar';
  const sup = await xrSupport(m);
  if (!sup.hasXR) return { ...sup, entered: false, error: 'WebXR unavailable' };
  if (!sup.supported) return { ...sup, entered: false, error: `${m} not supported` };
  const vp = window.__archdiscViewport;
  if (!vp || !vp.renderer) return { ...sup, entered: false, error: 'no renderer' };
  try {
    vp.renderer.xr.enabled = true;
    const session = await navigator.xr.requestSession(
      m,
      m === 'immersive-ar' ? { optionalFeatures: ['hit-test', 'local-floor'] } : {},
    );
    await vp.renderer.xr.setSession(session);
    return { ...sup, entered: true };
  } catch (e) {
    return { ...sup, entered: false, error: String((e && e.message) || e) };
  }
}

export function registerAudioXROps() {
  window.__studioAddAudioSource = addAudioSource;
  window.__studioSetListener    = setListener;
  window.__studioAudioState     = getAudioState;
  window.__studioXRSupport      = xrSupport;
  window.__studioEnterXR        = enterXR;
}

export function unregisterAudioXROps() {
  for (const k of [
    '__studioAddAudioSource', '__studioSetListener', '__studioAudioState',
    '__studioXRSupport', '__studioEnterXR',
  ]) { try { delete window[k]; } catch (_) {} }
}
