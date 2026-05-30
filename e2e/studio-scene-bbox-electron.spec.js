import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-scene-bbox');

test('Studio — N-panel View shows scene bbox (slice 265)', async () => {
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
  await expect(win.locator('[data-studio-npanel-scene-bbox]')).toHaveText('–');

  await win.waitForFunction(() => typeof window.__archieRun === 'function', null, { timeout: 30000 });
  await win.evaluate(() => {
    const r = {
      goal: 'scene bbox demo',
      scene: { discipline: 'modeling' },
      bodies: [
        { kind: 'cube',   pos: [-0.08, 0, 0], scale: [3, 3, 3], color: '#9ab' },
        { kind: 'sphere', pos: [ 0.08, 0, 0], scale: [3, 3, 3], color: '#c9a' },
      ],
      expect: { bodies: 2, kinds: ['cube', 'sphere'] },
    };
    window.__archieEngine.skillStore.save(r.goal, r, 1.0);
    return window.__archieRun({ goals: [r.goal], maxGoals: 1 });
  });
  await win.waitForTimeout(700);
  // Force re-render of N-panel content.
  await win.evaluate(() => document.querySelector('[data-studio-npanel-tab-button="Item"]').click());
  await win.evaluate(() => document.querySelector('[data-studio-npanel-tab-button="View"]').click());
  await win.waitForTimeout(300);

  const txt = await win.locator('[data-studio-npanel-scene-bbox]').textContent();
  expect(txt, 'scene bbox text').toMatch(/^\d+\.\d{2} × \d+\.\d{2} × \d+\.\d{2}$/);
  await win.screenshot({ path: path.join(OUT, '00.png') });
  await win.waitForTimeout(2500);

  // eslint-disable-next-line no-console
  console.log('  slice 265: scene bbox =', txt);

  await app.close();
});
