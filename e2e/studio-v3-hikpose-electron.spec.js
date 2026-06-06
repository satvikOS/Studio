// ArchDisc Studio V3 — HumanIK mirror pose + reset to bind (slice 740).
//
// Headed Mac-Electron spec. Adds the two daily rigging ops the HumanIK
// autorigger was missing (Maya HumanIK / MotionBuilder / Cascadeur):
//   • __studioHumanIKMirrorPose — reflect the pose across the sagittal
//     plane, swapping Left<->Right bone rotations (q→(x,−y,−z,w)).
//   • __studioHumanIKResetToBind — snap every bone back to identity (T-pose).
//
// Flow: spawn a box, autoRig it (21-bone biped), rotate LeftArm only,
// mirror → RightArm now carries the reflected rotation and LeftArm goes
// back to (the mirror of Right's previous identity); reset → all identity.

import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-v3-hikpose');
const NAMED_VIEWS = ['front', 'iso', 'right', 'top', 'close'];

test('Studio V3 — HumanIK mirror pose + reset to bind', async () => {
  test.setTimeout(240000);
  fs.mkdirSync(OUT, { recursive: true });

  const app = await electron.launch({
    args: [path.join(__dirname, '..', 'electron', 'main.js'), '--dev'],
    slowMo: Number(process.env.STUDIO_SLOWMO) || 140,
  });
  // --dev may auto-open a DevTools window; app.firstWindow() can race onto
  // it. Pick the real app window (url() not devtools://).
  let win = null;
  for (let i = 0; i < 30 && !win; i++) {
    win = app.windows().find((w) => {
      const u = (() => { try { return w.url(); } catch (_) { return ''; } })();
      return u && !u.startsWith('devtools://');
    }) || null;
    if (!win) { await new Promise((r) => setTimeout(r, 500)); }
  }
  if (!win) win = await app.firstWindow();
  win.on('dialog', (d) => { d.dismiss().catch(() => {}); });
  await win.waitForLoadState('domcontentloaded');

  await win.evaluate(() => {
    window.localStorage.setItem('studioV3', '1');
    window.localStorage.setItem('studio.v3.tour-seen', '1');
    window.localStorage.removeItem('studio.v3.theme');
    window.localStorage.removeItem('studio.v3.wb');
    try { window.sessionStorage.setItem('studio.v3.splash-shown', '1'); } catch (_) {}
  });
  let shellUp = false;
  for (let attempt = 0; attempt < 4 && !shellUp; attempt++) {
    await win.reload();
    await win.waitForLoadState('domcontentloaded');
    await win.waitForTimeout(1500);
    try {
      await expect(win.locator('[data-studio-v3-shell]')).toBeVisible({ timeout: 40000 });
      shellUp = true;
    } catch (_) { /* retry */ }
  }
  expect(shellUp).toBe(true);
  await win.waitForFunction(() => !!window.__archdiscScene && !!window.THREE, null, { timeout: 30000 });

  await win.evaluate(async () => {
    if (typeof window.__studioHumanIKAutoRig !== 'function') {
      await import('/src/workbenches/studio/v3/humanik/autoload.js');
    }
  });
  await win.waitForFunction(() => typeof window.__studioHumanIKMirrorPose === 'function',
    null, { timeout: 20000 });
  await win.screenshot({ path: path.join(OUT, '00-shell.png') });

  // ── 1) Spawn a humanoid-ish box and auto-rig it. ──────────────────
  const rig = await win.evaluate(() => {
    const THREE = window.THREE;
    const scene = window.__archdiscScene;
    const geo = new THREE.BoxGeometry(1, 2, 0.5, 4, 8, 2);
    const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0x88aacc }));
    mesh.position.set(0, 1, 0);
    scene.add(mesh);
    const r = window.__studioHumanIKAutoRig(mesh.uuid, { skin: true });
    return { uuid: mesh.uuid, r };
  });
  expect(rig.r.ok).toBe(true);
  expect(rig.r.boneCount).toBe(22);
  expect(rig.r.boneNames).toContain('LeftArm');
  expect(rig.r.boneNames).toContain('RightArm');
  await win.waitForTimeout(150);
  await win.screenshot({ path: path.join(OUT, '01-rigged.png') });

  // ── 2) Pose: rotate ONLY LeftArm; RightArm stays at identity. ─────
  const posed = await win.evaluate((uuid) => {
    const THREE = window.THREE;
    const scene = window.__archdiscScene;
    const mesh = scene.getObjectByProperty('uuid', uuid);
    const root = scene.getObjectByProperty('uuid', mesh.userData.archdiscStudioHumanIK.skeletonRoot);
    const la = root.getObjectByName('LeftArm');
    const ra = root.getObjectByName('RightArm');
    la.quaternion.setFromEuler(new THREE.Euler(0, 0, 0.6)); // bend around Z
    ra.quaternion.set(0, 0, 0, 1);
    return { la: la.quaternion.toArray(), ra: ra.quaternion.toArray() };
  }, rig.uuid);
  console.log('[hik] posed LeftArm z=', posed.la[2].toFixed(3), ' RightArm z=', posed.ra[2].toFixed(3));
  expect(Math.abs(posed.la[2])).toBeGreaterThan(0.2);
  expect(Math.abs(posed.ra[2])).toBeLessThan(1e-6);

  // ── 3) Mirror: RightArm should now carry the reflected LeftArm rot. ──
  const mir = await win.evaluate((uuid) => {
    const scene = window.__archdiscScene;
    const r = window.__studioHumanIKMirrorPose(uuid);
    const mesh = scene.getObjectByProperty('uuid', uuid);
    const root = scene.getObjectByProperty('uuid', mesh.userData.archdiscStudioHumanIK.skeletonRoot);
    const la = root.getObjectByName('LeftArm');
    const ra = root.getObjectByName('RightArm');
    return { r, la: la.quaternion.toArray(), ra: ra.quaternion.toArray() };
  }, rig.uuid);
  expect(mir.r.ok).toBe(true);
  expect(mir.r.pairs).toBeGreaterThan(0);
  console.log('[hik] after mirror LeftArm z=', mir.la[2].toFixed(3), ' RightArm z=', mir.ra[2].toFixed(3));
  // RightArm now holds the reflected LeftArm rotation: z component (the
  // original 0.6-ish bend) reflects to −z under mirror(q)=(x,−y,−z,w).
  expect(Math.abs(mir.ra[2])).toBeGreaterThan(0.2);
  // LeftArm receives the mirror of RightArm's old identity → identity.
  expect(Math.abs(mir.la[2])).toBeLessThan(1e-6);
  await win.waitForTimeout(150);
  await win.screenshot({ path: path.join(OUT, '02-mirrored.png') });

  // ── 4) Reset to bind: every bone back to identity. ───────────────
  const reset = await win.evaluate((uuid) => {
    const scene = window.__archdiscScene;
    const r = window.__studioHumanIKResetToBind(uuid);
    const mesh = scene.getObjectByProperty('uuid', uuid);
    const root = scene.getObjectByProperty('uuid', mesh.userData.archdiscStudioHumanIK.skeletonRoot);
    let maxDev = 0;
    for (const n of mesh.userData.archdiscStudioHumanIK.boneNames) {
      const b = root.getObjectByName(n);
      if (!b) continue;
      const q = b.quaternion;
      maxDev = Math.max(maxDev, Math.abs(q.x), Math.abs(q.y), Math.abs(q.z), Math.abs(q.w - 1));
    }
    return { r, maxDev };
  }, rig.uuid);
  expect(reset.r.ok).toBe(true);
  expect(reset.r.reset).toBe(22);
  console.log('[hik] reset maxDev from identity =', reset.maxDev.toExponential(2));
  expect(reset.maxDev).toBeLessThan(1e-6);
  await win.waitForTimeout(150);
  await win.screenshot({ path: path.join(OUT, '03-reset.png') });

  // ── 5) Global search surfaces the new ops. ───────────────────────
  const search = await win.evaluate(() => {
    const r = window.__studioCommandSearch('mirror', 80);
    return { ok: r.ok, names: (r.hits || []).map((h) => h.name) };
  });
  console.log('[hik] search "mirror" hits:', JSON.stringify(search.names));
  expect(search.ok).toBe(true);
  const hasMirror = search.names.some((n) => /HumanIKMirrorPose/i.test(n));
  expect(hasMirror).toBe(true);

  // ── 6) Camera sweep. ───────────────────────────────────────────────
  for (const view of NAMED_VIEWS) {
    await win.evaluate((v) => {
      if (typeof window.__studioSetView === 'function') window.__studioSetView(v);
      else if (typeof window.__archdiscSetView === 'function') window.__archdiscSetView(v);
    }, view);
    await win.waitForTimeout(220);
    await win.screenshot({ path: path.join(OUT, `cam-${view}.png`) });
  }

  // eslint-disable-next-line no-console
  console.log('  slice 740: mirror pairs', mir.r.pairs, '| reset', reset.r.reset, "bones to identity");

  await app.close();
});
