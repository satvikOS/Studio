import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-v3-twist');

test('Studio V3 — twist deformer rotates top vertex (slice 597)', async () => {
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

  await win.locator('[data-studio-v3-tool="cylinder"][data-studio-v3-tool-group="add"]').click();
  await win.waitForTimeout(250);

  // Capture a vertex near +Y (top) at +X.
  const probe = await win.evaluate(() => {
    const m = window.__studioSelectedMesh();
    const pos = m.geometry.attributes.position;
    let bestI = 0, bestScore = -Infinity;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), y = pos.getY(i);
      const score = y * 10 + x;
      if (score > bestScore) { bestScore = score; bestI = i; }
    }
    return { i: bestI, x: pos.getX(bestI), z: pos.getZ(bestI) };
  });

  const r = await win.evaluate(() => window.__studioTwistY(90));
  expect(r.ok).toBe(true);

  const after = await win.evaluate((i) => {
    const m = window.__studioSelectedMesh();
    return { x: m.geometry.attributes.position.getX(i), z: m.geometry.attributes.position.getZ(i) };
  }, probe.i);

  // The top vertex's X must have rotated → either x changed sign or z gained magnitude.
  const moved = Math.abs(probe.x - after.x) + Math.abs(probe.z - after.z);
  expect(moved).toBeGreaterThan(0.001);

  await win.screenshot({ path: path.join(OUT, '00.png') });

  // eslint-disable-next-line no-console
  console.log('  slice 597: twist vertex (', probe.x.toFixed(3), probe.z.toFixed(3), ') → (', after.x.toFixed(3), after.z.toFixed(3), ')');

  await win.evaluate(() => {
    window.__studioV3Dirty = false;
    window.onbeforeunload = null;
    window.dispatchEvent(new CustomEvent('studio-autosaved', { detail: { ts: Date.now(), bytes: 0, primitives: 0 } }));
  });
  await win.waitForTimeout(100);
  await app.close();
});
