import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-v3-mesh-dims');

test('Studio V3 — mesh stats show bbox dimensions (slice 545)', async () => {
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
  await win.waitForTimeout(1100); // > 1 s poll

  const dimsText = await win.locator('[data-studio-v3-mesh-dims] strong').textContent();
  // Cube primitive is ~0.030 m on a side (PRIMITIVE_SIZE = 0.03).
  expect(dimsText).toMatch(/0\.030\s+×\s+0\.030\s+×\s+0\.030/);

  // Resize the mesh + verify the inspector updates.
  await win.evaluate(() => {
    const m = window.__studioSelectedMesh();
    m.scale.set(2, 1, 0.5); m.updateMatrixWorld(true);
  });
  await win.waitForTimeout(1200);
  const after = await win.locator('[data-studio-v3-mesh-dims] strong').textContent();
  expect(after).toMatch(/0\.060\s+×\s+0\.030\s+×\s+0\.015/);

  await win.screenshot({ path: path.join(OUT, '00.png') });

  // eslint-disable-next-line no-console
  console.log('  slice 545: dims', dimsText.trim(), '→', after.trim());

  await win.evaluate(() => {
    window.__studioV3Dirty = false;
    window.onbeforeunload = null;
    window.dispatchEvent(new CustomEvent('studio-autosaved', { detail: { ts: Date.now(), bytes: 0, primitives: 0 } }));
  });
  await win.waitForTimeout(100);
  await app.close();
});
