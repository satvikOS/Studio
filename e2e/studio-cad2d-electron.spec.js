// ArchDisc Studio V3 — AutoCAD 2D drawing layer (slice 774).
//
// Headed Mac-Electron spec. Verifies the 2D entity model + SVG XML
// export installed by `v3/cad2d/`.
//
// Flow:
//   • boot the V3 shell
//   • ensure the cad2d autoload has installed __studioCAD2D*
//   • __studioCAD2DCreateDrawing({name:'spec-774'})         → ok
//   • __studioCAD2DAddLine + AddCircle + AddDimension       → ok with entityId
//   • __studioCAD2DAddRectangle + AddPolyline + AddArc + AddText → ok
//   • __studioCAD2DExportSVG                                → ok with svg
//   • assert svg contains <line/> <circle/> <text/>
//   • assert the named drawing shows up in List + has matching stats
//   • 5 named cam angles get captured for remote-desktop watchers.
//
// e2e DOES NOT run during this slice (per the brief); this file just
// has to compile when written.

import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-cad2d');
const NAMED_VIEWS = ['front', 'top', 'right', 'iso', 'close'];

test('Studio V3 — AutoCAD 2D drawing + SVG export (slice 774)', async () => {
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

  // ── Ensure the cad2d autoload has run. ────────────────────────────
  await win.evaluate(async () => {
    if (typeof window.__studioCAD2DCreateDrawing !== 'function') {
      await import('/src/workbenches/studio/v3/cad2d/autoload.js');
    }
  });
  await win.waitForFunction(
    () => typeof window.__studioCAD2DCreateDrawing === 'function'
       && typeof window.__studioCAD2DAddLine === 'function'
       && typeof window.__studioCAD2DAddPolyline === 'function'
       && typeof window.__studioCAD2DAddArc === 'function'
       && typeof window.__studioCAD2DAddCircle === 'function'
       && typeof window.__studioCAD2DAddRectangle === 'function'
       && typeof window.__studioCAD2DAddDimension === 'function'
       && typeof window.__studioCAD2DAddText === 'function'
       && typeof window.__studioCAD2DExportSVG === 'function'
       && typeof window.__studioCAD2DList === 'function'
       && typeof window.__studioCAD2DDelete === 'function',
    null, { timeout: 20000 }
  );
  await win.screenshot({ path: path.join(OUT, '00-shell.png') });

  // ── 1) Create a drawing. ─────────────────────────────────────────
  const created = await win.evaluate(() => window.__studioCAD2DCreateDrawing({ name: 'spec-774' }));
  expect(created.ok).toBe(true);
  expect(created.name).toBe('spec-774');

  // Duplicate name should fail with a clear error code.
  const dup = await win.evaluate(() => window.__studioCAD2DCreateDrawing({ name: 'spec-774' }));
  expect(dup.ok).toBe(false);
  expect(dup.error).toBe('name-exists');

  // ── 2) Add a Line, Circle, Dimension (the required trio). ────────
  const ln = await win.evaluate(() => window.__studioCAD2DAddLine({
    drawingName: 'spec-774', p1: [0, 0], p2: [10, 0], color: '#ff0000',
  }));
  expect(ln.ok).toBe(true);
  expect(typeof ln.entityId).toBe('string');

  const ci = await win.evaluate(() => window.__studioCAD2DAddCircle({
    drawingName: 'spec-774', center: [5, 5], radius: 2, layer: 'circles', color: '#0000ff',
  }));
  expect(ci.ok).toBe(true);
  expect(typeof ci.entityId).toBe('string');

  const dim = await win.evaluate(() => window.__studioCAD2DAddDimension({
    drawingName: 'spec-774', p1: [0, 0], p2: [10, 0], offset: -1.5, color: '#222222',
  }));
  expect(dim.ok).toBe(true);
  expect(typeof dim.entityId).toBe('string');

  // ── 3) Add the remaining four entity kinds. ──────────────────────
  const rect = await win.evaluate(() => window.__studioCAD2DAddRectangle({
    drawingName: 'spec-774', p1: [-2, -2], p2: [-1, -1],
  }));
  expect(rect.ok).toBe(true);

  const arc = await win.evaluate(() => window.__studioCAD2DAddArc({
    drawingName: 'spec-774',
    center: [5, -5], radius: 3, startAngle: 0, endAngle: Math.PI,
  }));
  expect(arc.ok).toBe(true);

  const poly = await win.evaluate(() => window.__studioCAD2DAddPolyline({
    drawingName: 'spec-774',
    points: [[0, 8], [1, 9], [3, 9], [4, 8]],
  }));
  expect(poly.ok).toBe(true);

  const tx = await win.evaluate(() => window.__studioCAD2DAddText({
    drawingName: 'spec-774', position: [0, -3], content: 'Plate A', size: 14,
  }));
  expect(tx.ok).toBe(true);

  // ── 4) List + stats. ─────────────────────────────────────────────
  const list = await win.evaluate(() => window.__studioCAD2DList());
  expect(list.ok).toBe(true);
  expect(list.count).toBeGreaterThanOrEqual(1);
  const me = list.drawings.find((d) => d.name === 'spec-774');
  expect(me).toBeTruthy();
  expect(me.entityCount).toBe(7);
  // Two layers: '0' (default) + 'circles'.
  expect(me.layerCount).toBeGreaterThanOrEqual(2);

  const stats = await win.evaluate(() => window.__studioCAD2DStats({ drawingName: 'spec-774' }));
  expect(stats.ok).toBe(true);
  expect(stats.stats.entityCount).toBe(7);
  expect(stats.stats.perKind.line).toBe(1);
  expect(stats.stats.perKind.circle).toBe(1);
  expect(stats.stats.perKind.dimensionLinear).toBe(1);
  expect(stats.stats.perKind.rectangle).toBe(1);
  expect(stats.stats.perKind.arc).toBe(1);
  expect(stats.stats.perKind.polyline).toBe(1);
  expect(stats.stats.perKind.text).toBe(1);

  // ── 5) Export to SVG; assert <line/> <circle/> <text/> present. ──
  const exp = await win.evaluate(() => window.__studioCAD2DExportSVG({ drawingName: 'spec-774' }));
  expect(exp.ok).toBe(true);
  expect(typeof exp.svg).toBe('string');
  expect(exp.svg.startsWith('<?xml')).toBe(true);
  expect(exp.svg).toContain('<svg');
  expect(exp.svg).toContain('<line');
  expect(exp.svg).toContain('<circle');
  expect(exp.svg).toContain('<text');
  expect(exp.svg).toContain('<polyline');
  expect(exp.svg).toContain('<rect');
  // Arc emits as <path d="M ... A ...">.
  expect(exp.svg).toMatch(/<path[^>]*d="M [^"]*A /);
  // Layer grouping should be present.
  expect(exp.svg).toContain('data-layer="0"');
  expect(exp.svg).toContain('data-layer="circles"');
  // Color from the line is preserved.
  expect(exp.svg).toContain('#ff0000');
  // Drawing name embedded.
  expect(exp.svg).toContain('spec-774');

  // ── 6) Delete the drawing; List goes back to whatever was there. ──
  const before = await win.evaluate(() => window.__studioCAD2DList().count);
  const del = await win.evaluate(() => window.__studioCAD2DDelete({ drawingName: 'spec-774' }));
  expect(del.ok).toBe(true);
  const after = await win.evaluate(() => window.__studioCAD2DList().count);
  expect(after).toBe(before - 1);

  // ── 7) 5-cam sweep. ──────────────────────────────────────────────
  for (const view of NAMED_VIEWS) {
    await win.evaluate((v) => {
      if (typeof window.__studioSetView === 'function') window.__studioSetView(v);
      else if (typeof window.__archdiscSetView === 'function') window.__archdiscSetView(v);
    }, view);
    await win.waitForTimeout(220);
    await win.screenshot({ path: path.join(OUT, `cam-${view}.png`) });
  }

  // eslint-disable-next-line no-console
  console.log('  slice 774: drawing entities', me.entityCount,
    'layers', me.layerCount,
    'svg bytes', exp.svg.length,
    'list after delete', after);

  await app.close();
});
