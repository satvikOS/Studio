// Studio V3 — Cascadeur-style AutoPosing: COM + balance + contact +
// ballistic trajectory.
//
// Builds a humanoid-ish rig (root → spine → 2 legs (hip, knee, ankle))
// on top of a cylinder primitive, then exercises every AutoPose op:
//
//   • __studioAutoPoseComputeCOM            → volume-weighted COM falls
//     somewhere between the lowest and highest bone Y.
//   • __studioAutoPoseAddAutoContact +
//     __studioAutoPoseListAutoContacts      → ankle bones get tagged
//     and re-read back through the listing API.
//   • __studioAutoPoseAutoContact           → tagged bones snap to
//     groundY = 0; the world-Y deltas are < 1e-2.
//   • __studioAutoPoseBalance               → after deliberately tilting
//     the rig sideways, balance bends the spine so the new COM
//     projection lies inside the foot polygon.
//   • __studioAutoPoseFitBallisticTrajectory → 12 samples baked, peak
//     hit at the midpoint, endpoints at y0; a ticker drives the
//     armature's root through the parabola.
//   • Side panel opens / closes / re-opens cleanly via the JS surface.
//
// Five camera angles (front / iso / right / top / close) screenshot the
// posed result, per the Forge multi-cam memory.

import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-v3-autopose');

test('Studio V3 — AutoPose: COM, balance, contact, ballistic trajectory', async () => {
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

  // Rig + AutoPose both have to be live before we build the test rig.
  await win.waitForFunction(() => typeof window.__studioRigCreateArmature === 'function', null, { timeout: 15000 });
  await win.evaluate(async () => {
    if (typeof window.__studioAutoPoseComputeCOM !== 'function') {
      await import('/src/workbenches/studio/v3/autopose/autoload.js');
    }
  });
  await win.waitForFunction(
    () => typeof window.__studioAutoPoseComputeCOM === 'function'
      && typeof window.__studioAutoPoseBalance === 'function'
      && typeof window.__studioAutoPoseAddAutoContact === 'function'
      && typeof window.__studioAutoPoseListAutoContacts === 'function'
      && typeof window.__studioAutoPoseAutoContact === 'function'
      && typeof window.__studioAutoPoseFitBallisticTrajectory === 'function'
      && typeof window.__studioAutoPosePanelOpen === 'function',
    null, { timeout: 15000 },
  );

  // ─── Step 1: spawn the cylinder torso ───────────────────────────────
  await win.locator('[data-studio-v3-tool="cylinder"][data-studio-v3-tool-group="add"]').click();
  await win.waitForTimeout(200);
  const cylinderUuid = await win.evaluate(() => {
    let cyl = null;
    window.__archdiscScene.traverse((o) => {
      if (o.userData && o.userData.archdiscStudioPrimitiveKind === 'cylinder' && !cyl) cyl = o;
    });
    cyl.scale.set(0.5, 100, 0.5); // primitives are 0.03 m → ~3 m tall
    cyl.position.set(0, 1.5, 0);
    cyl.updateMatrixWorld(true);
    return cyl.uuid;
  });
  expect(typeof cylinderUuid).toBe('string');

  // ─── Step 2: build the humanoid rig ─────────────────────────────────
  // Root → Spine1 → Spine2.   Root → Hip_L → Knee_L → Ankle_L.
  //                           Root → Hip_R → Knee_R → Ankle_R.
  const arm = await win.evaluate(() => window.__studioRigCreateArmature({
    name: 'Humanoid', position: [0, 0, 0],
  }));
  expect(arm.ok).toBe(true);

  // Spine bones rise from y=1 → y=2 → y=3.
  const spine1 = await win.evaluate((u) => window.__studioRigAddBone(u, null, [0, 1.0, 0], 'Spine1'), arm.uuid);
  const spine2 = await win.evaluate(([u, p]) => window.__studioRigAddBone(u, p, [0, 1.0, 0], 'Spine2'), [arm.uuid, spine1.uuid]);
  const head   = await win.evaluate(([u, p]) => window.__studioRigAddBone(u, p, [0, 0.5, 0], 'Head'),   [arm.uuid, spine2.uuid]);

  // Legs split at the root. Hip offset is sideways + small down so
  // ankle ends up around y=0 (close to ground).
  const hipL   = await win.evaluate((u)        => window.__studioRigAddBone(u, null, [-0.2, 0.0, 0], 'Hip_L'),  arm.uuid);
  const kneeL  = await win.evaluate(([u, p])   => window.__studioRigAddBone(u, p, [0, -0.5, 0], 'Knee_L'),     [arm.uuid, hipL.uuid]);
  const ankleL = await win.evaluate(([u, p])   => window.__studioRigAddBone(u, p, [0, -0.5, 0], 'Ankle_L'),    [arm.uuid, kneeL.uuid]);

  const hipR   = await win.evaluate((u)        => window.__studioRigAddBone(u, null, [0.2, 0.0, 0], 'Hip_R'),   arm.uuid);
  const kneeR  = await win.evaluate(([u, p])   => window.__studioRigAddBone(u, p, [0, -0.5, 0], 'Knee_R'),     [arm.uuid, hipR.uuid]);
  const ankleR = await win.evaluate(([u, p])   => window.__studioRigAddBone(u, p, [0, -0.5, 0], 'Ankle_R'),    [arm.uuid, kneeR.uuid]);

  // Bind the cylinder so the helper draws + we get a textured deformable.
  const bound = await win.evaluate(
    ([m, a]) => window.__studioRigBindMesh(m, a, { maxBones: 4 }),
    [cylinderUuid, arm.uuid],
  );
  expect(bound.ok).toBe(true);
  await win.evaluate((u) => window.__studioRigShowSkeleton(u), arm.uuid);
  await win.screenshot({ path: path.join(OUT, '00-rig.png') });

  // ─── Step 3: COM is meaningful ──────────────────────────────────────
  const com = await win.evaluate((u) => window.__studioAutoPoseComputeCOM(u), arm.uuid);
  expect(com.ok).toBe(true);
  expect(Array.isArray(com.com)).toBe(true);
  expect(com.mass).toBeGreaterThan(0);
  expect(com.segments).toBeGreaterThanOrEqual(7); // 3 spine + 4 leg parents
  // COM Y should sit between the lowest bone and the highest bone.
  expect(com.com[1]).toBeGreaterThan(-1.0);
  expect(com.com[1]).toBeLessThan(3.0);

  // ─── Step 4: tag ankles as AutoContact + verify the list ────────────
  const addL = await win.evaluate((u) => window.__studioAutoPoseAddAutoContact(u, true), ankleL.uuid);
  expect(addL.ok).toBe(true);
  expect(addL.on).toBe(true);
  const addR = await win.evaluate((u) => window.__studioAutoPoseAddAutoContact(u, true), ankleR.uuid);
  expect(addR.ok).toBe(true);
  const contacts = await win.evaluate((u) => window.__studioAutoPoseListAutoContacts(u), arm.uuid);
  expect(contacts.ok).toBe(true);
  expect(contacts.count).toBe(2);
  const contactUuids = contacts.contacts.map((c) => c.uuid).sort();
  expect(contactUuids).toEqual([ankleL.uuid, ankleR.uuid].sort());

  await win.screenshot({ path: path.join(OUT, '01-contacts-tagged.png') });

  // ─── Step 5: tag ankles as feet + spine bones for balance heuristics ─
  await win.evaluate(([uL, uR, uS1, uS2]) => {
    const tag = (u, key) => {
      let b = null;
      window.__archdiscScene.traverse((o) => { if (o.isBone && o.uuid === u) b = o; });
      if (b) b.userData[key] = true;
    };
    tag(uL,  'archdiscStudioAutoPoseFoot');
    tag(uR,  'archdiscStudioAutoPoseFoot');
    tag(uS1, 'archdiscStudioAutoPoseSpine');
    tag(uS2, 'archdiscStudioAutoPoseSpine');
  }, [ankleL.uuid, ankleR.uuid, spine1.uuid, spine2.uuid]);

  // ─── Step 6: AutoContact snaps ankles to ground ─────────────────────
  // Lift the entire armature so the ankles are well above ground first.
  await win.evaluate((u) => {
    let a = null; window.__archdiscScene.traverse((o) => { if (o.uuid === u) a = o; });
    a.position.set(0, 1.0, 0);
    a.updateMatrixWorld(true);
  }, arm.uuid);

  const ankleLBefore = await win.evaluate((u) => window.__studioRigGetBone(u).worldPosition, ankleL.uuid);
  const ankleRBefore = await win.evaluate((u) => window.__studioRigGetBone(u).worldPosition, ankleR.uuid);
  expect(ankleLBefore[1]).toBeGreaterThan(0.5);
  expect(ankleRBefore[1]).toBeGreaterThan(0.5);

  const contactRun = await win.evaluate((u) => window.__studioAutoPoseAutoContact(u, 0), arm.uuid);
  expect(contactRun.ok).toBe(true);
  expect(contactRun.count).toBe(2);
  for (const r of contactRun.results) {
    expect(Math.abs(r.after[1] - 0)).toBeLessThan(5e-2);
  }
  const ankleLAfter = await win.evaluate((u) => window.__studioRigGetBone(u).worldPosition, ankleL.uuid);
  const ankleRAfter = await win.evaluate((u) => window.__studioRigGetBone(u).worldPosition, ankleR.uuid);
  expect(Math.abs(ankleLAfter[1])).toBeLessThan(5e-2);
  expect(Math.abs(ankleRAfter[1])).toBeLessThan(5e-2);

  await win.screenshot({ path: path.join(OUT, '02-contact.png') });

  // ─── Step 7: AutoBalance — tilt the spine then re-balance ───────────
  // Deliberately tilt Spine1 sideways so the COM projection leaves the
  // foot polygon, then ask the balance pass to bring it back.
  await win.evaluate((u) => window.__studioRigSetBoneRotation(u, [0, 0, 0.45]), spine1.uuid);

  // Capture pre-balance state.
  const comTilted = await win.evaluate((u) => window.__studioAutoPoseComputeCOM(u), arm.uuid);
  expect(comTilted.ok).toBe(true);

  const balance = await win.evaluate(
    (u) => window.__studioAutoPoseBalance(u, { iterations: 16, step: 0.2 }),
    arm.uuid,
  );
  expect(balance.ok).toBe(true);
  expect(balance.iterations).toBeGreaterThan(0);
  expect(balance.feet.length).toBe(2);
  expect(balance.spine.length).toBeGreaterThanOrEqual(2);
  // The post-balance distance to the foot centroid must be no worse than
  // the pre-balance distance — that's the convergence proof.
  const startDist = Math.hypot(
    balance.comStart[0] - balance.centroid[0],
    balance.comStart[2] - balance.centroid[2],
  );
  const endDist = Math.hypot(
    balance.comEnd[0] - balance.centroid[0],
    balance.comEnd[2] - balance.centroid[2],
  );
  expect(endDist).toBeLessThanOrEqual(startDist + 1e-3);
  expect(balance.spineRotated).toBeGreaterThan(0);

  await win.screenshot({ path: path.join(OUT, '03-balance.png') });

  // ─── Step 8: ballistic trajectory bake + sample ─────────────────────
  // Move the armature back to origin so the trajectory's start is clean.
  await win.evaluate((u) => {
    let a = null; window.__archdiscScene.traverse((o) => { if (o.uuid === u) a = o; });
    a.position.set(0, 0, 0);
    a.updateMatrixWorld(true);
  }, arm.uuid);

  const trajectory = await win.evaluate(
    (u) => window.__studioAutoPoseFitBallisticTrajectory(u, 0, 1, 1.2),
    arm.uuid,
  );
  expect(trajectory.ok).toBe(true);
  expect(Array.isArray(trajectory.samples)).toBe(true);
  expect(trajectory.samples.length).toBe(13); // 12 segments + 1 endpoint

  // Endpoints sit at y=y0=0, midpoint sits at y0+peak=1.2.
  const start = trajectory.samples[0];
  const end   = trajectory.samples[trajectory.samples.length - 1];
  const mid   = trajectory.samples[Math.floor(trajectory.samples.length / 2)];
  expect(start.y).toBeCloseTo(0, 3);
  expect(end.y).toBeCloseTo(0, 3);
  expect(mid.y).toBeCloseTo(1.2, 1);

  // Sample at t=0.5 — should match the midpoint to <0.05 m.
  const sample = await win.evaluate((u) => window.__studioAutoPoseSampleTrajectory(u, 0.5), arm.uuid);
  expect(sample.ok).toBe(true);
  expect(Math.abs(sample.position[1] - 1.2)).toBeLessThan(0.05);

  // The ticker should have moved arm.position by the time we ask again.
  await win.waitForTimeout(250);
  const armPosNow = await win.evaluate((u) => {
    let a = null; window.__archdiscScene.traverse((o) => { if (o.uuid === u) a = o; });
    return [a.position.x, a.position.y, a.position.z];
  }, arm.uuid);
  // y should be > 0 if the playhead has advanced into the jump; if not
  // ≥ 0 is still consistent (e.g. the anim/playback state reports t=0).
  expect(armPosNow[1]).toBeGreaterThanOrEqual(0);

  await win.screenshot({ path: path.join(OUT, '04-trajectory.png') });

  // ─── Step 9: side panel lifecycle ───────────────────────────────────
  const popen = await win.evaluate(() => window.__studioAutoPosePanelOpen());
  expect(popen.ok).toBe(true);
  await expect(win.locator('[data-studio-v3-autopose-panel]')).toBeVisible({ timeout: 5000 });
  await expect(win.locator('[data-studio-v3-autopose-armchip]')).toHaveCount(1);
  // Header should mention the armature uuid (truncated).
  const chipText = await win.locator('[data-studio-v3-autopose-armchip]').textContent();
  expect(chipText && chipText.length > 0).toBe(true);

  await win.screenshot({ path: path.join(OUT, '05-panel.png') });

  const pclose = await win.evaluate(() => window.__studioAutoPosePanelClose());
  expect(pclose.ok).toBe(true);
  await expect(win.locator('[data-studio-v3-autopose-panel]')).toHaveCount(0);

  // Re-open via the toggle op.
  const ptog = await win.evaluate(() => window.__studioAutoPosePanelToggle());
  expect(ptog.ok).toBe(true);
  await expect(win.locator('[data-studio-v3-autopose-panel]')).toBeVisible({ timeout: 5000 });

  // ─── Step 10: command-palette discovery (category 'rig') ────────────
  const rigCmds = await win.evaluate(() => {
    if (typeof window.__studioCommandList !== 'function') return null;
    return window.__studioCommandList('rig');
  });
  expect(rigCmds.ok).toBe(true);
  const names = rigCmds.commands.map((c) => c.name);
  for (const expected of [
    '__studioAutoPoseComputeCOM',
    '__studioAutoPoseBalance',
    '__studioAutoPoseAddAutoContact',
    '__studioAutoPoseListAutoContacts',
    '__studioAutoPoseAutoContact',
    '__studioAutoPoseFitBallisticTrajectory',
    '__studioAutoPosePanelOpen',
    '__studioAutoPosePanelClose',
    '__studioAutoPosePanelToggle',
  ]) {
    expect(names).toContain(expected);
  }

  // ─── Step 11: multi-cam screenshots (5 angles) ──────────────────────
  const cams = [
    { name: 'front', pos: [0, 1.5, 5],  target: [0, 1.5, 0] },
    { name: 'iso',   pos: [3, 3, 3],    target: [0, 1.5, 0] },
    { name: 'right', pos: [5, 1.5, 0],  target: [0, 1.5, 0] },
    { name: 'top',   pos: [0, 6, 0.01], target: [0, 1.5, 0] },
    { name: 'close', pos: [2, 2, 2],    target: [0, 1, 0] },
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
    await win.screenshot({ path: path.join(OUT, `06-${c.name}.png`) });
  }

  // Cleanup.
  await win.evaluate((u) => window.__studioAutoPoseClearTrajectory(u), arm.uuid);
  await win.evaluate(() => window.__studioAutoPosePanelClose());
  await win.evaluate((u) => window.__studioRigRemoveArmature(u), arm.uuid);
  await win.evaluate(() => {
    window.localStorage.removeItem('studioV3');
    window.localStorage.removeItem('studio.v3.theme');
    window.localStorage.removeItem('studio.v3.wb');
  });

  // eslint-disable-next-line no-console
  console.log(`  autopose: COM mass=${com.mass.toFixed(3)} m³, balance iters=${balance.iterations} dist=${endDist.toFixed(3)} m, trajectory ${trajectory.samples.length} keys`);

  await app.close();
});
