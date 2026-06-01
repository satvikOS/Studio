import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-v3-cameraops');

test('Studio V3 — camera / transform / clone / scatter family (slice 403)', async () => {
  test.setTimeout(180000);
  fs.mkdirSync(OUT, { recursive: true });

  const app = await electron.launch({
    args: [path.join(__dirname, '..', 'electron', 'main.js')],
    slowMo: Number(process.env.STUDIO_SLOWMO) || 300,
  });
  const win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');

  await win.evaluate(() => {
    window.localStorage.setItem('studioV3', '1');
    window.localStorage.removeItem('studio.v3.theme');
    window.localStorage.removeItem('studio.v3.wb');
  });
  await win.reload();
  await win.waitForLoadState('domcontentloaded');
  await expect(win.locator('[data-studio-v3-shell]')).toBeVisible({ timeout: 15000 });
  await win.waitForFunction(() => typeof window.__studioFrameAll === 'function', null, { timeout: 15000 });

  // Spawn + select cube.
  await win.locator('[data-studio-v3-tool="cube"][data-studio-v3-tool-group="add"]').click();
  await win.waitForTimeout(300);
  await win.evaluate(() => {
    const vp = window.__archdiscViewport;
    let cube = null;
    vp.scene.traverse((o) => { if (o.userData && o.userData.archdiscStudioPrimitiveKind === 'cube') cube = o; });
    vp.transformControls.attach(cube);
  });

  // ── camera framing ──
  const fa = await win.evaluate(() => window.__studioFrameAll());
  expect(fa.ok).toBe(true);
  const fs2 = await win.evaluate(() => window.__studioFitSelected());
  expect(fs2.ok).toBe(true);

  // ── axis view ──
  for (const ax of ['top', 'front', 'side', 'persp']) {
    const r = await win.evaluate((a) => window.__studioSetCameraAxis(a), ax);
    expect(r.ok).toBe(true);
    expect(r.axis).toBe(ax);
  }
  const badAx = await win.evaluate(() => window.__studioSetCameraAxis('weird'));
  expect(badAx.ok).toBe(false);

  // ── lookAt ──
  const la = await win.evaluate(() => window.__studioLookAt([1, 0, 0]));
  expect(la.ok).toBe(true);

  // ── centerAtOrigin (move cube first then snap it back) ──
  await win.evaluate(() => { window.__studioSelectedMesh().position.set(0.5, 0.3, 0.2); });
  const cao = await win.evaluate(() => window.__studioCenterAtOrigin());
  expect(cao.ok).toBe(true);
  const after = await win.evaluate(() => {
    const m = window.__studioSelectedMesh();
    return [m.position.x, m.position.y, m.position.z];
  });
  expect(after).toEqual([0, 0, 0]);

  // ── alignToGround ──
  const ag = await win.evaluate(() => window.__studioAlignToGround());
  expect(ag.ok).toBe(true);

  // ── recenterPivot ──
  const rp = await win.evaluate(() => window.__studioRecenterPivot());
  expect(rp.ok).toBe(true);

  // ── applyTransforms (cube was offset by alignToGround) ──
  const at = await win.evaluate(() => window.__studioApplyTransforms());
  expect(at.ok).toBe(true);

  // ── mirrorAcrossAxis ──
  const mir = await win.evaluate(() => window.__studioMirrorAcrossAxis('x'));
  expect(mir.ok).toBe(true);

  // ── cloneAlongAxis — count climbs from 1 → 6.
  const countBefore = await win.evaluate(() => window.__studioCountPrimitives());
  expect(countBefore).toBe(1);
  const cl = await win.evaluate(() => window.__studioCloneAlongAxis('x', 5, 0.05));
  expect(cl.ok).toBe(true);
  expect(cl.count).toBe(5);
  const countAfter = await win.evaluate(() => window.__studioCountPrimitives());
  expect(countAfter).toBe(6);

  // ── randomScatter — count climbs by 8 (deterministic via seed).
  const sc = await win.evaluate(() => window.__studioRandomScatter(8, 0.2, 42));
  expect(sc.ok).toBe(true);
  expect(sc.count).toBe(8);
  expect(await win.evaluate(() => window.__studioCountPrimitives())).toBe(14);

  // ── groupSelected ──
  const gs = await win.evaluate(() => window.__studioGroupSelected());
  expect(gs.ok).toBe(true);
  expect(typeof gs.uuid).toBe('string');

  await win.screenshot({ path: path.join(OUT, '00-after-cameraops.png') });

  // Reset.
  await win.evaluate(() => {
    window.localStorage.removeItem('studioV3');
    window.localStorage.removeItem('studio.v3.theme');
    window.localStorage.removeItem('studio.v3.wb');
  });

  // eslint-disable-next-line no-console
  console.log('  slice 403: 12 camera/transform ops all green; scene count 1 → 14 via clone + scatter');

  await app.close();
});
