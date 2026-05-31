import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-title-selected');

test('Studio — title HUD shows N selected badge (slice 277)', async () => {
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

  // No selection — badge absent.
  await expect(win.locator('[data-studio-viewport-title-selected]')).toHaveCount(0);

  await win.waitForFunction(() => typeof window.__archieRun === 'function', null, { timeout: 30000 });
  await win.evaluate(() => {
    const r = {
      goal: 'title sel demo',
      scene: { discipline: 'modeling' },
      bodies: [
        { kind: 'cube',   pos: [-0.07, 0, 0], scale: [3, 3, 3], color: '#9ab' },
        { kind: 'sphere', pos: [ 0.07, 0, 0], scale: [3, 3, 3], color: '#c9a' },
      ],
      expect: { bodies: 2, kinds: ['cube', 'sphere'] },
    };
    window.__archieEngine.skillStore.save(r.goal, r, 1.0);
    return window.__archieRun({ goals: [r.goal], maxGoals: 1 });
  });
  await win.waitForTimeout(700);

  // Ctrl+A selects all → badge shows "2 selected".
  await win.evaluate(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', ctrlKey: true, bubbles: true })));
  await win.waitForTimeout(300);
  await expect(win.locator('[data-studio-viewport-title-selected]')).toHaveText('2 selected');
  await win.screenshot({ path: path.join(OUT, '00.png') });
  await win.waitForTimeout(2500);

  // eslint-disable-next-line no-console
  console.log('  slice 277: selected badge shows "2 selected"');

  await app.close();
});
