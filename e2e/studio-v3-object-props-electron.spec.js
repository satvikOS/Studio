import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-v3-object-props');

test('Studio V3 — Object section toggles cast/receive/visible (slice 583)', async () => {
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
  await win.waitForTimeout(700);

  await expect(win.locator('[data-studio-v3-object-props]')).toBeVisible();

  // Initial: cast / receive should be true (spawn defaults), visible true.
  const before = await win.evaluate(() => {
    const m = window.__studioSelectedMesh();
    return { cast: !!m.castShadow, receive: !!m.receiveShadow, visible: m.visible !== false };
  });
  expect(before.cast).toBe(true);

  // Toggle cast off.
  await win.locator('[data-studio-v3-object-prop="cast"]').click();
  await win.waitForTimeout(200);
  const after = await win.evaluate(() => {
    const m = window.__studioSelectedMesh();
    return { cast: !!m.castShadow };
  });
  expect(after.cast).toBe(false);

  // Toggle visible off.
  await win.locator('[data-studio-v3-object-prop="visible"]').click();
  await win.waitForTimeout(200);
  const vis = await win.evaluate(() => window.__studioSelectedMesh().visible);
  expect(vis).toBe(false);

  await win.screenshot({ path: path.join(OUT, '00.png') });

  // eslint-disable-next-line no-console
  console.log('  slice 583: cast on→off; visible on→off');

  await win.evaluate(() => {
    window.__studioV3Dirty = false;
    window.onbeforeunload = null;
    window.dispatchEvent(new CustomEvent('studio-autosaved', { detail: { ts: Date.now(), bytes: 0, primitives: 0 } }));
  });
  await win.waitForTimeout(100);
  await app.close();
});
