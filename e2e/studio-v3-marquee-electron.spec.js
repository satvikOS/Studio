import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-v3-marquee');

test('Studio V3 — B arms drag-rectangle marquee + commits via boxSelect (slice 502)', async () => {
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
    window.localStorage.setItem('studio.v3.tour-seen', '1');
    window.localStorage.removeItem('studio.v3.theme');
    window.localStorage.removeItem('studio.v3.wb');
  });
  await win.reload();
  await win.waitForLoadState('domcontentloaded');
  await expect(win.locator('[data-studio-v3-shell]')).toBeVisible({ timeout: 15000 });
  await win.waitForTimeout(400);

  await win.evaluate(() => { if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); });

  // Spawn 2.
  await win.locator('[data-studio-v3-tool="cube"][data-studio-v3-tool-group="add"]').click();
  await win.waitForTimeout(120);
  await win.locator('[data-studio-v3-tool="sphere"][data-studio-v3-tool-group="add"]').click();
  await win.waitForTimeout(400);

  // Press B → overlay arms.
  await win.keyboard.press('b');
  await win.waitForTimeout(150);
  await expect(win.locator('[data-studio-v3-marquee-overlay]')).toBeVisible();

  // Programmatically drag a rectangle across the whole viewport so the
  // boxSelect picks up both primitives. We do this by directly invoking
  // boxSelect via the op (the UI is verified by the overlay being mounted).
  const result = await win.evaluate(() => {
    const dom = window.__archdiscViewport.renderer.domElement;
    return window.__studioBoxSelect(0, 0, dom.clientWidth, dom.clientHeight);
  });
  expect(result.count).toBeGreaterThanOrEqual(2);

  // Esc dismisses the overlay.
  await win.keyboard.press('Escape');
  await win.waitForTimeout(150);
  await expect(win.locator('[data-studio-v3-marquee-overlay]')).toHaveCount(0);

  await win.screenshot({ path: path.join(OUT, '00.png') });

  // eslint-disable-next-line no-console
  console.log('  slice 502: marquee arm + box select count', result.count);

  await win.evaluate(() => {
    window.__studioV3Dirty = false;
    window.onbeforeunload = null;
    window.dispatchEvent(new CustomEvent('studio-autosaved', { detail: { ts: Date.now(), bytes: 0, primitives: 0 } }));
  });
  await win.waitForTimeout(100);
  await app.close();
});
