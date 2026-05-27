import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

/*
 * Slice 71 — Viewport right-click context menu.
 *
 * Right-click on a Studio primitive opens a small menu pinned to the
 * cursor with: Duplicate / Subdivide / Shading→Smooth / Shading→Flat
 * / Delete. Right-click on empty viewport shows: Add Cube / Sphere /
 * Suzanne. Click-outside or click-on-action closes the menu.
 */

const OUT = path.resolve(__dirname, 'screenshots', 'studio-context-menu');

async function selectByKind(win, kind) {
  await win.evaluate((k) => {
    const vp = window.__archdiscViewport;
    let m = null;
    vp.scene.traverse(o => { if (o.userData && o.userData.archdiscStudioPrimitiveKind === k) m = o; });
    if (m && window.__studioSelectMesh) window.__studioSelectMesh(m);
  }, kind);
}

test('Studio context menu — right-click opens Duplicate / Subdivide / Delete', async () => {
  test.setTimeout(120000);
  fs.mkdirSync(OUT, { recursive: true });

  const app = await electron.launch({
    args: [path.join(__dirname, '..', 'electron', 'main.js')],
    slowMo: 250,
  });

  const win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');
  await expect(win.locator('.workbench-current .workbench-name')).toHaveText('ArchDisc Studio', { timeout: 30000 });
  await expect(win.locator('canvas').first()).toBeVisible({ timeout: 60000 });
  await win.waitForFunction(() => !!window.__archdiscViewport, null, { timeout: 30000 });
  await win.waitForTimeout(800);

  // Stage a cube so we can right-click on it.
  await win.locator('[data-studio-primitive="cube"]').click();
  await win.waitForTimeout(300);

  // Project the cube's world center to screen pixels so we can right-click
  // EXACTLY on it.
  const clickPt = await win.evaluate(() => {
    const vp = window.__archdiscViewport;
    let m = null;
    vp.scene.traverse(o => { if (o.userData && o.userData.archdiscStudioPrimitiveKind === 'cube') m = o; });
    if (!m) return null;
    const rect = vp.renderer.domElement.getBoundingClientRect();
    const v = m.position.clone().project(vp.camera);
    return {
      x: (v.x + 1) / 2 * rect.width + rect.left,
      y: (-v.y + 1) / 2 * rect.height + rect.top,
    };
  });
  expect(clickPt).not.toBeNull();

  // Right-click the cube.
  await win.mouse.click(clickPt.x, clickPt.y, { button: 'right' });
  await win.waitForTimeout(300);
  await expect(win.locator('[data-studio-context-menu]')).toBeVisible();
  // Selected cube should be reflected in selection kind.
  await expect(win.locator('[data-studio-selection="kind"]')).toHaveText('cube');
  await win.screenshot({ path: path.join(OUT, '01-menu-on-cube.png'), fullPage: false });

  // Click Duplicate — expect 2 cubes (1 original + 1 duplicate).
  await win.locator('[data-studio-context-action="duplicate"]').click();
  await win.waitForTimeout(400);
  await expect(win.locator('[data-studio-context-menu]')).toHaveCount(0);
  const cubes = await win.evaluate(() => {
    const vp = window.__archdiscViewport;
    let count = 0;
    vp.scene.traverse(o => {
      if (o.userData && o.userData.archdiscStudioPrimitive &&
          (o.userData.archdiscStudioPrimitiveKind === 'cube' ||
           o.userData.archdiscStudioPrimitiveKind === 'cube-dup')) count++;
    });
    return count;
  });
  expect(cubes).toBe(2);
  await win.screenshot({ path: path.join(OUT, '02-after-duplicate.png'), fullPage: false });

  // Right-click the duplicated cube — verify menu reopens (state cycling).
  // Re-project the FIRST cube's position so we know we hit it.
  const clickPt2 = await win.evaluate(() => {
    const vp = window.__archdiscViewport;
    let m = null;
    vp.scene.traverse(o => { if (o.userData && o.userData.archdiscStudioPrimitiveKind === 'cube') m = o; });
    if (!m) return null;
    const rect = vp.renderer.domElement.getBoundingClientRect();
    const v = m.position.clone().project(vp.camera);
    return {
      x: (v.x + 1) / 2 * rect.width + rect.left,
      y: (-v.y + 1) / 2 * rect.height + rect.top,
    };
  });
  await win.mouse.click(clickPt2.x, clickPt2.y, { button: 'right' });
  await win.waitForTimeout(400);
  await expect(win.locator('[data-studio-context-menu]')).toBeVisible();
  await expect(win.locator('[data-studio-context-action="delete"]')).toBeVisible();
  await win.screenshot({ path: path.join(OUT, '03-menu-on-second-cube.png'), fullPage: false });

  // Click Delete — verify the cube is gone.
  await win.locator('[data-studio-context-action="delete"]').click();
  await win.waitForTimeout(400);
  const remaining = await win.evaluate(() => {
    const vp = window.__archdiscViewport;
    let n = 0;
    vp.scene.traverse(o => {
      if (o.userData && o.userData.archdiscStudioPrimitive &&
          (o.userData.archdiscStudioPrimitiveKind === 'cube' ||
           o.userData.archdiscStudioPrimitiveKind === 'cube-dup')) n++;
    });
    return n;
  });
  expect(remaining).toBe(1);  // one cube was deleted

  // eslint-disable-next-line no-console
  console.log(`  context menu: right-click cube -> duplicate (2 cubes) -> delete one (1 cube); menu cycles state correctly`);

  await app.close();
});
