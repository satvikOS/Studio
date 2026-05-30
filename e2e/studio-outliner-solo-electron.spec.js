import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

/*
 * Studio — Slice 237: per-Outliner-entry solo button.
 * Headed Mac Electron.
 */

const OUT = path.resolve(__dirname, 'screenshots', 'studio-outliner-solo');

test('Studio — Outliner solo button isolates that mesh', async () => {
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
      goal: 'solo demo',
      scene: { discipline: 'modeling' },
      bodies: [
        { kind: 'cube',         pos: [-0.07, 0, 0], scale: [1, 1, 1], color: '#9ab' },
        { kind: 'sphere',       pos: [ 0,    0, 0], scale: [1, 1, 1], color: '#c9a' },
        { kind: 'icosahedron',  pos: [ 0.07, 0, 0], scale: [1, 1, 1], color: '#ac9' },
      ],
      expect: { bodies: 3, kinds: ['cube', 'icosahedron', 'sphere'] },
    };
    window.__archieEngine.skillStore.save(r.goal, r, 1.0);
    return window.__archieRun({ goals: [r.goal], maxGoals: 1 });
  });
  await win.waitForTimeout(700);

  // Click the solo button on the sphere row.
  await win.evaluate(() => {
    const row = document.querySelector('[data-studio-outliner-kind="sphere"]');
    const solo = row && row.querySelector('[data-studio-outliner-solo]');
    if (solo) solo.click();
  });
  await win.waitForTimeout(300);
  const vis = await win.evaluate(() => {
    const out = {};
    window.__archdiscScene.traverse((o) => {
      if (o.userData && o.userData.archdiscStudioPrimitive) {
        out[o.userData.archdiscStudioPrimitiveKind] = o.visible;
      }
    });
    return out;
  });
  expect(vis.sphere, 'sphere visible').toBe(true);
  expect(vis.cube, 'cube hidden').toBe(false);
  expect(vis.icosahedron, 'icosahedron hidden').toBe(false);
  await win.screenshot({ path: path.join(OUT, '00-solo.png') });
  await win.waitForTimeout(2500);

  // eslint-disable-next-line no-console
  console.log('  slice 237: outliner solo working');

  await app.close();
});
