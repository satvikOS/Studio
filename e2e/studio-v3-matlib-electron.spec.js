import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-v3-matlib');

test('Studio V3 — matlib library + browser + apply (slice matlib-1)', async () => {
  test.setTimeout(180000);
  fs.mkdirSync(OUT, { recursive: true });

  // Launch with --dev so Electron loads from the Vite dev server (port
  // 3000) and we can dynamic-import the matlib autoload module by URL
  // even when api.js orchestration hasn't been wired yet by the other
  // agent. The remaining flow (selection, mesh, ops) matches the other
  // V3 specs.
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
    try { window.sessionStorage.setItem('studio.v3.splash-shown', '1'); } catch (_) {}
  });
  await win.reload();
  await win.waitForLoadState('domcontentloaded');
  await expect(win.locator('[data-studio-v3-shell]')).toBeVisible({ timeout: 15000 });
  await win.waitForFunction(() => typeof window.__studioSelectedMesh === 'function', null, { timeout: 15000 });

  // Ensure the matlib module is installed. Either api.js has been
  // wired by the orchestrator (preferred) or we install it ourselves
  // via the autoload entry on the dev server.
  await win.evaluate(async () => {
    if (typeof window.__studioMatLibApply !== 'function') {
      await import('/src/workbenches/studio/v3/matlib/autoload.js');
    }
  });
  await win.waitForFunction(() => typeof window.__studioMatLibApply === 'function', null, { timeout: 15000 });

  // ─── Library count + category coverage. ────────────────────────────
  const counts = await win.evaluate(() => window.__studioMatLibCount());
  expect(counts.ok).toBe(true);
  expect(counts.total).toBeGreaterThanOrEqual(100);
  // 10 mandated categories — all must be non-empty.
  for (const c of ['Metals', 'Plastics', 'Glass', 'Wood', 'Concrete',
                   'Stone', 'Fabric', 'Ceramic', 'Paint', 'Misc']) {
    expect(counts.byCategory[c] || 0).toBeGreaterThan(0);
  }

  const cats = await win.evaluate(() => window.__studioMatLibListCategories());
  expect(cats.ok).toBe(true);
  expect(cats.count).toBe(10);

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
  await win.screenshot({ path: path.join(OUT, '00-cube.png') });

  // ─── Apply a Gold recipe via the generic op. ───────────────────────
  const gold = await win.evaluate(() => window.__studioMatLibApply('metals-gold'));
  expect(gold.ok).toBe(true);
  expect(gold.id).toBe('metals-gold');
  expect(gold.materialType).toBe('MeshPhysicalMaterial');

  const matState1 = await win.evaluate(() => {
    const m = window.__studioSelectedMesh();
    const mat = Array.isArray(m.material) ? m.material[0] : m.material;
    return {
      isPhys: !!mat.isMeshPhysicalMaterial,
      metalness: mat.metalness,
      roughness: mat.roughness,
      colorHex: mat.color.getHex(),
    };
  });
  expect(matState1.isPhys).toBe(true);
  expect(matState1.metalness).toBeCloseTo(1.0, 2);
  expect(Math.abs(matState1.colorHex - 0xffd24a)).toBeLessThan(8);

  await win.screenshot({ path: path.join(OUT, '01-gold-applied.png') });

  // ─── Apply a glass recipe — transmission should turn on. ───────────
  const glass = await win.evaluate(() => window.__studioMatLibApply('glass-clear'));
  expect(glass.ok).toBe(true);
  const matState2 = await win.evaluate(() => {
    const m = window.__studioSelectedMesh();
    const mat = Array.isArray(m.material) ? m.material[0] : m.material;
    return { transmission: mat.transmission, transparent: mat.transparent, ior: mat.ior };
  });
  expect(matState2.transmission).toBeCloseTo(1.0, 2);
  expect(matState2.transparent).toBe(true);
  expect(matState2.ior).toBeCloseTo(1.52, 2);
  await win.screenshot({ path: path.join(OUT, '02-glass-applied.png') });

  // ─── Per-preset op auto-registration. ──────────────────────────────
  const perPreset = await win.evaluate(() => ({
    velvet: typeof window.__studioMatLib_fabric_velvet,
    chrome: typeof window.__studioMatLib_metals_chrome,
    lava: typeof window.__studioMatLib_misc_lava,
  }));
  expect(perPreset.velvet).toBe('function');
  expect(perPreset.chrome).toBe('function');
  expect(perPreset.lava).toBe('function');

  const velvet = await win.evaluate(() => window.__studioMatLib_fabric_velvet());
  expect(velvet.ok).toBe(true);
  expect(velvet.id).toBe('fabric-velvet');
  const matState3 = await win.evaluate(() => {
    const m = window.__studioSelectedMesh();
    const mat = Array.isArray(m.material) ? m.material[0] : m.material;
    return { sheen: mat.sheen, transmission: mat.transmission };
  });
  expect(matState3.sheen).toBeCloseTo(1.0, 2);
  expect(matState3.transmission).toBeCloseTo(0, 2);

  await win.screenshot({ path: path.join(OUT, '03-velvet-applied.png') });

  // ─── Command palette registration under category 'matlib'. ─────────
  const matlibCmds = await win.evaluate(() => window.__studioCommandList('matlib'));
  expect(matlibCmds.ok).toBe(true);
  // 8 generic ops + per-preset entries → must be > 100.
  expect(matlibCmds.commands.length).toBeGreaterThan(100);
  const names = matlibCmds.commands.map((c) => c.name);
  expect(names).toContain('__studioMatLibApply');
  expect(names).toContain('__studioMatLib_metals_gold');
  expect(names).toContain('__studioMatLib_glass_clear');

  // ─── Browser open → DOM mounted → tiles render → close. ────────────
  await win.evaluate(() => window.__studioMatLibBrowserOpen());
  await expect(win.locator('[data-studio-v3-matlib-browser]')).toBeVisible({ timeout: 5000 });
  await win.waitForTimeout(400);
  await win.screenshot({ path: path.join(OUT, '04-browser-open.png') });

  // At least a few tiles should render in the All view.
  const tileCount = await win.locator('[data-studio-v3-matlib-tile]').count();
  expect(tileCount).toBeGreaterThan(20);

  // Filter to Metals via the category dropdown — tile count shrinks.
  await win.locator('[data-studio-v3-matlib-cat]').selectOption('Metals');
  await win.waitForTimeout(200);
  const metalsCount = await win.locator('[data-studio-v3-matlib-tile]').count();
  expect(metalsCount).toBeGreaterThan(0);
  expect(metalsCount).toBeLessThan(tileCount);
  await win.screenshot({ path: path.join(OUT, '05-browser-metals.png') });

  // Click the first Metals tile — that should apply to selection.
  const firstTile = win.locator('[data-studio-v3-matlib-tile]').first();
  const firstTileId = await firstTile.getAttribute('data-studio-v3-matlib-tile');
  await firstTile.click();
  await win.waitForTimeout(200);
  const applied = await win.evaluate(() => {
    const m = window.__studioSelectedMesh();
    return m && m.userData && m.userData.archdiscStudioMatLib;
  });
  expect(applied).toBe(firstTileId);
  await win.screenshot({ path: path.join(OUT, '06-browser-click-apply.png') });

  // Search filter.
  await win.locator('[data-studio-v3-matlib-cat]').selectOption('All');
  await win.locator('[data-studio-v3-matlib-search]').fill('gold');
  await win.waitForTimeout(150);
  const searchCount = await win.locator('[data-studio-v3-matlib-tile]').count();
  expect(searchCount).toBeGreaterThan(0);
  expect(searchCount).toBeLessThan(tileCount);
  await win.screenshot({ path: path.join(OUT, '07-browser-search-gold.png') });

  // Close via the button.
  await win.locator('[data-studio-v3-matlib-close]').click();
  await expect(win.locator('[data-studio-v3-matlib-browser]')).toBeHidden();

  // ─── Multi-cam viewport screenshots (front / top / right / iso / close). ──
  for (const view of ['front', 'top', 'right', 'iso', 'close']) {
    await win.evaluate((v) => {
      const vp = window.__archdiscViewport; if (!vp || !vp.camera) return;
      const c = vp.camera;
      if (v === 'front') c.position.set(0, 0, 6);
      else if (v === 'top') c.position.set(0, 6, 0.001);
      else if (v === 'right') c.position.set(6, 0, 0);
      else if (v === 'iso') c.position.set(4, 4, 4);
      else if (v === 'close') c.position.set(2.4, 2.0, 2.4);
      c.lookAt(0, 0, 0);
    }, view);
    await win.waitForTimeout(200);
    await win.screenshot({ path: path.join(OUT, `08-cam-${view}.png`) });
  }

  // eslint-disable-next-line no-console
  console.log('  matlib: total=%d, perPresetOps=%d, browser=ok', counts.total, matlibCmds.commands.length);

  await win.evaluate(() => {
    window.__studioV3Dirty = false;
    window.onbeforeunload = null;
  });
  await app.close();
});
