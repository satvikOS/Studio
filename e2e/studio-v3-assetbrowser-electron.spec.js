import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-v3-assetbrowser');

test('Studio V3 — asset browser (Blender-3.0-style visual grid)', async () => {
  test.setTimeout(180000);
  fs.mkdirSync(OUT, { recursive: true });

  // Headed Mac-Electron + Vite dev server so we can dynamic-import the
  // assetbrowser autoload module even if the api.js orchestrator
  // hasn't been wired by another agent. Mirrors the matlib pattern.
  const app = await electron.launch({
    args: [path.join(__dirname, '..', 'electron', 'main.js'), '--dev'],
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
    // Clear any prior asset rows so each run starts from a known state.
    for (let i = window.localStorage.length - 1; i >= 0; i--) {
      const k = window.localStorage.key(i);
      if (k && k.startsWith('studio.v3.assets.')) window.localStorage.removeItem(k);
    }
    try { window.sessionStorage.setItem('studio.v3.splash-shown', '1'); } catch (_) {}
  });
  await win.reload();
  await win.waitForLoadState('domcontentloaded');
  await expect(win.locator('[data-studio-v3-shell]')).toBeVisible({ timeout: 15000 });
  await win.waitForFunction(() => typeof window.__studioSelectedMesh === 'function', null, { timeout: 15000 });
  await win.waitForFunction(() => typeof window.__studioAssetSave === 'function', null, { timeout: 15000 });

  // Install the asset browser. Either api.js wired it or we side-load it.
  await win.evaluate(async () => {
    if (typeof window.__studioAssetBrowserOpen !== 'function') {
      await import('/src/workbenches/studio/v3/assetbrowser/autoload.js');
    }
  });
  await win.waitForFunction(() => typeof window.__studioAssetBrowserOpen === 'function', null, { timeout: 15000 });

  // ─── Verify the mandatory op surface is registered. ────────────────
  const opsExist = await win.evaluate(() => ({
    open:    typeof window.__studioAssetBrowserOpen,
    close:   typeof window.__studioAssetBrowserClose,
    toggle:  typeof window.__studioAssetBrowserToggle,
    filter:  typeof window.__studioAssetBrowserSetFilter,
    search:  typeof window.__studioAssetBrowserSetSearch,
    list:    typeof window.__studioAssetBrowserListVisible,
    refresh: typeof window.__studioAssetBrowserRefreshThumbs,
    save:    typeof window.__studioAssetBrowserSaveSelection,
  }));
  for (const k of Object.keys(opsExist)) expect(opsExist[k]).toBe('function');

  // ─── Spawn a cube and attach selection. ────────────────────────────
  await win.locator('[data-studio-v3-tool="cube"][data-studio-v3-tool-group="add"]').click();
  await win.waitForTimeout(400);
  await win.evaluate(() => {
    const vp = window.__archdiscViewport;
    let cube = null;
    vp.scene.traverse((o) => { if (o.userData && o.userData.archdiscStudioPrimitiveKind === 'cube') cube = o; });
    vp.transformControls.attach(cube);
  });
  await win.waitForTimeout(200);
  await win.screenshot({ path: path.join(OUT, '00-cube-selected.png') });

  // ─── Save current selection through the browser op. ────────────────
  const save1 = await win.evaluate(() => window.__studioAssetBrowserSaveSelection('redCube', 'props'));
  expect(save1.ok).toBe(true);
  expect(save1.name).toBe('redCube');

  // Save a second asset so the grid + tag chips have variety.
  await win.locator('[data-studio-v3-tool="sphere"][data-studio-v3-tool-group="add"]').click();
  await win.waitForTimeout(300);
  await win.evaluate(() => {
    const vp = window.__archdiscViewport;
    let sph = null;
    vp.scene.traverse((o) => { if (o.userData && o.userData.archdiscStudioPrimitiveKind === 'sphere') sph = o; });
    vp.transformControls.attach(sph);
  });
  const save2 = await win.evaluate(() => window.__studioAssetBrowserSaveSelection('blueSphere', 'nature'));
  expect(save2.ok).toBe(true);

  // ListVisible should now report 2.
  const listAll = await win.evaluate(() => window.__studioAssetBrowserListVisible());
  expect(listAll.ok).toBe(true);
  expect(listAll.total).toBe(2);
  expect(listAll.count).toBe(2);
  const allNames = listAll.items.map((i) => i.name).sort();
  expect(allNames).toEqual(['blueSphere', 'redCube']);

  // ─── Open the browser. DOM should mount and show both tiles. ───────
  await win.evaluate(() => window.__studioAssetBrowserOpen());
  await expect(win.locator('[data-studio-v3-assetbrowser-panel]')).toBeVisible({ timeout: 5000 });
  await win.waitForTimeout(300);
  const tileCount = await win.locator('[data-studio-v3-assetbrowser-tile]').count();
  expect(tileCount).toBe(2);
  await win.screenshot({ path: path.join(OUT, '01-browser-open.png') });

  // Thumbnails must each have a non-empty src (placeholder dataURL counts).
  const thumbSrcs = await win.locator('[data-studio-v3-assetbrowser-thumb]').evaluateAll(
    (els) => els.map((e) => (e.getAttribute('src') || '').slice(0, 22)),
  );
  for (const src of thumbSrcs) {
    expect(src.startsWith('data:image/')).toBe(true);
  }

  // ─── Tag chip filter — clicking "props" hides the sphere. ──────────
  await win.locator('[data-studio-v3-assetbrowser-chip="props"]').click();
  await win.waitForTimeout(150);
  const propsTiles = await win.locator('[data-studio-v3-assetbrowser-tile]').count();
  expect(propsTiles).toBe(1);
  const propsName = await win.locator('[data-studio-v3-assetbrowser-tile]').first().getAttribute('data-studio-v3-assetbrowser-tile');
  expect(propsName).toBe('redCube');
  await win.screenshot({ path: path.join(OUT, '02-filter-props.png') });

  // Filter via the programmatic op too — empty string clears.
  await win.evaluate(() => window.__studioAssetBrowserSetFilter(''));
  await win.waitForTimeout(100);
  const allAfterClear = await win.locator('[data-studio-v3-assetbrowser-tile]').count();
  expect(allAfterClear).toBe(2);

  // ─── Search bar — filter down to "blue". ───────────────────────────
  await win.locator('[data-studio-v3-assetbrowser-search]').fill('blue');
  await win.waitForTimeout(150);
  const searchTiles = await win.locator('[data-studio-v3-assetbrowser-tile]').count();
  expect(searchTiles).toBe(1);
  await win.screenshot({ path: path.join(OUT, '03-search-blue.png') });

  await win.locator('[data-studio-v3-assetbrowser-search]').fill('');
  await win.waitForTimeout(100);

  // ─── Double-click → instantiate at origin. ─────────────────────────
  const beforeDbl = await win.evaluate(() => {
    let n = 0;
    window.__archdiscScene.traverse((o) => { if (o.userData && o.userData.archdiscStudioAssetName === 'redCube') n++; });
    return n;
  });
  await win.locator('[data-studio-v3-assetbrowser-tile="redCube"]').dblclick();
  await win.waitForTimeout(300);
  const afterDbl = await win.evaluate(() => {
    let n = 0;
    window.__archdiscScene.traverse((o) => { if (o.userData && o.userData.archdiscStudioAssetName === 'redCube') n++; });
    return n;
  });
  expect(afterDbl).toBe(beforeDbl + 1);
  await win.screenshot({ path: path.join(OUT, '04-dbl-click-instantiate.png') });

  // ─── Programmatic drop-to-world instantiate via the op. ───────────
  const drop = await win.evaluate(async () => {
    const r = await window.__studioAssetBrowserInstantiate('blueSphere', [2.5, 0.5, -1.0]);
    return r;
  });
  expect(drop.ok).toBe(true);
  const droppedPos = await win.evaluate(() => {
    let m = null;
    window.__archdiscScene.traverse((o) => {
      if (o.userData && o.userData.archdiscStudioAssetName === 'blueSphere') m = o;
    });
    return m ? m.position.toArray() : null;
  });
  expect(droppedPos).not.toBeNull();
  expect(Math.abs(droppedPos[0] - 2.5)).toBeLessThan(0.1);
  expect(Math.abs(droppedPos[1] - 0.5)).toBeLessThan(0.1);
  expect(Math.abs(droppedPos[2] - (-1.0))).toBeLessThan(0.1);
  await win.screenshot({ path: path.join(OUT, '05-drop-instantiate.png') });

  // ─── Right-click context menu → Delete the blueSphere. ─────────────
  await win.locator('[data-studio-v3-assetbrowser-tile="blueSphere"]').dispatchEvent('contextmenu', {
    button: 2, clientX: 200, clientY: 200,
  });
  await expect(win.locator('[data-studio-v3-assetbrowser-ctx]')).toBeVisible({ timeout: 3000 });
  await win.screenshot({ path: path.join(OUT, '06-ctx-menu.png') });
  await win.locator('[data-studio-v3-assetbrowser-ctx-delete]').click();
  await win.waitForTimeout(200);
  const afterDelete = await win.locator('[data-studio-v3-assetbrowser-tile]').count();
  expect(afterDelete).toBe(1);
  const remaining = await win.evaluate(() => window.__studioAssetBrowserListVisible());
  expect(remaining.total).toBe(1);
  expect(remaining.items[0].name).toBe('redCube');

  // ─── Refresh thumbs op should re-warm the cache. ───────────────────
  const refreshed = await win.evaluate(() => window.__studioAssetBrowserRefreshThumbs());
  expect(refreshed.ok).toBe(true);
  expect(refreshed.warmed).toBeGreaterThanOrEqual(1);

  // ─── Command palette registration under category 'assetbrowser'. ──
  const abCmds = await win.evaluate(() => window.__studioCommandList('assetbrowser'));
  expect(abCmds.ok).toBe(true);
  const cmdNames = abCmds.commands.map((c) => c.name);
  for (const required of [
    '__studioAssetBrowserOpen',
    '__studioAssetBrowserClose',
    '__studioAssetBrowserToggle',
    '__studioAssetBrowserSetFilter',
    '__studioAssetBrowserSetSearch',
    '__studioAssetBrowserListVisible',
    '__studioAssetBrowserRefreshThumbs',
    '__studioAssetBrowserSaveSelection',
  ]) {
    expect(cmdNames).toContain(required);
  }

  // ─── Close via the button. ─────────────────────────────────────────
  await win.locator('[data-studio-v3-assetbrowser-close]').click();
  await expect(win.locator('[data-studio-v3-assetbrowser-panel]')).toBeHidden();
  await win.screenshot({ path: path.join(OUT, '07-closed.png') });

  // Re-open via toggle to prove idempotence.
  await win.evaluate(() => window.__studioAssetBrowserToggle());
  await expect(win.locator('[data-studio-v3-assetbrowser-panel]')).toBeVisible({ timeout: 3000 });
  await win.evaluate(() => window.__studioAssetBrowserToggle());
  await expect(win.locator('[data-studio-v3-assetbrowser-panel]')).toBeHidden();

  // ─── Multi-cam viewport screenshots (front / top / right / iso / close). ──
  for (const view of ['front', 'top', 'right', 'iso', 'close']) {
    await win.evaluate((v) => {
      const vp = window.__archdiscViewport; if (!vp || !vp.camera) return;
      const c = vp.camera;
      if (v === 'front') c.position.set(0, 1.2, 6);
      else if (v === 'top') c.position.set(0, 6, 0.001);
      else if (v === 'right') c.position.set(6, 1.2, 0);
      else if (v === 'iso') c.position.set(4, 4, 4);
      else if (v === 'close') c.position.set(2.4, 2.0, 2.4);
      c.lookAt(0, 0, 0);
    }, view);
    await win.waitForTimeout(200);
    await win.screenshot({ path: path.join(OUT, `08-cam-${view}.png`) });
  }

  // eslint-disable-next-line no-console
  console.log('  assetbrowser: tiles=%d, ctx-menu=ok, registered=%d', tileCount, cmdNames.length);

  await win.evaluate(() => {
    window.__studioV3Dirty = false;
    window.onbeforeunload = null;
  });
  await app.close();
});
