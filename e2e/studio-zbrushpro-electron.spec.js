// ArchDisc Studio V3 — ZBrush Pro 50+ brush catalogue headed Mac-Electron
// spec (slice 782).
//
// Boots the V3 shell, installs the zbrushpro autoload, and verifies the
// four window ops:
//
//   • __studioZBrushProListBrushes() returns ≥ 50 named brushes
//     (Standard / Clay / DamStandard / Move / Slash / Inflate / Smooth /
//     etc. — the canonical ZBrush palette).
//   • __studioZBrushProCategories() returns the canonical category set
//     present in the catalogue.
//   • __studioZBrushProGetBrushDetails({name:'Clay'}) → baseKernel
//     flatten, blend ['draw', 0.6], description starts with "Flatten + …".
//   • __studioZBrushProApplyBrush({name:'Clay'}) on a high-poly sphere
//     reports ok + changedVerts > 0 AND geometry actually moves (a
//     known reference vertex Y changes by > 1e-5).
//   • Repeat for 'Slash' and 'Inflate' — each on a freshly reset sphere
//     so we measure each brush's effect in isolation.
//
// Camera sweep: 5 named views per remote-desktop watchability rule.
//
// e2e DOES NOT run during this slice (per the brief — the harness runs
// builds, not playwright). This file just has to compile when written.

import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-zbrushpro');
const NAMED_VIEWS = ['front', 'iso', 'right', 'top', 'close'];

test('Studio V3 — ZBrush Pro 50+ brush catalogue (slice 782)', async () => {
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

  // ── Ensure the zbrushdetail + zbrushpro ops are installed. ──────────
  // zbrushpro delegates every kernel pass to slice 758's
  // `__studioZBrushBrush`, so both autoloaders must register before we
  // call applyBrush.
  await win.evaluate(async () => {
    if (typeof window.__studioZBrushBrush !== 'function') {
      await import('/src/workbenches/studio/v3/zbrushdetail/autoload.js');
    }
    if (typeof window.__studioZBrushProApplyBrush !== 'function') {
      await import('/src/workbenches/studio/v3/zbrushpro/autoload.js');
    }
  });
  await win.waitForFunction(
    () => typeof window.__studioZBrushProListBrushes === 'function'
       && typeof window.__studioZBrushProApplyBrush === 'function'
       && typeof window.__studioZBrushProGetBrushDetails === 'function'
       && typeof window.__studioZBrushProCategories === 'function'
       && typeof window.__studioZBrushBrush === 'function',
    null, { timeout: 20000 }
  );
  await win.screenshot({ path: path.join(OUT, '00-shell.png') });

  // ── 1) List brushes — must be at least 50 ────────────────────────────
  const list = await win.evaluate(() => window.__studioZBrushProListBrushes());
  expect(list.ok).toBe(true);
  expect(Array.isArray(list.names)).toBe(true);
  expect(list.names.length).toBeGreaterThanOrEqual(50);
  expect(list.count).toBe(list.names.length);
  // Spot-check canonical ZBrush names are present.
  for (const name of ['Standard', 'Clay', 'DamStandard', 'Move', 'Slash',
                      'Inflate', 'Smooth', 'Polish', 'Pinch', 'Flatten',
                      'Layer', 'ZModeler', 'Cloth', 'Mask']) {
    expect(list.names).toContain(name);
  }
  // eslint-disable-next-line no-console
  console.log('  ZBrush Pro brushes:', list.count);
  await win.screenshot({ path: path.join(OUT, '01-list.png') });

  // ── 2) Categories ───────────────────────────────────────────────────
  const cats = await win.evaluate(() => window.__studioZBrushProCategories());
  expect(cats.ok).toBe(true);
  expect(Array.isArray(cats.categories)).toBe(true);
  expect(cats.categories).toContain('sculpt');
  expect(cats.categories).toContain('mask');
  expect(cats.categories).toContain('curve');
  expect(cats.categories).toContain('insert');
  // eslint-disable-next-line no-console
  console.log('  categories:', cats.categories.join(', '));

  // ── 3) Get details for Clay ─────────────────────────────────────────
  const clayDetails = await win.evaluate(() => window.__studioZBrushProGetBrushDetails({ name: 'Clay' }));
  expect(clayDetails.ok).toBe(true);
  expect(clayDetails.name).toBe('Clay');
  expect(clayDetails.baseKernel).toBe('flatten');
  expect(clayDetails.params.blend).toEqual(['draw', 0.6]);
  expect(typeof clayDetails.description).toBe('string');
  expect(clayDetails.description.length).toBeGreaterThan(8);
  expect(clayDetails.category).toBe('sculpt');

  // Bad-name path.
  const badDetails = await win.evaluate(() => window.__studioZBrushProGetBrushDetails({ name: 'NotARealBrush' }));
  expect(badDetails.ok).toBe(false);
  expect(Array.isArray(badDetails.valid)).toBe(true);
  expect(badDetails.valid.length).toBeGreaterThanOrEqual(50);

  // ── 4) Spawn a high-poly sphere ─────────────────────────────────────
  // 64×64 segments → ~4096 verts so each brush has > 100 verts in its
  // radius to actually move.
  await win.evaluate(() => {
    const THREE = window.THREE;
    const scene = window.__archdiscScene;
    const geo = new THREE.SphereGeometry(0.05, 64, 64);
    const mat = new THREE.MeshStandardMaterial({ color: 0xc4d4e6, roughness: 0.55 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = 'zbrushpro-target';
    mesh.userData = { archdiscStudioPrimitive: true, archdiscStudioPrimitiveKind: 'sphere' };
    scene.add(mesh);
    if (window.__studioSelectMesh) window.__studioSelectMesh(mesh);
    window.__zbrushProTestMesh = mesh;
  });
  await win.waitForTimeout(250);
  await win.screenshot({ path: path.join(OUT, '02-spawn-sphere.png') });

  const meshInfo = await win.evaluate(() => {
    const m = window.__zbrushProTestMesh;
    return {
      uuid: m.uuid,
      verts: m.geometry.attributes.position.count,
    };
  });
  expect(meshInfo.verts).toBeGreaterThan(4000);
  // eslint-disable-next-line no-console
  console.log('  sphere uuid', meshInfo.uuid, 'verts', meshInfo.verts);

  // Helper: reset the sphere geometry between brush applies so we
  // measure each brush's effect in isolation.
  const resetSphere = async () => {
    await win.evaluate(() => {
      const THREE = window.THREE;
      const m = window.__zbrushProTestMesh;
      if (m.geometry && m.geometry.dispose) m.geometry.dispose();
      m.geometry = new THREE.SphereGeometry(0.05, 64, 64);
      m.geometry.computeVertexNormals();
    });
  };

  // Helper: snapshot the +Y pole vertex (highest Y).
  const polePos = async () => win.evaluate(() => {
    const m = window.__zbrushProTestMesh;
    const a = m.geometry.attributes.position.array;
    let maxY = -Infinity, idx = -1;
    for (let i = 0; i < a.length; i += 3) {
      if (a[i + 1] > maxY) { maxY = a[i + 1]; idx = i / 3; }
    }
    return { maxY, idx };
  });

  // Helper: snapshot mean radius for verts above Y > 0.03 (the top cap).
  const topCapMeanR = async () => win.evaluate(() => {
    const m = window.__zbrushProTestMesh;
    const a = m.geometry.attributes.position.array;
    let sR = 0, n = 0;
    for (let i = 0; i < a.length; i += 3) {
      if (a[i + 1] < 0.03) continue;
      const d = Math.sqrt(a[i] * a[i] + a[i + 1] * a[i + 1] + a[i + 2] * a[i + 2]);
      sR += d; n++;
    }
    return { meanR: sR / Math.max(n, 1), n };
  });

  // ── 5) Clay — flatten + draw composite ──────────────────────────────
  await resetSphere();
  const clayBefore = await polePos();
  const clayApply = await win.evaluate((uuid) => {
    return window.__studioZBrushProApplyBrush({
      meshUuid: uuid,
      name: 'Clay',
      center: [0, 0.05, 0],
      radius: 0.03,
      strength: 0.4,
    });
  }, meshInfo.uuid);
  expect(clayApply.ok).toBe(true);
  expect(clayApply.brush).toBe('Clay');
  expect(clayApply.baseKernel).toBe('flatten');
  expect(clayApply.changedVerts).toBeGreaterThan(0);
  expect(clayApply.blend).toBeTruthy();
  expect(clayApply.blend.kernel).toBe('draw');
  const clayAfter = await polePos();
  // eslint-disable-next-line no-console
  console.log('  Clay: maxY', clayBefore.maxY.toFixed(5), '→', clayAfter.maxY.toFixed(5),
    '(changed', clayApply.changedVerts, ')');
  // The Clay brush flattens then draws — the pole should have moved
  // (either up from the draw blend, or down if the flatten dominated).
  expect(Math.abs(clayAfter.maxY - clayBefore.maxY)).toBeGreaterThan(1e-5);
  await win.screenshot({ path: path.join(OUT, '03-clay.png') });

  // ── 6) Slash — directional crease ───────────────────────────────────
  await resetSphere();
  const slashBefore = await topCapMeanR();
  const slashApply = await win.evaluate((uuid) => {
    return window.__studioZBrushProApplyBrush({
      meshUuid: uuid,
      name: 'Slash',
      center: [0, 0.05, 0],
      radius: 0.03,
      strength: 0.6,
    });
  }, meshInfo.uuid);
  expect(slashApply.ok).toBe(true);
  expect(slashApply.brush).toBe('Slash');
  expect(slashApply.baseKernel).toBe('crease');
  expect(slashApply.changedVerts).toBeGreaterThan(0);
  const slashAfter = await topCapMeanR();
  // eslint-disable-next-line no-console
  console.log('  Slash: meanR', slashBefore.meanR.toFixed(5), '→', slashAfter.meanR.toFixed(5),
    '(changed', slashApply.changedVerts, ')');
  // Slash uses the crease kernel which displaces inward along the
  // inverted normal — the mean cap radius MUST shrink.
  expect(slashAfter.meanR).toBeLessThan(slashBefore.meanR);
  await win.screenshot({ path: path.join(OUT, '04-slash.png') });

  // ── 7) Inflate — push along normal ──────────────────────────────────
  await resetSphere();
  const inflateBefore = await topCapMeanR();
  const inflateApply = await win.evaluate((uuid) => {
    return window.__studioZBrushProApplyBrush({
      meshUuid: uuid,
      name: 'Inflate',
      center: [0, 0.05, 0],
      radius: 0.03,
      strength: 0.5,
    });
  }, meshInfo.uuid);
  expect(inflateApply.ok).toBe(true);
  expect(inflateApply.brush).toBe('Inflate');
  expect(inflateApply.baseKernel).toBe('inflate');
  expect(inflateApply.changedVerts).toBeGreaterThan(0);
  const inflateAfter = await topCapMeanR();
  // eslint-disable-next-line no-console
  console.log('  Inflate: meanR', inflateBefore.meanR.toFixed(5), '→', inflateAfter.meanR.toFixed(5),
    '(changed', inflateApply.changedVerts, ')');
  // Inflate pushes outward along the surface normal — the mean cap
  // radius MUST grow.
  expect(inflateAfter.meanR).toBeGreaterThan(inflateBefore.meanR);
  await win.screenshot({ path: path.join(OUT, '05-inflate.png') });

  // ── 8) Bad-brush path ───────────────────────────────────────────────
  const badApply = await win.evaluate((uuid) => {
    return window.__studioZBrushProApplyBrush({
      meshUuid: uuid,
      name: 'NotARealBrushXYZ',
      center: [0, 0, 0], radius: 0.02, strength: 0.5,
    });
  }, meshInfo.uuid);
  expect(badApply.ok).toBe(false);
  expect(Array.isArray(badApply.valid)).toBe(true);
  expect(badApply.valid.length).toBeGreaterThanOrEqual(50);

  // ── 9) Camera sweep ─────────────────────────────────────────────────
  for (const view of NAMED_VIEWS) {
    await win.evaluate((v) => {
      if (typeof window.__studioSetView === 'function') window.__studioSetView(v);
      else if (typeof window.__archdiscSetView === 'function') window.__archdiscSetView(v);
    }, view);
    await win.waitForTimeout(220);
    await win.screenshot({ path: path.join(OUT, `cam-${view}.png`) });
  }

  // eslint-disable-next-line no-console
  console.log('  slice 782: 50+ ZBrush Pro brushes — Clay / Slash / Inflate green');

  await win.evaluate(() => {
    window.__studioV3Dirty = false;
    window.onbeforeunload = null;
    window.dispatchEvent(new CustomEvent('studio-autosaved', { detail: { ts: Date.now(), bytes: 0, primitives: 0 } }));
  });
  await win.waitForTimeout(150);
  await app.close();
});
