// ArchDisc Studio V3 — edit-mode marker renderer.
//
// Visualisation companions to editops's selection set. Listens to the
// 'studio-pick' event from the viewport click router, pushes the pick
// into the multi-set (or replaces), then re-renders every selected
// vert / edge / face as a teal helper.
//
//   __studioRenderPickMarker          — handle a studio-pick event
//   __studioRenderEditSelectionMarkers — full re-render of the helpers
//   __studioClearPickMarkers          — wipe every marker from the scene

import * as THREE from 'three';

const MARKER_GROUP = '__studio_pick_marker__';
const TEAL = 0x1de9b6;

function scene() {
  return window.__archdiscScene || (window.__archdiscViewport && window.__archdiscViewport.scene) || null;
}
function activeMesh() {
  const vp = window.__archdiscViewport;
  return (vp && vp.getSelected && vp.getSelected()) || null;
}

function clearMarkers() {
  const s = scene(); if (!s) return;
  const toRemove = [];
  s.traverse((o) => { if (o.name === MARKER_GROUP) toRemove.push(o); });
  toRemove.forEach((o) => {
    s.remove(o);
    if (o.geometry) o.geometry.dispose();
    if (o.material) o.material.dispose();
  });
}

function clearPickMarkers() {
  clearMarkers();
  return { ok: true };
}

function renderEditSelectionMarkers() {
  const s = scene();
  const m = activeMesh();
  if (!s || !m || !m.geometry || !m.geometry.attributes.position) return { ok: false };
  clearMarkers();
  const pos = m.geometry.attributes.position;
  const idx = m.geometry.index ? m.geometry.index.array : null;
  if (!window.__studioEditSelection) window.__studioEditSelection = { current: { vertices: [], edges: [], faces: [] } };
  const sel = window.__studioEditSelection.current;
  m.updateMatrixWorld(true);
  for (const v of sel.vertices) {
    const p = new THREE.Vector3().fromBufferAttribute(pos, v).applyMatrix4(m.matrixWorld);
    const g = new THREE.SphereGeometry(0.0012, 16, 12);
    const h = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: TEAL, depthTest: false, transparent: true, opacity: 0.95 }));
    h.position.copy(p);
    h.name = MARKER_GROUP; h.renderOrder = 999; h.userData.isHelper = true;
    s.add(h);
  }
  for (const e of sel.edges) {
    const vA = new THREE.Vector3().fromBufferAttribute(pos, e[0]).applyMatrix4(m.matrixWorld);
    const vB = new THREE.Vector3().fromBufferAttribute(pos, e[1]).applyMatrix4(m.matrixWorld);
    const g = new THREE.BufferGeometry().setFromPoints([vA, vB]);
    const h = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: TEAL, depthTest: false, transparent: true, opacity: 0.95 }));
    h.name = MARKER_GROUP; h.renderOrder = 999; h.userData.isHelper = true;
    s.add(h);
  }
  for (const f of sel.faces) {
    const a = idx ? idx[f * 3] : f * 3;
    const b = idx ? idx[f * 3 + 1] : f * 3 + 1;
    const c = idx ? idx[f * 3 + 2] : f * 3 + 2;
    const vA = new THREE.Vector3().fromBufferAttribute(pos, a).applyMatrix4(m.matrixWorld);
    const vB = new THREE.Vector3().fromBufferAttribute(pos, b).applyMatrix4(m.matrixWorld);
    const vC = new THREE.Vector3().fromBufferAttribute(pos, c).applyMatrix4(m.matrixWorld);
    const g = new THREE.BufferGeometry().setFromPoints([vA, vB, vC]);
    g.setIndex([0, 1, 2]);
    const h = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: TEAL, side: THREE.DoubleSide, depthTest: false, transparent: true, opacity: 0.4 }));
    h.name = MARKER_GROUP; h.renderOrder = 999; h.userData.isHelper = true;
    s.add(h);
  }
  return { ok: true, counts: { vertices: sel.vertices.length, edges: sel.edges.length, faces: sel.faces.length } };
}

function renderPickMarker(detail) {
  const s = scene();
  if (!s || !detail || !detail.result || !detail.result.ok) return { ok: false };
  const mode = detail.mode;
  const r = detail.result;
  if (mode === 'vertex' && Number.isInteger(r.vertIdx)) {
    if (detail.additive && window.__studioAddToEditSelection) window.__studioAddToEditSelection('vertex', r.vertIdx);
    else if (window.__studioReplaceEditSelection) window.__studioReplaceEditSelection('vertex', r.vertIdx);
  } else if (mode === 'edge' && Array.isArray(r.vertIdx) && r.vertIdx.length === 2) {
    if (detail.additive && window.__studioAddToEditSelection) window.__studioAddToEditSelection('edge', r.vertIdx);
    else if (window.__studioReplaceEditSelection) window.__studioReplaceEditSelection('edge', r.vertIdx);
  } else if (mode === 'face' && Number.isInteger(r.faceIdx)) {
    if (detail.additive && window.__studioAddToEditSelection) window.__studioAddToEditSelection('face', r.faceIdx);
    else if (window.__studioReplaceEditSelection) window.__studioReplaceEditSelection('face', r.faceIdx);
  }
  renderEditSelectionMarkers();
  return { ok: true, mode };
}

let _wiredHandlers = null;

export function registerMarkerOps() {
  window.__studioRenderPickMarker          = renderPickMarker;
  window.__studioRenderEditSelectionMarkers = renderEditSelectionMarkers;
  window.__studioClearPickMarkers          = clearPickMarkers;
  if (_wiredHandlers) return;
  const onPick = (ev) => renderPickMarker(ev.detail);
  const onModeChange = (ev) => {
    if (ev.detail && ev.detail.mode === 'object') {
      if (window.__studioClearEditSelection) window.__studioClearEditSelection();
      clearMarkers();
    }
  };
  window.addEventListener('studio-pick', onPick);
  window.addEventListener('studio-edit-mode-changed', onModeChange);
  _wiredHandlers = { onPick, onModeChange };
  window.__studioPickMarkerWired = true;
}

export function unregisterMarkerOps() {
  for (const k of [
    '__studioRenderPickMarker', '__studioRenderEditSelectionMarkers', '__studioClearPickMarkers',
  ]) { try { delete window[k]; } catch (_) {} }
  if (_wiredHandlers) {
    window.removeEventListener('studio-pick', _wiredHandlers.onPick);
    window.removeEventListener('studio-edit-mode-changed', _wiredHandlers.onModeChange);
    _wiredHandlers = null;
  }
  delete window.__studioPickMarkerWired;
  clearMarkers();
}
