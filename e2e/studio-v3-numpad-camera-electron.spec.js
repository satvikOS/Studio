import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-v3-numpad-camera');

test('Studio V3 — Blender numpad axes + frame + isolate (slice 622)', async () => {
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
  await win.waitForTimeout(250);
  await win.locator('[data-studio-v3-tool="sphere"][data-studio-v3-tool-group="add"]').click();
  await win.waitForTimeout(250);

  // back / left / bottom axes
  const back = await win.evaluate(() => window.__studioSetCameraAxis('back'));
  expect(back.ok).toBe(true);
  const left = await win.evaluate(() => window.__studioSetCameraAxis('left'));
  expect(left.ok).toBe(true);
  const bottom = await win.evaluate(() => window.__studioSetCameraAxis('bottom'));
  expect(bottom.ok).toBe(true);

  // frame selection
  const frame = await win.evaluate(() => window.__studioFrameSelection());
  expect(frame.ok).toBe(true);
  expect(frame.radius).toBeGreaterThan(0);

  // isolate / restore
  const visBefore = await win.evaluate(() => {
    let n = 0;
    window.__archdiscScene.traverse((o) => { if (o.isMesh && o.visible) n++; });
    return n;
  });
  const iso = await win.evaluate(() => window.__studioToggleIsolateSelection());
  expect(iso.ok).toBe(true);
  expect(iso.isolated).toBe(true);
  const visIso = await win.evaluate(() => {
    let n = 0;
    window.__archdiscScene.traverse((o) => { if (o.isMesh && o.visible) n++; });
    return n;
  });
  expect(visIso).toBeLessThan(visBefore);
  const unIso = await win.evaluate(() => window.__studioToggleIsolateSelection());
  expect(unIso.isolated).toBe(false);

  await win.screenshot({ path: path.join(OUT, '00.png') });

  // eslint-disable-next-line no-console
  console.log('  slice 622: numpad axes + frame + isolate', visBefore, '→', visIso, '→ restored');

  await win.evaluate(() => {
    window.__studioV3Dirty = false;
    window.onbeforeunload = null;
    window.dispatchEvent(new CustomEvent('studio-autosaved', { detail: { ts: Date.now(), bytes: 0, primitives: 0 } }));
  });
  await win.waitForTimeout(100);
  await app.close();
});
