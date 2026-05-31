import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-v3-spawn');

test('Studio V3 — toolbar Add group spawns into scene (slice 395)', async () => {
  test.setTimeout(180000);
  fs.mkdirSync(OUT, { recursive: true });

  const app = await electron.launch({
    args: [path.join(__dirname, '..', 'electron', 'main.js')],
    slowMo: Number(process.env.STUDIO_SLOWMO) || 500,
  });
  const win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');

  // Bootstrap V3.
  await win.evaluate(() => {
    window.localStorage.setItem('studioV3', '1');
    window.localStorage.removeItem('studio.v3.theme');
    window.localStorage.removeItem('studio.v3.wb');
  });
  await win.reload();
  await win.waitForLoadState('domcontentloaded');
  await expect(win.locator('[data-studio-v3-shell]')).toBeVisible({ timeout: 15000 });
  await win.waitForFunction(() => !!window.__archdiscScene, null, { timeout: 15000 });

  const countPrims = () => win.evaluate(() => {
    let n = 0;
    if (window.__archdiscScene) window.__archdiscScene.traverse((o) => {
      if (o.userData && o.userData.archdiscStudioPrimitive) n++;
    });
    return n;
  });

  // Empty scene.
  expect(await countPrims()).toBe(0);

  // Click Cube in the Add toolbar group.
  await win.locator('[data-studio-v3-tool="cube"][data-studio-v3-tool-group="add"]').click();
  await win.waitForTimeout(300);
  expect(await countPrims()).toBe(1);

  // Sphere.
  await win.locator('[data-studio-v3-tool="sphere"][data-studio-v3-tool-group="add"]').click();
  await win.waitForTimeout(300);
  expect(await countPrims()).toBe(2);

  // Cone.
  await win.locator('[data-studio-v3-tool="cone"][data-studio-v3-tool-group="add"]').click();
  await win.waitForTimeout(300);
  expect(await countPrims()).toBe(3);

  // Switch right panel to Outliner tab; reflects the 3 spawned items.
  await win.locator('[data-studio-v3-right-tab="outliner"]').click();
  await expect(win.locator('[data-studio-v3-outliner-item]')).toHaveCount(3, { timeout: 5000 });

  // Status bar live prim count climbs (poll on a tick).
  await win.waitForTimeout(700);
  await expect(win.locator('[data-studio-v3-status="primitives"]')).toContainText('3 prim');

  // Transform tools STAY toggleable — don't spawn anything.
  await win.locator('[data-studio-v3-tool="move"][data-studio-v3-tool-group="transform"]').click();
  expect(await countPrims()).toBe(3);
  await expect(win.locator('[data-studio-v3-tool="move"]'))
    .toHaveAttribute('data-active', 'true');

  await win.screenshot({ path: path.join(OUT, '00-3-primitives.png') });

  // Reset.
  await win.evaluate(() => {
    window.localStorage.removeItem('studioV3');
    window.localStorage.removeItem('studio.v3.theme');
    window.localStorage.removeItem('studio.v3.wb');
  });

  // eslint-disable-next-line no-console
  console.log('  slice 395: V3 toolbar spawns 3 primitives, outliner + status reflect');

  await app.close();
});
