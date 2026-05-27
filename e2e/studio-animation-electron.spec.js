import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

/*
 * Slice 8 — Animation discipline: real-time rotate-around-Y for the
 * selected mesh with a speed slider, play/stop toggle, and a live
 * "playing/idle" indicator. The animation loop runs on requestAnimationFrame
 * and pushes the latest mesh.rotation back into the Selection panel
 * so the readout ticks as the mesh spins.
 *
 * Spec uses real Electron interactions: pick a primitive, hit Animate,
 * sample rotation.y across timed waits, slide the speed control,
 * confirm the rotation rate scales, hit Stop, confirm rotation halts.
 */

const OUT = path.resolve(__dirname, 'screenshots', 'studio-animation');

async function screenPosOfMesh(win, index) {
  return await win.evaluate(({ idx }) => {
    const vp = window.__archdiscViewport;
    const meshes = [];
    vp.scene.traverse(o => {
      if (o.isMesh && o.userData && o.userData.archdiscStudioPrimitive) meshes.push(o);
    });
    const mesh = meshes[idx];
    if (!mesh) return null;
    const v = mesh.position.clone().project(vp.camera);
    const rect = vp.renderer.domElement.getBoundingClientRect();
    return {
      x: (v.x + 1) / 2 * rect.width + rect.left,
      y: (-v.y + 1) / 2 * rect.height + rect.top,
    };
  }, { idx: index });
}

async function selectedRotationY(win) {
  return await win.evaluate(() => {
    const vp = window.__archdiscViewport;
    let mesh = null;
    vp.scene.traverse(o => {
      if (o.isMesh && o.userData && o.userData.archdiscStudioPrimitive) mesh = o;
    });
    return mesh ? mesh.rotation.y : null;
  });
}

test('Studio animation — Animate Selected spins the picked mesh, Speed scales it, Stop halts', async () => {
  fs.mkdirSync(OUT, { recursive: true });

  const app = await electron.launch({
    args: [path.join(__dirname, '..', 'electron', 'main.js')],
    slowMo: 300,
  });

  const win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');
  await expect(win.locator('.workbench-current .workbench-name')).toHaveText('ArchDisc Studio', { timeout: 30000 });
  await expect(win.locator('canvas').first()).toBeVisible({ timeout: 60000 });
  await win.waitForFunction(() => !!window.__archdiscViewport, null, { timeout: 30000 });
  await win.waitForTimeout(800);

  // ---- Baseline: Animation panel is visible, idle, button disabled (nothing selected) ----
  await expect(win.locator('[data-studio-section="animation"]')).toBeVisible();
  await expect(win.locator('[data-studio-animation-state]')).toHaveText('idle');
  await expect(win.locator('[data-studio-action="toggle-animation"]')).toBeDisabled();
  await win.screenshot({ path: path.join(OUT, '00-animation-idle-disabled.png'), fullPage: false });

  // ---- Add a torus knot (visually interesting spin) and select it ----
  await win.locator('[data-studio-primitive="torus-knot"]').click();
  await win.waitForTimeout(400);
  const meshPos = await screenPosOfMesh(win, 0);
  expect(meshPos).not.toBeNull();
  await win.mouse.click(meshPos.x, meshPos.y);
  await win.waitForTimeout(500);
  await expect(win.locator('[data-studio-action="toggle-animation"]')).toBeEnabled();
  await win.screenshot({ path: path.join(OUT, '01-selected-ready-to-animate.png'), fullPage: false });

  // ---- Press Animate → rotation.y should grow over time ----
  const rot0 = await selectedRotationY(win);
  await win.locator('[data-studio-action="toggle-animation"]').click();
  await expect(win.locator('[data-studio-animation-state]')).toHaveText('playing');
  await expect(win.locator('[data-studio-action="toggle-animation"]')).toHaveText('Stop Animation');
  await win.waitForTimeout(800);
  await win.screenshot({ path: path.join(OUT, '02-animating-default-speed.png'), fullPage: false });
  const rot1 = await selectedRotationY(win);
  expect(rot1).toBeGreaterThan(rot0 + 0.3); // 90°/s * 0.8s = 1.25 rad; very generous floor

  // ---- Bump speed to ~360°/s — rotation accelerates ----
  await win.locator('[data-studio-animation="speed"]').fill('360');
  await win.dispatchEvent('[data-studio-animation="speed"]', 'input');
  await win.waitForTimeout(300);
  await expect(win.locator('[data-studio-animation-readout="speed"]')).toHaveText('360 °/s');
  const rotAtFast = await selectedRotationY(win);
  await win.waitForTimeout(600);
  const rotAfterFast = await selectedRotationY(win);
  // 360°/s * 0.6s = 6.28 rad. Floor at 2 rad to be very tolerant.
  expect(rotAfterFast - rotAtFast).toBeGreaterThan(2);
  await win.screenshot({ path: path.join(OUT, '03-animating-fast.png'), fullPage: false });

  // ---- Stop → rotation should halt ----
  await win.locator('[data-studio-action="toggle-animation"]').click();
  await expect(win.locator('[data-studio-animation-state]')).toHaveText('idle');
  await expect(win.locator('[data-studio-action="toggle-animation"]')).toHaveText('Animate Selected');
  const rotAtStop = await selectedRotationY(win);
  await win.waitForTimeout(700);
  const rotAfterStop = await selectedRotationY(win);
  // Frozen — difference should be effectively zero (sub-radian).
  expect(Math.abs(rotAfterStop - rotAtStop)).toBeLessThan(0.05);
  await win.screenshot({ path: path.join(OUT, '04-stopped.png'), fullPage: false });

  // ---- Restart at slow speed for the headline shot ----
  await win.locator('[data-studio-animation="speed"]').fill('60');
  await win.dispatchEvent('[data-studio-animation="speed"]', 'input');
  await win.locator('[data-studio-action="toggle-animation"]').click();
  await win.waitForTimeout(300);
  await win.screenshot({ path: path.join(OUT, '05-restart-slow.png'), fullPage: false });
  await win.locator('[data-studio-action="toggle-animation"]').click();
  await expect(win.locator('[data-studio-animation-state]')).toHaveText('idle');

  // eslint-disable-next-line no-console
  console.log(`  animation: rot0=${rot0.toFixed(3)} → after-default=${rot1.toFixed(3)} → after-360°/s=${rotAfterFast.toFixed(3)} → stop=${rotAtStop.toFixed(3)} → frozen=${rotAfterStop.toFixed(3)}`);

  await app.close();
});
