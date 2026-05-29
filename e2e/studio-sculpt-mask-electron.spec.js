import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

/*
 * Studio — ZBRUSH SCULPT MASK (headed Electron).
 *
 * Closes a DCC gap (ZBrush masking, previously a counter-only STUB). A real
 * per-vertex protect-mask: paint a mask over the TOP of a sphere, then run an
 * inflate brush over the WHOLE mesh — masked (top) vertices hold their shape
 * while unmasked (bottom) vertices inflate. Masked verts shade darker
 * (vertex-colour viz). Verified numerically (top displacement << bottom) +
 * visually.
 */

const OUT = path.resolve(__dirname, 'screenshots', 'studio-sculpt-mask');

test('Studio — sculpt mask protects masked vertices from the brush', async () => {
  test.setTimeout(240000);
  fs.mkdirSync(OUT, { recursive: true });

  const app = await electron.launch({ args: [path.join(__dirname, '..', 'electron', 'main.js')], slowMo: Number(process.env.STUDIO_SLOWMO) || 220 });
  const win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');
  await expect(win.locator('.workbench-current .workbench-name')).toHaveText('ArchDisc Studio', { timeout: 30000 });
  await expect(win.locator('canvas').first()).toBeVisible({ timeout: 60000 });
  await win.waitForFunction(() => !!window.__archdiscViewport, null, { timeout: 30000 });
  await win.waitForFunction(() => typeof window.__studioSelectMesh === 'function', null, { timeout: 30000 });
  await win.waitForFunction(() => typeof window.__studioPaintMaskAt === 'function', null, { timeout: 30000 });
  await win.waitForTimeout(500);

  // Sphere, selected. (UV sphere already has plenty of verts for a top/bottom split.)
  await win.locator('[data-studio-primitive="sphere"]').click();
  await win.waitForTimeout(250);
  await win.evaluate(() => {
    const s = window.__archdiscScene; let m = null;
    s && s.traverse((o) => { if (o.userData && o.userData.archdiscStudioPrimitive) m = o; });
    if (m && window.__studioSelectMesh) window.__studioSelectMesh(m);
  });
  await win.waitForTimeout(200);

  // Paint a mask at the TOP (3 passes build a strongly-masked cap). Brush
  // falloff is radial, so we test by mask STRENGTH buckets rather than a clean
  // hemisphere split.
  const masked = await win.evaluate(() => {
    const m = window.__studioSelectedMesh(); if (!m) return null;
    m.geometry.computeBoundingBox(); const bb = m.geometry.boundingBox;
    const box = bb.clone().applyMatrix4(m.matrixWorld);
    const cx = (box.min.x + box.max.x) / 2, cz = (box.min.z + box.max.z) / 2, topY = box.max.y;
    const h = box.max.y - box.min.y;
    for (let p = 0; p < 3; p++) window.__studioPaintMaskAt([cx, topY, cz], h * 0.6, 1);
    const mask = m.userData.archdiscStudioMask; const pos = m.geometry.attributes.position;
    const cyLocal = (bb.min.y + bb.max.y) / 2;
    let strong = 0, strongTopY = 0, unmasked = 0;
    for (let i = 0; i < pos.count; i++) {
      if (mask[i] > 0.7) { strong++; strongTopY += (pos.getY(i) > cyLocal ? 1 : 0); }
      else if (mask[i] < 0.1) unmasked++;
    }
    return { total: mask.length, strong, strongTopFrac: strong ? strongTopY / strong : 0, unmasked };
  });
  expect(masked, 'mask buffer created').not.toBeNull();
  expect(masked.strong, 'a strongly-masked region exists').toBeGreaterThan(10);
  expect(masked.strongTopFrac, 'the strong mask sits on the top').toBeGreaterThan(0.8);
  expect(masked.unmasked, 'much of the mesh stays unmasked').toBeGreaterThan(masked.strong);

  await win.evaluate(() => { window.__studioFrameAll && window.__studioFrameAll(); window.__archdiscOrbitView && window.__archdiscOrbitView(20, 6, 1.3); });
  await win.waitForTimeout(250);
  await win.screenshot({ path: path.join(OUT, '01-masked-top.png') });

  // Snapshot, inflate the WHOLE mesh, measure displacement by mask strength:
  // strongly-masked (>0.7) verts must hold shape vs unmasked (<0.1) verts.
  const result = await win.evaluate(() => {
    const m = window.__studioSelectedMesh(); const pos = m.geometry.attributes.position;
    const mask = m.userData.archdiscStudioMask;
    const before = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) { before[i * 3] = pos.getX(i); before[i * 3 + 1] = pos.getY(i); before[i * 3 + 2] = pos.getZ(i); }
    m.geometry.computeBoundingBox();
    const wb = m.geometry.boundingBox.clone().applyMatrix4(m.matrixWorld);
    const cx = (wb.min.x + wb.max.x) / 2, cy = (wb.min.y + wb.max.y) / 2, cz = (wb.min.z + wb.max.z) / 2;
    const r = (wb.max.x - wb.min.x) * 1.2; // cover the whole sphere
    window.__studioBrushStrokeAt([cx, cy, cz], { mode: 'inflate', radius: r, strength: 0.6 });
    let mDisp = 0, mN = 0, uDisp = 0, uN = 0;
    for (let i = 0; i < pos.count; i++) {
      const d = Math.hypot(pos.getX(i) - before[i * 3], pos.getY(i) - before[i * 3 + 1], pos.getZ(i) - before[i * 3 + 2]);
      if (mask[i] > 0.7) { mDisp += d; mN++; } else if (mask[i] < 0.1) { uDisp += d; uN++; }
    }
    return { maskedAvg: mN ? mDisp / mN : 0, unmaskedAvg: uN ? uDisp / uN : 0, mN, uN };
  });

  // eslint-disable-next-line no-console
  console.log(`  sculpt mask: masked(>0.7) avg disp ${result.maskedAvg.toExponential(2)} (n=${result.mN}) vs unmasked(<0.1) ${result.unmaskedAvg.toExponential(2)} (n=${result.uN})`);
  expect(result.unmaskedAvg, 'unmasked verts inflated').toBeGreaterThan(1e-5);
  expect(result.maskedAvg, 'strongly-masked verts held their shape').toBeLessThan(result.unmaskedAvg * 0.2);

  await win.evaluate(() => { window.__studioFrameAll && window.__studioFrameAll(); window.__archdiscOrbitView && window.__archdiscOrbitView(24, 8, 1.3); });
  await win.waitForTimeout(250);
  await win.screenshot({ path: path.join(OUT, '02-inflated-unmasked.png') });

  await app.close();
});
