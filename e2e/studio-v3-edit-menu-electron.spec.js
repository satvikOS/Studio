import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-v3-edit-menu');

test('Studio V3 — Edit menu lists actions + fires undo (slice 551)', async () => {
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

  await win.locator('[data-studio-v3-menu="edit"]').click();
  await win.waitForTimeout(200);

  const menu = win.locator('[data-studio-v3-edit-menu]');
  await expect(menu).toBeVisible();
  await expect(win.locator('[data-studio-v3-edit-action="undo"]')).toBeVisible();
  await expect(win.locator('[data-studio-v3-edit-action="group"]')).toBeVisible();

  // Pick Undo → primitive count drops to 0.
  await win.locator('[data-studio-v3-edit-action="undo"]').click();
  await win.waitForTimeout(200);

  const remaining = await win.evaluate(() => {
    let n = 0;
    window.__archdiscScene.traverse((o) => { if (o.userData && o.userData.archdiscStudioPrimitive && o.userData.archdiscStudioPrimitiveKind !== 'group') n++; });
    return n;
  });
  expect(remaining).toBe(0);

  // Menu dismissed after action.
  await expect(menu).toHaveCount(0);

  await win.screenshot({ path: path.join(OUT, '00.png') });

  // eslint-disable-next-line no-console
  console.log('  slice 551: Edit→Undo dropped primitive count to', remaining);

  await win.evaluate(() => {
    window.__studioV3Dirty = false;
    window.onbeforeunload = null;
    window.dispatchEvent(new CustomEvent('studio-autosaved', { detail: { ts: Date.now(), bytes: 0, primitives: 0 } }));
  });
  await win.waitForTimeout(100);
  await app.close();
});
