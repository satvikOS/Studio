import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

/*
 * Slice 46 — Click-paint sculpt brush (per-vertex deformation under
 * the cursor with smooth quartic falloff).
 *
 * Three brush modes:
 *   push    — outward along the radial normal at the hit point
 *   pull    — inward
 *   smooth  — Laplacian average toward one-ring neighbours (within radius)
 *
 * Spec adds a sphere (smooth surface — easy to see brush effects),
 * activates the brush, clicks 5 spots on the sphere via canvas
 * coordinates derived from world→screen projection, then verifies
 * the geometry checksum changed measurably between modes.
 */

const OUT = path.resolve(__dirname, 'screenshots', 'studio-click-paint-brush');

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

async function meshChecksum(win, kind) {
  return await win.evaluate((k) => {
    const vp = window.__archdiscViewport;
    let m = null;
    vp.scene.traverse(o => {
      if (o.userData && o.userData.archdiscStudioPrimitiveKind === k) m = o;
    });
    if (!m) return 0;
    const pos = m.geometry.attributes.position;
    let sum = 0;
    for (let i = 0; i < pos.count; i++) {
      sum += Math.abs(pos.getX(i)) + Math.abs(pos.getY(i)) + Math.abs(pos.getZ(i));
    }
    return sum;
  }, kind);
}

// Project N points on the front hemisphere of the mesh to screen coords
// so the spec can fire real Playwright clicks at the brush hit-points.
async function frontHemispherePoints(win, kind, n) {
  return await win.evaluate(({ k, count }) => {
    const vp = window.__archdiscViewport;
    let m = null;
    vp.scene.traverse(o => { if (o.userData && o.userData.archdiscStudioPrimitiveKind === k) m = o; });
    if (!m) return [];
    const cam = vp.camera;
    const rect = vp.renderer.domElement.getBoundingClientRect();
    if (!m.geometry.boundingSphere) m.geometry.computeBoundingSphere();
    // Vector3 constructor reached via the camera's own up vector.
    const V3 = cam.up.constructor;
    const center = m.position.clone();
    const radius = m.geometry.boundingSphere.radius * 0.7;
    const camDir = center.clone().sub(cam.position).normalize();
    // Pick `count` deterministic offset directions on the hemisphere
    // facing the camera (Fibonacci on a half-sphere).
    const out = [];
    const GA = Math.PI * (3 - Math.sqrt(5));
    for (let i = 0; i < count; i++) {
      const t = (i + 0.5) / count;
      const phi = Math.acos(0.4 + 0.6 * t); // bias toward equator
      const theta = GA * i;
      // Camera-relative basis: right and up vectors transformed by
      // camera orientation.
      const right = new V3(1, 0, 0).applyQuaternion(cam.quaternion);
      const up    = new V3(0, 1, 0).applyQuaternion(cam.quaternion);
      const r = radius * Math.sin(phi);
      const local = right.multiplyScalar(r * Math.cos(theta))
        .add(up.multiplyScalar(r * Math.sin(theta)))
        .add(camDir.clone().multiplyScalar(-radius * Math.cos(phi)));
      const worldPt = center.clone().add(local);
      const screenP = worldPt.clone().project(cam);
      out.push({
        x: (screenP.x + 1) / 2 * rect.width + rect.left,
        y: (-screenP.y + 1) / 2 * rect.height + rect.top,
      });
    }
    return out;
  }, { k: kind, count: n });
}

test('Studio click-paint brush — push / pull / smooth deformations under the cursor', async () => {
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

  // Add + select a sphere (dense vertex layout — brushes have lots of
  // verts within radius).
  await win.locator('[data-studio-primitive="sphere"]').click();
  await win.waitForTimeout(300);

  await win.locator('.workbench-ribbon-placeholder-tab[data-studio-discipline="sculpting"]').click();
  await win.waitForTimeout(300);
  await expect(win.locator('[data-studio-section="sculpting"]')).toBeVisible();

  const baseline = await meshChecksum(win, 'sphere');
  expect(baseline).toBeGreaterThan(0);
  await win.screenshot({ path: path.join(OUT, '00-baseline-sphere.png'), fullPage: false });

  // ---- Activate the brush in Push mode, paint 5 spots ----
  await win.locator('[data-studio-brush="active"]').check();
  await win.locator('[data-studio-brush="mode"]').selectOption('push');
  await setRange(win, '[data-studio-brush="radius"]',   '0.012');
  await setRange(win, '[data-studio-brush="strength"]', '0.6');
  await expect(win.locator('[data-studio-brush-readout="radius"]')).toHaveText('12.0 mm');

  // Click 5 spots on the sphere.
  const pts = await frontHemispherePoints(win, 'sphere', 5);
  expect(pts.length).toBe(5);
  for (const p of pts) {
    await win.mouse.click(p.x, p.y);
    await win.waitForTimeout(150);
  }
  const afterPush = await meshChecksum(win, 'sphere');
  expect(Math.abs(afterPush - baseline)).toBeGreaterThan(0.01);
  await win.screenshot({ path: path.join(OUT, '01-after-push-5-spots.png'), fullPage: false });

  // ---- Switch to Smooth mode, click each spot again (should reduce
  //      checksum back toward the baseline). ----
  await win.locator('[data-studio-brush="mode"]').selectOption('smooth');
  await setRange(win, '[data-studio-brush="strength"]', '0.8');
  for (const p of pts) {
    await win.mouse.click(p.x, p.y);
    await win.waitForTimeout(150);
  }
  const afterSmooth = await meshChecksum(win, 'sphere');
  // Smooth pulls toward neighbours — sum-of-magnitudes drops vs post-push.
  expect(afterSmooth).toBeLessThan(afterPush);
  await win.screenshot({ path: path.join(OUT, '02-after-smooth.png'), fullPage: false });

  // ---- Pull mode — clicks bring vertices inward toward the centre. ----
  await win.locator('[data-studio-brush="mode"]').selectOption('pull');
  await setRange(win, '[data-studio-brush="strength"]', '0.5');
  for (const p of pts) {
    await win.mouse.click(p.x, p.y);
    await win.waitForTimeout(150);
  }
  const afterPull = await meshChecksum(win, 'sphere');
  expect(Math.abs(afterPull - afterSmooth)).toBeGreaterThan(0.001);
  await win.screenshot({ path: path.join(OUT, '03-after-pull.png'), fullPage: false });

  // ---- Multi-angle orbit captures of the sculpted result ----
  for (const az of [0, 90, 180, 270]) {
    await win.evaluate((a) => window.__archdiscOrbitView && window.__archdiscOrbitView(a, 20, 1), az);
    await win.waitForTimeout(250);
    await win.screenshot({ path: path.join(OUT, `04-sculpted-az${az}.png`), fullPage: false });
  }

  // eslint-disable-next-line no-console
  console.log(`  brush: baseline=${baseline.toFixed(3)} push=${afterPush.toFixed(3)} smooth=${afterSmooth.toFixed(3)} pull=${afterPull.toFixed(3)}`);

  await app.close();
});
