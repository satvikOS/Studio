// Studio V3 — IK gizmo handles in the viewport.
//
// Stands up the slice-682 arm rig (cylinder → 5-bone armature → bound
// SkinnedMesh), then exercises every rigui surface:
//
//   • __studioRigUIShowHandles      → drops sphere handles tagged
//     archdiscStudioIKHandle + archdiscStudioGizmo; counts one per
//     end-effector bone (Tip only in this rig).
//   • __studioRigUIListHandles      → reports the same set with positions.
//   • __studioRigUIDragHandle       → programmatic drag; CCD IK runs;
//     shoulder + elbow rotations change; handle world position lands at
//     the target; bone effector follows.
//   • Synthetic pointer drag        → real pointerdown / pointermove /
//     pointerup on the canvas hits the dragger, picks the handle,
//     re-runs IK. orbitControls.enabled flips false during drag, true
//     after pointerup.
//   • __studioRigUISetChainLength   → mutates a handle's chain length.
//   • __studioRigUIRefreshHandles   → re-syncs every handle to its
//     bone's fresh world position.
//   • __studioRigUIHideHandles      → removes them.
//
// Five-camera screenshots per the Forge multi-cam memory.

import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-v3-rigui');

test('Studio V3 — IK gizmo handles: show, drag (programmatic + pointer), hide', async () => {
  test.setTimeout(180000);
  fs.mkdirSync(OUT, { recursive: true });

  const app = await electron.launch({
    args: [path.join(__dirname, '..', 'electron', 'main.js')],
    slowMo: Number(process.env.STUDIO_SLOWMO) || 250,
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
  await expect(win.locator('[data-studio-v3-shell]')).toBeVisible({ timeout: 15000 });

  // Rig + rigui both have to be live before we touch any handles.
  await win.waitForFunction(() => typeof window.__studioRigCreateArmature === 'function', null, { timeout: 15000 });
  await win.evaluate(async () => {
    if (typeof window.__studioRigUIShowHandles !== 'function') {
      await import('/src/workbenches/studio/v3/rigui/autoload.js');
    }
  });
  await win.waitForFunction(
    () => typeof window.__studioRigUIShowHandles === 'function'
      && typeof window.__studioRigUIDragHandle === 'function'
      && typeof window.__studioRigUIListHandles === 'function'
      && typeof window.__studioRigUIHideHandles === 'function'
      && typeof window.__studioRigUISetChainLength === 'function'
      && typeof window.__studioRigUIRefreshHandles === 'function',
    null, { timeout: 15000 },
  );

  // ─── Step 1: spawn the arm cylinder ─────────────────────────────────
  await win.locator('[data-studio-v3-tool="cylinder"][data-studio-v3-tool-group="add"]').click();
  await win.waitForTimeout(200);
  const cylinderUuid = await win.evaluate(() => {
    let cyl = null;
    window.__archdiscScene.traverse((o) => {
      if (o.userData && o.userData.archdiscStudioPrimitiveKind === 'cylinder' && !cyl) cyl = o;
    });
    cyl.scale.set(0.5, 100, 0.5);  // primitives are 0.03 m → ~3 m tall
    cyl.position.set(0, 1.5, 0);
    cyl.updateMatrixWorld(true);
    return cyl.uuid;
  });
  expect(typeof cylinderUuid).toBe('string');

  // ─── Step 2: armature + bone chain (Root → Shoulder → Elbow → Hand → Tip)
  const arm = await win.evaluate(() => window.__studioRigCreateArmature({ name: 'ArmRig', position: [0, 0, 0] }));
  expect(arm.ok).toBe(true);
  const shoulder = await win.evaluate((u) => window.__studioRigAddBone(u, null, [0, 0, 0], 'Shoulder'), arm.uuid);
  const elbow = await win.evaluate(([u, p]) => window.__studioRigAddBone(u, p, [0, 1.0, 0], 'Elbow'), [arm.uuid, shoulder.uuid]);
  const hand = await win.evaluate(([u, p]) => window.__studioRigAddBone(u, p, [0, 1.0, 0], 'Hand'), [arm.uuid, elbow.uuid]);
  const tip = await win.evaluate(([u, p]) => window.__studioRigAddBone(u, p, [0, 1.0, 0], 'Tip'), [arm.uuid, hand.uuid]);
  expect(tip.ok).toBe(true);

  const bound = await win.evaluate(
    ([m, a]) => window.__studioRigBindMesh(m, a, { maxBones: 4 }),
    [cylinderUuid, arm.uuid],
  );
  expect(bound.ok).toBe(true);
  await win.evaluate((u) => window.__studioRigShowSkeleton(u), arm.uuid);
  await win.screenshot({ path: path.join(OUT, '00-rig.png') });

  // ─── Step 3: drop handles (end-effector default → Tip only) ──────────
  const show = await win.evaluate((u) => window.__studioRigUIShowHandles(u, { chainLength: 3 }), arm.uuid);
  expect(show.ok).toBe(true);
  expect(show.count).toBe(1);          // only Tip is a leaf
  expect(show.handles[0].boneUuid).toBe(tip.uuid);
  const handleUuid = show.handles[0].uuid;

  // Sanity: handle mesh is tagged as a gizmo so scrubbers skip it.
  const tagsOk = await win.evaluate((u) => {
    let h = null;
    window.__archdiscScene.traverse((o) => { if (o.uuid === u) h = o; });
    if (!h) return null;
    return {
      hasHandleTag: !!(h.userData && h.userData.archdiscStudioIKHandle),
      hasGizmoTag: !!(h.userData && h.userData.archdiscStudioGizmo),
      boneUuid: h.userData.archdiscStudioIKHandle && h.userData.archdiscStudioIKHandle.boneUuid,
      chainLength: h.userData.archdiscStudioIKHandle && h.userData.archdiscStudioIKHandle.chainLength,
      pos: [h.position.x, h.position.y, h.position.z],
    };
  }, handleUuid);
  expect(tagsOk.hasHandleTag).toBe(true);
  expect(tagsOk.hasGizmoTag).toBe(true);
  expect(tagsOk.boneUuid).toBe(tip.uuid);
  expect(tagsOk.chainLength).toBe(3);

  // List should report exactly one handle.
  const list = await win.evaluate(() => window.__studioRigUIListHandles());
  expect(list.ok).toBe(true);
  expect(list.count).toBe(1);
  expect(list.handles[0].uuid).toBe(handleUuid);

  await win.screenshot({ path: path.join(OUT, '01-handles.png') });

  // ─── Step 4: programmatic drag → IK runs ─────────────────────────────
  // Snapshot bone rotations before, drag the handle to a folded target,
  // verify shoulder + elbow rotations changed.
  const shoulderBefore = await win.evaluate((u) => window.__studioRigGetBone(u).rotation, shoulder.uuid);
  const elbowBefore = await win.evaluate((u) => window.__studioRigGetBone(u).rotation, elbow.uuid);

  const drag = await win.evaluate(([u, p]) => window.__studioRigUIDragHandle(u, p), [handleUuid, [2.5, 0.8, 0]]);
  expect(drag.ok).toBe(true);
  expect(drag.ik.ok).toBe(true);
  expect(drag.ik.rotationsChanged).toBeGreaterThanOrEqual(2);
  // Handle world position landed exactly at the requested target.
  const handlePosAfterDrag = await win.evaluate((u) => {
    let h = null;
    window.__archdiscScene.traverse((o) => { if (o.uuid === u) h = o; });
    return [h.position.x, h.position.y, h.position.z];
  }, handleUuid);
  expect(Math.abs(handlePosAfterDrag[0] - 2.5)).toBeLessThan(1e-3);
  expect(Math.abs(handlePosAfterDrag[1] - 0.8)).toBeLessThan(1e-3);
  expect(Math.abs(handlePosAfterDrag[2] - 0.0)).toBeLessThan(1e-3);

  const shoulderAfter = await win.evaluate((u) => window.__studioRigGetBone(u).rotation, shoulder.uuid);
  const elbowAfter = await win.evaluate((u) => window.__studioRigGetBone(u).rotation, elbow.uuid);
  const delta =
    Math.abs(shoulderAfter[0] - shoulderBefore[0]) +
    Math.abs(shoulderAfter[1] - shoulderBefore[1]) +
    Math.abs(shoulderAfter[2] - shoulderBefore[2]) +
    Math.abs(elbowAfter[0] - elbowBefore[0]) +
    Math.abs(elbowAfter[1] - elbowBefore[1]) +
    Math.abs(elbowAfter[2] - elbowBefore[2]);
  expect(delta).toBeGreaterThan(0.05);

  await win.screenshot({ path: path.join(OUT, '02-dragged.png') });

  // ─── Step 5: synthetic pointer drag on the canvas → IK runs ──────────
  // Reset the rig so we can verify the pointer path moves things again.
  await win.evaluate((u) => window.__studioRigSetBoneRotation(u, [0, 0, 0]), shoulder.uuid);
  await win.evaluate((u) => window.__studioRigSetBoneRotation(u, [0, 0, 0]), elbow.uuid);
  await win.evaluate((u) => window.__studioRigSetBoneRotation(u, [0, 0, 0]), hand.uuid);
  await win.evaluate(() => window.__studioRigUIRefreshHandles());

  // Project the handle's world position to a screen pixel via the live
  // camera, then drive the canvas with REAL pointer events.
  const screen = await win.evaluate((u) => {
    const vp = window.__archdiscViewport;
    if (!vp) return null;
    const dom = vp.renderer.domElement;
    const r = dom.getBoundingClientRect();
    let h = null;
    window.__archdiscScene.traverse((o) => { if (o.uuid === u) h = o; });
    if (!h) return null;
    h.updateMatrixWorld(true);
    // THREE.Vector3.project(camera) → NDC ([-1,1] on each axis).
    const ndc = h.position.clone().project(vp.camera);
    const px = r.left + ((ndc.x + 1) / 2) * r.width;
    const py = r.top + ((1 - ndc.y) / 2) * r.height;
    return { px, py, rect: { x: r.left, y: r.top, w: r.width, h: r.height } };
  }, handleUuid);
  expect(screen).not.toBeNull();
  expect(screen.px).toBeGreaterThan(screen.rect.x);
  expect(screen.px).toBeLessThan(screen.rect.x + screen.rect.w);
  expect(screen.py).toBeGreaterThan(screen.rect.y);
  expect(screen.py).toBeLessThan(screen.rect.y + screen.rect.h);

  // Drive a real mouse drag — pointerdown picks the handle, pointermove
  // (a few pixels right) re-projects to the camera-perpendicular plane
  // and re-runs IK, pointerup releases.
  const shoulderBeforeSyn = await win.evaluate((u) => window.__studioRigGetBone(u).rotation, shoulder.uuid);
  await win.mouse.move(screen.px, screen.py);
  await win.mouse.down();
  // Slide the cursor far right to force a visible chain rotation.
  await win.mouse.move(screen.px + 220, screen.py + 80, { steps: 12 });
  // Verify orbit was disabled mid-drag.
  const orbitDuringDrag = await win.evaluate(() => {
    const v = window.__archdiscViewport;
    return v && v.orbitControls ? v.orbitControls.enabled : null;
  });
  expect(orbitDuringDrag).toBe(false);
  await win.mouse.up();
  await win.waitForTimeout(50);
  const orbitAfter = await win.evaluate(() => {
    const v = window.__archdiscViewport;
    return v && v.orbitControls ? v.orbitControls.enabled : null;
  });
  expect(orbitAfter).toBe(true);
  const shoulderAfterSyn = await win.evaluate((u) => window.__studioRigGetBone(u).rotation, shoulder.uuid);
  const synDelta =
    Math.abs(shoulderAfterSyn[0] - shoulderBeforeSyn[0]) +
    Math.abs(shoulderAfterSyn[1] - shoulderBeforeSyn[1]) +
    Math.abs(shoulderAfterSyn[2] - shoulderBeforeSyn[2]);
  expect(synDelta).toBeGreaterThan(0.01);

  await win.screenshot({ path: path.join(OUT, '03-pointer-drag.png') });

  // ─── Step 6: setChainLength + refreshHandles ─────────────────────────
  const cl = await win.evaluate((u) => window.__studioRigUISetChainLength(u, 2), handleUuid);
  expect(cl.ok).toBe(true);
  expect(cl.chainLength).toBe(2);

  // Move the bone manually, then refresh — handle should snap to the
  // bone's fresh world position.
  await win.evaluate((u) => window.__studioRigSetBoneRotation(u, [0, 0, Math.PI / 4]), shoulder.uuid);
  const ref = await win.evaluate(() => window.__studioRigUIRefreshHandles());
  expect(ref.ok).toBe(true);
  expect(ref.refreshed).toBe(1);
  const handleNow = await win.evaluate((u) => {
    let h = null; window.__archdiscScene.traverse((o) => { if (o.uuid === u) h = o; });
    let b = null; window.__archdiscScene.traverse((o) => { if (o.isBone && o.uuid === h.userData.archdiscStudioIKHandle.boneUuid) b = o; });
    const wp = new (h.position.constructor)();
    b.getWorldPosition(wp);
    return { handle: [h.position.x, h.position.y, h.position.z], bone: [wp.x, wp.y, wp.z] };
  }, handleUuid);
  const drift = Math.hypot(
    handleNow.handle[0] - handleNow.bone[0],
    handleNow.handle[1] - handleNow.bone[1],
    handleNow.handle[2] - handleNow.bone[2],
  );
  expect(drift).toBeLessThan(1e-3);

  // ─── Step 7: command-palette discovery (category 'rig') ──────────────
  const rigCmds = await win.evaluate(() => {
    if (typeof window.__studioCommandList !== 'function') return null;
    return window.__studioCommandList('rig');
  });
  expect(rigCmds.ok).toBe(true);
  const names = rigCmds.commands.map((c) => c.name);
  for (const expected of [
    '__studioRigUIShowHandles', '__studioRigUIHideHandles', '__studioRigUIListHandles',
    '__studioRigUIDragHandle', '__studioRigUISetChainLength', '__studioRigUIRefreshHandles',
  ]) {
    expect(names).toContain(expected);
  }

  // ─── Step 8: multi-cam screenshots (5 angles) ───────────────────────
  const cams = [
    { name: 'front', pos: [0, 1.5, 5],  target: [0, 1.5, 0] },
    { name: 'iso',   pos: [3, 3, 3],    target: [1, 1.5, 0] },
    { name: 'right', pos: [5, 1.5, 0],  target: [0, 1.5, 0] },
    { name: 'top',   pos: [0, 6, 0.01], target: [0, 1.5, 0] },
    { name: 'close', pos: [2, 2, 2],    target: [1, 1, 0] },
  ];
  for (const c of cams) {
    await win.evaluate(({ pos, target }) => {
      const v = window.__archdiscViewport;
      if (!v) return;
      v.camera.position.set(pos[0], pos[1], pos[2]);
      v.camera.lookAt(target[0], target[1], target[2]);
      if (v.orbitControls) {
        v.orbitControls.target.set(target[0], target[1], target[2]);
        v.orbitControls.update();
      }
      v.camera.updateMatrixWorld(true);
      v.renderer.render(v.scene, v.camera);
    }, c);
    await win.waitForTimeout(120);
    await win.screenshot({ path: path.join(OUT, `04-${c.name}.png`) });
  }

  // ─── Step 9: hide → 0 handles ────────────────────────────────────────
  const hide = await win.evaluate(() => window.__studioRigUIHideHandles());
  expect(hide.ok).toBe(true);
  expect(hide.removed).toBe(1);
  const after = await win.evaluate(() => window.__studioRigUIListHandles());
  expect(after.count).toBe(0);

  await win.evaluate(() => {
    window.localStorage.removeItem('studioV3');
    window.localStorage.removeItem('studio.v3.theme');
    window.localStorage.removeItem('studio.v3.wb');
  });

  // eslint-disable-next-line no-console
  console.log(`  rigui: handle drag → IK ${drag.ik.iterations} iters, final dist ${drag.ik.finalDistance.toFixed(3)} m, pointer-drag shoulder Δ ${synDelta.toFixed(3)} rad`);

  await app.close();
});
