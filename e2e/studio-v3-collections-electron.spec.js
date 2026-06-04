import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-v3-collections');

test('Studio V3 — collections: create/add/remove/list/selectAll/delete (slice 649)', async () => {
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
    try { window.sessionStorage.setItem('studio.v3.splash-shown', '1'); } catch (_) {}
  });
  await win.reload();
  await win.waitForLoadState('domcontentloaded');
  await expect(win.locator('[data-studio-v3-shell]')).toBeVisible({ timeout: 15000 });
  await win.waitForTimeout(400);

  await win.locator('[data-studio-v3-tool="cube"][data-studio-v3-tool-group="add"]').click();
  await win.waitForTimeout(200);
  const aUuid = await win.evaluate(() => window.__studioSelectedMesh().uuid);
  await win.locator('[data-studio-v3-tool="sphere"][data-studio-v3-tool-group="add"]').click();
  await win.waitForTimeout(200);

  // 1: create
  const c = await win.evaluate(() => window.__studioCollectionCreate('heroes'));
  expect(c.ok).toBe(true);
  await win.screenshot({ path: path.join(OUT, '01-create.png') });

  // 2: add selected (sphere is currently selected)
  const ad = await win.evaluate(() => window.__studioCollectionAddSelected('heroes'));
  expect(ad.ok).toBe(true);
  expect(ad.size).toBe(1);
  // add the cube too
  await win.evaluate((u) => { const m = window.__archdiscScene.getObjectByProperty('uuid', u); if (window.__studioSelectMesh) window.__studioSelectMesh(m); }, aUuid);
  await win.evaluate(() => window.__studioCollectionAddSelected('heroes'));
  await win.screenshot({ path: path.join(OUT, '02-add.png') });

  // 3: list
  const list = await win.evaluate(() => window.__studioCollectionList());
  expect(list.collections.length).toBe(1);
  expect(list.collections[0].size).toBe(2);
  await win.screenshot({ path: path.join(OUT, '03-list.png') });

  // 4: remove one
  const rm = await win.evaluate((u) => window.__studioCollectionRemove('heroes', u), aUuid);
  expect(rm.ok).toBe(true);
  expect(rm.removed).toBe(true);
  expect(rm.size).toBe(1);
  await win.screenshot({ path: path.join(OUT, '04-remove.png') });

  // 5: select all
  const sel = await win.evaluate(() => window.__studioCollectionSelectAll('heroes'));
  expect(sel.ok).toBe(true);
  expect(sel.count).toBe(1);
  await win.screenshot({ path: path.join(OUT, '05-select.png') });

  // 6: delete collection
  const del = await win.evaluate(() => window.__studioCollectionDelete('heroes'));
  expect(del.ok).toBe(true);
  expect(del.removed).toBe(true);
  expect(del.count).toBe(0);
  await win.screenshot({ path: path.join(OUT, '06-delete.png') });

  // eslint-disable-next-line no-console
  console.log('  slice 649: 6 collection features verified');

  await win.evaluate(() => {
    window.__studioV3Dirty = false;
    window.onbeforeunload = null;
    window.dispatchEvent(new CustomEvent('studio-autosaved', { detail: { ts: Date.now(), bytes: 0, primitives: 0 } }));
  });
  await win.waitForTimeout(100);
  await app.close();
});
