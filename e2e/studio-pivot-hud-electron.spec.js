import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

/*
 * Studio — Slice 248: pivot-mode HUD in viewport center-bottom.
 * Headed Mac Electron — body scaled large so it dominates the viewer's
 * perception per the scale-to-viewer rule.
 */

const OUT = path.resolve(__dirname, 'screenshots', 'studio-pivot-hud');

test('Studio — pivot HUD updates as . cycles modes', async () => {
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

  // Build a teapot scaled 4x so it actually fills the viewport — the
  // scale-to-viewer rule for remote-desktop visibility.
  await win.waitForFunction(() => typeof window.__archieRun === 'function', null, { timeout: 30000 });
  await win.evaluate(() => {
    const r = {
      goal: 'pivot hud demo',
      scene: { discipline: 'modeling' },
      bodies: [{ kind: 'teapot', pos: [0, 0, 0], scale: [4, 4, 4], color: '#bfa14a' }],
      expect: { bodies: 1, kinds: ['teapot'] },
    };
    window.__archieEngine.skillStore.save(r.goal, r, 1.0);
    return window.__archieRun({ goals: [r.goal], maxGoals: 1 });
  });
  await win.waitForTimeout(700);
  await win.evaluate(() => { if (window.__studioFrameAll) window.__studioFrameAll(); });
  await win.waitForTimeout(400);

  await expect(win.locator('[data-studio-viewport-pivot-hud]')).toBeVisible();
  await expect(win.locator('[data-studio-viewport-pivot-mode]')).toHaveText('median');

  await win.evaluate(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: '.', bubbles: true })));
  await win.waitForTimeout(300);
  await expect(win.locator('[data-studio-viewport-pivot-mode]')).toHaveText('individual');
  await win.screenshot({ path: path.join(OUT, '00-individual.png') });

  await win.evaluate(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: '.', bubbles: true })));
  await win.waitForTimeout(300);
  await expect(win.locator('[data-studio-viewport-pivot-mode]')).toHaveText('cursor');
  await win.screenshot({ path: path.join(OUT, '01-cursor.png') });
  await win.waitForTimeout(2500);

  // eslint-disable-next-line no-console
  console.log('  slice 248: pivot HUD live, teapot dominates viewport');

  await app.close();
});
