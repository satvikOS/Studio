import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-v3-reset-transform');

test('Studio V3 — Alt+G / R / S clear transform components (slice 490)', async () => {
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
    window.localStorage.removeItem('studio.v3.theme');
    window.localStorage.removeItem('studio.v3.wb');
  });
  await win.reload();
  await win.waitForLoadState('domcontentloaded');
  await expect(win.locator('[data-studio-v3-shell]')).toBeVisible({ timeout: 15000 });
  await win.waitForTimeout(400);

  await win.evaluate(() => { if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); });

  await win.locator('[data-studio-v3-tool="cube"][data-studio-v3-tool-group="add"]').click();
  await win.waitForTimeout(250);

  // Pre-load the selection with non-default position/rotation/scale.
  await win.evaluate(() => {
    const m = window.__studioSelectedMesh && window.__studioSelectedMesh();
    if (m) { m.position.set(2, 3, 4); m.rotation.set(0.5, 0.5, 0.5); m.scale.set(2, 2, 2); m.updateMatrixWorld(true); }
  });

  // Alt+G clears position.
  await win.keyboard.press('Alt+g');
  await win.waitForTimeout(150);
  let snap = await win.evaluate(() => {
    const m = window.__studioSelectedMesh();
    return { p: m.position.toArray(), r: m.rotation.toArray().slice(0, 3), s: m.scale.toArray() };
  });
  expect(snap.p).toEqual([0, 0, 0]);
  expect(snap.s).toEqual([2, 2, 2]);

  // Alt+R clears rotation.
  await win.keyboard.press('Alt+r');
  await win.waitForTimeout(150);
  snap = await win.evaluate(() => {
    const m = window.__studioSelectedMesh();
    return { r: m.rotation.toArray().slice(0, 3), s: m.scale.toArray() };
  });
  expect(snap.r).toEqual([0, 0, 0]);
  expect(snap.s).toEqual([2, 2, 2]);

  // Alt+S clears scale.
  await win.keyboard.press('Alt+s');
  await win.waitForTimeout(150);
  snap = await win.evaluate(() => {
    const m = window.__studioSelectedMesh();
    return { s: m.scale.toArray() };
  });
  expect(snap.s).toEqual([1, 1, 1]);

  await win.screenshot({ path: path.join(OUT, '00.png') });

  // eslint-disable-next-line no-console
  console.log('  slice 490: Alt+GRS cleared position / rotation / scale');

  await win.evaluate(() => {
    window.__studioV3Dirty = false;
    window.onbeforeunload = null;
    window.dispatchEvent(new CustomEvent('studio-autosaved', { detail: { ts: Date.now(), bytes: 0, primitives: 0 } }));
  });
  await win.waitForTimeout(100);
  await app.close();
});
