import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

/*
 * Studio — FIELD-ALIGNED QUAD REMESH / ZRemesher (headed Electron).
 *
 * The genuine field-aligned retopology (ZBrush ZRemesher / Instant Meshes):
 * estimate the principal-curvature cross-field, RoSy-smooth it, and trace a
 * field-following streamline quad net. The discriminating proof vs a uniform
 * grid: on a surface whose curvature runs DIAGONALLY, the quad flow must rotate
 * to ~45 deg (follow curvature) rather than staying on the 0/90 parameter axes,
 * and the quad edges must align to the field (alignment ~1). Different surfaces
 * yield different flow angles (curvature-driven, not hardcoded).
 */

const OUT = path.resolve(__dirname, 'screenshots', 'studio-field-quad-remesh');
const deg = (r) => (r * 180 / Math.PI);

test('Studio — field-aligned quad remesh flows with curvature', async () => {
  test.setTimeout(240000);
  fs.mkdirSync(OUT, { recursive: true });

  const app = await electron.launch({ args: [path.join(__dirname, '..', 'electron', 'main.js')], slowMo: Number(process.env.STUDIO_SLOWMO) || 220 });
  const win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');
  await expect(win.locator('.workbench-current .workbench-name')).toHaveText('ArchDisc Studio', { timeout: 30000 });
  await expect(win.locator('canvas').first()).toBeVisible({ timeout: 60000 });
  await win.waitForFunction(() => !!window.__archdiscViewport, null, { timeout: 30000 });
  await win.waitForFunction(() => typeof window.__studioFieldQuadRemesh === 'function', null, { timeout: 30000 });
  await win.waitForTimeout(400);

  // ── build the field-aligned quad net on the diagonal-wave surface (ribbon) ──
  await win.locator('[data-studio-ribbon-action="field-quad-remesh"]').click();
  await win.waitForTimeout(400);
  const diag = await win.evaluate(() => {
    const s = window.__archdiscScene; let m = null;
    s && s.traverse((o) => { if (o.userData && o.userData.archdiscStudioPrimitiveKind === 'field-quad') m = o; });
    if (!m) return null;
    let wire = false; m.traverse((c) => { if (c.userData && c.userData.archdiscQuadWire) wire = true; });
    const fq = m.userData.archdiscFieldQuad;
    return { ...fq, quads: m.userData.archdiscQuads.length, verts: m.geometry.attributes.position.count, wire };
  });
  expect(diag, 'a field-quad primitive entered the scene').not.toBeNull();
  expect(diag.quads, 'produced a quad net').toBeGreaterThan(100);
  expect(diag.alignment, 'quad edges align to the curvature field').toBeGreaterThan(0.85);
  // diagonal curvature -> flow rotates to ~45deg, NOT the 0/90 parameter axes
  expect(deg(diag.meanFieldAngle), 'flow follows the diagonal curvature (not the u/v axes)').toBeGreaterThan(25);
  expect(deg(diag.meanFieldAngle), 'flow follows the diagonal curvature (not the u/v axes)').toBeLessThan(65);
  expect(diag.wire, 'visible quad-edge wireframe shows the flow').toBe(true);

  await win.evaluate(() => { window.__studioFrameAll && window.__studioFrameAll(); window.__archdiscOrbitView && window.__archdiscOrbitView(18, 38, 1.5); });
  await win.waitForTimeout(250);
  await win.screenshot({ path: path.join(OUT, '01-diagwave-fieldquad.png') });

  // ── different surfaces -> different curvature-driven flow (cylinder = hoop ~0/90) ──
  const cyl = await win.evaluate(() => window.__studioFieldQuadRemesh({ surface: 'cylinder' }));
  expect(cyl.alignment, 'cylinder net aligns to its hoop/axial field').toBeGreaterThan(0.85);
  const cylDeg = deg(cyl.meanFieldAngle);
  const cylAxisAligned = cylDeg < 20 || cylDeg > 70; // hoop or axial, i.e. on the axes
  expect(cylAxisAligned, 'cylinder flow is hoop/axial (on-axis), unlike the diagonal wave').toBe(true);

  await win.evaluate(() => { window.__studioFrameAll && window.__studioFrameAll(); window.__archdiscOrbitView && window.__archdiscOrbitView(20, 18, 1.4); });
  await win.waitForTimeout(250);
  await win.screenshot({ path: path.join(OUT, '02-cylinder-fieldquad.png') });

  // eslint-disable-next-line no-console
  console.log(`  field quad: diagwave flow=${deg(diag.meanFieldAngle).toFixed(1)}deg align=${diag.alignment.toFixed(3)} quads=${diag.quads}; cylinder flow=${cylDeg.toFixed(1)}deg align=${cyl.alignment.toFixed(3)}`);

  await app.close();
});
