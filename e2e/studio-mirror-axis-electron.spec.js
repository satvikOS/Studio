import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-mirror-axis');

test('Studio — Blender Mirror modifier across axis (slice 312)', async () => {
  test.setTimeout(180000);
  fs.mkdirSync(OUT, { recursive: true });

  const app = await electron.launch({
    args: [path.join(__dirname, '..', 'electron', 'main.js')],
    slowMo: Number(process.env.STUDIO_SLOWMO) || 700,
  });
  const win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');
  await expect(win.locator('.workbench-current .workbench-name'))
    .toHaveText('ArchDisc Studio', { timeout: 30000 });
  await expect(win.locator('canvas').first()).toBeVisible({ timeout: 60000 });
  await win.waitForFunction(() => !!window.__archdiscViewport, null, { timeout: 30000 });
  await win.waitForFunction(() => typeof window.__studioMirrorAcrossAxis === 'function', null, { timeout: 30000 });
  await win.waitForTimeout(800);

  // Spawn + offset a cube so the mirror is visibly distinct.
  await win.locator('[data-studio-primitive="cube"]').click();
  await win.waitForTimeout(400);
  const srcUuid = await win.evaluate(() => {
    let m = null;
    window.__archdiscScene.traverse((o) => { if (o.userData && o.userData.archdiscStudioPrimitiveKind === 'cube') m = o; });
    m.position.set(0.5, 0, 0); m.scale.set(4, 4, 4);
    if (window.__studioSelectMesh) window.__studioSelectMesh(m);
    return m.uuid;
  });
  expect(srcUuid).toBeTruthy();
  await win.waitForTimeout(300);

  const r = await win.evaluate(() => window.__studioMirrorAcrossAxis('x'));
  expect(r.ok).toBe(true);
  expect(r.axis).toBe('x');
  expect(r.sourceUuid).toBe(srcUuid);

  const probe = await win.evaluate(({ u }) => {
    let m = null;
    window.__archdiscScene.traverse((o) => { if (o.uuid === u) m = o; });
    return m ? {
      sx: m.scale.x, sy: m.scale.y, sz: m.scale.z,
      px: m.position.x, py: m.position.y, pz: m.position.z,
      stamp: m.userData.archdiscStudioMirrorOf,
    } : null;
  }, { u: r.uuid });
  expect(probe).toBeTruthy();
  // Mirror clone has X scale negated.
  expect(probe.sx).toBeCloseTo(-4, 5);
  expect(probe.sy).toBeCloseTo(4, 5);
  expect(probe.sz).toBeCloseTo(4, 5);
  // Position is the same (the flip lives in scale, not position).
  expect(probe.px).toBeCloseTo(0.5, 5);
  expect(probe.stamp).toBe(srcUuid);

  // Bad axis rejected.
  const bad = await win.evaluate(() => window.__studioMirrorAcrossAxis('q'));
  expect(bad.ok).toBe(false);

  await win.screenshot({ path: path.join(OUT, '00.png') });
  await win.waitForTimeout(1500);

  // eslint-disable-next-line no-console
  console.log('  slice 312: mirror across X — clone scale=', probe.sx, probe.sy, probe.sz);

  await app.close();
});
