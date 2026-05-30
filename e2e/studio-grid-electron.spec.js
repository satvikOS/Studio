import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

/*
 * Studio — Slice 203: BLENDER-STYLE GROUND GRID.
 *
 * GridHelper at world origin — every DCC tool ships one for scale +
 * horizon orientation (Blender, Maya, 3ds Max, Cinema 4D, Houdini,
 * ZBrush). Exposed as window.__studioGrid + window.__studioSetGridVisible
 * so e2e + AI can toggle.
 *
 * Headed Mac Electron.
 */

const OUT = path.resolve(__dirname, 'screenshots', 'studio-grid');

test('Studio — ground grid present + toggleable', async () => {
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
  await win.waitForFunction(() => !!window.__studioGrid, null, { timeout: 30000 });
  await win.waitForTimeout(1500);

  const initial = await win.evaluate(() => ({
    type: window.__studioGrid && window.__studioGrid.type,
    visible: window.__studioGrid && window.__studioGrid.visible,
    tagged: !!(window.__studioGrid && window.__studioGrid.userData && window.__studioGrid.userData.archdiscStudioGrid),
  }));
  expect(initial.type, 'grid is a GridHelper / LineSegments').toMatch(/LineSegments|GridHelper/);
  expect(initial.visible, 'grid visible by default').toBe(true);
  expect(initial.tagged, 'grid tagged').toBe(true);
  await win.screenshot({ path: path.join(OUT, '00-grid-visible.png') });
  await win.waitForTimeout(700);

  // Toggle off.
  await win.evaluate(() => window.__studioSetGridVisible(false));
  await win.waitForTimeout(300);
  const offVisible = await win.evaluate(() => window.__studioGrid.visible);
  expect(offVisible, 'grid hidden').toBe(false);
  await win.screenshot({ path: path.join(OUT, '01-grid-hidden.png') });
  await win.waitForTimeout(700);

  // Toggle back on.
  await win.evaluate(() => window.__studioSetGridVisible(true));
  await win.waitForTimeout(300);
  const onVisible = await win.evaluate(() => window.__studioGrid.visible);
  expect(onVisible, 'grid back on').toBe(true);
  await win.screenshot({ path: path.join(OUT, '02-grid-back.png') });
  await win.waitForTimeout(2500);

  // eslint-disable-next-line no-console
  console.log('  slice 203: ground grid present + toggleable end-to-end');

  await app.close();
});
