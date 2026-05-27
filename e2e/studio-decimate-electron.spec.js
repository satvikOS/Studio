import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

/*
 * Slice 49 — Decimate modifier (vertex-clustering polygon reduction).
 *
 * Quantizes vertex positions to a uniform grid, collapses cells to a
 * single representative, and drops degenerate triangles. The standard
 * vertex-clustering decimation algorithm — fast, robust, no topology
 * preservation guarantees, but a strict reduction in poly count.
 *
 * Spec spawns a Sphere (dense default tessellation), runs Decimate at
 * three aggressiveness levels, and verifies the vertex / face count
 * drops monotonically.
 */

const OUT = path.resolve(__dirname, 'screenshots', 'studio-decimate');

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

async function meshCounts(win, kind) {
  return await win.evaluate((k) => {
    const vp = window.__archdiscViewport;
    let m = null;
    vp.scene.traverse(o => { if (o.userData && o.userData.archdiscStudioPrimitiveKind === k) m = o; });
    if (!m) return null;
    return {
      verts: m.geometry.attributes.position.count,
      tris:  m.geometry.index ? m.geometry.index.count / 3 : 0,
    };
  }, kind);
}

test('Studio Decimate — vertex clustering reduces poly count monotonically', async () => {
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

  // ---- Stage: sphere with default 32x24 tessellation ----
  await win.locator('[data-studio-primitive="sphere"]').click();
  await win.waitForTimeout(300);
  await selectByKind(win, 'sphere');
  await win.waitForTimeout(300);

  const baseline = await meshCounts(win, 'sphere');
  expect(baseline).not.toBeNull();
  expect(baseline.verts).toBeGreaterThan(500);
  expect(baseline.tris).toBeGreaterThan(900);
  await win.screenshot({ path: path.join(OUT, '00-baseline-sphere.png'), fullPage: false });

  // ---- Light decimate (aggressiveness 0.2) ----
  await setRange(win, '[data-studio-decimate="aggressiveness"]', '0.2');
  await expect(win.locator('[data-studio-decimate-readout="aggressiveness"]')).toHaveText('0.20');
  await win.locator('[data-studio-action="decimate-selected"]').click();
  await win.waitForTimeout(400);
  const light = await meshCounts(win, 'sphere');
  expect(light.verts).toBeLessThan(baseline.verts);
  expect(light.tris).toBeLessThan(baseline.tris);
  await win.screenshot({ path: path.join(OUT, '01-light-decimate.png'), fullPage: false });

  // ---- Medium decimate (aggressiveness 0.5) ----
  await setRange(win, '[data-studio-decimate="aggressiveness"]', '0.5');
  await win.locator('[data-studio-action="decimate-selected"]').click();
  await win.waitForTimeout(400);
  const medium = await meshCounts(win, 'sphere');
  expect(medium.verts).toBeLessThan(light.verts);
  expect(medium.tris).toBeLessThan(light.tris);
  await win.screenshot({ path: path.join(OUT, '02-medium-decimate.png'), fullPage: false });

  // ---- Heavy decimate (aggressiveness 0.8) ----
  await setRange(win, '[data-studio-decimate="aggressiveness"]', '0.8');
  await win.locator('[data-studio-action="decimate-selected"]').click();
  await win.waitForTimeout(400);
  const heavy = await meshCounts(win, 'sphere');
  expect(heavy.verts).toBeLessThanOrEqual(medium.verts);
  expect(heavy.tris).toBeLessThanOrEqual(medium.tris);
  // Heavy decimate of a sphere yields a small fraction of the baseline.
  expect(heavy.verts).toBeLessThan(baseline.verts * 0.25);
  await win.screenshot({ path: path.join(OUT, '03-heavy-decimate.png'), fullPage: false });

  // ---- Decimated counter stamped on userData ----
  const counter = await win.evaluate(() => {
    const vp = window.__archdiscViewport;
    let m = null;
    vp.scene.traverse(o => { if (o.userData && o.userData.archdiscStudioPrimitiveKind === 'sphere') m = o; });
    return m ? m.userData.archdiscStudioDecimated : -1;
  });
  expect(counter).toBe(3);

  // ---- Multi-angle to compare baseline vs heavily-decimated ----
  for (const az of [0, 90, 180, 270]) {
    await win.evaluate((a) => window.__archdiscOrbitView && window.__archdiscOrbitView(a, 20, 1), az);
    await win.waitForTimeout(250);
    await win.screenshot({ path: path.join(OUT, `04-heavy-az${az}.png`), fullPage: false });
  }

  // eslint-disable-next-line no-console
  console.log(`  decimate: baseline ${baseline.verts}v/${baseline.tris}t -> light ${light.verts}v/${light.tris}t -> medium ${medium.verts}v/${medium.tris}t -> heavy ${heavy.verts}v/${heavy.tris}t`);

  await app.close();
});
