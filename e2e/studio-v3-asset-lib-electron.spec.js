import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-v3-asset-lib');

test('Studio V3 — asset library: save/inst/list/delete/retag/tags (slice 666)', async () => {
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
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (k && k.startsWith('studio.v3.assets.')) localStorage.removeItem(k);
    }
    try { window.sessionStorage.setItem('studio.v3.splash-shown', '1'); } catch (_) {}
  });
  await win.reload();
  await win.waitForLoadState('domcontentloaded');
  await expect(win.locator('[data-studio-v3-shell]')).toBeVisible({ timeout: 15000 });
  await win.waitForTimeout(400);

  await win.locator('[data-studio-v3-tool="cube"][data-studio-v3-tool-group="add"]').click();
  await win.waitForTimeout(200);

  // 1: save
  const s = await win.evaluate(() => window.__studioAssetSave('hero_cube', 'props'));
  expect(s.ok).toBe(true);
  expect(s.name).toBe('hero_cube');
  expect(s.tag).toBe('props');
  await win.screenshot({ path: path.join(OUT, '01-save.png') });

  // 2: instantiate
  const before = await win.evaluate(() => {
    let n = 0;
    window.__archdiscScene.traverse((o) => { if (o.isMesh) n++; });
    return n;
  });
  const inst = await win.evaluate(() => window.__studioAssetInstantiate('hero_cube', [1, 0, 0]));
  expect(inst.ok).toBe(true);
  const after = await win.evaluate(() => {
    let n = 0;
    window.__archdiscScene.traverse((o) => { if (o.isMesh) n++; });
    return n;
  });
  expect(after).toBe(before + 1);
  await win.screenshot({ path: path.join(OUT, '02-inst.png') });

  // 3: list
  const list = await win.evaluate(() => window.__studioAssetList());
  expect(list.count).toBe(1);
  expect(list.items[0].name).toBe('hero_cube');
  await win.screenshot({ path: path.join(OUT, '03-list.png') });

  // 4: retag
  const rt = await win.evaluate(() => window.__studioAssetRetag('hero_cube', 'characters'));
  expect(rt.ok).toBe(true);
  expect(rt.tag).toBe('characters');
  await win.screenshot({ path: path.join(OUT, '04-retag.png') });

  // 5: tag list
  const tags = await win.evaluate(() => window.__studioAssetListTags());
  expect(tags.tags).toContain('characters');
  await win.screenshot({ path: path.join(OUT, '05-tags.png') });

  // 6: delete
  const d = await win.evaluate(() => window.__studioAssetDelete('hero_cube'));
  expect(d.removed).toBe(true);
  const after2 = await win.evaluate(() => window.__studioAssetList());
  expect(after2.count).toBe(0);
  await win.screenshot({ path: path.join(OUT, '06-delete.png') });

  // eslint-disable-next-line no-console
  console.log('  slice 666: 6 asset-library features verified');

  await win.evaluate(() => {
    window.__studioV3Dirty = false;
    window.onbeforeunload = null;
    window.dispatchEvent(new CustomEvent('studio-autosaved', { detail: { ts: Date.now(), bytes: 0, primitives: 0 } }));
  });
  await win.waitForTimeout(100);
  await app.close();
});
