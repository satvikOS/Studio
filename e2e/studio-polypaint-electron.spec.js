import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

/*
 * Studio — ZBRUSH POLYPAINT (vertex-colour brush) (headed Electron).
 *
 * Closes a DCC gap (ZBrush polypaint — was a fixed-gradient bake). A real
 * brush that paints per-vertex colours with radial falloff. Verifies that
 * painting one region (the sphere's top) colours those verts while the
 * opposite region stays the base white. Verified visually.
 */

const OUT = path.resolve(__dirname, 'screenshots', 'studio-polypaint');

test('Studio — polypaint colours vertices under the brush', async () => {
  test.setTimeout(240000);
  fs.mkdirSync(OUT, { recursive: true });

  const app = await electron.launch({ args: [path.join(__dirname, '..', 'electron', 'main.js')], slowMo: 25 });
  const win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');
  await expect(win.locator('.workbench-current .workbench-name')).toHaveText('ArchDisc Studio', { timeout: 30000 });
  await expect(win.locator('canvas').first()).toBeVisible({ timeout: 60000 });
  await win.waitForFunction(() => !!window.__archdiscViewport, null, { timeout: 30000 });
  await win.waitForFunction(() => typeof window.__studioPolyPaintAt === 'function', null, { timeout: 30000 });
  await win.waitForTimeout(500);

  await win.locator('[data-studio-primitive="sphere"]').click();
  await win.waitForTimeout(250);
  await win.evaluate(() => { const s = window.__archdiscScene; let m = null; s && s.traverse((o) => { if (o.userData && o.userData.archdiscStudioPrimitive) m = o; }); if (m) window.__studioSelectMesh(m); });
  await win.waitForTimeout(200);

  const res = await win.evaluate(() => {
    const m = window.__studioSelectedMesh();
    m.geometry.computeBoundingBox(); const bb = m.geometry.boundingBox;
    const wb = bb.clone().applyMatrix4(m.matrixWorld);
    const cx = (wb.min.x + wb.max.x) / 2, cz = (wb.min.z + wb.max.z) / 2, topY = wb.max.y;
    const h = wb.max.y - wb.min.y;
    // paint green over the top cap (a couple passes to build colour)
    window.__studioPolyPaintAt([cx, topY, cz], '#22cc55', h * 0.55);
    window.__studioPolyPaintAt([cx, topY, cz], '#22cc55', h * 0.45);
    // find a topmost + bottommost local vertex and read their colours
    const pos = m.geometry.attributes.position;
    let topI = 0, botI = 0, topYv = -1e9, botYv = 1e9;
    for (let i = 0; i < pos.count; i++) { const y = pos.getY(i); if (y > topYv) { topYv = y; topI = i; } if (y < botYv) { botYv = y; botI = i; } }
    return { top: window.__studioReadVertexColor(topI), bottom: window.__studioReadVertexColor(botI), vertexColors: !!(m.material && m.material.vertexColors) };
  });

  expect(res.vertexColors, 'material has vertex colours enabled').toBe(true);
  // top is green-painted: G clearly dominant
  expect(res.top[1], 'top vertex G high (painted green)').toBeGreaterThan(120);
  expect(res.top[1] - res.top[0], 'top vertex G >> R (it is the green paint)').toBeGreaterThan(60);
  // bottom stays ~base white (un-painted)
  expect(res.bottom[0] > 200 && res.bottom[1] > 200 && res.bottom[2] > 200, 'bottom vertex is still base white').toBe(true);

  await win.evaluate(() => { window.__studioFrameAll && window.__studioFrameAll(); window.__archdiscOrbitView && window.__archdiscOrbitView(18, 18, 1.3); });
  await win.waitForTimeout(250);
  await win.screenshot({ path: path.join(OUT, '01-polypainted.png') });

  // eslint-disable-next-line no-console
  console.log(`  polypaint: top vertex ${res.top} (painted), bottom ${res.bottom} (base), vertexColors=${res.vertexColors}`);

  await app.close();
});
