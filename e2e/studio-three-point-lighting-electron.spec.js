import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

/*
 * Slice 41 — Three-Point Cinematic Lighting preset.
 *
 * One click drops a canonical key / fill / rim setup into the scene:
 *   - Warm key   (#ffb56b @ 2.4)
 *   - Cool fill  (#6bb5ff @ 1.6)
 *   - Magenta rim (#d469c4 @ 1.0)
 *
 * Clears any existing Studio lights first so the result is always
 * exactly three lights regardless of prior state.
 */

const OUT = path.resolve(__dirname, 'screenshots', 'studio-three-point-lighting');

async function lightSnapshot(win) {
  return await win.evaluate(() => {
    const vp = window.__archdiscViewport;
    const list = [];
    vp.scene.traverse(o => {
      if (o.userData && o.userData.archdiscStudioLight && o.isLight) {
        list.push({
          color:     '#' + o.color.getHexString(),
          intensity: o.intensity,
          position:  [
            +o.position.x.toFixed(4),
            +o.position.y.toFixed(4),
            +o.position.z.toFixed(4),
          ],
        });
      }
    });
    return list;
  });
}

test('Studio three-point cinematic preset — one click → key + fill + rim', async () => {
  fs.mkdirSync(OUT, { recursive: true });

  const app = await electron.launch({
    args: [path.join(__dirname, '..', 'electron', 'main.js')],
    slowMo: Number(process.env.STUDIO_SLOWMO) || 2200,
  });

  const win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');
  await expect(win.locator('.workbench-current .workbench-name')).toHaveText('ArchDisc Studio', { timeout: 30000 });
  await expect(win.locator('canvas').first()).toBeVisible({ timeout: 60000 });
  await win.waitForFunction(() => !!window.__archdiscViewport, null, { timeout: 30000 });
  await win.waitForTimeout(800);

  // Compose a small scene so the lights have something to light.
  for (const k of ['cube', 'sphere', 'suzanne']) {
    await win.locator(`[data-studio-primitive="${k}"]`).click();
    await win.waitForTimeout(200);
  }

  // Switch to Rendering tab (where the Cinematic Lighting section lives).
  await win.locator('.workbench-ribbon-placeholder-tab[data-studio-discipline="rendering"]').click();
  await win.waitForTimeout(300);
  await expect(win.locator('[data-studio-action="three-point-preset"]')).toBeVisible();

  // ---- Baseline: 0 lights ----
  await expect(win.locator('[data-studio-light-count]')).toHaveText('0 added');
  await win.screenshot({ path: path.join(OUT, '00-baseline.png'), fullPage: false });

  // ---- Apply 3-Point ----
  await win.locator('[data-studio-action="three-point-preset"]').click();
  await win.waitForTimeout(300);
  await expect(win.locator('[data-studio-light-count]')).toHaveText('3 added');
  const after3p = await lightSnapshot(win);
  expect(after3p).toHaveLength(3);
  // Colors match the preset values (lowercased).
  const colors = after3p.map(l => l.color.toLowerCase()).sort();
  expect(colors).toEqual(['#6bb5ff', '#d469c4', '#ffb56b']);
  // Intensities match the preset values.
  const intensities = after3p.map(l => l.intensity).sort((a, b) => a - b);
  expect(intensities[0]).toBeCloseTo(1.0, 2);
  expect(intensities[1]).toBeCloseTo(1.6, 2);
  expect(intensities[2]).toBeCloseTo(2.4, 2);
  // The three lights are at pair-wise distinct positions.
  const posSet = new Set(after3p.map(l => l.position.join('|')));
  expect(posSet.size).toBe(3);
  await win.screenshot({ path: path.join(OUT, '01-after-3-point.png'), fullPage: false });

  // ---- Add a manual extra light, then 3-Point again → still exactly 3 ----
  await win.locator('[data-studio-lighting="color"]').fill('#ffffff');
  await win.locator('[data-studio-action="add-light"]').click();
  await win.waitForTimeout(200);
  await expect(win.locator('[data-studio-light-count]')).toHaveText('4 added');

  await win.locator('[data-studio-action="three-point-preset"]').click();
  await win.waitForTimeout(300);
  await expect(win.locator('[data-studio-light-count]')).toHaveText('3 added');
  const re3p = await lightSnapshot(win);
  expect(re3p).toHaveLength(3);
  await win.screenshot({ path: path.join(OUT, '02-after-reapply.png'), fullPage: false });

  // eslint-disable-next-line no-console
  console.log(`  3-point lighting: ${after3p.length} lights, intensities ${intensities.join('/')}, idempotent under reapply`);

  await app.close();
});
