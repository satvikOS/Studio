import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

/*
 * Slice 12 — Particles / VFX discipline: THREE.Points particle clouds.
 *
 * The right-panel Particles / VFX section takes a count + size, and
 * Spawn Particle Cloud drops a colored THREE.Points distribution
 * (uniform in a sphere, warm vertex colors) into the scene as a
 * Studio primitive. The cloud counts in Mesh stats and can be
 * Cleared / Deleted just like the regular meshes.
 */

const OUT = path.resolve(__dirname, 'screenshots', 'studio-particles');

test('Studio particles — Spawn Particle Cloud drops a colored Points cloud', async () => {
  fs.mkdirSync(OUT, { recursive: true });

  const app = await electron.launch({
    args: [path.join(__dirname, '..', 'electron', 'main.js')],
    slowMo: 300,
  });

  const win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');
  await expect(win.locator('.workbench-current .workbench-name')).toHaveText('ArchDisc Studio', { timeout: 30000 });
  await expect(win.locator('canvas').first()).toBeVisible({ timeout: 60000 });
  await win.waitForFunction(() => !!window.__archdiscViewport, null, { timeout: 30000 });
  await win.waitForTimeout(800);

  // ---- Particles panel visible, defaults populated ----
  await expect(win.locator('[data-studio-section="particles"]')).toBeVisible();
  await expect(win.locator('[data-studio-particles-readout="count"]')).toHaveText('800');
  await win.screenshot({ path: path.join(OUT, '00-particles-panel-default.png'), fullPage: false });

  // ---- Spawn at default 800 particles ----
  await win.locator('[data-studio-action="spawn-particles"]').click();
  await win.waitForTimeout(500);
  await expect(win.locator('[data-studio-primitive-count]')).toHaveText('1 primitive in scene');

  const cloud0 = await win.evaluate(() => {
    const vp = window.__archdiscViewport;
    let pts = null;
    vp.scene.traverse(o => {
      if (o.userData && o.userData.archdiscStudioPrimitiveKind === 'particles') pts = o;
    });
    if (!pts) return null;
    return {
      isPoints: !!pts.isPoints,
      vCount: pts.geometry.attributes.position.count,
      hasColor: !!pts.geometry.attributes.color,
      colorEntries: pts.geometry.attributes.color ? pts.geometry.attributes.color.count : 0,
    };
  });
  expect(cloud0).not.toBeNull();
  expect(cloud0.isPoints).toBe(true);
  expect(cloud0.vCount).toBe(800);
  expect(cloud0.hasColor).toBe(true);
  expect(cloud0.colorEntries).toBe(800);

  await win.evaluate(() => window.__archdiscOrbitView && window.__archdiscOrbitView(30, 25, 1));
  await win.waitForTimeout(300);
  await win.screenshot({ path: path.join(OUT, '01-cloud-800-az30.png'), fullPage: false });

  // ---- Bump count to 3000, slightly larger size, spawn again ----
  await win.locator('[data-studio-particles="count"]').fill('3000');
  await win.dispatchEvent('[data-studio-particles="count"]', 'input');
  await win.locator('[data-studio-particles="size"]').fill('0.003');
  await win.dispatchEvent('[data-studio-particles="size"]', 'input');
  await expect(win.locator('[data-studio-particles-readout="count"]')).toHaveText('3000');
  await expect(win.locator('[data-studio-particles-readout="size"]')).toHaveText('3.00 mm');

  await win.locator('[data-studio-action="spawn-particles"]').click();
  await win.waitForTimeout(500);
  await expect(win.locator('[data-studio-primitive-count]')).toHaveText('2 primitives in scene');

  const cloud1Total = await win.evaluate(() => {
    const vp = window.__archdiscViewport;
    let total = 0;
    vp.scene.traverse(o => {
      if (o.userData && o.userData.archdiscStudioPrimitiveKind === 'particles') {
        total += o.geometry.attributes.position.count;
      }
    });
    return total;
  });
  expect(cloud1Total).toBe(800 + 3000);

  await win.evaluate(() => window.__archdiscOrbitView && window.__archdiscOrbitView(135, 30, 1));
  await win.waitForTimeout(300);
  await win.screenshot({ path: path.join(OUT, '02-two-clouds-az135.png'), fullPage: false });
  await win.evaluate(() => window.__archdiscOrbitView && window.__archdiscOrbitView(225, 30, 1));
  await win.waitForTimeout(300);
  await win.screenshot({ path: path.join(OUT, '03-two-clouds-az225.png'), fullPage: false });

  // ---- Clear Scene wipes the clouds too (they're regular Studio primitives). ----
  await win.locator('[data-studio-action="clear-scene"]').click();
  await win.waitForTimeout(400);
  await expect(win.locator('[data-studio-primitive-count]')).toHaveText('0 primitives in scene');
  await win.screenshot({ path: path.join(OUT, '04-cleared.png'), fullPage: false });

  // eslint-disable-next-line no-console
  console.log(`  particles: 800 → +3000 (total 3800 vertices across 2 clouds) → cleared`);

  await app.close();
});
