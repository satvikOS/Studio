import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-cursor-readout');

test('Studio — N-panel 3D cursor readout + reset button (slice 276)', async () => {
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
  await win.waitForFunction(() => typeof window.__studioSetCursor === 'function', null, { timeout: 30000 });
  await win.waitForTimeout(1500);

  await win.evaluate(() => document.querySelector('[data-studio-npanel-tab-button="View"]').click());
  await win.waitForTimeout(300);

  // Move cursor, force a re-render by selecting a body.
  await win.evaluate(() => window.__studioSetCursor([0.21, 0.05, -0.07]));
  await win.waitForFunction(() => typeof window.__archieRun === 'function', null, { timeout: 30000 });
  await win.evaluate(() => {
    const r = {
      goal: 'cursor readout demo',
      scene: { discipline: 'modeling' },
      bodies: [{ kind: 'cube', pos: [0, 0, 0], scale: [4, 4, 4], color: '#9ab' }],
      expect: { bodies: 1, kinds: ['cube'] },
    };
    window.__archieEngine.skillStore.save(r.goal, r, 1.0);
    return window.__archieRun({ goals: [r.goal], maxGoals: 1 });
  });
  await win.waitForTimeout(500);
  await win.evaluate(() => document.querySelector('[data-studio-npanel-tab-button="View"]').click());
  await win.waitForTimeout(300);

  const txt = await win.locator('[data-studio-npanel-cursor-pos]').textContent();
  expect(txt).toBe('0.21 0.05 -0.07');

  // Reset button → 0 0 0.
  await win.evaluate(() => document.querySelector('[data-studio-npanel-cursor-reset]').click());
  await win.waitForTimeout(300);
  expect(await win.evaluate(() => window.__studioGetCursor())).toEqual([0, 0, 0]);
  await win.screenshot({ path: path.join(OUT, '00.png') });
  await win.waitForTimeout(2500);

  // eslint-disable-next-line no-console
  console.log('  slice 276: cursor readout + reset button working');

  await app.close();
});
