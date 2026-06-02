import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-v3-layer-rename');

test('Studio V3 — view layers can be renamed + persisted (slice 544)', async () => {
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
    window.localStorage.removeItem('studio.v3.layer-names');
    try { window.sessionStorage.setItem('studio.v3.splash-shown', '1'); } catch (_) {}
  });
  await win.reload();
  await win.waitForLoadState('domcontentloaded');
  await expect(win.locator('[data-studio-v3-shell]')).toBeVisible({ timeout: 15000 });
  await win.waitForTimeout(400);

  await win.locator('[data-studio-v3-right-tab="layers"]').click();
  await win.waitForTimeout(300);

  // Rename layer 0 → 'blockout' via focus + type + Enter so React's
  // onKeyDown=Enter handler fires the rename.
  await win.locator('[data-studio-v3-layer-name="0"]').click();
  await win.locator('[data-studio-v3-layer-name="0"]').fill('blockout');
  await win.keyboard.press('Enter');
  await win.waitForTimeout(200);

  const stored = JSON.parse(await win.evaluate(() => window.localStorage.getItem('studio.v3.layer-names')));
  expect(stored['0']).toBe('blockout');

  // Reload — value persists.
  await win.reload();
  await win.waitForLoadState('domcontentloaded');
  await expect(win.locator('[data-studio-v3-shell]')).toBeVisible({ timeout: 15000 });
  await win.waitForTimeout(400);
  await win.locator('[data-studio-v3-right-tab="layers"]').click();
  await win.waitForTimeout(300);

  const restored = await win.locator('[data-studio-v3-layer-name="0"]').inputValue();
  expect(restored).toBe('blockout');

  await win.screenshot({ path: path.join(OUT, '00.png') });

  // eslint-disable-next-line no-console
  console.log('  slice 544: layer 0 → "blockout" persisted across reload');

  await win.evaluate(() => {
    window.__studioV3Dirty = false;
    window.onbeforeunload = null;
    window.dispatchEvent(new CustomEvent('studio-autosaved', { detail: { ts: Date.now(), bytes: 0, primitives: 0 } }));
  });
  await win.waitForTimeout(100);
  await app.close();
});
