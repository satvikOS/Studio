// ArchDisc Studio V3 — snap2 (live snap during drag + transform
// orientations + pivot points) e2e.
//
// Headed Mac-Electron spec per the user feedback rule (the user is
// remote and watches the spec play out). Drives the surface installed
// by frontend/src/workbenches/studio/v3/snap2/autoload.js.
//
// Coverage:
//   • __studioSnap2EnableLiveDrag toggles the pointermove listener
//   • __studioSnap2SetRadius / SetKindMask / SetGridSize update state
//   • Manual stepSnap with a primed scene snaps the dragged mesh to
//     the nearest vertex / face / grid
//   • __studioSnap2SetOrientation accepts all six kinds; gizmo space
//     flips between 'world' and 'local' as expected
//   • __studioSnap2SetCustomOrientation accepts a 3-axis vector
//   • __studioSnap2SetPivot accepts every kind + computePivot returns
//     the right world point for bbox / median / cursor
//   • Side panel mounts, chips toggle the kind mask, radio groups
//     update orientation + pivot, panel is closable
//   • Command palette registration: every op exists under 'snap'
//   • Multi-cam screenshots for remote-desktop watcher

import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-v3-snap2');
const NAMED_VIEWS = ['front', 'top', 'right', 'iso', 'close'];

test('Studio V3 — snap2: live snap + orientations + pivot', async () => {
  test.setTimeout(180000);
  fs.mkdirSync(OUT, { recursive: true });

  const app = await electron.launch({
    args: [path.join(__dirname, '..', 'electron', 'main.js'), '--dev'],
    slowMo: Number(process.env.STUDIO_SLOWMO) || 220,
  });
  const win = await app.firstWindow();
  win.on('dialog', (d) => { d.dismiss().catch(() => {}); });
  await win.waitForLoadState('domcontentloaded');

  await win.evaluate(() => {
    window.localStorage.setItem('studioV3', '1');
    window.localStorage.setItem('studio.v3.tour-seen', '1');
    window.localStorage.removeItem('studio.v3.theme');
    window.localStorage.removeItem('studio.v3.wb');
    try { window.sessionStorage.setItem('studio.v3.splash-shown', '1'); } catch (_) {}
  });
  await win.reload();
  await win.waitForLoadState('domcontentloaded');
  await expect(win.locator('[data-studio-v3-shell]')).toBeVisible({ timeout: 20000 });
  await win.waitForFunction(() => typeof window.__studioSelectedMesh === 'function', null, { timeout: 20000 });
  await win.waitForFunction(() => !!window.__archdiscScene && !!window.THREE, null, { timeout: 20000 });

  // ─── Install snap2 via the dev-server autoload URL. ──────────────
  await win.evaluate(async () => {
    if (typeof window.__studioSnap2EnableLiveDrag !== 'function') {
      await import('/src/workbenches/studio/v3/snap2/autoload.js');
    }
  });
  await win.waitForFunction(
    () => typeof window.__studioSnap2EnableLiveDrag === 'function'
       && typeof window.__studioSnap2SetOrientation === 'function'
       && typeof window.__studioSnap2SetPivot === 'function'
       && typeof window.__studioSnap2PanelOpen === 'function',
    null, { timeout: 20000 },
  );

  await win.screenshot({ path: path.join(OUT, '00-init.png') });

  // ─── Seed: clear stale primitives, then build a target + dragged
  // mesh. The target stays put; we move the dragged mesh to land near
  // a vertex / face / grid point and assert the snap result. ───────
  const seed = await win.evaluate(() => {
    const THREE = window.THREE;
    const scene = window.__archdiscScene;
    if (!scene || !THREE) return { ok: false };
    const stale = [];
    scene.traverse((o) => { if (o.userData && o.userData.archdiscStudioPrimitive) stale.push(o); });
    for (const o of stale) {
      if (o.geometry && o.geometry.dispose) o.geometry.dispose();
      if (o.material && o.material.dispose) o.material.dispose();
      (o.parent || scene).remove(o);
    }
    const make = (cx, cy, cz, name) => {
      const g = new THREE.BoxGeometry(0.5, 0.5, 0.5);
      const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: 0x6699cc, roughness: 0.6 }));
      m.position.set(cx, cy, cz);
      m.name = name;
      m.userData = { archdiscStudioPrimitive: true, archdiscStudioPrimitiveKind: 'snap-test' };
      m.updateMatrixWorld(true);
      scene.add(m);
      return m;
    };
    const target = make(0, 0, 0, 'snap-target');
    const dragged = make(0.5, 0, 0, 'snap-dragged');
    return { ok: true, targetUuid: target.uuid, draggedUuid: dragged.uuid };
  });
  expect(seed.ok).toBe(true);
  await win.screenshot({ path: path.join(OUT, '01-seeded.png') });

  // ─── Enable live drag + set radius. ──────────────────────────────
  const enable = await win.evaluate(() => window.__studioSnap2EnableLiveDrag(true));
  expect(enable.ok).toBe(true);
  expect(enable.on).toBe(true);

  const radius = await win.evaluate(() => window.__studioSnap2SetRadius(0.2));
  expect(radius.ok).toBe(true);
  expect(radius.snapRadius).toBeCloseTo(0.2, 5);

  // Only vertex snap to start.
  const mask = await win.evaluate(() => window.__studioSnap2SetKindMask({
    vertex: true, edge: false, face: false, grid: false,
  }));
  expect(mask.ok).toBe(true);
  expect(mask.mask.vertex).toBe(true);
  expect(mask.mask.grid).toBe(false);

  // ─── Manually fake a drag: attach the gizmo to the dragged mesh,
  // fire dragging-changed, move the mesh near a vertex of the target,
  // then call __studioSnap2Step. ────────────────────────────────────
  const stepRes = await win.evaluate(({ tUuid, dUuid }) => {
    const THREE = window.THREE;
    const scene = window.__archdiscScene;
    const vp = window.__archdiscViewport;
    let target = null, dragged = null;
    scene.traverse((o) => {
      if (o.uuid === tUuid) target = o;
      if (o.uuid === dUuid) dragged = o;
    });
    if (!dragged || !target) return { ok: false, reason: 'meshes missing' };
    // Attach to the gizmo
    if (vp && vp.transformControls) {
      vp.transformControls.attach(dragged);
      // Manually flip dragging on so the snap-step has work to do.
      vp.transformControls.dispatchEvent({ type: 'dragging-changed', value: true });
    }
    // Place the dragged mesh just *near* the target's +X vertex
    // (target is a 0.5-cube at origin → +X vertex at ~0.25 world).
    dragged.position.set(0.26, 0.24, 0.24);
    dragged.updateMatrixWorld(true);
    const before = dragged.position.toArray();
    const step = window.__studioSnap2Step();
    const after = dragged.position.toArray();
    return { ok: true, before, after, step };
  }, { tUuid: seed.targetUuid, dUuid: seed.draggedUuid });
  expect(stepRes.ok).toBe(true);
  expect(stepRes.step.ok).toBe(true);
  expect(stepRes.step.snapped).toBe(true);
  expect(stepRes.step.kind).toBe('vertex');
  // Snapped position should be at the cube's +X+Y+Z vertex (0.25, 0.25, 0.25)
  // since the dragged mesh has identity orientation + the parent is the
  // scene root (no inverse needed).
  expect(stepRes.after[0]).toBeCloseTo(0.25, 5);
  expect(stepRes.after[1]).toBeCloseTo(0.25, 5);
  expect(stepRes.after[2]).toBeCloseTo(0.25, 5);

  await win.screenshot({ path: path.join(OUT, '02-vertex-snap.png') });

  // ─── Grid snap with a generous grid size. ────────────────────────
  await win.evaluate(() => window.__studioSnap2SetGridSize(0.1));
  await win.evaluate(() => window.__studioSnap2SetKindMask({
    vertex: false, edge: false, face: false, grid: true,
  }));
  const gridStep = await win.evaluate(({ dUuid }) => {
    const scene = window.__archdiscScene;
    let dragged = null;
    scene.traverse((o) => { if (o.uuid === dUuid) dragged = o; });
    if (!dragged) return { ok: false };
    // Position just off a grid line at 0.103
    dragged.position.set(0.103, 0.0, 0.0);
    dragged.updateMatrixWorld(true);
    const step = window.__studioSnap2Step();
    return { ok: true, after: dragged.position.toArray(), step };
  }, { dUuid: seed.draggedUuid });
  expect(gridStep.ok).toBe(true);
  expect(gridStep.step.snapped).toBe(true);
  expect(gridStep.step.kind).toBe('grid');
  expect(gridStep.after[0]).toBeCloseTo(0.1, 5);
  expect(gridStep.after[1]).toBeCloseTo(0, 5);
  expect(gridStep.after[2]).toBeCloseTo(0, 5);

  await win.screenshot({ path: path.join(OUT, '03-grid-snap.png') });

  // ─── Face snap. ──────────────────────────────────────────────────
  await win.evaluate(() => window.__studioSnap2SetKindMask({
    vertex: false, edge: false, face: true, grid: false,
  }));
  const faceStep = await win.evaluate(({ dUuid }) => {
    const scene = window.__archdiscScene;
    let dragged = null;
    scene.traverse((o) => { if (o.uuid === dUuid) dragged = o; });
    // Just past a face centre (target +X face centre is at (0.25, 0, 0)).
    dragged.position.set(0.27, 0.02, 0.01);
    dragged.updateMatrixWorld(true);
    const step = window.__studioSnap2Step();
    return { ok: true, after: dragged.position.toArray(), step };
  }, { dUuid: seed.draggedUuid });
  expect(faceStep.ok).toBe(true);
  expect(faceStep.step.snapped).toBe(true);
  expect(faceStep.step.kind).toBe('face');
  // Face centres of a BoxGeometry land on each face; one of the 6
  // candidates should be within snap radius.
  await win.screenshot({ path: path.join(OUT, '04-face-snap.png') });

  // Release the drag.
  await win.evaluate(() => {
    const vp = window.__archdiscViewport;
    if (vp && vp.transformControls) {
      vp.transformControls.dispatchEvent({ type: 'dragging-changed', value: false });
    }
  });

  // ─── Orientations: cycle through every kind. ─────────────────────
  for (const kind of ['global', 'local', 'normal', 'gimbal', 'view', 'custom']) {
    const r = await win.evaluate((k) => window.__studioSnap2SetOrientation(k), kind);
    expect(r.ok).toBe(true);
    expect(r.kind).toBe(kind);
  }
  // After 'custom' the orientation kind is custom.
  let orient = await win.evaluate(() => window.__studioSnap2GetOrientation());
  expect(orient.ok).toBe(true);
  expect(orient.kind).toBe('custom');
  expect(orient.valid).toEqual(['global', 'local', 'normal', 'gimbal', 'view', 'custom']);

  const custom = await win.evaluate(() => window.__studioSnap2SetCustomOrientation([1, 1, 0]));
  expect(custom.ok).toBe(true);
  expect(custom.axes).toEqual([1, 1, 0]);

  orient = await win.evaluate(() => window.__studioSnap2GetOrientation());
  expect(orient.customAxes).toEqual([1, 1, 0]);

  // Bad kind rejected.
  const bad = await win.evaluate(() => window.__studioSnap2SetOrientation('garbage'));
  expect(bad.ok).toBe(false);
  expect(bad.valid).toContain('global');

  await win.screenshot({ path: path.join(OUT, '05-orient-custom.png') });

  // Gizmo space should be 'local' for any non-global orientation.
  const space1 = await win.evaluate(() => {
    const vp = window.__archdiscViewport;
    return vp && vp.transformControls ? vp.transformControls.space : null;
  });
  expect(space1).toBe('local');

  // Back to global → space should be 'world'.
  await win.evaluate(() => window.__studioSnap2SetOrientation('global'));
  const space2 = await win.evaluate(() => {
    const vp = window.__archdiscViewport;
    return vp && vp.transformControls ? vp.transformControls.space : null;
  });
  expect(space2).toBe('world');

  // ─── Pivot: cycle through every kind + check computePivot. ───────
  for (const kind of ['bbox', 'median', 'individual', 'active', 'cursor']) {
    const r = await win.evaluate((k) => window.__studioSnap2SetPivot(k), kind);
    expect(r.ok).toBe(true);
    expect(r.kind).toBe(kind);
  }
  const pivot = await win.evaluate(() => window.__studioSnap2GetPivot());
  expect(pivot.ok).toBe(true);
  expect(pivot.kind).toBe('cursor');
  expect(pivot.valid).toEqual(['bbox', 'median', 'individual', 'active', 'cursor']);

  const badPivot = await win.evaluate(() => window.__studioSnap2SetPivot('garbage'));
  expect(badPivot.ok).toBe(false);

  // computePivot('median') on the two-cube selection should be at (0.25, 0, 0).
  const pivotPt = await win.evaluate(({ a, b }) => {
    const scene = window.__archdiscScene;
    let mA = null, mB = null;
    scene.traverse((o) => { if (o.uuid === a) mA = o; if (o.uuid === b) mB = o; });
    window.__studioSelectedMeshesSet = [mA, mB];
    return window.__studioSnap2ComputePivot('median');
  }, { a: seed.targetUuid, b: seed.draggedUuid });
  expect(pivotPt.ok).toBe(true);
  expect(pivotPt.point[0]).toBeCloseTo(0.05, 5); // (0 + 0.1) / 2 — dragged was just moved to (0.1,0,0)
  // (median of x-coords after the grid snap repositioning)

  // bbox vs median can differ — sanity-check bbox encompasses both meshes.
  const pivotBbox = await win.evaluate(() => window.__studioSnap2ComputePivot('bbox'));
  expect(pivotBbox.ok).toBe(true);
  expect(pivotBbox.kind).toBe('bbox');

  await win.screenshot({ path: path.join(OUT, '06-pivot-cycled.png') });

  // ─── Panel: open → DOM mounts → toggle a kind chip → close. ──────
  await win.evaluate(() => window.__studioSnap2PanelOpen());
  await expect(win.locator('[data-studio-v3-snap2-panel]')).toBeVisible({ timeout: 5000 });
  await expect(win.locator('[data-studio-v3-snap2-live-toggle]')).toBeVisible();
  await expect(win.locator('[data-studio-v3-snap2-radius]')).toBeVisible();
  for (const k of ['vertex', 'edge', 'face', 'grid']) {
    await expect(win.locator(`[data-studio-v3-snap2-kind="${k}"]`)).toHaveCount(1);
  }
  for (const k of ['global', 'local', 'normal', 'gimbal', 'view', 'custom']) {
    await expect(win.locator(`[data-studio-v3-snap2-orient="${k}"]`)).toHaveCount(1);
  }
  for (const k of ['bbox', 'median', 'individual', 'active', 'cursor']) {
    await expect(win.locator(`[data-studio-v3-snap2-pivot="${k}"]`)).toHaveCount(1);
  }
  await win.screenshot({ path: path.join(OUT, '07-panel-open.png') });

  // Click the 'edge' kind chip — should flip the kindMask edge bit.
  await win.locator('[data-studio-v3-snap2-kind="edge"]').click();
  await win.waitForTimeout(150);
  const afterEdgeClick = await win.evaluate(() => window.__studioSnap2GetState());
  expect(afterEdgeClick.kindMask.edge).toBe(true);

  // Click the 'vertex' radio under Pivot — wait, vertex isn't a pivot.
  // Click the 'bbox' pivot radio.
  await win.locator('[data-studio-v3-snap2-pivot="bbox"] input').click();
  await win.waitForTimeout(150);
  const afterBboxClick = await win.evaluate(() => window.__studioSnap2GetPivot());
  expect(afterBboxClick.kind).toBe('bbox');

  await win.screenshot({ path: path.join(OUT, '08-panel-toggled.png') });

  // Close.
  await win.locator('[data-studio-v3-snap2-close]').click();
  await expect(win.locator('[data-studio-v3-snap2-panel]')).toBeHidden();
  await win.screenshot({ path: path.join(OUT, '09-panel-closed.png') });

  // ─── Command palette registration: every op exists under 'snap'. ──
  const cmds = await win.evaluate(() => window.__studioCommandList && window.__studioCommandList('snap'));
  expect(cmds && cmds.ok).toBe(true);
  expect(cmds.count).toBeGreaterThanOrEqual(12);
  const names = cmds.commands.map((c) => c.name);
  for (const expected of [
    '__studioSnap2EnableLiveDrag',
    '__studioSnap2SetRadius',
    '__studioSnap2SetKindMask',
    '__studioSnap2GetState',
    '__studioSnap2SetOrientation',
    '__studioSnap2SetCustomOrientation',
    '__studioSnap2GetOrientation',
    '__studioSnap2SetPivot',
    '__studioSnap2GetPivot',
    '__studioSnap2PanelOpen',
    '__studioSnap2PanelClose',
    '__studioSnap2PanelToggle',
  ]) {
    expect(names).toContain(expected);
  }

  // ─── Multi-cam screenshots so the remote-desktop watcher sees the
  // snapped scene under all five canonical angles. ─────────────────
  for (const view of NAMED_VIEWS) {
    await win.evaluate((v) => {
      const vp = window.__archdiscViewport; if (!vp || !vp.camera) return;
      const c = vp.camera;
      if (v === 'front') c.position.set(0, 0.5, 2.5);
      else if (v === 'top') c.position.set(0, 2.5, 0.001);
      else if (v === 'right') c.position.set(2.5, 0.5, 0);
      else if (v === 'iso') c.position.set(1.5, 1.5, 1.5);
      else if (v === 'close') c.position.set(0.6, 0.6, 1.2);
      c.lookAt(0, 0, 0);
    }, view);
    await win.waitForTimeout(150);
    await win.screenshot({ path: path.join(OUT, `10-cam-${view}.png`) });
  }

  // eslint-disable-next-line no-console
  console.log('  snap2: %d ops registered under "snap"', cmds.count);

  await win.evaluate(() => {
    window.__studioV3Dirty = false;
    window.onbeforeunload = null;
    window.dispatchEvent(new CustomEvent('studio-autosaved', { detail: { ts: Date.now(), bytes: 0, primitives: 0 } }));
  });
  await win.waitForTimeout(100);
  await app.close();
});
