// ArchDisc Studio V3 — camera bookmarks + turntable + FOV + projection.
//
// Complements cameraops.js (frame all / set axis / look at) with the
// view-time camera controls every DCC has under View > Cameras.
//
//   __studioBookmarkCamera        — save current camera pose under name
//   __studioRestoreCameraBookmark — restore named pose
//   __studioListCameraBookmarks   — list saved bookmark names
//   __studioToggleTurntable       — OrbitControls autoRotate flip
//   __studioSetFov                — perspective camera FOV in degrees
//   __studioToggleViewProjection  — toggle persp / ortho marker (real
//                                   ortho cam swap lands when the
//                                   renderer plumbs both projections)

function vp() {
  return window.__archdiscViewport || null;
}

// Slice 527 — Camera bookmarks persist to localStorage so they survive
// reloads. Rehydrate on first access if window slot is empty.
const BOOKMARK_KEY = 'studio.v3.cameraBookmarks';
function loadBookmarksFromDisk() {
  try {
    const raw = window.localStorage.getItem(BOOKMARK_KEY);
    if (!raw) return {};
    const obj = JSON.parse(raw);
    return obj && typeof obj === 'object' ? obj : {};
  } catch (_) { return {}; }
}
function persistBookmarks() {
  try { window.localStorage.setItem(BOOKMARK_KEY, JSON.stringify(window.__studioCameraBookmarks || {})); } catch (_) {}
}
function ensureBookmarks() {
  if (!window.__studioCameraBookmarks) window.__studioCameraBookmarks = loadBookmarksFromDisk();
  return window.__studioCameraBookmarks;
}

function bookmarkCamera(name) {
  const v = vp();
  if (!v || !v.camera) return { ok: false, error: 'no viewport' };
  const ctrl = v.orbitControls || v.controls;
  ensureBookmarks();
  const rec = {
    position: [v.camera.position.x, v.camera.position.y, v.camera.position.z],
    target: ctrl && ctrl.target ? [ctrl.target.x, ctrl.target.y, ctrl.target.z] : [0, 0, 0],
    ts: Date.now(),
  };
  window.__studioCameraBookmarks[name] = rec;
  persistBookmarks();
  return { ok: true, name, ...rec };
}

function restoreCameraBookmark(name) {
  const v = vp();
  if (!v || !v.camera) return { ok: false, error: 'no viewport' };
  ensureBookmarks();
  const rec = window.__studioCameraBookmarks[name];
  if (!rec) return { ok: false, error: `no bookmark named ${name}` };
  v.camera.position.set(rec.position[0], rec.position[1], rec.position[2]);
  const ctrl = v.orbitControls || v.controls;
  if (ctrl && ctrl.target) {
    ctrl.target.set(rec.target[0], rec.target[1], rec.target[2]);
    if (typeof ctrl.update === 'function') ctrl.update();
  }
  return { ok: true, name, ...rec };
}

function deleteCameraBookmark(name) {
  ensureBookmarks();
  if (!(name in window.__studioCameraBookmarks)) return { ok: false, error: 'no such bookmark' };
  delete window.__studioCameraBookmarks[name];
  persistBookmarks();
  return { ok: true, name };
}

function listCameraBookmarks() {
  ensureBookmarks();
  return Object.keys(window.__studioCameraBookmarks).slice();
}

function toggleTurntable(rate = 0.5) {
  const v = vp();
  if (!v || !v.orbitControls) return { ok: false, error: 'no controls' };
  const ctrl = v.orbitControls;
  const on = !ctrl.autoRotate;
  ctrl.autoRotate = on;
  ctrl.autoRotateSpeed = on ? rate * 2 : 0;
  window.__studioTurntableOn = on;
  return { ok: true, on, rate };
}

function setFov(degrees) {
  const v = vp();
  if (!v || !v.camera) return { ok: false, error: 'no viewport' };
  const fov = Number(degrees);
  if (!Number.isFinite(fov) || fov <= 1 || fov >= 175) return { ok: false, error: 'fov out of range (1..175)' };
  if (typeof v.camera.fov === 'undefined') return { ok: false, error: 'not a perspective camera' };
  v.camera.fov = fov;
  v.camera.updateProjectionMatrix();
  return { ok: true, fov };
}

function toggleViewProjection() {
  const next = window.__studioViewProjection === 'ortho' ? 'persp' : 'ortho';
  window.__studioViewProjection = next;
  window.dispatchEvent(new CustomEvent('studio-view-projection-changed', { detail: { projection: next } }));
  return { ok: true, projection: next };
}

export function registerCameraViewOps() {
  window.__studioBookmarkCamera        = bookmarkCamera;
  window.__studioRestoreCameraBookmark = restoreCameraBookmark;
  window.__studioListCameraBookmarks   = listCameraBookmarks;
  window.__studioDeleteCameraBookmark  = deleteCameraBookmark;
  window.__studioToggleTurntable       = toggleTurntable;
  window.__studioSetFov                = setFov;
  window.__studioToggleViewProjection  = toggleViewProjection;
}

export function unregisterCameraViewOps() {
  for (const k of [
    '__studioBookmarkCamera', '__studioRestoreCameraBookmark',
    '__studioListCameraBookmarks', '__studioDeleteCameraBookmark', '__studioToggleTurntable',
    '__studioSetFov', '__studioToggleViewProjection',
  ]) { try { delete window[k]; } catch (_) {} }
}
