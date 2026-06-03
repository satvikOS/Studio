import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-v3-bend');

test('Studio V3 — bend deformer warps vertices in YZ (slice 598)', async () => {
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

  const probe = await win.evaluate(() => {
    const m = window.__studioSelectedMesh();
    const pos = m.geometry.attributes.position;
    let bestI = 0, bestY = -Infinity;
    for (let i = 0; i < pos.count; i++) {
      if (pos.getY(i) > bestY) { bestY = pos.getY(i); bestI = i; }
    }
    return { i: bestI, y: pos.getY(bestI), z: pos.getZ(bestI) };
  });

  const r = await win.evaluate(() => window.__studioBendYZ(90));
  expect(r.ok).toBe(true);

  const after = await win.evaluate((i) => {
    const m = window.__studioSelectedMesh();
    return { y: m.geometry.attributes.position.getY(i), z: m.geometry.attributes.position.getZ(i) };
  }, probe.i);

  // Top vertex (y > 0) should have curved toward +Z, gaining z magnitude.
  expect(Math.abs(after.z - probe.z)).toBeGreaterThan(0.001);

  await win.screenshot({ path: path.join(OUT, '00.png') });

  // eslint-disable-next-line no-console
  console.log('  slice 598: bend vertex (', probe.y.toFixed(3), probe.z.toFixed(3), ') → (', after.y.toFixed(3), after.z.toFixed(3), ')');

  await win.evaluate(() => {
    window.__studioV3Dirty = false;
    window.onbeforeunload = null;
    window.dispatchEvent(new CustomEvent('studio-autosaved', { detail: { ts: Date.now(), bytes: 0, primitives: 0 } }));
  });
  await win.waitForTimeout(100);
  await app.close();
});
