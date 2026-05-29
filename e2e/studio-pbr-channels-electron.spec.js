import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

/*
 * Studio — FULL PBR CHANNELS texture paint (Substance Painter) (headed Electron).
 *
 * Extends base-colour texture paint to a full PBR channel set: paint into
 * colour / roughness / metalness / emissive — each its own CanvasTexture wired
 * to the matching MeshStandardMaterial map. Verifies each channel reads back
 * the painted value and the material carries map + roughnessMap + metalnessMap
 * + emissiveMap. Verified visually (metallic + emissive painted sphere).
 */

const OUT = path.resolve(__dirname, 'screenshots', 'studio-pbr-channels');

test('Studio — paint into all PBR channels (color/rough/metal/emissive)', async () => {
  test.setTimeout(240000);
  fs.mkdirSync(OUT, { recursive: true });

  const app = await electron.launch({ args: [path.join(__dirname, '..', 'electron', 'main.js')], slowMo: 25 });
  const win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');
  await expect(win.locator('.workbench-current .workbench-name')).toHaveText('ArchDisc Studio', { timeout: 30000 });
  await expect(win.locator('canvas').first()).toBeVisible({ timeout: 60000 });
  await win.waitForFunction(() => !!window.__archdiscViewport, null, { timeout: 30000 });
  await win.waitForFunction(() => typeof window.__studioPaintTextureAt === 'function', null, { timeout: 30000 });
  await win.waitForTimeout(500);

  await win.locator('[data-studio-primitive="sphere"]').click();
  await win.waitForTimeout(250);
  await win.evaluate(() => { const s = window.__archdiscScene; let m = null; s && s.traverse((o) => { if (o.userData && o.userData.archdiscStudioPrimitive) m = o; }); if (m) window.__studioSelectMesh(m); });
  await win.waitForTimeout(200);

  const res = await win.evaluate(() => {
    // paint a distinct value into each PBR channel at distinct UVs
    window.__studioPaintTextureAt([0.3, 0.5], '#cc3333', 46, 'color');      // red base colour
    window.__studioPaintTextureAt([0.5, 0.5], '#1a1a1a', 46, 'roughness');  // very smooth (dark = low rough)
    window.__studioPaintTextureAt([0.7, 0.5], '#ffffff', 46, 'metalness');  // fully metallic (white = 1)
    window.__studioPaintTextureAt([0.5, 0.75], '#33cc66', 46, 'emissive');  // green glow
    const m = window.__studioSelectedMesh();
    const mat = m.material;
    return {
      color: window.__studioReadTexel([0.3, 0.5], 'color'),
      rough: window.__studioReadTexel([0.5, 0.5], 'roughness'),
      metal: window.__studioReadTexel([0.7, 0.5], 'metalness'),
      emit: window.__studioReadTexel([0.5, 0.75], 'emissive'),
      maps: { color: !!mat.map, rough: !!mat.roughnessMap, metal: !!mat.metalnessMap, emit: !!mat.emissiveMap },
      scalars: { roughness: mat.roughness, metalness: mat.metalness },
    };
  });

  // all four maps exist on the material
  expect(res.maps.color && res.maps.rough && res.maps.metal && res.maps.emit, 'material has all 4 PBR maps').toBe(true);
  // scalars set to 1 so the maps fully drive rough/metal
  expect(res.scalars.roughness).toBe(1);
  expect(res.scalars.metalness).toBe(1);
  // each channel read back the painted value
  expect(res.color[0], 'colour channel painted red').toBeGreaterThan(150);
  expect(res.rough[0], 'roughness painted dark (smooth)').toBeLessThan(80);
  expect(res.metal[0], 'metalness painted bright (metallic)').toBeGreaterThan(180);
  expect(res.emit[1], 'emissive painted green (G high)').toBeGreaterThan(120);

  // more strokes for a visible PBR sphere, then render
  await win.evaluate(() => {
    for (let i = 0; i < 6; i++) { const u = 0.15 + i * 0.12; window.__studioPaintTextureAt([u, 0.35], '#ffffff', 30, 'metalness'); window.__studioPaintTextureAt([u, 0.35], '#101010', 30, 'roughness'); }
    window.__studioPaintTextureAt([0.5, 0.6], '#3a86ff', 60, 'color');
  });
  await win.evaluate(() => { window.__studioFrameAll && window.__studioFrameAll(); window.__archdiscOrbitView && window.__archdiscOrbitView(22, 10, 1.3); });
  await win.waitForTimeout(300);
  await win.screenshot({ path: path.join(OUT, '01-pbr-painted-sphere.png') });

  // eslint-disable-next-line no-console
  console.log(`  pbr channels: color ${res.color} rough ${res.rough} metal ${res.metal} emit ${res.emit}; maps=${JSON.stringify(res.maps)}`);

  await app.close();
});
