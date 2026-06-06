// ArchDisc Studio V3 — Maya HumanIK animation retargeting (slice 762).
//
// Headed Mac-Electron spec. Builds TWO armatures with similar bone
// names but different bone lengths (the canonical "retarget across
// proportions" case), poses the source's TopBone, extracts a one-frame
// clip, applies it onto the target, and asserts the target's TopBone
// carries the source's authored rotation. Five named camera angles
// per the multi-cam memory.

import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-an-retarget');
const NAMED_VIEWS = ['front', 'iso', 'right', 'top', 'close'];

test('Studio V3 — Maya HumanIK animation retargeting', async () => {
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

  // Make sure rig + anretarget ops are installed.
  await win.evaluate(async () => {
    if (typeof window.__studioRigCreateArmature !== 'function') {
      await import('/src/workbenches/studio/v3/rig/autoload.js');
    }
    if (typeof window.__studioAnRetargetMap !== 'function') {
      await import('/src/workbenches/studio/v3/anretarget/autoload.js');
    }
  });
  await win.waitForFunction(() => typeof window.__studioAnRetargetMap === 'function',
    null, { timeout: 20000 });
  await win.screenshot({ path: path.join(OUT, '00-shell.png') });

  // ── 1) Build a SOURCE armature: BottomBone (root) → TopBone, 1m tall. ──
  const src = await win.evaluate(() => {
    const a = window.__studioRigCreateArmature({ name: 'SourceArm', position: [-1.5, 0, 0] });
    // Add BottomBone under the auto-created root (offset 0,0,0 so it sits
    // at the armature origin); then TopBone parented under BottomBone at
    // (0,1,0) — a 1m segment.
    const bb = window.__studioRigAddBone(a.uuid, null, [0, 0, 0], 'BottomBone');
    const tb = window.__studioRigAddBone(a.uuid, bb.uuid, [0, 1, 0], 'TopBone');
    return { armUuid: a.uuid, bottomUuid: bb.uuid, topUuid: tb.uuid };
  });
  expect(typeof src.armUuid).toBe('string');
  expect(typeof src.topUuid).toBe('string');

  // ── 2) Build a TARGET armature with the SAME bone names but a 2m
  //      TopBone offset — proportions differ. ─────────────────────────────
  const tgt = await win.evaluate(() => {
    const a = window.__studioRigCreateArmature({ name: 'TargetArm', position: [1.5, 0, 0] });
    const bb = window.__studioRigAddBone(a.uuid, null, [0, 0, 0], 'BottomBone');
    const tb = window.__studioRigAddBone(a.uuid, bb.uuid, [0, 2, 0], 'TopBone');
    return { armUuid: a.uuid, bottomUuid: bb.uuid, topUuid: tb.uuid };
  });
  expect(typeof tgt.armUuid).toBe('string');
  await win.waitForTimeout(150);
  await win.screenshot({ path: path.join(OUT, '01-armatures.png') });

  // ── 3) Build the bone-name map. ────────────────────────────────────────
  const mapped = await win.evaluate(([s, t]) => {
    return window.__studioAnRetargetMap(s, t);
  }, [src.armUuid, tgt.armUuid]);
  console.log('[anretarget] mapping:', JSON.stringify(mapped.mapping));
  expect(mapped.ok).toBe(true);
  // We expect at least: Root → Root, BottomBone → BottomBone, TopBone → TopBone.
  expect(mapped.pairs).toBeGreaterThanOrEqual(3);
  expect(mapped.mapping.TopBone).toBe('TopBone');
  expect(mapped.mapping.BottomBone).toBe('BottomBone');

  // ── 4) Pose the source: rotate TopBone by ~34° around Z. ───────────────
  const poseAngle = 0.6; // radians ≈ 34.4°
  const posed = await win.evaluate(([s, angle]) => {
    return window.__studioRigSetBoneRotation(s, [0, 0, angle]);
  }, [src.topUuid, poseAngle]);
  expect(posed.ok).toBe(true);
  expect(Math.abs(posed.rotation[2] - poseAngle)).toBeLessThan(1e-6);

  // Read source TopBone's quaternion z component for the assertion.
  const srcTopQuat = await win.evaluate((u) => {
    const scene = window.__archdiscScene;
    let bone = null;
    scene.traverse((o) => { if (o.isBone && o.uuid === u) bone = o; });
    if (!bone) return null;
    return [bone.quaternion.x, bone.quaternion.y, bone.quaternion.z, bone.quaternion.w];
  }, src.topUuid);
  expect(srcTopQuat).not.toBeNull();
  expect(Math.abs(srcTopQuat[2])).toBeGreaterThan(0.2);
  await win.waitForTimeout(150);
  await win.screenshot({ path: path.join(OUT, '02-posed-source.png') });

  // ── 5) Extract the clip from the source (one frame). ───────────────────
  const clipR = await win.evaluate((s) => {
    const r = window.__studioAnRetargetExtractClip(s, [0]);
    return {
      ok: r.ok, frameCount: r.frameCount, clipKey: r.clipKey,
      // Sample the TopBone rotation from the clip to make sure extract
      // captured it.
      topQuat: r.clip[0][1]['TopBone'],
      bonesRestTop: r.bonesRest && r.bonesRest['TopBone'],
    };
  }, src.armUuid);
  expect(clipR.ok).toBe(true);
  expect(clipR.frameCount).toBe(1);
  expect(typeof clipR.clipKey).toBe('string');
  expect(clipR.topQuat).toBeDefined();
  // The clip's TopBone z must match the source TopBone's z.
  expect(Math.abs(clipR.topQuat.z - srcTopQuat[2])).toBeLessThan(1e-6);

  // ── 6) Apply the clip onto the target. ─────────────────────────────────
  const appliedR = await win.evaluate(([t, k]) => {
    return window.__studioAnRetargetApply(t, k, 0);
  }, [tgt.armUuid, clipR.clipKey]);
  console.log('[anretarget] apply →', JSON.stringify(appliedR));
  expect(appliedR.ok).toBe(true);
  expect(appliedR.applied).toBeGreaterThanOrEqual(3);

  // ── 7) Assert target's TopBone now matches source TopBone rotation. ───
  //      Both armatures were built with identity rest poses so the
  //      normaliser collapses to Q_t = Q_s exactly.
  const tgtTopQuat = await win.evaluate((u) => {
    const scene = window.__archdiscScene;
    let bone = null;
    scene.traverse((o) => { if (o.isBone && o.uuid === u) bone = o; });
    if (!bone) return null;
    return [bone.quaternion.x, bone.quaternion.y, bone.quaternion.z, bone.quaternion.w];
  }, tgt.topUuid);
  expect(tgtTopQuat).not.toBeNull();
  console.log('[anretarget] src TopBone z=', srcTopQuat[2].toFixed(4),
    ' tgt TopBone z=', tgtTopQuat[2].toFixed(4));
  // Tight match — identity rest → straight copy.
  for (let i = 0; i < 4; i++) {
    expect(Math.abs(tgtTopQuat[i] - srcTopQuat[i])).toBeLessThan(1e-5);
  }
  await win.waitForTimeout(150);
  await win.screenshot({ path: path.join(OUT, '03-retargeted.png') });

  // ── 8) Save the clip under a stable name, verify List surfaces it. ─────
  const saved = await win.evaluate(() => window.__studioAnRetargetSaveClip('topbend', null));
  console.log('[anretarget] save →', JSON.stringify(saved));
  expect(saved.ok).toBe(true);
  expect(saved.name).toBe('topbend');
  expect(saved.frameCount).toBe(1);

  const listed = await win.evaluate(() => window.__studioAnRetargetList());
  expect(listed.ok).toBe(true);
  expect(listed.count).toBeGreaterThanOrEqual(2); // the extract synthetic + the named save
  const hasNamed = listed.clips.some((c) => c.name === 'topbend');
  expect(hasNamed).toBe(true);

  // ── 9) Command palette discovery. ──────────────────────────────────────
  const search = await win.evaluate(() => {
    const r = window.__studioCommandSearch('retarget', 80);
    return { ok: r.ok, names: (r.hits || []).map((h) => h.name) };
  });
  console.log('[anretarget] search "retarget" hits:', JSON.stringify(search.names));
  expect(search.ok).toBe(true);
  for (const expected of [
    '__studioAnRetargetMap',
    '__studioAnRetargetExtractClip',
    '__studioAnRetargetApply',
    '__studioAnRetargetSaveClip',
    '__studioAnRetargetList',
  ]) {
    expect(search.names).toContain(expected);
  }

  // ── 10) Five-camera sweep. ─────────────────────────────────────────────
  // We frame both armatures (positioned at ±1.5 on X) so the screenshots
  // include enough of the scene to verify the retarget visually.
  const cams = [
    { name: 'front', pos: [0, 1.5, 6], target: [0, 1, 0] },
    { name: 'iso',   pos: [4, 3, 4],   target: [0, 1, 0] },
    { name: 'right', pos: [6, 1.5, 0], target: [0, 1, 0] },
    { name: 'top',   pos: [0, 7, 0.01], target: [0, 1, 0] },
    { name: 'close', pos: [2.5, 2.5, 2.5], target: [1.5, 1.5, 0] },
  ];
  for (const c of cams) {
    let snapped = false;
    try {
      await win.evaluate(({ pos, target }) => {
        const v = window.__archdiscViewport;
        if (!v || !v.camera) return false;
        v.camera.position.set(pos[0], pos[1], pos[2]);
        v.camera.lookAt(target[0], target[1], target[2]);
        if (v.orbitControls) {
          v.orbitControls.target.set(target[0], target[1], target[2]);
          v.orbitControls.update();
        }
        v.camera.updateMatrixWorld(true);
        if (v.renderer && v.scene) v.renderer.render(v.scene, v.camera);
        return true;
      }, c);
      snapped = true;
    } catch (_) {
      // Fall back to viewport-agnostic named view if available.
      try {
        await win.evaluate((v) => {
          if (typeof window.__studioSetView === 'function') window.__studioSetView(v);
          else if (typeof window.__archdiscSetView === 'function') window.__archdiscSetView(v);
        }, c.name);
        snapped = true;
      } catch (_) {}
    }
    await win.waitForTimeout(220);
    await win.screenshot({ path: path.join(OUT, `cam-${c.name}.png`) });
    expect(snapped).toBe(true);
  }

  // eslint-disable-next-line no-console
  console.log('  slice 762: map', mapped.pairs, 'pairs | applied', appliedR.applied, 'bones');

  await app.close();
});
