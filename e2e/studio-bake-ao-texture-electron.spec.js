import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-bake-ao-texture');

test('Studio — bake AO to texture map (Substance/Mari workflow) (slice 284)', async () => {
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
  await win.waitForTimeout(1500);

  await win.waitForFunction(() => typeof window.__archieRun === 'function', null, { timeout: 30000 });
  await win.evaluate(() => {
    const r = {
      goal: 'bake ao texture demo',
      scene: { discipline: 'modeling' },
      bodies: [{ kind: 'cube', pos: [0, 0, 0], scale: [4, 4, 4], color: '#cad' }],
      expect: { bodies: 1, kinds: ['cube'] },
    };
    window.__archieEngine.skillStore.save(r.goal, r, 1.0);
    return window.__archieRun({ goals: [r.goal], maxGoals: 1 });
  });
  await win.waitForTimeout(700);
  await win.evaluate(() => {
    let m = null;
    window.__archdiscScene.traverse((o) => { if (o.userData && o.userData.archdiscStudioPrimitiveKind === 'cube') m = o; });
    if (m && window.__studioSelectMesh) window.__studioSelectMesh(m);
  });
  await win.waitForTimeout(400);

  // Bake 32×32 with 4 rays so the spec completes quickly.
  const res = await win.evaluate(() => window.__studioBakeAOToTexture(32, 4));
  expect(res).toBeTruthy();
  expect(res.ok).toBe(true);
  expect(res.size).toBe(32);
  expect(res.pixelsCovered).toBeGreaterThan(0);
  expect(res.mean).toBeGreaterThanOrEqual(0);
  expect(res.mean).toBeLessThanOrEqual(1);

  // The aoMap canvas should have non-empty pixel data.
  const probe = await win.evaluate(() => {
    const m = window.__studioSelectedMesh();
    if (!m.material.aoMap) return null;
    const c = m.material.aoMap.image;
    const ctx = c.getContext('2d');
    const d = ctx.getImageData(0, 0, c.width, c.height).data;
    let nonZero = 0; for (let i = 0; i < d.length; i += 4) if (d[i] > 0) nonZero++;
    return { w: c.width, h: c.height, nonZero, baked: m.userData.archdiscStudioBakedTexture };
  });
  expect(probe.w).toBe(32);
  expect(probe.h).toBe(32);
  expect(probe.nonZero).toBeGreaterThan(0);
  expect(probe.baked).toBe('ao');

  await win.screenshot({ path: path.join(OUT, '00.png') });
  await win.waitForTimeout(2500);

  // eslint-disable-next-line no-console
  console.log('  slice 284: AO texture bake size=', res.size, 'rays=', res.rays, 'covered=', res.pixelsCovered, 'mean=', res.mean.toFixed(3));

  await app.close();
});
