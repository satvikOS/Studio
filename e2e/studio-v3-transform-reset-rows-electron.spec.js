import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-v3-transform-reset-rows');

test('Studio V3 — Transform reset chips clear single component (slice 564)', async () => {
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
    m.position.set(2, 3, 4); m.scale.set(1.5, 1.5, 1.5); m.updateMatrixWorld(true);
  });
  await win.waitForTimeout(500);

  await expect(win.locator('[data-studio-v3-transform-reset="g"]')).toBeVisible();
  await win.locator('[data-studio-v3-transform-reset="g"]').click();
  await win.waitForTimeout(200);

  const snap = await win.evaluate(() => {
    const m = window.__studioSelectedMesh();
    return {
      p: [m.position.x, m.position.y, m.position.z],
      s: [m.scale.x, m.scale.y, m.scale.z],
    };
  });
  expect(snap.p).toEqual([0, 0, 0]);
  expect(snap.s[0]).toBeCloseTo(1.5);

  await win.screenshot({ path: path.join(OUT, '00.png') });

  // eslint-disable-next-line no-console
  console.log('  slice 564: Position reset · scale kept');

  await win.evaluate(() => {
    window.__studioV3Dirty = false;
    window.onbeforeunload = null;
    window.dispatchEvent(new CustomEvent('studio-autosaved', { detail: { ts: Date.now(), bytes: 0, primitives: 0 } }));
  });
  await win.waitForTimeout(100);
  await app.close();
});
