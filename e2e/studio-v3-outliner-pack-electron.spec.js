import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-v3-outliner-pack');

test('Studio V3 — outliner: list/rename/visible/frozen/reparent/tag (slice 631)', async () => {
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
  await win.locator('[data-studio-v3-tool="sphere"][data-studio-v3-tool-group="add"]').click();
  await win.waitForTimeout(200);
  await win.locator('[data-studio-v3-tool="cylinder"][data-studio-v3-tool-group="add"]').click();
  await win.waitForTimeout(200);

  // 1: list
  const list = await win.evaluate(() => window.__studioListSceneMeshes());
  expect(list.ok).toBe(true);
  expect(list.count).toBeGreaterThanOrEqual(3);
  const uuid = list.meshes[0].uuid;
  await win.screenshot({ path: path.join(OUT, '01-list.png') });

  // 2: rename
  const ren = await win.evaluate((u) => window.__studioRenameMesh(u, 'hero_cube'), uuid);
  expect(ren.ok).toBe(true);
  expect(ren.name).toBe('hero_cube');
  await win.screenshot({ path: path.join(OUT, '02-rename.png') });

  // 3: set visible false
  const vis = await win.evaluate((u) => window.__studioSetMeshVisible(u, false), uuid);
  expect(vis.ok).toBe(true);
  expect(vis.visible).toBe(false);
  await win.screenshot({ path: path.join(OUT, '03-visible.png') });

  // 4: freeze
  const fr = await win.evaluate((u) => window.__studioSetMeshFrozen(u, true), uuid);
  expect(fr.ok).toBe(true);
  expect(fr.frozen).toBe(true);
  await win.screenshot({ path: path.join(OUT, '04-frozen.png') });

  // 5: reparent: child = list[1], parent = uuid
  const parentUuid = uuid;
  const childUuid = list.meshes[1].uuid;
  const re = await win.evaluate(([c, p]) => window.__studioReparentMesh(c, p), [childUuid, parentUuid]);
  expect(re.ok).toBe(true);
  expect(re.parent).toBe(parentUuid);
  await win.screenshot({ path: path.join(OUT, '05-reparent.png') });

  // 6: tag color
  const tag = await win.evaluate((u) => window.__studioSetMeshTagColor(u, '#ff8800'), uuid);
  expect(tag.ok).toBe(true);
  expect(tag.color).toBe('#ff8800');
  await win.screenshot({ path: path.join(OUT, '06-tag.png') });

  // eslint-disable-next-line no-console
  console.log('  slice 631: 6 features — outliner verified across', list.count, 'meshes');

  await win.evaluate(() => {
    window.__studioV3Dirty = false;
    window.onbeforeunload = null;
    window.dispatchEvent(new CustomEvent('studio-autosaved', { detail: { ts: Date.now(), bytes: 0, primitives: 0 } }));
  });
  await win.waitForTimeout(100);
  await app.close();
});
