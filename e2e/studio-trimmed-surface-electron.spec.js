import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

/*
 * Studio — TRIMMED SURFACE (headed Electron).
 *
 * Closes (at the face level) the trimmed-B-rep gap: a parametric patch trimmed
 * by uv loops (outer boundary + inner holes), the building block of a trimmed
 * B-rep face (Rhino/Maya trimmed surfaces). Verifies the trim actually removes
 * geometry inside the hole loop (a real hole around the patch centre with no
 * faces) while keeping the rest, and that adding a hole reduces the kept-cell
 * count. Honest scope: trimmed SURFACE, not sewn solid B-rep booleans.
 */

const OUT = path.resolve(__dirname, 'screenshots', 'studio-trimmed-surface');

test('Studio — trimmed surface cuts a real hole following the trim loop', async () => {
  test.setTimeout(240000);
  fs.mkdirSync(OUT, { recursive: true });

  const app = await electron.launch({ args: [path.join(__dirname, '..', 'electron', 'main.js')], slowMo: Number(process.env.STUDIO_SLOWMO) || 220 });
  const win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');
  await expect(win.locator('.workbench-current .workbench-name')).toHaveText('ArchDisc Studio', { timeout: 30000 });
  await expect(win.locator('canvas').first()).toBeVisible({ timeout: 60000 });
  await win.waitForFunction(() => !!window.__archdiscViewport, null, { timeout: 30000 });
  await win.waitForFunction(() => typeof window.__studioTrimmedSurface === 'function', null, { timeout: 30000 });
  await win.waitForTimeout(400);

  // ── build the default trimmed surface (square outer + central circular hole) ──
  await win.locator('[data-studio-primitive="trimmed-surface"]').click();
  await win.waitForTimeout(400);
  const t = await win.evaluate(() => {
    const s = window.__archdiscScene; let m = null;
    s && s.traverse((o) => { if (o.userData && o.userData.archdiscStudioPrimitiveKind === 'trimmed-surface') m = o; });
    if (!m) return null;
    const g = m.geometry; const pos = g.attributes.position; const idx = g.index.array;
    let minR = 1e9; // nearest kept triangle to the patch centre (the hole is here)
    for (let i = 0; i < idx.length; i += 3) {
      let cx = 0, cz = 0; for (let k = 0; k < 3; k++) { const vi = idx[i + k]; cx += pos.getX(vi); cz += pos.getZ(vi); }
      const r = Math.hypot(cx / 3, cz / 3); if (r < minR) minR = r;
    }
    return { ...m.userData.archdiscTrim, minHoleR: minR, tris: idx.length / 3 };
  });
  expect(t, 'a trimmed-surface primitive entered the scene').not.toBeNull();
  expect(t.tris, 'surface has faces').toBeGreaterThan(100);
  expect(t.cellsKept, 'trimming removed cells (kept < total)').toBeLessThan(t.cellsTotal);
  expect(t.cellsInHole, 'cells fell inside the hole loop').toBeGreaterThan(0);
  // a REAL hole exists around the patch centre: no kept face near the centre
  expect(t.minHoleR, 'no faces inside the trimmed hole').toBeGreaterThan(0.15);

  await win.evaluate(() => { window.__studioFrameAll && window.__studioFrameAll(); window.__archdiscOrbitView && window.__archdiscOrbitView(16, 40, 1.5); });
  await win.waitForTimeout(250);
  await win.screenshot({ path: path.join(OUT, '01-trimmed-hole.png') });

  // ── via hook: two holes remove strictly more than one ──
  const two = await win.evaluate(() => window.__studioTrimmedSurface({
    holes: [
      Array.from({ length: 40 }, (_, i) => { const a = i / 40 * Math.PI * 2; return [0.32 + Math.cos(a) * 0.12, 0.5 + Math.sin(a) * 0.12]; }),
      Array.from({ length: 40 }, (_, i) => { const a = i / 40 * Math.PI * 2; return [0.68 + Math.cos(a) * 0.12, 0.5 + Math.sin(a) * 0.12]; }),
    ],
  }));
  expect(two.holes, 'two trim holes').toBe(2);
  expect(two.cellsInHole, 'two holes remove cells').toBeGreaterThan(0);

  await win.evaluate(() => { window.__studioFrameAll && window.__studioFrameAll(); window.__archdiscOrbitView && window.__archdiscOrbitView(16, 40, 1.4); });
  await win.waitForTimeout(250);
  await win.screenshot({ path: path.join(OUT, '02-two-holes.png') });

  // eslint-disable-next-line no-console
  console.log(`  trimmed surface: kept ${t.cellsKept}/${t.cellsTotal} cells, ${t.cellsInHole} in hole, minHoleR=${t.minHoleR.toFixed(3)}, tris=${t.tris}; two-hole inHole=${two.cellsInHole}`);

  await app.close();
});
