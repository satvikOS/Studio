import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

/*
 * Slice 50 — Noise Displacement modifier (3D value noise along normals).
 *
 * Verifies:
 *   - Same parameters applied twice to identical baseline produce
 *     identical post-displacement geometry (DETERMINISTIC, no rand).
 *   - Geometry shape changes (vertex positions differ from baseline).
 *   - Vertex count unchanged (displacement is in-place).
 *   - Higher amplitude yields larger maximum displacement.
 *
 * Spec spawns a Subdivided Sphere (dense enough to show noise detail),
 * applies displace at moderate frequency/amplitude, then captures.
 */

const OUT = path.resolve(__dirname, 'screenshots', 'studio-displace-noise');

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

async function meshState(win, kind) {
  return await win.evaluate((k) => {
    const vp = window.__archdiscViewport;
    let m = null;
    vp.scene.traverse(o => { if (o.userData && o.userData.archdiscStudioPrimitiveKind === k) m = o; });
    if (!m) return null;
    const pos = m.geometry.attributes.position;
    let sum = 0;
    for (let i = 0; i < pos.count; i++) {
      sum += Math.abs(pos.getX(i)) + Math.abs(pos.getY(i)) + Math.abs(pos.getZ(i));
    }
    return {
      verts: pos.count,
      checksum: sum,
      displaceCount: m.userData.archdiscStudioDisplaced || 0,
      maxDelta: m.userData.archdiscStudioDisplacedMaxDelta || 0,
    };
  }, kind);
}

test('Studio Displace · Noise — deterministic value-noise displacement along normals', async () => {
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

  // ---- Run 1 — sphere, subdivide once, displace ----
  await win.locator('[data-studio-primitive="sphere"]').click();
  await win.waitForTimeout(300);
  await selectByKind(win, 'sphere');
  await win.waitForTimeout(300);
  await win.locator('[data-studio-action="subdivide-selected"]').click();
  await win.waitForTimeout(400);

  const baseline = await meshState(win, 'sphere');
  expect(baseline.verts).toBeGreaterThan(2000); // 1× subdivided dense sphere
  expect(baseline.displaceCount).toBe(0);
  await win.screenshot({ path: path.join(OUT, '00-subdivided-sphere.png'), fullPage: false });

  // Tune displacement, apply once.
  await setRange(win, '[data-studio-displace="frequency"]', '120');
  await setRange(win, '[data-studio-displace="amplitude"]', '0.005');
  await setRange(win, '[data-studio-displace="octaves"]',   '3');
  await expect(win.locator('[data-studio-displace-readout="amplitude"]')).toHaveText('5.0 mm');
  await win.locator('[data-studio-action="displace-noise"]').click();
  await win.waitForTimeout(500);

  const afterRun1 = await meshState(win, 'sphere');
  expect(afterRun1.displaceCount).toBe(1);
  expect(afterRun1.maxDelta).toBeGreaterThan(0);
  // Vertex count unchanged.
  expect(afterRun1.verts).toBe(baseline.verts);
  // Checksum should differ from baseline (some verts moved).
  expect(Math.abs(afterRun1.checksum - baseline.checksum)).toBeGreaterThan(0.01);
  await win.screenshot({ path: path.join(OUT, '01-displaced-run1.png'), fullPage: false });

  // ---- Run 2 — independent fresh sphere, same parameters ----
  // Wipe + start over to ensure determinism across runs.
  await win.locator('[data-studio-action="clear-scene"]').click();
  await win.waitForTimeout(300);
  await win.locator('[data-studio-primitive="sphere"]').click();
  await win.waitForTimeout(300);
  await selectByKind(win, 'sphere');
  await win.waitForTimeout(300);
  await win.locator('[data-studio-action="subdivide-selected"]').click();
  await win.waitForTimeout(400);

  const baseline2 = await meshState(win, 'sphere');
  expect(baseline2.checksum).toBeCloseTo(baseline.checksum, 3);
  expect(baseline2.verts).toBe(baseline.verts);

  await win.locator('[data-studio-action="displace-noise"]').click();
  await win.waitForTimeout(500);
  const afterRun2 = await meshState(win, 'sphere');

  // ---- Determinism: run 2 produces same checksum as run 1 ----
  expect(afterRun2.verts).toBe(afterRun1.verts);
  expect(afterRun2.checksum).toBeCloseTo(afterRun1.checksum, 3);
  expect(afterRun2.maxDelta).toBeCloseTo(afterRun1.maxDelta, 6);

  // ---- Higher amplitude -> bigger max delta ----
  await setRange(win, '[data-studio-displace="amplitude"]', '0.012');
  await win.locator('[data-studio-action="displace-noise"]').click();
  await win.waitForTimeout(500);
  const afterHigh = await meshState(win, 'sphere');
  expect(afterHigh.maxDelta).toBeGreaterThan(afterRun2.maxDelta);
  await win.screenshot({ path: path.join(OUT, '02-displaced-high-amp.png'), fullPage: false });

  // ---- Multi-angle showcase ----
  for (const az of [0, 90, 180, 270]) {
    await win.evaluate((a) => window.__archdiscOrbitView && window.__archdiscOrbitView(a, 20, 1), az);
    await win.waitForTimeout(250);
    await win.screenshot({ path: path.join(OUT, `03-displaced-az${az}.png`), fullPage: false });
  }

  // eslint-disable-next-line no-console
  console.log(`  displace noise: baseline cs=${baseline.checksum.toFixed(3)} run1 cs=${afterRun1.checksum.toFixed(3)} (maxΔ=${(afterRun1.maxDelta*1000).toFixed(2)}mm), run2 cs=${afterRun2.checksum.toFixed(3)} (identical), high-amp maxΔ=${(afterHigh.maxDelta*1000).toFixed(2)}mm`);

  await app.close();
});
