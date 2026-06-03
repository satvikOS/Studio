import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-v3-noise');

test('Studio V3 — Noise displacement perturbs vertices (slice 596)', async () => {
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

  await win.locator('[data-studio-v3-tool="sphere"][data-studio-v3-tool-group="add"]').click();
  await win.waitForTimeout(250);

  const before = await win.evaluate(() => {
    const m = window.__studioSelectedMesh();
    return [m.geometry.attributes.position.getX(0), m.geometry.attributes.position.getY(0), m.geometry.attributes.position.getZ(0)];
  });

  const r = await win.evaluate(() => window.__studioDisplaceNoise(0.005));
  expect(r.ok).toBe(true);

  const after = await win.evaluate(() => {
    const m = window.__studioSelectedMesh();
    return [m.geometry.attributes.position.getX(0), m.geometry.attributes.position.getY(0), m.geometry.attributes.position.getZ(0)];
  });

  const moved = Math.hypot(after[0] - before[0], after[1] - before[1], after[2] - before[2]);
  expect(moved).toBeGreaterThan(0);

  await win.screenshot({ path: path.join(OUT, '00.png') });

  // eslint-disable-next-line no-console
  console.log('  slice 596: vertex 0 moved', moved.toExponential(2));

  await win.evaluate(() => {
    window.__studioV3Dirty = false;
    window.onbeforeunload = null;
    window.dispatchEvent(new CustomEvent('studio-autosaved', { detail: { ts: Date.now(), bytes: 0, primitives: 0 } }));
  });
  await win.waitForTimeout(100);
  await app.close();
});
