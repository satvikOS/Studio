import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

/*
 * Slice 48 — UV Unwrap (spherical projection).
 *
 * Spawns a Suzanne head (which has no UVs by default — imported from
 * Blender's X3D test fixture as positions + indices only), runs the
 * spherical unwrap, then applies a checkerboard texture so the new
 * UV layout becomes visible. Verifies:
 *   - UV attribute exists and has 2 components per vertex.
 *   - All UV values are in [0, 1].
 *   - Texture renders with checker pattern visible at multiple angles.
 */

const OUT = path.resolve(__dirname, 'screenshots', 'studio-uv-unwrap');

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

test('Studio UV Unwrap — spherical projection generates valid UVs, texture renders cleanly', async () => {
  test.setTimeout(120000);
  fs.mkdirSync(OUT, { recursive: true });

  const app = await electron.launch({
    args: [path.join(__dirname, '..', 'electron', 'main.js')],
    slowMo: 250,
  });

  const win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');
  await expect(win.locator('.workbench-current .workbench-name')).toHaveText('ArchDisc Studio', { timeout: 30000 });
  await expect(win.locator('canvas').first()).toBeVisible({ timeout: 60000 });
  await win.waitForFunction(() => !!window.__archdiscViewport, null, { timeout: 30000 });
  await win.waitForTimeout(800);

  // ---- Suzanne — imported X3D doesn't ship UVs ----
  await win.locator('[data-studio-primitive="suzanne"]').click();
  await win.waitForTimeout(300);
  await selectByKind(win, 'suzanne');
  await win.waitForTimeout(300);
  await expect(win.locator('[data-studio-selection="kind"]')).toHaveText('suzanne');

  // Confirm baseline: no UV attribute at all (or a default one we'll overwrite).
  const baseline = await win.evaluate(() => {
    const vp = window.__archdiscViewport;
    let m = null;
    vp.scene.traverse(o => { if (o.userData && o.userData.archdiscStudioPrimitiveKind === 'suzanne') m = o; });
    if (!m) return null;
    return {
      hasUv: !!m.geometry.attributes.uv,
      vertCount: m.geometry.attributes.position.count,
      unwrapped: m.userData.archdiscStudioUvUnwrapped || 0,
    };
  });
  expect(baseline).not.toBeNull();
  expect(baseline.vertCount).toBeGreaterThan(400);
  expect(baseline.unwrapped).toBe(0);

  // ---- Run UV Unwrap ----
  await win.locator('.workbench-ribbon-placeholder-tab[data-studio-discipline="uv-texture"]').click();
  await win.waitForTimeout(300);
  await expect(win.locator('[data-studio-section="texture"]')).toBeVisible();
  await win.locator('[data-studio-action="unwrap-uvs"]').click();
  await win.waitForTimeout(300);

  // ---- Verify the UV attribute is now present, in-range, and stamped. ----
  const afterUnwrap = await win.evaluate(() => {
    const vp = window.__archdiscViewport;
    let m = null;
    vp.scene.traverse(o => { if (o.userData && o.userData.archdiscStudioPrimitiveKind === 'suzanne') m = o; });
    if (!m || !m.geometry.attributes.uv) return null;
    const uv = m.geometry.attributes.uv;
    let inRange = true, minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;
    for (let i = 0; i < uv.count; i++) {
      const u = uv.getX(i), v = uv.getY(i);
      if (u < 0 || u > 1 || v < 0 || v > 1) inRange = false;
      if (u < minU) minU = u; if (u > maxU) maxU = u;
      if (v < minV) minV = v; if (v > maxV) maxV = v;
    }
    return {
      uvCount: uv.count,
      itemSize: uv.itemSize,
      inRange,
      range: { minU, maxU, minV, maxV },
      unwrapped: m.userData.archdiscStudioUvUnwrapped,
    };
  });
  expect(afterUnwrap).not.toBeNull();
  expect(afterUnwrap.uvCount).toBe(baseline.vertCount); // 1 UV per vertex
  expect(afterUnwrap.itemSize).toBe(2);
  expect(afterUnwrap.inRange).toBe(true);
  // Spherical projection should hit a wide range of both axes.
  expect(afterUnwrap.range.maxU - afterUnwrap.range.minU).toBeGreaterThan(0.6);
  expect(afterUnwrap.range.maxV - afterUnwrap.range.minV).toBeGreaterThan(0.4);
  expect(afterUnwrap.unwrapped).toBe(1);

  // ---- Apply checkerboard texture so the UV mapping is visible ----
  await setRange(win, '[data-studio-texture="tiles"]', '12');
  await win.locator('[data-studio-action="apply-texture"]').click();
  await win.waitForTimeout(400);
  // Verify the material now carries a texture map.
  const hasMap = await win.evaluate(() => {
    const vp = window.__archdiscViewport;
    let m = null;
    vp.scene.traverse(o => { if (o.userData && o.userData.archdiscStudioPrimitiveKind === 'suzanne') m = o; });
    return !!(m && m.material && m.material.map);
  });
  expect(hasMap).toBe(true);

  // ---- Multi-angle captures showing the checker pattern wrapping the head ----
  for (const az of [0, 90, 180, 270]) {
    await win.evaluate((a) => window.__archdiscOrbitView && window.__archdiscOrbitView(a, 20, 1), az);
    await win.waitForTimeout(280);
    await win.screenshot({ path: path.join(OUT, `01-checker-az${az}.png`), fullPage: false });
  }

  // eslint-disable-next-line no-console
  console.log(`  uv unwrap: ${afterUnwrap.uvCount} UVs, range U=[${afterUnwrap.range.minU.toFixed(3)}, ${afterUnwrap.range.maxU.toFixed(3)}] V=[${afterUnwrap.range.minV.toFixed(3)}, ${afterUnwrap.range.maxV.toFixed(3)}]`);

  await app.close();
});
