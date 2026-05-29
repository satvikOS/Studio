import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

/*
 * Studio — SUBSTANCE-STYLE PBR TEXTURE PAINT (headed Electron).
 *
 * Closes a DCC gap (Substance Painter / Blender texture paint — was a no-op
 * counter). Each painted mesh gets a CanvasTexture as its material.map; brush
 * dabs composite at the hit's UV. Verifies a painted UV reads back the paint
 * colour (vs the base) and the painted region differs from an unpainted region;
 * the material now carries a texture map.
 */

const OUT = path.resolve(__dirname, 'screenshots', 'studio-texture-paint');

test('Studio — texture paint composites colour into the mesh UV map', async () => {
  test.setTimeout(240000);
  fs.mkdirSync(OUT, { recursive: true });

  const app = await electron.launch({ args: [path.join(__dirname, '..', 'electron', 'main.js')], slowMo: Number(process.env.STUDIO_SLOWMO) || 220 });
  const win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');
  await expect(win.locator('.workbench-current .workbench-name')).toHaveText('ArchDisc Studio', { timeout: 30000 });
  await expect(win.locator('canvas').first()).toBeVisible({ timeout: 60000 });
  await win.waitForFunction(() => !!window.__archdiscViewport, null, { timeout: 30000 });
  await win.waitForFunction(() => typeof window.__studioPaintTextureAt === 'function', null, { timeout: 30000 });
  await win.waitForTimeout(500);

  // a sphere (has a clean UV map), selected
  await win.locator('[data-studio-primitive="sphere"]').click();
  await win.waitForTimeout(250);
  await win.evaluate(() => { const s = window.__archdiscScene; let m = null; s && s.traverse((o) => { if (o.userData && o.userData.archdiscStudioPrimitive) m = o; }); if (m) window.__studioSelectMesh(m); });
  await win.waitForTimeout(200);

  // base texel before painting (ensures the canvas + reads work)
  const result = await win.evaluate(() => {
    // paint a strong red blob around UV (0.5,0.5)
    window.__studioPaintTextureAt([0.5, 0.5], '#e23b3b', 50);
    window.__studioPaintTextureAt([0.5, 0.5], '#e23b3b', 40);
    const painted = window.__studioReadTexel([0.5, 0.5]);   // centre of the blob
    const elsewhere = window.__studioReadTexel([0.08, 0.08]); // far corner, unpainted
    const m = window.__studioSelectedMesh();
    return { painted, elsewhere, hasMap: !!(m.material && m.material.map), count: m.userData.archdiscStudioTexturePainted };
  });

  expect(result.hasMap, 'mesh material now has a paint texture map').toBe(true);
  expect(result.painted, 'painted texel read back').not.toBeNull();
  // painted centre is clearly red-dominant; the far corner is not
  expect(result.painted[0], 'painted texel is red-ish (R high)').toBeGreaterThan(150);
  expect(result.painted[0] - result.painted[2], 'painted texel R >> B (it is the red paint)').toBeGreaterThan(60);
  const paintedIsRed = result.painted[0] > result.painted[2] + 60;
  const cornerIsRed = result.elsewhere[0] > result.elsewhere[2] + 60;
  expect(cornerIsRed, 'an unpainted region is NOT the paint colour').toBe(false);

  // paint a few more colours to make it visible, then render
  await win.evaluate((col) => {
    window.__studioPaintTextureAt([0.25, 0.6], '#3bd07a', 44);
    window.__studioPaintTextureAt([0.75, 0.4], '#3b6ad0', 44);
    window.__studioPaintTextureAt([0.5, 0.8], col, 40);
  }, '#e2c23b');
  await win.evaluate(() => { window.__studioFrameAll && window.__studioFrameAll(); window.__archdiscOrbitView && window.__archdiscOrbitView(20, 8, 1.3); });
  await win.waitForTimeout(300);
  await win.screenshot({ path: path.join(OUT, '01-painted-sphere.png') });

  // eslint-disable-next-line no-console
  console.log(`  texture paint: painted texel rgb [${result.painted}], corner [${result.elsewhere}], dabs=${result.count}, hasMap=${result.hasMap}`);

  await app.close();
});
