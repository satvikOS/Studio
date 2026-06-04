import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-v3-file-mgmt');

test('Studio V3 — file mgmt: save/load/list/delete/rename/export (slice 661)', async () => {
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
    // clear any prior saved files
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (k && k.startsWith('studio.v3.files.')) localStorage.removeItem(k);
    }
    try { window.sessionStorage.setItem('studio.v3.splash-shown', '1'); } catch (_) {}
  });
  await win.reload();
  await win.waitForLoadState('domcontentloaded');
  await expect(win.locator('[data-studio-v3-shell]')).toBeVisible({ timeout: 15000 });
  await win.waitForTimeout(400);

  // Add some meshes so save is non-trivial
  await win.locator('[data-studio-v3-tool="cube"][data-studio-v3-tool-group="add"]').click();
  await win.waitForTimeout(200);

  // 1: save
  const s = await win.evaluate(() => window.__studioFileSave('sceneA'));
  expect(s.ok).toBe(true);
  expect(s.bytes).toBeGreaterThan(100);
  await win.screenshot({ path: path.join(OUT, '01-save.png') });

  // 2: list contains it
  const l = await win.evaluate(() => window.__studioFileList());
  expect(l.files.find((f) => f.name === 'sceneA')).toBeTruthy();
  await win.screenshot({ path: path.join(OUT, '02-list.png') });

  // 3: load — first clear scene
  await win.evaluate(() => window.__studioClearScene && window.__studioClearScene());
  const before = await win.evaluate(() => {
    let n = 0;
    window.__archdiscScene.traverse((o) => { if (o.isMesh && o.userData?.archdiscStudioPrimitiveKind) n++; });
    return n;
  });
  const ld = await win.evaluate(() => window.__studioFileLoad('sceneA'));
  expect(ld.ok).toBe(true);
  expect(ld.added).toBeGreaterThan(0);
  const after = await win.evaluate(() => {
    let n = 0;
    window.__archdiscScene.traverse((o) => { if (o.isMesh && o.userData?.archdiscStudioPrimitiveKind) n++; });
    return n;
  });
  expect(after).toBeGreaterThan(before);
  await win.screenshot({ path: path.join(OUT, '03-load.png') });

  // 4: rename
  const r = await win.evaluate(() => window.__studioFileRename('sceneA', 'sceneB'));
  expect(r.ok).toBe(true);
  const l2 = await win.evaluate(() => window.__studioFileList());
  expect(l2.files.find((f) => f.name === 'sceneB')).toBeTruthy();
  expect(l2.files.find((f) => f.name === 'sceneA')).toBeFalsy();
  await win.screenshot({ path: path.join(OUT, '04-rename.png') });

  // 5: export
  const e = await win.evaluate(() => window.__studioFileExport());
  expect(e.ok).toBe(true);
  expect(e.dataUrl.startsWith('data:application/json')).toBe(true);
  await win.screenshot({ path: path.join(OUT, '05-export.png') });

  // 6: delete
  const d = await win.evaluate(() => window.__studioFileDelete('sceneB'));
  expect(d.removed).toBe(true);
  await win.screenshot({ path: path.join(OUT, '06-delete.png') });

  // eslint-disable-next-line no-console
  console.log('  slice 661: 6 file-mgmt features verified — save', s.bytes, 'b, load added', ld.added);

  await win.evaluate(() => {
    window.__studioV3Dirty = false;
    window.onbeforeunload = null;
    window.dispatchEvent(new CustomEvent('studio-autosaved', { detail: { ts: Date.now(), bytes: 0, primitives: 0 } }));
  });
  await win.waitForTimeout(100);
  await app.close();
});
