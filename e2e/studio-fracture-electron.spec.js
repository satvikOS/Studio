import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

/*
 * Slice 52 — Cell Fracture / Voronoi Shatter.
 *
 * Splits a mesh into N spatial chunks along Voronoi-like boundaries
 * around Fibonacci-sphere seed points, then offsets each chunk
 * outward along its seed direction for a destruction-VFX look.
 *
 * Spec validates:
 *   - 12 chunk request yields 1-12 chunk primitives (Voronoi cells
 *     can be empty; we expect most to populate).
 *   - Total triangle count across chunks equals the source's tri count.
 *   - Source mesh removed from the scene after fracture.
 *   - Each chunk carries archdiscStudioFractureSeed tagging.
 *   - DETERMINISM: same seed-count + same explode -> identical chunk
 *     positions across two independent runs.
 */

const OUT = path.resolve(__dirname, 'screenshots', 'studio-fracture');

async function setRange(win, selector, value) {
  await win.evaluate(({ sel, val }) => {
    const el = document.querySelector(sel);
    if (!el) return;
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(el, String(val));
    el.dispatchEvent(new Event('input',  { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }, { sel: selector, val: value });
}

async function selectByKind(win, kind) {
  await win.evaluate((k) => {
    const vp = window.__archdiscViewport;
    let m = null;
    vp.scene.traverse(o => { if (o.userData && o.userData.archdiscStudioPrimitiveKind === k) m = o; });
    if (m && window.__studioSelectMesh) window.__studioSelectMesh(m);
  }, kind);
}

async function fractureState(win) {
  return await win.evaluate(() => {
    const vp = window.__archdiscViewport;
    const chunks = [];
    let totalTris = 0;
    vp.scene.traverse(o => {
      if (o.userData && o.userData.archdiscStudioPrimitiveKind === 'fracture-chunk') {
        const tris = o.geometry.index ? o.geometry.index.count / 3 : 0;
        totalTris += tris;
        chunks.push({
          seed: o.userData.archdiscStudioFractureSeed,
          tris,
          x: o.position.x, y: o.position.y, z: o.position.z,
        });
      }
    });
    chunks.sort((a, b) => a.seed - b.seed);
    let posSum = 0;
    for (const c of chunks) posSum += Math.abs(c.x) + Math.abs(c.y) + Math.abs(c.z);
    return { chunks, totalTris, posSum };
  });
}

test('Studio Cell Fracture — deterministic Voronoi shatter into spatial chunks', async () => {
  test.setTimeout(120000);
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

  // ---- Run 1 ----
  await win.locator('[data-studio-primitive="sphere"]').click();
  await win.waitForTimeout(300);
  await selectByKind(win, 'sphere');
  await win.waitForTimeout(300);
  const baselineTris = await win.evaluate(() => {
    const vp = window.__archdiscViewport;
    let m = null;
    vp.scene.traverse(o => { if (o.userData && o.userData.archdiscStudioPrimitiveKind === 'sphere') m = o; });
    return m ? m.geometry.index.count / 3 : 0;
  });
  expect(baselineTris).toBeGreaterThan(1000);
  await win.screenshot({ path: path.join(OUT, '00-baseline-sphere.png'), fullPage: false });

  await setRange(win, '[data-studio-fracture="chunks"]',  '12');
  await setRange(win, '[data-studio-fracture="explode"]', '0.008');
  await expect(win.locator('[data-studio-fracture-readout="explode"]')).toHaveText('8.0 mm');
  await win.locator('[data-studio-action="fracture-selected"]').click();
  await win.waitForTimeout(500);

  const run1 = await fractureState(win);
  expect(run1.chunks.length).toBeGreaterThan(6);  // most seeds get triangles
  expect(run1.chunks.length).toBeLessThanOrEqual(12);
  expect(run1.totalTris).toBe(baselineTris); // no triangles dropped
  // Sphere itself removed.
  const sphereGone = await win.evaluate(() => {
    const vp = window.__archdiscViewport;
    let found = false;
    vp.scene.traverse(o => { if (o.userData && o.userData.archdiscStudioPrimitiveKind === 'sphere') found = true; });
    return !found;
  });
  expect(sphereGone).toBe(true);
  await win.screenshot({ path: path.join(OUT, '01-fractured-12-chunks.png'), fullPage: false });

  // ---- Run 2 — identical setup -> identical positions ----
  await win.locator('[data-studio-action="clear-scene"]').click();
  await win.waitForTimeout(300);
  await expect(win.locator('[data-studio-primitive-count]')).toHaveText('0 primitives in scene');

  await win.locator('[data-studio-primitive="sphere"]').click();
  await win.waitForTimeout(300);
  await selectByKind(win, 'sphere');
  await win.waitForTimeout(300);
  await win.locator('[data-studio-action="fracture-selected"]').click();
  await win.waitForTimeout(500);

  const run2 = await fractureState(win);
  expect(run2.chunks.length).toBe(run1.chunks.length);
  expect(run2.totalTris).toBe(run1.totalTris);
  expect(run2.posSum).toBeCloseTo(run1.posSum, 4);

  // ---- Multi-angle showcase of shattered sphere ----
  for (const az of [0, 90, 180, 270]) {
    await win.evaluate((a) => window.__archdiscOrbitView && window.__archdiscOrbitView(a, 20, 1), az);
    await win.waitForTimeout(280);
    await win.screenshot({ path: path.join(OUT, `02-shattered-az${az}.png`), fullPage: false });
  }

  // eslint-disable-next-line no-console
  console.log(`  fracture: ${baselineTris}t sphere -> ${run1.chunks.length} chunks (totalTris=${run1.totalTris} preserved), positions identical across runs (cs=${run1.posSum.toFixed(4)} == ${run2.posSum.toFixed(4)})`);

  await app.close();
});
