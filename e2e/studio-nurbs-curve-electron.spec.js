import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

/*
 * Studio — NURBS CURVE (headed Electron).
 *
 * Closes the NURBS-curves half of the Maya/Rhino NURBS gap: a real rational
 * degree-3 B-spline (Cox-de Boor) swept to a tube. Verifies the clamped curve
 * interpolates its end control points, and — the RATIONAL property that makes it
 * a NURBS, not a plain B-spline — that raising a control point's weight pulls the
 * curve toward that point.
 */

const OUT = path.resolve(__dirname, 'screenshots', 'studio-nurbs-curve');
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

test('Studio — NURBS curve: clamped endpoints + rational weight warps the curve', async () => {
  test.setTimeout(240000);
  fs.mkdirSync(OUT, { recursive: true });

  const app = await electron.launch({ args: [path.join(__dirname, '..', 'electron', 'main.js')], slowMo: Number(process.env.STUDIO_SLOWMO) || 220 });
  const win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');
  await expect(win.locator('.workbench-current .workbench-name')).toHaveText('ArchDisc Studio', { timeout: 30000 });
  await expect(win.locator('canvas').first()).toBeVisible({ timeout: 60000 });
  await win.waitForFunction(() => !!window.__archdiscViewport, null, { timeout: 30000 });
  await win.waitForFunction(() => typeof window.__studioAddNurbsCurve === 'function', null, { timeout: 30000 });
  await win.waitForTimeout(400);

  // ── build a NURBS curve via the ribbon ──
  await win.locator('[data-studio-primitive="nurbs-curve"]').click();
  await win.waitForTimeout(400);
  const c = await win.evaluate(() => {
    const s = window.__archdiscScene; let m = null;
    s && s.traverse((o) => { if (o.userData && o.userData.archdiscStudioPrimitiveKind === 'nurbs-curve') m = o; });
    return m ? { ...m.userData.archdiscNurbsCurve, verts: m.geometry.attributes.position.count } : null;
  });
  expect(c, 'a NURBS curve primitive entered the scene').not.toBeNull();
  expect(c.verts, 'curve tube has geometry').toBeGreaterThan(100);
  expect(c.degree, 'degree-3 NURBS').toBe(3);
  // clamped knots -> the curve interpolates its first/last control points
  expect(dist(c.start, c.controlStart), 'curve starts at the first control point (clamped)').toBeLessThan(0.02);
  expect(dist(c.end, c.controlEnd), 'curve ends at the last control point (clamped)').toBeLessThan(0.02);

  await win.evaluate(() => { window.__studioFrameAll && window.__studioFrameAll(); window.__archdiscOrbitView && window.__archdiscOrbitView(18, 22, 1.5); });
  await win.waitForTimeout(250);
  await win.screenshot({ path: path.join(OUT, '01-nurbs-curve.png') });

  // ── rational property: heavier middle weight pulls the curve toward that CP ──
  const light = await win.evaluate(() => window.__studioAddNurbsCurve({ midWeight: 1 }));
  const heavy = await win.evaluate(() => window.__studioAddNurbsCurve({ midWeight: 6 }));
  const dLight = dist(light.mid, light.controlMid);
  const dHeavy = dist(heavy.mid, heavy.controlMid);
  expect(dHeavy, 'higher weight pulls the curve toward the control point (rational NURBS)').toBeLessThan(dLight - 0.02);

  await win.evaluate(() => { window.__studioFrameAll && window.__studioFrameAll(); window.__archdiscOrbitView && window.__archdiscOrbitView(18, 22, 1.4); });
  await win.waitForTimeout(250);
  await win.screenshot({ path: path.join(OUT, '02-nurbs-curve-weights.png') });

  // eslint-disable-next-line no-console
  console.log(`  nurbs curve: verts=${c.verts} deg=${c.degree}; endpoint err start=${dist(c.start, c.controlStart).toFixed(4)} end=${dist(c.end, c.controlEnd).toFixed(4)}; mid->ctrl dist weight1=${dLight.toFixed(3)} weight6=${dHeavy.toFixed(3)}`);

  await app.close();
});
