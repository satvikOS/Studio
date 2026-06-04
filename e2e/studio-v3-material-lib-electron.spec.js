import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-v3-material-lib');

test('Studio V3 — material lib: presetApply/list/save/load/delete/copy (slice 651)', async () => {
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
    window.localStorage.removeItem('studio.v3.user-materials');
    try { window.sessionStorage.setItem('studio.v3.splash-shown', '1'); } catch (_) {}
  });
  await win.reload();
  await win.waitForLoadState('domcontentloaded');
  await expect(win.locator('[data-studio-v3-shell]')).toBeVisible({ timeout: 15000 });
  await win.waitForTimeout(400);

  await win.locator('[data-studio-v3-tool="sphere"][data-studio-v3-tool-group="add"]').click();
  await win.waitForTimeout(200);

  // 1: apply gold preset
  const g = await win.evaluate(() => window.__studioMaterialPresetApply('gold'));
  expect(g.ok).toBe(true);
  expect(g.preset).toBe('gold');
  const cm = await win.evaluate(() => {
    const sel = window.__studioSelectedMesh();
    const m = Array.isArray(sel.material) ? sel.material[0] : sel.material;
    return { metal: m.metalness, rough: m.roughness, isPhys: m.isMeshPhysicalMaterial };
  });
  expect(cm.metal).toBe(1);
  expect(cm.isPhys).toBe(true);
  await win.screenshot({ path: path.join(OUT, '01-gold.png') });

  // 2: list
  const list = await win.evaluate(() => window.__studioMaterialPresetList());
  expect(list.builtin).toContain('gold');
  expect(list.builtin).toContain('glass');
  expect(list.user.length).toBe(0);
  await win.screenshot({ path: path.join(OUT, '02-list.png') });

  // 3: save current as user preset
  const sv = await win.evaluate(() => window.__studioMaterialSavePreset('myGold'));
  expect(sv.ok).toBe(true);
  expect(sv.total).toBe(1);
  await win.screenshot({ path: path.join(OUT, '03-save.png') });

  // 4: apply glass preset (over the gold)
  await win.evaluate(() => window.__studioMaterialPresetApply('glass'));
  // load myGold back
  const ld = await win.evaluate(() => window.__studioMaterialLoadPreset('myGold'));
  expect(ld.ok).toBe(true);
  const after = await win.evaluate(() => {
    const m = Array.isArray(window.__studioSelectedMesh().material) ? window.__studioSelectedMesh().material[0] : window.__studioSelectedMesh().material;
    return { metal: m.metalness, rough: m.roughness };
  });
  expect(after.metal).toBe(1);
  await win.screenshot({ path: path.join(OUT, '04-load.png') });

  // 5: delete user preset
  const del = await win.evaluate(() => window.__studioMaterialDeletePreset('myGold'));
  expect(del.removed).toBe(true);
  expect(del.total).toBe(0);
  await win.screenshot({ path: path.join(OUT, '05-delete.png') });

  // 6: copy material to clipboard
  const cp = await win.evaluate(() => window.__studioMaterialCopySelection());
  expect(cp.ok).toBe(true);
  expect(cp.snapshot.metalness).toBe(1);
  await win.screenshot({ path: path.join(OUT, '06-copy.png') });

  // eslint-disable-next-line no-console
  console.log('  slice 651: 6 material-library features verified');

  await win.evaluate(() => {
    window.__studioV3Dirty = false;
    window.onbeforeunload = null;
    window.dispatchEvent(new CustomEvent('studio-autosaved', { detail: { ts: Date.now(), bytes: 0, primitives: 0 } }));
  });
  await win.waitForTimeout(100);
  await app.close();
});
