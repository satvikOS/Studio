import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-v3-gizmo-toggle');

test('Studio V3 — Y toggles gizmo visibility (slice 484)', async () => {
  test.setTimeout(180000);
  fs.mkdirSync(OUT, { recursive: true });

  const app = await electron.launch({
    args: [path.join(__dirname, '..', 'electron', 'main.js')],
    slowMo: Number(process.env.STUDIO_SLOWMO) || 300,
  });
  const win = await app.firstWindow();
  win.on('dialog', (d) => { d.dismiss().catch(() => {}); });
  await win.waitForLoadState('domcontentloaded');

  await win.evaluate(() => {
    window.localStorage.setItem('studioV3', '1');
    window.localStorage.removeItem('studio.v3.theme');
    window.localStorage.removeItem('studio.v3.wb');
  });
  await win.reload();
  await win.waitForLoadState('domcontentloaded');
  await expect(win.locator('[data-studio-v3-shell]')).toBeVisible({ timeout: 15000 });
  await win.waitForTimeout(400);

  await win.evaluate(() => { if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); });

  // Spawn cube + select.
  await win.locator('[data-studio-v3-tool="cube"][data-studio-v3-tool-group="add"]').click();
  await win.waitForTimeout(300);

  // Normalise the initial state to true so the toggle test is deterministic.
  await win.evaluate(() => {
    const vp = window.__archdiscViewport;
    if (vp && vp.transformControls) vp.transformControls.visible = true;
  });

  await win.keyboard.press('y');
  await win.waitForTimeout(150);
  expect(await win.evaluate(() => window.__archdiscViewport.transformControls.visible)).toBe(false);

  await win.keyboard.press('y');
  await win.waitForTimeout(150);
  expect(await win.evaluate(() => window.__archdiscViewport.transformControls.visible)).toBe(true);

  await win.screenshot({ path: path.join(OUT, '00.png') });
  await win.waitForTimeout(500);

  // eslint-disable-next-line no-console
  console.log('  slice 484: Y toggles gizmo true → false → true');

  await win.evaluate(() => { window.__studioV3Dirty = false; window.onbeforeunload = null; });
  await app.close();
});
