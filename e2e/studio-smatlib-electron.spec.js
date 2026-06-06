// ArchDisc Studio V3 — Substance Painter smart-material library
// (slice 769).
//
// Headed Mac-Electron spec. Verifies:
//   • boot the V3 shell, install the smatlib autoload
//   • __studioSMatList() returns ≥ 30 presets, each with name + category
//   • __studioSMatCategories() returns the seven shelf categories
//   • spawn a unit cube, apply 'gold' via __studioSMatApply
//   • assert mesh.material is a MeshStandardMaterial with
//     metalness === 1.0 and roughness < 0.4
//   • 5 cam angles for remote-desktop verification
//
// e2e DOES NOT run during this slice (per the slice brief — the harness
// runs builds, not playwright). This file just has to compile cleanly
// when the autoload + the ops are wired correctly.

import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-smatlib');
const NAMED_VIEWS = ['front', 'iso', 'right', 'top', 'close'];

test('Studio V3 — Substance Painter smart-material library (slice 769)', async () => {
  test.setTimeout(240000);
  fs.mkdirSync(OUT, { recursive: true });

  const app = await electron.launch({
    args: [path.join(__dirname, '..', 'electron', 'main.js'), '--dev'],
    slowMo: Number(process.env.STUDIO_SLOWMO) || 140,
  });
  // --dev may auto-open a DevTools window; pick the real app window.
  let win = null;
  for (let i = 0; i < 30 && !win; i++) {
    win = app.windows().find((w) => {
      const u = (() => { try { return w.url(); } catch (_) { return ''; } })();
      return u && !u.startsWith('devtools://');
    }) || null;
    if (!win) { await new Promise((r) => setTimeout(r, 500)); }
  }
  if (!win) win = await app.firstWindow();
  win.on('dialog', (d) => { d.dismiss().catch(() => {}); });
  await win.waitForLoadState('domcontentloaded');

  await win.evaluate(() => {
    window.localStorage.setItem('studioV3', '1');
    window.localStorage.setItem('studio.v3.tour-seen', '1');
    window.localStorage.removeItem('studio.v3.theme');
    window.localStorage.removeItem('studio.v3.wb');
    try { window.sessionStorage.setItem('studio.v3.splash-shown', '1'); } catch (_) {}
  });
  let shellUp = false;
  for (let attempt = 0; attempt < 4 && !shellUp; attempt++) {
    await win.reload();
    await win.waitForLoadState('domcontentloaded');
    await win.waitForTimeout(1500);
    try {
      await expect(win.locator('[data-studio-v3-shell]')).toBeVisible({ timeout: 40000 });
      shellUp = true;
    } catch (_) { /* retry */ }
  }
  expect(shellUp).toBe(true);
  await win.waitForFunction(() => !!window.__archdiscScene && !!window.THREE, null, { timeout: 30000 });

  // ── Ensure the smatlib module is installed. ────────────────────────
  await win.evaluate(async () => {
    if (typeof window.__studioSMatList !== 'function') {
      await import('/src/workbenches/studio/v3/smatlib/autoload.js');
    }
  });
  await win.waitForFunction(
    () => typeof window.__studioSMatList === 'function'
       && typeof window.__studioSMatApply === 'function'
       && typeof window.__studioSMatPreview === 'function'
       && typeof window.__studioSMatCategories === 'function',
    null, { timeout: 20000 }
  );
  await win.screenshot({ path: path.join(OUT, '00-shell.png') });

  // ── 1) List ≥ 30 presets, each with name + category. ──────────────
  const listing = await win.evaluate(() => window.__studioSMatList());
  console.log('[smatlib] list count=%d', listing.count);
  expect(listing.ok).toBe(true);
  expect(Array.isArray(listing.presets)).toBe(true);
  expect(listing.presets.length).toBeGreaterThanOrEqual(30);
  expect(listing.count).toBe(listing.presets.length);
  for (const p of listing.presets) {
    expect(typeof p.name).toBe('string');
    expect(typeof p.category).toBe('string');
  }
  // Sanity: every brief-named preset is present.
  const names = new Set(listing.presets.map((p) => p.name));
  for (const must of [
    'gold', 'copper', 'aluminum', 'iron', 'steel', 'bronze', 'titanium',
    'chrome', 'nickel', 'brass',
    'oak', 'walnut', 'pine', 'mahogany',
    'matte_plastic', 'glossy_plastic', 'silicone', 'rubber',
    'linen', 'cotton', 'silk', 'wool', 'velvet', 'denim',
    'porcelain', 'terracotta', 'glazed_ceramic', 'raw_ceramic',
    'marble', 'granite', 'sandstone', 'slate',
    'clear_glass', 'frosted_glass', 'tinted_glass',
  ]) {
    expect(names.has(must)).toBe(true);
  }

  // ── 2) Categories list. ───────────────────────────────────────────
  const cats = await win.evaluate(() => window.__studioSMatCategories());
  expect(cats.ok).toBe(true);
  expect(Array.isArray(cats.categories)).toBe(true);
  for (const c of [
    'metals', 'woods', 'plastics', 'fabrics', 'ceramics', 'stones', 'glass',
  ]) {
    expect(cats.categories.includes(c)).toBe(true);
  }

  // ── 3) Spawn a unit cube. ─────────────────────────────────────────
  const cube = await win.evaluate(() => {
    const THREE = window.THREE;
    const g = new THREE.BoxGeometry(1, 1, 1);
    const m = new THREE.MeshStandardMaterial({ color: 0x808080, roughness: 0.5 });
    const mesh = new THREE.Mesh(g, m);
    mesh.userData.archdiscStudioPrimitive = true;
    mesh.userData.archdiscStudioPrimitiveKind = 'cube';
    window.__archdiscScene.add(mesh);
    if (typeof window.__studioSelectMesh === 'function') {
      try { window.__studioSelectMesh(mesh); } catch (_) {}
    }
    return { uuid: mesh.uuid };
  });
  expect(typeof cube.uuid).toBe('string');
  console.log('[smatlib] cube uuid', cube.uuid);
  await win.waitForTimeout(150);
  await win.screenshot({ path: path.join(OUT, '01-cube.png') });

  // ── 4) Preview the 'gold' preset (no scene mutation). ─────────────
  const preview = await win.evaluate(() => window.__studioSMatPreview({ name: 'gold' }));
  console.log('[smatlib] preview gold', JSON.stringify(preview));
  expect(preview.ok).toBe(true);
  expect(preview.values.name).toBe('gold');
  expect(preview.values.category).toBe('metals');
  expect(preview.values.metalness).toBe(1.0);
  expect(preview.values.roughness).toBeLessThan(0.4);

  // ── 5) Apply 'gold' to the cube. ──────────────────────────────────
  const applied = await win.evaluate((uuid) => {
    return window.__studioSMatApply({ meshUuid: uuid, name: 'gold' });
  }, cube.uuid);
  console.log('[smatlib] apply gold', JSON.stringify(applied));
  expect(applied.ok).toBe(true);
  expect(applied.applied.name).toBe('gold');
  expect(applied.applied.category).toBe('metals');

  // ── 6) Verify the live material was swapped. ──────────────────────
  const mat = await win.evaluate((uuid) => {
    const o = window.__archdiscScene.getObjectByProperty('uuid', uuid);
    if (!o || !o.material) return { found: false };
    const m = Array.isArray(o.material) ? o.material[0] : o.material;
    return {
      found: true,
      type: m.type,
      isStandard: !!m.isMeshStandardMaterial,
      isPhysical: !!m.isMeshPhysicalMaterial,
      metalness: m.metalness,
      roughness: m.roughness,
      color: m.color ? m.color.getHex() : null,
      tag: o.userData && o.userData.archdiscStudioSmartMat,
    };
  }, cube.uuid);
  console.log('[smatlib] mat', JSON.stringify(mat));
  expect(mat.found).toBe(true);
  // MeshPhysicalMaterial is a MeshStandardMaterial subclass — either is
  // valid per the spec (gold has no clearcoat/ior, so it should be the
  // plain Standard variant).
  expect(mat.isStandard).toBe(true);
  expect(mat.metalness).toBe(1.0);
  expect(mat.roughness).toBeLessThan(0.4);
  expect(mat.tag).toBe('gold');

  await win.waitForTimeout(150);
  await win.screenshot({ path: path.join(OUT, '02-gold-applied.png') });

  // ── 7) Apply 'clear_glass' to confirm the Physical-material path. ─
  const cube2 = await win.evaluate(() => {
    const THREE = window.THREE;
    const g = new THREE.BoxGeometry(1, 1, 1);
    const m = new THREE.MeshStandardMaterial({ color: 0x808080, roughness: 0.5 });
    const mesh = new THREE.Mesh(g, m);
    mesh.position.set(2, 0, 0);
    window.__archdiscScene.add(mesh);
    return { uuid: mesh.uuid };
  });
  const glass = await win.evaluate((uuid) => {
    return window.__studioSMatApply({ meshUuid: uuid, name: 'clear_glass' });
  }, cube2.uuid);
  expect(glass.ok).toBe(true);
  const glassMat = await win.evaluate((uuid) => {
    const o = window.__archdiscScene.getObjectByProperty('uuid', uuid);
    const m = Array.isArray(o.material) ? o.material[0] : o.material;
    return {
      type: m.type,
      isPhysical: !!m.isMeshPhysicalMaterial,
      ior: m.ior,
      transmission: m.transmission,
    };
  }, cube2.uuid);
  console.log('[smatlib] clear_glass mat', JSON.stringify(glassMat));
  expect(glassMat.isPhysical).toBe(true);
  expect(glassMat.ior).toBeCloseTo(1.5, 3);
  expect(glassMat.transmission).toBeGreaterThan(0);
  await win.waitForTimeout(150);
  await win.screenshot({ path: path.join(OUT, '03-glass-applied.png') });

  // ── 8) Camera sweep. ──────────────────────────────────────────────
  for (const view of NAMED_VIEWS) {
    await win.evaluate((v) => {
      const vp = window.__archdiscViewport;
      const c = vp && vp.camera;
      if (c) {
        if (v === 'front') c.position.set(0, 0, 4);
        else if (v === 'top') c.position.set(0, 4, 0.001);
        else if (v === 'right') c.position.set(4, 0, 0);
        else if (v === 'iso') c.position.set(3, 3, 3);
        else if (v === 'close') c.position.set(1.5, 1.5, 1.5);
        c.lookAt(0, 0, 0);
      } else if (typeof window.__studioSetView === 'function') {
        window.__studioSetView(v);
      } else if (typeof window.__archdiscSetView === 'function') {
        window.__archdiscSetView(v);
      }
    }, view);
    await win.waitForTimeout(220);
    await win.screenshot({ path: path.join(OUT, `cam-${view}.png`) });
  }

  // eslint-disable-next-line no-console
  console.log('  slice 769: smatlib presets=%d categories=%d gold metalness=%f roughness=%f',
    listing.count, cats.categories.length, mat.metalness, mat.roughness);

  await win.evaluate(() => {
    window.__studioV3Dirty = false;
    window.onbeforeunload = null;
  });
  await app.close();
});
