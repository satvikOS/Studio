import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

/*
 * Studio — HEIGHT + NORMAL MAP PAINT (headed Electron).
 *
 * Completes the Substance Painter PBR channel set (colour/roughness/metalness/
 * emissive already shipped). Adds a HEIGHT channel painted into a bumpMap, and a
 * Sobel "Height -> Normal" bake that derives a tangent-space normalMap. Verifies
 * painting raises a relief (bump texel brightens vs the neutral grey base), the
 * material gains a bumpMap, the bake produces a normalMap whose flat region is
 * ~(128,128,255) while a sloped region tilts R/G away from 128.
 */

const OUT = path.resolve(__dirname, 'screenshots', 'studio-normal-height-paint');

test('Studio — paint a height relief and bake a normal map from it', async () => {
  test.setTimeout(240000);
  fs.mkdirSync(OUT, { recursive: true });

  const app = await electron.launch({ args: [path.join(__dirname, '..', 'electron', 'main.js')], slowMo: Number(process.env.STUDIO_SLOWMO) || 220 });
  const win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');
  await expect(win.locator('.workbench-current .workbench-name')).toHaveText('ArchDisc Studio', { timeout: 30000 });
  await expect(win.locator('canvas').first()).toBeVisible({ timeout: 60000 });
  await win.waitForFunction(() => !!window.__archdiscViewport, null, { timeout: 30000 });
  await win.waitForFunction(() => typeof window.__studioBakeNormalFromHeight === 'function', null, { timeout: 30000 });
  await win.waitForTimeout(500);

  // sphere (clean UVs), selected
  await win.locator('[data-studio-primitive="sphere"]').click();
  await win.waitForTimeout(250);
  await win.evaluate(() => { const s = window.__archdiscScene; let m = null; s && s.traverse((o) => { if (o.userData && o.userData.archdiscStudioPrimitive) m = o; }); if (m) window.__studioSelectMesh(m); });
  await win.waitForTimeout(150);

  // ── select the Height channel via the real UV ribbon control ──
  await win.locator('[data-studio-discipline="uv-texture"]').click();
  await win.waitForTimeout(150);
  await win.locator('[data-studio-texpaint-channel]').selectOption('height');
  await win.waitForTimeout(120);

  // ── paint a raised relief blob into the height channel ──
  const painted = await win.evaluate(() => {
    window.__studioPaintTextureAt([0.5, 0.5], '#ffffff', 120, 'height');
    window.__studioPaintTextureAt([0.5, 0.5], '#ffffff', 90, 'height');
    window.__studioPaintTextureAt([0.5, 0.5], '#ffffff', 45, 'height'); // sharp peak -> steep slope
    const center = window.__studioReadTexel([0.5, 0.5], 'height');
    const corner = window.__studioReadTexel([0.05, 0.05], 'height');
    const m = window.__studioSelectedMesh();
    return { center, corner, hasBump: !!(m.material && m.material.bumpMap), bumpScale: m.material.bumpScale };
  });
  expect(painted.hasBump, 'material gained a bumpMap from height paint').toBe(true);
  expect(painted.bumpScale, 'bumpScale is set so relief shows').toBeGreaterThan(0);
  expect(painted.center[0], 'painted centre is raised (bright)').toBeGreaterThan(200);
  expect(Math.abs(painted.corner[0] - 128), 'unpainted area stays at the neutral grey base (~128)').toBeLessThan(20);

  // ── bake the normal map from the painted height ──
  const baked = await win.evaluate(() => {
    const r = window.__studioBakeNormalFromHeight(12);
    const flat = window.__studioReadNormalTexel([0.05, 0.05]);   // far from relief -> flat
    // scan a ring around the blob for the steepest (most tilted) normal texel
    let maxTilt = 0, slope = null;
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * Math.PI * 2;
      for (const rad of [0.05, 0.09, 0.13, 0.17]) {
        const t = window.__studioReadNormalTexel([0.5 + Math.cos(a) * rad, 0.5 + Math.sin(a) * rad]);
        if (!t) continue;
        const tilt = Math.abs(t[0] - 128) + Math.abs(t[1] - 128);
        if (tilt > maxTilt) { maxTilt = tilt; slope = t; }
      }
    }
    const m = window.__studioSelectedMesh();
    return { r, flat, slope, maxTilt, hasNormal: !!(m.material && m.material.normalMap) };
  });
  expect(baked.r && baked.r.baked, 'normal bake succeeded').toBe(true);
  expect(baked.hasNormal, 'material gained a normalMap').toBe(true);
  // flat region: tangent-space up ~ (128,128,255)
  expect(Math.abs(baked.flat[0] - 128), 'flat region normal R ~128').toBeLessThan(12);
  expect(Math.abs(baked.flat[1] - 128), 'flat region normal G ~128').toBeLessThan(12);
  expect(baked.flat[2], 'flat region normal B high (facing out)').toBeGreaterThan(235);
  // the steepest region tilts the normal away from flat (R/G deviate from 128)
  expect(baked.maxTilt, 'sloped region normal tilts away from flat').toBeGreaterThan(15);

  await win.evaluate(() => { window.__studioFrameAll && window.__studioFrameAll(); window.__archdiscOrbitView && window.__archdiscOrbitView(18, 10, 1.3); });
  await win.waitForTimeout(300);
  await win.screenshot({ path: path.join(OUT, '01-relief-sphere.png') });

  // eslint-disable-next-line no-console
  console.log(`  height/normal: bump center=${painted.center[0]} corner=${painted.corner[0]} bumpScale=${painted.bumpScale}; normal flat=[${baked.flat}] slope=[${baked.slope}] maxTilt=${baked.maxTilt}`);

  await app.close();
});
