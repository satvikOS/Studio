import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

/*
 * Slice 53 — Asset Library: preset scenes composed of Studio ops.
 *
 * Each preset is a deterministic, parameter-driven composition that
 * runs the same ribbon-tool functions a user would invoke by hand.
 * No bespoke per-preset builders. Loading the same preset twice
 * produces the same scene.
 *
 * Presets:
 *   - crystal-garden    -> 3 polyhedra (icosa+dodec+icosa), various
 *                          materials, two subdivided
 *   - furry-suzanne     -> Suzanne head, subdivided, chrome, with
 *                          1500-strand hair
 *   - shattered-sphere  -> sphere -> subdivide -> noise displace ->
 *                          fracture into 14 chunks
 *   - industrial-pod    -> cylinder + torus + cube, alternating
 *                          chrome / gold materials
 */

const OUT = path.resolve(__dirname, 'screenshots', 'studio-asset-library');

async function sceneSummary(win) {
  return await win.evaluate(() => {
    const vp = window.__archdiscViewport;
    const kinds = {};
    let total = 0;
    vp.scene.traverse(o => {
      if (o.userData && o.userData.archdiscStudioPrimitive) {
        total++;
        const k = o.userData.archdiscStudioPrimitiveKind;
        kinds[k] = (kinds[k] || 0) + 1;
      }
    });
    return { total, kinds };
  });
}

test('Studio Asset Library — preset scenes load deterministically through real ops', async () => {
  test.setTimeout(180000);
  fs.mkdirSync(OUT, { recursive: true });

  const app = await electron.launch({
    args: [path.join(__dirname, '..', 'electron', 'main.js')],
    slowMo: 200,
  });

  const win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');
  await expect(win.locator('.workbench-current .workbench-name')).toHaveText('ArchDisc Studio', { timeout: 30000 });
  await expect(win.locator('canvas').first()).toBeVisible({ timeout: 60000 });
  await win.waitForFunction(() => !!window.__archdiscViewport, null, { timeout: 30000 });
  await win.waitForTimeout(800);

  await expect(win.locator('[data-studio-library-status]')).toHaveText('No preset loaded');

  // ---- Preset 1: crystal-garden ----
  await win.locator('[data-studio-preset="crystal-garden"]').click();
  await win.waitForTimeout(700);
  await expect(win.locator('[data-studio-library-status]')).toHaveText('Loaded: crystal-garden');
  const crystal = await sceneSummary(win);
  expect(crystal.total).toBe(3);
  expect(crystal.kinds['icosahedron']).toBe(2);
  expect(crystal.kinds['dodecahedron']).toBe(1);
  for (const az of [0, 120, 240]) {
    await win.evaluate((a) => window.__archdiscOrbitView && window.__archdiscOrbitView(a, 18, 1), az);
    await win.waitForTimeout(220);
    await win.screenshot({ path: path.join(OUT, `01-crystal-garden-az${az}.png`), fullPage: false });
  }

  // ---- Preset 2: furry-suzanne ----
  await win.locator('[data-studio-preset="furry-suzanne"]').click();
  await win.waitForTimeout(1000);
  await expect(win.locator('[data-studio-library-status]')).toHaveText('Loaded: furry-suzanne');
  const furry = await sceneSummary(win);
  expect(furry.kinds['suzanne']).toBe(1);
  expect(furry.kinds['hair']).toBe(1);
  for (const az of [0, 120, 240]) {
    await win.evaluate((a) => window.__archdiscOrbitView && window.__archdiscOrbitView(a, 18, 1), az);
    await win.waitForTimeout(220);
    await win.screenshot({ path: path.join(OUT, `02-furry-suzanne-az${az}.png`), fullPage: false });
  }

  // ---- Preset 3: shattered-sphere ----
  await win.locator('[data-studio-preset="shattered-sphere"]').click();
  await win.waitForTimeout(1200);
  await expect(win.locator('[data-studio-library-status]')).toHaveText('Loaded: shattered-sphere');
  const shattered = await sceneSummary(win);
  expect(shattered.kinds['fracture-chunk']).toBeGreaterThan(6);
  expect(shattered.kinds['sphere']).toBeUndefined(); // consumed by fracture
  for (const az of [0, 120, 240]) {
    await win.evaluate((a) => window.__archdiscOrbitView && window.__archdiscOrbitView(a, 18, 1), az);
    await win.waitForTimeout(220);
    await win.screenshot({ path: path.join(OUT, `03-shattered-sphere-az${az}.png`), fullPage: false });
  }

  // ---- Preset 4: industrial-pod ----
  await win.locator('[data-studio-preset="industrial-pod"]').click();
  await win.waitForTimeout(700);
  await expect(win.locator('[data-studio-library-status]')).toHaveText('Loaded: industrial-pod');
  const pod = await sceneSummary(win);
  expect(pod.total).toBe(3);
  expect(pod.kinds['cylinder']).toBe(1);
  expect(pod.kinds['torus']).toBe(1);
  expect(pod.kinds['cube']).toBe(1);
  for (const az of [0, 120, 240]) {
    await win.evaluate((a) => window.__archdiscOrbitView && window.__archdiscOrbitView(a, 18, 1), az);
    await win.waitForTimeout(220);
    await win.screenshot({ path: path.join(OUT, `04-industrial-pod-az${az}.png`), fullPage: false });
  }

  // ---- Determinism — load crystal-garden twice, vertex checksums match ----
  await win.locator('[data-studio-preset="crystal-garden"]').click();
  await win.waitForTimeout(700);
  const cs1 = await win.evaluate(() => {
    const vp = window.__archdiscViewport;
    let sum = 0;
    vp.scene.traverse(o => {
      if (o.userData && o.userData.archdiscStudioPrimitive && o.geometry && o.geometry.attributes.position) {
        const p = o.geometry.attributes.position;
        for (let i = 0; i < p.count; i++) sum += Math.abs(p.getX(i)) + Math.abs(p.getY(i)) + Math.abs(p.getZ(i));
      }
    });
    return sum;
  });
  await win.locator('[data-studio-preset="crystal-garden"]').click();
  await win.waitForTimeout(700);
  const cs2 = await win.evaluate(() => {
    const vp = window.__archdiscViewport;
    let sum = 0;
    vp.scene.traverse(o => {
      if (o.userData && o.userData.archdiscStudioPrimitive && o.geometry && o.geometry.attributes.position) {
        const p = o.geometry.attributes.position;
        for (let i = 0; i < p.count; i++) sum += Math.abs(p.getX(i)) + Math.abs(p.getY(i)) + Math.abs(p.getZ(i));
      }
    });
    return sum;
  });
  expect(cs2).toBeCloseTo(cs1, 3);

  // eslint-disable-next-line no-console
  console.log(`  asset library: 4 presets loaded; crystal-garden checksum identical across 2 loads (cs=${cs1.toFixed(3)} == ${cs2.toFixed(3)})`);

  await app.close();
});
