import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

/*
 * Studio — Slice 253: scene-wide triangle count in N-panel View tab.
 * Headed Mac Electron.
 */

const OUT = path.resolve(__dirname, 'screenshots', 'studio-scene-triangles');

test('Studio — N-panel triangle counter grows as scene populates', async () => {
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

  await win.evaluate(() => document.querySelector('[data-studio-npanel-tab-button="View"]').click());
  await win.waitForTimeout(300);
  const emptyTris = parseInt((await win.locator('[data-studio-npanel-triangles]').textContent()).replace(/,/g, ''), 10);

  // Spawn a viewer-dominant teapot.
  await win.waitForFunction(() => typeof window.__archieRun === 'function', null, { timeout: 30000 });
  await win.evaluate(() => {
    const r = {
      goal: 'tri count demo',
      scene: { discipline: 'modeling' },
      bodies: [{ kind: 'teapot', pos: [0, 0, 0], scale: [4, 4, 4], color: '#bfa14a' }],
      expect: { bodies: 1, kinds: ['teapot'] },
    };
    window.__archieEngine.skillStore.save(r.goal, r, 1.0);
    return window.__archieRun({ goals: [r.goal], maxGoals: 1 });
  });
  await win.waitForTimeout(700);
  await win.evaluate(() => document.querySelector('[data-studio-npanel-tab-button="View"]').click());
  await win.waitForTimeout(500);

  const populated = parseInt((await win.locator('[data-studio-npanel-triangles]').textContent()).replace(/,/g, ''), 10);
  expect(populated, 'triangle count grew').toBeGreaterThan(emptyTris);
  await win.screenshot({ path: path.join(OUT, '00-triangles.png') });
  await win.waitForTimeout(2500);

  // eslint-disable-next-line no-console
  console.log('  slice 253: scene triangles went from', emptyTris, 'to', populated);

  await app.close();
});
