import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-v3-selection-cycle');

test('Studio V3 — Cmd+] / Cmd+[ cycles selection (slice 612)', async () => {
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

  await win.evaluate(() => { if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); });

  await win.locator('[data-studio-v3-tool="cube"][data-studio-v3-tool-group="add"]').click();
  await win.waitForTimeout(120);
  await win.locator('[data-studio-v3-tool="sphere"][data-studio-v3-tool-group="add"]').click();
  await win.waitForTimeout(120);
  await win.locator('[data-studio-v3-tool="plane"][data-studio-v3-tool-group="add"]').click();
  await win.waitForTimeout(250);

  const initialUuid = await win.evaluate(() => window.__studioSelectedMesh() && window.__studioSelectedMesh().uuid);

  await win.keyboard.press('Meta+]');
  await win.waitForTimeout(150);
  const nextUuid = await win.evaluate(() => window.__studioSelectedMesh() && window.__studioSelectedMesh().uuid);
  expect(nextUuid).not.toBe(initialUuid);

  await win.keyboard.press('Meta+[');
  await win.waitForTimeout(150);
  const backUuid = await win.evaluate(() => window.__studioSelectedMesh() && window.__studioSelectedMesh().uuid);
  expect(backUuid).toBe(initialUuid);

  await win.screenshot({ path: path.join(OUT, '00.png') });

  // eslint-disable-next-line no-console
  console.log('  slice 612: cycle next + back returns to initial');

  await win.evaluate(() => {
    window.__studioV3Dirty = false;
    window.onbeforeunload = null;
    window.dispatchEvent(new CustomEvent('studio-autosaved', { detail: { ts: Date.now(), bytes: 0, primitives: 0 } }));
  });
  await win.waitForTimeout(100);
  await app.close();
});
