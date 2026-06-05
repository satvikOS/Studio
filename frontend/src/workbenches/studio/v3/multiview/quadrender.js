// ArchDisc Studio V3 — Quad-view scissored renderer.
//
// Renders the live three.js scene into the existing renderer canvas as
// 2×2 panes per frame using viewport scissoring. No second canvas, no
// extra render targets, no new buffers — just four `renderer.render()`
// calls per frame, each scoped to a sub-rectangle of the existing
// drawing buffer. Pure three.js, no new npm packages, no WASM.
//
// Pane layout — splitters at horizontalRatio (vertical splitter, 0..1)
// and verticalRatio (horizontal splitter, 0..1). Defaults to 0.5/0.5:
//
//   0:TL persp                |   1:TR top ortho
//   --------------------------+----------------------------
//   2:BL front ortho          |   3:BR right ortho
//
// Pane index → semantic key  ['persp', 'top', 'front', 'right'].
//
// Each pane owns its own camera (`_panes[i].camera`). The persp pane
// borrows the live viewport camera (so OrbitControls keeps driving it).
// The three orthos are framed around the scene's bounding box every
// frame, so adding/removing primitives self-frames without user action.
//
// Maximizing a pane (idx ∈ 0..3) makes its scissor span the whole
// drawing buffer — a single full-viewport render. Setting
// maximizedIdx = -1 returns to the 4-pane layout.

import * as THREE from 'three';

// ─── Pane key constants ─────────────────────────────────────────────
export const PANE_KEYS = ['persp', 'top', 'front', 'right'];

// ─── Per-pane camera factory ────────────────────────────────────────
//
// Cameras for the three ortho panes are sized by an outer call each
// frame (see `_frameOrthos`). The persp camera is whatever the live
// viewport hands us. Returns an array of length 4.
function _buildCameras(perspCam) {
  // Each entry is the camera used to render pane index `i`. The persp
  // entry is just a reference to the live viewport camera, so when
  // OrbitControls drives the user-camera the persp pane follows.
  const panes = [
    perspCam || new THREE.PerspectiveCamera(45, 1, 0.0001, 1000),
    new THREE.OrthographicCamera(-1, 1, 1, -1, 0.0001, 1000),  // top
    new THREE.OrthographicCamera(-1, 1, 1, -1, 0.0001, 1000),  // front
    new THREE.OrthographicCamera(-1, 1, 1, -1, 0.0001, 1000),  // right
  ];

  // Top — look straight down -Y, with -Z as the "up" so +X is right
  // and +Z is down on screen (matches Blender numpad 7).
  panes[1].up.set(0, 0, -1);
  // Front — look down -Z, +Y is up (Blender numpad 1).
  panes[2].up.set(0, 1, 0);
  // Right — look down -X, +Y is up (Blender numpad 3).
  panes[3].up.set(0, 1, 0);

  return panes;
}

// ─── Scene bounds → ortho extents ───────────────────────────────────
//
// Pull a Box3 over every Studio primitive (matches cameraops.js so the
// quad-view frames the same content as `frame all`). Falls back to a
// tiny default cube if the scene is empty so the ortho cams still
// produce a valid projection matrix.
function _sceneBoundsAndCentre(scene) {
  if (!scene) return null;
  const box = new THREE.Box3();
  let any = false;
  scene.traverse((o) => {
    if (!o || !o.isMesh) return;
    if (!o.userData || !o.userData.archdiscStudioPrimitive) return;
    o.updateMatrixWorld(true);
    const b = new THREE.Box3().setFromObject(o);
    if (!isFinite(b.min.x) || !isFinite(b.max.x)) return;
    box.union(b);
    any = true;
  });
  if (!any) {
    box.set(
      new THREE.Vector3(-0.05, -0.05, -0.05),
      new THREE.Vector3(0.05, 0.05, 0.05),
    );
  }
  const centre = new THREE.Vector3(); box.getCenter(centre);
  const size = new THREE.Vector3(); box.getSize(size);
  const radius = Math.max(size.length() * 0.5, 0.02);
  return { box, centre, size, radius };
}

// Reframe the three ortho cameras around the current scene bounds.
//
// `aspect` is the W/H of the pane (not the whole canvas) so the ortho
// frustum doesn't get squashed when the user drags the splitter.
function _frameOrthos(panes, scene, paneAspects) {
  const bnd = _sceneBoundsAndCentre(scene);
  if (!bnd) return;
  const { centre, radius } = bnd;
  const halfH = radius * 1.2; // 20 % margin so geometry doesn't kiss edges
  const farDist = radius * 6 + 1;

  // ─── Pane 1 — top (look down -Y) ────────────────────────────────
  {
    const cam = panes[1];
    const aspect = paneAspects[1] || 1;
    const hw = halfH * aspect;
    cam.left = -hw; cam.right = hw;
    cam.top = halfH; cam.bottom = -halfH;
    cam.near = 0.0001; cam.far = farDist * 2;
    cam.position.set(centre.x, centre.y + farDist, centre.z);
    cam.lookAt(centre);
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld(true);
  }
  // ─── Pane 2 — front (look down -Z) ───────────────────────────────
  {
    const cam = panes[2];
    const aspect = paneAspects[2] || 1;
    const hw = halfH * aspect;
    cam.left = -hw; cam.right = hw;
    cam.top = halfH; cam.bottom = -halfH;
    cam.near = 0.0001; cam.far = farDist * 2;
    cam.position.set(centre.x, centre.y, centre.z + farDist);
    cam.lookAt(centre);
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld(true);
  }
  // ─── Pane 3 — right (look down -X) ───────────────────────────────
  {
    const cam = panes[3];
    const aspect = paneAspects[3] || 1;
    const hw = halfH * aspect;
    cam.left = -hw; cam.right = hw;
    cam.top = halfH; cam.bottom = -halfH;
    cam.near = 0.0001; cam.far = farDist * 2;
    cam.position.set(centre.x + farDist, centre.y, centre.z);
    cam.lookAt(centre);
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld(true);
  }
}

// ─── Pane rectangle layout ──────────────────────────────────────────
//
// Returns four CSS-space rectangles (origin top-left, pixels) inside
// a `width × height` canvas. With `maximizedIdx >= 0`, three of the
// four collapse to zero size and the chosen pane spans everything.
//
//   rect = { x, y, w, h }   // top-left origin, w*h pixels
export function computeRects(width, height, horizontalRatio, verticalRatio, maximizedIdx) {
  const hR = Math.max(0.05, Math.min(0.95, Number(horizontalRatio) || 0.5));
  const vR = Math.max(0.05, Math.min(0.95, Number(verticalRatio) || 0.5));
  const xMid = Math.round(width * hR);
  const yMid = Math.round(height * vR);
  const rects = [
    // 0 — top-left  (persp)
    { x: 0,    y: 0,    w: xMid,         h: yMid },
    // 1 — top-right (top ortho)
    { x: xMid, y: 0,    w: width - xMid, h: yMid },
    // 2 — bottom-left (front ortho)
    { x: 0,    y: yMid, w: xMid,         h: height - yMid },
    // 3 — bottom-right (right ortho)
    { x: xMid, y: yMid, w: width - xMid, h: height - yMid },
  ];
  if (maximizedIdx >= 0 && maximizedIdx < 4) {
    for (let i = 0; i < 4; i += 1) {
      if (i === maximizedIdx) rects[i] = { x: 0, y: 0, w: width, h: height };
      else rects[i] = { x: 0, y: 0, w: 0, h: 0 };
    }
  }
  return rects;
}

// ─── State holder ────────────────────────────────────────────────────
//
// `createQuadState` owns the per-instance cameras. Multiple installers
// would conflict on `__studioComposer`, so the installer keeps a single
// state and reuses it across toggles.
export function createQuadState(perspCam) {
  return {
    panes: _buildCameras(perspCam),
    horizontalRatio: 0.5,
    verticalRatio: 0.5,
    maximizedIdx: -1,
    // Last-seen drawing-buffer size — recomputed every frame so a
    // window resize during the next animation tick reframes the
    // orthos correctly without an explicit resize hook.
    lastSize: { w: 0, h: 0 },
  };
}

// Update the persp pane to track the live viewport camera. Called from
// the installer whenever the user-camera reference changes (e.g. on
// first reception from window.__archdiscViewport).
export function setPerspCamera(state, perspCam) {
  if (!state) return;
  if (perspCam) state.panes[0] = perspCam;
}

// ─── Renderer driver ─────────────────────────────────────────────────
//
// `renderQuad(canvas, state, renderer, scene)` does the four scissored
// `renderer.render()` calls. Restores the prior viewport / scissor /
// scissorTest state on exit so any other code that draws into the
// renderer this frame (post-effects, dom-overlays-via-render, etc.)
// gets the same canvas it expected.
export function renderQuad(canvas, state, renderer, scene) {
  if (!renderer || !scene || !state) return false;
  const c = canvas || (renderer.domElement || null);
  if (!c) return false;

  // Drawing buffer is in *device* pixels — multiply by pixelRatio.
  const pr = renderer.getPixelRatio ? renderer.getPixelRatio() : 1;
  const fullW = Math.max(2, Math.floor(c.width));
  const fullH = Math.max(2, Math.floor(c.height));

  // CSS-space rect sizes used by the React overlay, then scaled into
  // device pixels for setScissor / setViewport. Three.js scissor is
  // GL-bottom-up: y is measured from the BOTTOM of the framebuffer.
  const cssW = c.clientWidth || Math.floor(fullW / pr);
  const cssH = c.clientHeight || Math.floor(fullH / pr);
  state.lastSize = { w: cssW, h: cssH };

  const rects = computeRects(
    cssW, cssH,
    state.horizontalRatio, state.verticalRatio,
    state.maximizedIdx,
  );

  // ─── Frame the orthos so they fit current bounds in current aspect ─
  const aspects = rects.map((r) => (r.h > 0 ? r.w / r.h : 1));
  _frameOrthos(state.panes, scene, aspects);

  // ─── Stash prior renderer state so we restore it on exit. ──────────
  // three.js doesn't expose getters for setScissor/setViewport vectors,
  // so we reset to "full canvas" rather than "previous rect" — which is
  // the next-frame contract anyway.
  const prevScissorTest = renderer.getScissorTest ? renderer.getScissorTest() : false;
  renderer.setScissorTest(true);

  for (let i = 0; i < 4; i += 1) {
    const r = rects[i];
    if (r.w < 2 || r.h < 2) continue;
    // CSS-y from top → GL-y from bottom.
    const glX = Math.floor(r.x * pr);
    const glYTop = Math.floor(r.y * pr);
    const glW = Math.floor(r.w * pr);
    const glH = Math.floor(r.h * pr);
    const glY = fullH - glYTop - glH;

    renderer.setScissor(glX, glY, glW, glH);
    renderer.setViewport(glX, glY, glW, glH);

    const cam = state.panes[i];
    if (!cam) continue;

    // PerspectiveCamera needs aspect kept in sync with its viewport.
    if (cam.isPerspectiveCamera) {
      const newAspect = glW / Math.max(1, glH);
      if (Math.abs(cam.aspect - newAspect) > 0.001) {
        cam.aspect = newAspect;
        cam.updateProjectionMatrix();
      }
    }
    renderer.render(scene, cam);
  }

  // ─── Restore so the main loop's renderer.render() (if it still runs
  //     for any reason) renders the whole canvas, not a stale pane. ───
  renderer.setScissorTest(prevScissorTest);
  renderer.setViewport(0, 0, fullW, fullH);
  renderer.setScissor(0, 0, fullW, fullH);
  return true;
}

// Convenience: pane index ↔ key.
export function indexToKey(i) { return PANE_KEYS[i] || null; }
export function keyToIndex(k) {
  const i = PANE_KEYS.indexOf(String(k));
  return i >= 0 ? i : -1;
}
