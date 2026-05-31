import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-smart-material');

test('Studio — Substance smart-material preset (slice 308)', async () => {
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
  await win.waitForFunction(() => typeof window.__studioApplySmartMaterial === 'function', null, { timeout: 30000 });
  await win.waitForTimeout(800);

  await win.locator('[data-studio-primitive="cube"]').click();
  await win.waitForTimeout(400);

  const r = await win.evaluate(() => window.__studioApplySmartMaterial('rust'));
  expect(r.ok).toBe(true);
  expect(r.preset).toBe('rust');
  expect(r.map).toBe(true);
  expect(r.rough).toBe(true);
  expect(r.ao).toBe(true);

  const probe = await win.evaluate(() => {
    const m = window.__studioSelectedMesh();
    return {
      hasMap: !!m.material.map,
      hasRough: !!m.material.roughnessMap,
      hasAO: !!m.material.aoMap,
      met: m.material.metalness,
      stamp: m.userData.archdiscStudioSmartMat,
    };
  });
  expect(probe.hasMap).toBe(true);
  expect(probe.hasRough).toBe(true);
  expect(probe.hasAO).toBe(true);
  expect(probe.met).toBeCloseTo(0.65, 5);
  expect(probe.stamp).toBe('rust');

  await win.screenshot({ path: path.join(OUT, '00-rust.png') });
  await win.waitForTimeout(400);

  const bad = await win.evaluate(() => window.__studioApplySmartMaterial('unknown'));
  expect(bad.ok).toBe(false);

  await win.waitForTimeout(1500);

  // eslint-disable-next-line no-console
  console.log('  slice 308: smart-material "rust" applied — map/rough/ao all bound; metalness=0.65');

  await app.close();
});
