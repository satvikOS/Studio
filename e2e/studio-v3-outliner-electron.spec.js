import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-v3-outliner');

test('Studio V3 — outliner tree + controls (slice outliner-1)', async () => {
  test.setTimeout(180000);
  fs.mkdirSync(OUT, { recursive: true });

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

  // Install the outliner via the autoload entry (works regardless of
  // whether api.js has wired it through the orchestrator yet).
  await win.evaluate(async () => {
    if (typeof window.__studioOutlinerTree !== 'function') {
      await import('/src/workbenches/studio/v3/outliner/autoload.js');
    }
  });
  await win.waitForFunction(() => typeof window.__studioOutlinerTree === 'function', null, { timeout: 15000 });

  // ─── Spawn three primitives so the tree has something to show. ──────
  for (const kind of ['cube', 'sphere', 'cylinder']) {
    await win.locator(`[data-studio-v3-tool="${kind}"][data-studio-v3-tool-group="add"]`).click();
    await win.waitForTimeout(150);
  }
  await win.waitForTimeout(200);

  // Smoke: tree readout sees at least three primitives plus scene root.
  const t0 = await win.evaluate(() => window.__studioOutlinerTree());
  expect(t0.ok).toBe(true);
  expect(t0.count).toBeGreaterThanOrEqual(4);
  expect(t0.counts.total).toBeGreaterThanOrEqual(4);
  // Root should be classified 'scene'.
  expect(t0.rows[0].kind).toBe('scene');
  expect(t0.rows[0].depth).toBe(0);

  await win.screenshot({ path: path.join(OUT, '00-pre-open.png') });

  // ─── Open the panel. ───────────────────────────────────────────────
  const openRes = await win.evaluate(() => window.__studioOutlinerOpen());
  expect(openRes.ok).toBe(true);
  expect(openRes.open).toBe(true);
  await expect(win.locator('[data-studio-v3-outliner]')).toBeVisible({ timeout: 5000 });
  await win.waitForTimeout(300);
  await win.screenshot({ path: path.join(OUT, '01-open.png') });

  // The root scene row is auto-expanded so we should see its children.
  const rowCount = await win.locator('[data-studio-v3-outliner-row]').count();
  expect(rowCount).toBeGreaterThanOrEqual(4);

  // ─── Pick the first primitive row and exercise its controls. ───────
  const primitiveUuid = await win.evaluate(() => {
    const s = window.__archdiscScene;
    let found = null;
    s.traverse((o) => { if (!found && o.userData && o.userData.archdiscStudioPrimitiveKind === 'cube') found = o; });
    return found ? found.uuid : null;
  });
  expect(primitiveUuid).not.toBeNull();
  const rowSel = `[data-studio-v3-outliner-row="${primitiveUuid}"]`;
  await expect(win.locator(rowSel)).toBeVisible();

  // Click-to-select.
  await win.locator(`${rowSel} [data-studio-v3-outliner-name="${primitiveUuid}"]`).click();
  await win.waitForTimeout(150);
  const sel1 = await win.evaluate(() => {
    const m = window.__studioSelectedMesh && window.__studioSelectedMesh();
    return m ? m.uuid : null;
  });
  expect(sel1).toBe(primitiveUuid);
  await expect(win.locator(`${rowSel}[data-studio-v3-outliner-selected="1"]`)).toBeVisible();
  await win.screenshot({ path: path.join(OUT, '02-selected.png') });

  // Eye toggle hides the cube.
  await win.locator(`${rowSel} [data-studio-v3-outliner-eye="${primitiveUuid}"]`).click();
  await win.waitForTimeout(150);
  const vis1 = await win.evaluate((u) => {
    const o = window.__archdiscScene.getObjectByProperty('uuid', u);
    return o ? o.visible : null;
  }, primitiveUuid);
  expect(vis1).toBe(false);
  await win.screenshot({ path: path.join(OUT, '03-hidden.png') });

  // Eye toggle again restores it.
  await win.locator(`${rowSel} [data-studio-v3-outliner-eye="${primitiveUuid}"]`).click();
  await win.waitForTimeout(150);
  const vis2 = await win.evaluate((u) => {
    const o = window.__archdiscScene.getObjectByProperty('uuid', u);
    return o.visible;
  }, primitiveUuid);
  expect(vis2).toBe(true);

  // Lock toggle.
  await win.locator(`${rowSel} [data-studio-v3-outliner-lock="${primitiveUuid}"]`).click();
  await win.waitForTimeout(150);
  const lock1 = await win.evaluate((u) => {
    const o = window.__archdiscScene.getObjectByProperty('uuid', u);
    return !!(o.userData && o.userData.archdiscStudioFrozen);
  }, primitiveUuid);
  expect(lock1).toBe(true);
  await win.screenshot({ path: path.join(OUT, '04-locked.png') });
  // Unlock via op (covers programmatic toggle path).
  await win.evaluate((u) => window.__studioOutlinerToggleFrozen(u), primitiveUuid);
  await win.waitForTimeout(150);
  const lock2 = await win.evaluate((u) => {
    const o = window.__archdiscScene.getObjectByProperty('uuid', u);
    return !!(o.userData && o.userData.archdiscStudioFrozen);
  }, primitiveUuid);
  expect(lock2).toBe(false);

  // ─── Rename via op (covers the same path the dbl-click UI calls). ─
  const renamed = await win.evaluate((u) => window.__studioOutlinerRename(u, 'TheBigCube'), primitiveUuid);
  expect(renamed.ok).toBe(true);
  expect(renamed.name).toBe('TheBigCube');
  await win.waitForTimeout(200);
  await expect(win.locator(`[data-studio-v3-outliner-name="${primitiveUuid}"]`)).toHaveText('TheBigCube');
  await win.screenshot({ path: path.join(OUT, '05-renamed.png') });

  // ─── Collapse all then expand all. ─────────────────────────────────
  await win.evaluate(() => window.__studioOutlinerCollapseAll());
  await win.waitForTimeout(200);
  // After collapse-all the panel only shows the (auto-re-expanded) root
  // or simply the root itself — count must drop to ≥1.
  const afterCollapse = await win.locator('[data-studio-v3-outliner-row]').count();
  expect(afterCollapse).toBeGreaterThanOrEqual(1);
  await win.screenshot({ path: path.join(OUT, '06-collapsed.png') });

  await win.evaluate(() => window.__studioOutlinerExpandAll());
  await win.waitForTimeout(200);
  const afterExpand = await win.locator('[data-studio-v3-outliner-row]').count();
  expect(afterExpand).toBeGreaterThanOrEqual(rowCount);
  await win.screenshot({ path: path.join(OUT, '07-expanded.png') });

  // ─── Filter via the search box. ────────────────────────────────────
  await win.locator('[data-studio-v3-outliner-search]').fill('cube');
  await win.waitForTimeout(150);
  const filtered = await win.locator('[data-studio-v3-outliner-row]').count();
  expect(filtered).toBeLessThan(afterExpand);
  expect(filtered).toBeGreaterThan(0);
  await win.screenshot({ path: path.join(OUT, '08-search.png') });
  await win.locator('[data-studio-v3-outliner-search]').fill('');

  // ─── Command palette registration under category 'outliner'. ──────
  const cmds = await win.evaluate(() => window.__studioCommandList('outliner'));
  expect(cmds.ok).toBe(true);
  expect(cmds.commands.length).toBeGreaterThanOrEqual(12);
  const names = cmds.commands.map((c) => c.name);
  for (const n of [
    '__studioOutlinerOpen', '__studioOutlinerClose', '__studioOutlinerToggle',
    '__studioOutlinerTree', '__studioOutlinerExpand', '__studioOutlinerToggleVisible',
    '__studioOutlinerToggleFrozen', '__studioOutlinerRename', '__studioOutlinerSelect',
    '__studioOutlinerCollapseAll', '__studioOutlinerExpandAll', '__studioOutlinerRefresh',
  ]) {
    expect(names).toContain(n);
  }

  // ─── Close via the toolbar button. ────────────────────────────────
  await win.locator('[data-studio-v3-outliner-close]').click();
  await expect(win.locator('[data-studio-v3-outliner]')).toBeHidden();

  // ─── Toggle op opens it again. ────────────────────────────────────
  await win.evaluate(() => window.__studioOutlinerToggle());
  await expect(win.locator('[data-studio-v3-outliner]')).toBeVisible({ timeout: 5000 });

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
    await win.screenshot({ path: path.join(OUT, `09-cam-${view}.png`) });
  }

  // eslint-disable-next-line no-console
  console.log('  outliner: tree=%d, ops=%d', t0.count, cmds.commands.length);

  await win.evaluate(() => {
    window.__studioV3Dirty = false;
    window.onbeforeunload = null;
  });
  await app.close();
});
