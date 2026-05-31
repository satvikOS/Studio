import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-random-scatter');

test('Studio — Houdini Scatter / random clones in sphere (slice 354)', async () => {
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
  await win.waitForFunction(() => typeof window.__studioRandomScatter === 'function', null, { timeout: 30000 });
  await win.waitForTimeout(800);

  await win.locator('[data-studio-primitive="cube"]').click();
  await win.waitForTimeout(400);
  const srcUuid = await win.evaluate(() => window.__studioSelectedMesh().uuid);

  const r = await win.evaluate(() => window.__studioRandomScatter({ count: 8, radius: 0.12, seed: 42 }));
  expect(r.ok).toBe(true);
  expect(r.count).toBe(8);
  expect(r.created.length).toBe(8);

  // All 8 clones link back to source uuid.
  const linked = await win.evaluate(({ src }) => {
    let n = 0;
    window.__archdiscScene.traverse((o) => { if (o.userData && o.userData.archdiscStudioScatteredFrom === src) n++; });
    return n;
  }, { src: srcUuid });
  expect(linked).toBe(8);

  // Determinism: same seed → identical first clone position.
  const firstPosA = await win.evaluate(({ id }) => {
    let m = null;
    window.__archdiscScene.traverse((o) => { if (o.uuid === id) m = o; });
    return [m.position.x, m.position.y, m.position.z];
  }, { id: r.created[0] });
  const r2 = await win.evaluate(() => window.__studioRandomScatter({ count: 1, radius: 0.12, seed: 42 }));
  const firstPosB = await win.evaluate(({ id }) => {
    let m = null;
    window.__archdiscScene.traverse((o) => { if (o.uuid === id) m = o; });
    return [m.position.x, m.position.y, m.position.z];
  }, { id: r2.created[0] });
  // Same seed + same source position → same offset → same world pos.
  expect(firstPosA[0]).toBeCloseTo(firstPosB[0], 6);
  expect(firstPosA[1]).toBeCloseTo(firstPosB[1], 6);
  expect(firstPosA[2]).toBeCloseTo(firstPosB[2], 6);

  await win.screenshot({ path: path.join(OUT, '00.png') });
  await win.waitForTimeout(1500);

  // eslint-disable-next-line no-console
  console.log('  slice 354: scatter spawned 8 clones, deterministic seed reproduces');

  await app.close();
});
