import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-outliner-visibility');

test('Studio — Outliner visibility icon reflects state (slice 320)', async () => {
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
  await win.waitForTimeout(800);

  await win.locator('[data-studio-primitive="cube"]').click();
  await win.waitForTimeout(400);
  const uuid = await win.evaluate(() => window.__studioSelectedMesh().uuid);

  const eyeSel = `[data-studio-outliner-visibility="${uuid}"]`;
  await expect(win.locator(eyeSel)).toBeVisible();
  // Initially visible.
  await expect(win.locator(eyeSel)).toHaveAttribute('data-studio-outliner-visibility-state', 'visible');

  // Click → hidden.
  await win.locator(eyeSel).click();
  await win.waitForTimeout(300);
  await expect(win.locator(eyeSel)).toHaveAttribute('data-studio-outliner-visibility-state', 'hidden');
  const meshHidden = await win.evaluate(({ u }) => {
    let m = null;
    window.__archdiscScene.traverse((o) => { if (o.uuid === u) m = o; });
    return m && m.visible === false;
  }, { u: uuid });
  expect(meshHidden).toBe(true);

  // Click again → visible.
  await win.locator(eyeSel).click();
  await win.waitForTimeout(300);
  await expect(win.locator(eyeSel)).toHaveAttribute('data-studio-outliner-visibility-state', 'visible');
  const meshShown = await win.evaluate(({ u }) => {
    let m = null;
    window.__archdiscScene.traverse((o) => { if (o.uuid === u) m = o; });
    return m && m.visible === true;
  }, { u: uuid });
  expect(meshShown).toBe(true);

  await win.screenshot({ path: path.join(OUT, '00.png') });
  await win.waitForTimeout(1500);

  // eslint-disable-next-line no-console
  console.log('  slice 320: outliner visibility icon flips on/off correctly');

  await app.close();
});
