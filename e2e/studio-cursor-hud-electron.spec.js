import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-cursor-hud');

test('Studio — cursor-in-world HUD updates as pointer moves (slice 269)', async () => {
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

  // Dispatch a pointermove on the canvas at its center.
  await win.evaluate(() => {
    const cv = window.__archdiscViewport.renderer.domElement;
    const r = cv.getBoundingClientRect();
    cv.dispatchEvent(new PointerEvent('pointermove', {
      clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, bubbles: true,
    }));
  });
  await win.waitForTimeout(300);

  const txt = await win.locator('[data-studio-viewport-cursor-hud]').textContent();
  expect(txt, 'hud updated').not.toBe('cursor: –');
  expect(txt).toMatch(/^-?\d+\.\d{3} -?\d+\.\d{3} -?\d+\.\d{3}$/);
  const w = await win.evaluate(() => window.__studioCursorWorld);
  expect(w).toHaveLength(3);
  await win.screenshot({ path: path.join(OUT, '00.png') });
  await win.waitForTimeout(2500);

  // eslint-disable-next-line no-console
  console.log('  slice 269: cursor world =', txt);

  await app.close();
});
