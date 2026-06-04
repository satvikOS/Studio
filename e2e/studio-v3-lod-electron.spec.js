import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-v3-lod');

test('Studio V3 — LOD wraps selection with 3 distance tiers (slice 620)', async () => {
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

  await win.locator('[data-studio-v3-tool="ico"][data-studio-v3-tool-group="add"]').click();
  await win.waitForTimeout(250);

  const r = await win.evaluate(() => window.__studioCreateLOD());
  expect(r.ok).toBe(true);
  expect(r.levels).toBe(3);
  expect(r.verts[0]).toBeGreaterThan(r.verts[1]);
  expect(r.verts[1]).toBeGreaterThan(r.verts[2]);

  const hasLod = await win.evaluate(() => {
    let found = false;
    window.__archdiscScene.traverse((o) => { if (o.isLOD && o.userData.archdiscStudioLOD) found = true; });
    return found;
  });
  expect(hasLod).toBe(true);

  await win.screenshot({ path: path.join(OUT, '00.png') });

  // eslint-disable-next-line no-console
  console.log('  slice 620: LOD verts', r.verts.join(' → '));

  await win.evaluate(() => {
    window.__studioV3Dirty = false;
    window.onbeforeunload = null;
    window.dispatchEvent(new CustomEvent('studio-autosaved', { detail: { ts: Date.now(), bytes: 0, primitives: 0 } }));
  });
  await win.waitForTimeout(100);
  await app.close();
});
