import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-v3-annotations-section');

test('Studio V3 — N-panel Annotations section lists + deletes (slice 522)', async () => {
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
    try { window.sessionStorage.setItem('studio.v3.splash-shown', '1'); } catch (_) {}
  });
  await win.reload();
  await win.waitForLoadState('domcontentloaded');
  await expect(win.locator('[data-studio-v3-shell]')).toBeVisible({ timeout: 15000 });
  await win.waitForTimeout(400);

  await win.locator('[data-studio-v3-tool="cube"][data-studio-v3-tool-group="add"]').click();
  await win.waitForTimeout(200);

  await win.evaluate(() => {
    window.__studioAddAnnotation('alpha');
    window.__studioAddAnnotation('beta');
    window.__studioAddAnnotation('gamma');
  });
  await win.waitForTimeout(800);

  await expect(win.locator('[data-studio-v3-annotations-section]')).toBeVisible();
  const rows = win.locator('[data-studio-v3-annotation-row]');
  await expect(rows).toHaveCount(3);

  // Delete the first one.
  const firstUuid = await rows.first().getAttribute('data-studio-v3-annotation-row');
  await win.locator(`[data-studio-v3-annotation-delete="${firstUuid}"]`).click();
  await win.waitForTimeout(800);
  await expect(rows).toHaveCount(2);

  await win.screenshot({ path: path.join(OUT, '00.png') });

  // eslint-disable-next-line no-console
  console.log('  slice 522: annotations list + delete (3 → 2)');

  await win.evaluate(() => {
    window.__studioV3Dirty = false;
    window.onbeforeunload = null;
    window.dispatchEvent(new CustomEvent('studio-autosaved', { detail: { ts: Date.now(), bytes: 0, primitives: 0 } }));
  });
  await win.waitForTimeout(100);
  await app.close();
});
