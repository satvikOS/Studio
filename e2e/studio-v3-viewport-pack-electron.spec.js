import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-v3-viewport-pack');

test('Studio V3 — camera fov/near/far + axis/ground/wire overlay (slice 626)', async () => {
  test.setTimeout(180000);
  fs.mkdirSync(OUT, { recursive: true });

  const app = await electron.launch({
    args: [path.join(__dirname, '..', 'electron', 'main.js')],
    slowMo: Number(process.env.STUDIO_SLOWMO) || 250,
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

  // 1: fov ────────────────────────────────────────────────────────────
  const fov = await win.evaluate(() => window.__studioSetCameraFov(80));
  expect(fov.ok).toBe(true);
  expect(fov.fov).toBe(80);
  await win.screenshot({ path: path.join(OUT, '01-fov.png') });

  // 2: near ───────────────────────────────────────────────────────────
  const near = await win.evaluate(() => window.__studioSetCameraNear(0.05));
  expect(near.ok).toBe(true);
  expect(near.near).toBeCloseTo(0.05, 4);
  await win.screenshot({ path: path.join(OUT, '02-near.png') });

  // 3: far ────────────────────────────────────────────────────────────
  const far = await win.evaluate(() => window.__studioSetCameraFar(500));
  expect(far.ok).toBe(true);
  expect(far.far).toBe(500);
  await win.screenshot({ path: path.join(OUT, '03-far.png') });

  // 4: axis lines toggle ─────────────────────────────────────────────
  const axOn = await win.evaluate(() => window.__studioToggleAxisLines());
  expect(axOn.on).toBe(true);
  const hasAx = await win.evaluate(() => !!window.__archdiscViewport.__studioAxisHelper);
  expect(hasAx).toBe(true);
  const axOff = await win.evaluate(() => window.__studioToggleAxisLines());
  expect(axOff.on).toBe(false);
  await win.screenshot({ path: path.join(OUT, '04-axis.png') });

  // 5: ground toggle ─────────────────────────────────────────────────
  const grOn = await win.evaluate(() => window.__studioToggleGround());
  expect(grOn.on).toBe(true);
  const grOff = await win.evaluate(() => window.__studioToggleGround());
  expect(grOff.on).toBe(false);
  await win.screenshot({ path: path.join(OUT, '05-ground.png') });

  // 6: wire overlay ──────────────────────────────────────────────────
  await win.locator('[data-studio-v3-tool="cube"][data-studio-v3-tool-group="add"]').click();
  await win.waitForTimeout(200);
  const wOn = await win.evaluate(() => window.__studioToggleWireOverlay());
  expect(wOn.on).toBe(true);
  const wHas = await win.evaluate(() => !!window.__studioSelectedMesh().__studioWireOverlay);
  expect(wHas).toBe(true);
  const wOff = await win.evaluate(() => window.__studioToggleWireOverlay());
  expect(wOff.on).toBe(false);
  await win.screenshot({ path: path.join(OUT, '06-wire.png') });

  // eslint-disable-next-line no-console
  console.log('  slice 626: 6 features verified — fov/near/far + axis + ground + wire overlay');

  await win.evaluate(() => {
    window.__studioV3Dirty = false;
    window.onbeforeunload = null;
    window.dispatchEvent(new CustomEvent('studio-autosaved', { detail: { ts: Date.now(), bytes: 0, primitives: 0 } }));
  });
  await win.waitForTimeout(100);
  await app.close();
});
