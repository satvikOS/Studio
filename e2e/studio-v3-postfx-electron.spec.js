import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-v3-postfx');

test('Studio V3 — Post FX panel chips toggle 4 effects (slice 610)', async () => {
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
  await win.waitForTimeout(500);

  await win.locator('[data-studio-v3-tool="cube"][data-studio-v3-tool-group="add"]').click();
  await win.waitForTimeout(250);

  await expect(win.locator('[data-studio-v3-postfx-section]')).toBeVisible();

  for (const id of ['outline', 'ssao', 'bloom', 'fxaa']) {
    await expect(win.locator(`[data-studio-v3-postfx="${id}"]`)).toBeVisible();
  }

  // Toggle bloom on; chip should switch to true after the next poll.
  await win.locator('[data-studio-v3-postfx="bloom"]').click();
  await win.waitForTimeout(800);

  const bloomOn = await win.evaluate(() => {
    const c = window.__archdiscViewport.__studioComposer;
    return c && c.passes.some((p) => p.constructor.name === 'UnrealBloomPass');
  });
  expect(bloomOn).toBe(true);

  await win.screenshot({ path: path.join(OUT, '00.png') });

  // eslint-disable-next-line no-console
  console.log('  slice 610: PostFX chip toggled bloom on');

  await win.evaluate(() => {
    window.__studioV3Dirty = false;
    window.onbeforeunload = null;
    window.dispatchEvent(new CustomEvent('studio-autosaved', { detail: { ts: Date.now(), bytes: 0, primitives: 0 } }));
  });
  await win.waitForTimeout(100);
  await app.close();
});
