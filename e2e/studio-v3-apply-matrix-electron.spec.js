import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-v3-apply-matrix');

test('Studio V3 — Apply matrix bakes transform into geometry (slice 570)', async () => {
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

  await win.evaluate(() => {
    const m = window.__studioSelectedMesh();
    m.position.set(1, 2, 3);
    m.scale.set(2, 2, 2);
    m.updateMatrixWorld(true);
  });

  const before = await win.evaluate(() => {
    const m = window.__studioSelectedMesh();
    return {
      p: [m.position.x, m.position.y, m.position.z],
      s: [m.scale.x, m.scale.y, m.scale.z],
      // First vertex world-space sample
      v0: (() => {
        const a = m.geometry.attributes.position.array;
        return [a[0], a[1], a[2]];
      })(),
    };
  });

  const r = await win.evaluate(() => window.__studioApplyMatrix());
  expect(r.ok).toBe(true);

  const after = await win.evaluate(() => {
    const m = window.__studioSelectedMesh();
    return {
      p: [m.position.x, m.position.y, m.position.z],
      s: [m.scale.x, m.scale.y, m.scale.z],
      v0: (() => {
        const a = m.geometry.attributes.position.array;
        return [a[0], a[1], a[2]];
      })(),
    };
  });

  expect(after.p).toEqual([0, 0, 0]);
  expect(after.s).toEqual([1, 1, 1]);
  // First vertex must have moved (scale + translate baked in).
  expect(after.v0[0]).not.toBeCloseTo(before.v0[0], 4);

  await win.screenshot({ path: path.join(OUT, '00.png') });

  // eslint-disable-next-line no-console
  console.log('  slice 570: position reset · v0', before.v0[0].toFixed(4), '→', after.v0[0].toFixed(4));

  await win.evaluate(() => {
    window.__studioV3Dirty = false;
    window.onbeforeunload = null;
    window.dispatchEvent(new CustomEvent('studio-autosaved', { detail: { ts: Date.now(), bytes: 0, primitives: 0 } }));
  });
  await win.waitForTimeout(100);
  await app.close();
});
