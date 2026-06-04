import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-v3-fly');

test('Studio V3 — Shift+W/S flies camera forward/back (slice 600)', async () => {
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

  const before = await win.evaluate(() => {
    const c = window.__archdiscViewport.camera;
    return [c.position.x, c.position.y, c.position.z];
  });

  // Forward 4 steps.
  for (let i = 0; i < 4; i++) {
    await win.keyboard.press('Shift+W');
  }
  await win.waitForTimeout(150);

  const fwd = await win.evaluate(() => {
    const c = window.__archdiscViewport.camera;
    return [c.position.x, c.position.y, c.position.z];
  });
  const movedFwd = Math.hypot(fwd[0] - before[0], fwd[1] - before[1], fwd[2] - before[2]);
  expect(movedFwd).toBeGreaterThan(0.15);

  // Backward 4 → close to start (allow slight drift due to OrbitControls clamping).
  for (let i = 0; i < 4; i++) {
    await win.keyboard.press('Shift+S');
  }
  await win.waitForTimeout(150);

  const back = await win.evaluate(() => {
    const c = window.__archdiscViewport.camera;
    return [c.position.x, c.position.y, c.position.z];
  });
  const drift = Math.hypot(back[0] - before[0], back[1] - before[1], back[2] - before[2]);
  expect(drift).toBeLessThan(0.05);

  await win.screenshot({ path: path.join(OUT, '00.png') });

  // eslint-disable-next-line no-console
  console.log('  slice 600: fly fwd', movedFwd.toFixed(3), '· back-drift', drift.toFixed(3));

  await win.evaluate(() => {
    window.__studioV3Dirty = false;
    window.onbeforeunload = null;
    window.dispatchEvent(new CustomEvent('studio-autosaved', { detail: { ts: Date.now(), bytes: 0, primitives: 0 } }));
  });
  await win.waitForTimeout(100);
  await app.close();
});
