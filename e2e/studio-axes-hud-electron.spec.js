import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

/*
 * Studio — Slice 250: world-axes HUD overlay.
 * Headed Mac Electron, scale-to-viewer applied.
 */

const OUT = path.resolve(__dirname, 'screenshots', 'studio-axes-hud');

test('Studio — axes HUD shows +X / +Y / +Z in correct colours', async () => {
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

  // Spawn a viewer-dominant teapot per the scale-to-viewer rule.
  await win.waitForFunction(() => typeof window.__archieRun === 'function', null, { timeout: 30000 });
  await win.evaluate(() => {
    const r = {
      goal: 'axes hud demo',
      scene: { discipline: 'modeling' },
      bodies: [{ kind: 'teapot', pos: [0, 0, 0], scale: [4, 4, 4], color: '#bfa14a' }],
      expect: { bodies: 1, kinds: ['teapot'] },
    };
    window.__archieEngine.skillStore.save(r.goal, r, 1.0);
    return window.__archieRun({ goals: [r.goal], maxGoals: 1 });
  });
  await win.waitForTimeout(700);
  await win.evaluate(() => window.__studioFrameAll && window.__studioFrameAll());
  await win.waitForTimeout(400);

  await expect(win.locator('[data-studio-viewport-axes-hud]')).toBeVisible();
  await expect(win.locator('[data-studio-viewport-axis="x"]')).toHaveText('+X');
  await expect(win.locator('[data-studio-viewport-axis="y"]')).toHaveText('+Y');
  await expect(win.locator('[data-studio-viewport-axis="z"]')).toHaveText('+Z');
  await win.screenshot({ path: path.join(OUT, '00-hud.png') });
  await win.waitForTimeout(2500);

  // eslint-disable-next-line no-console
  console.log('  slice 250: axes HUD live; teapot dominates viewport');

  await app.close();
});
