import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

/*
 * Slice 57 — Motion Path display.
 *
 * Toggle a viewport overlay that draws the interpolated trajectory
 * of every mesh with ≥2 keyframes as a teal poly-line. Lets the user
 * see the full animation path at a glance — Maya / 3ds Max / Blender
 * all ship this.
 *
 * Workflow:
 *   1. Cube + sphere both keyframed at frames 0 and 60 (different poses).
 *   2. Toggle motion path overlay ON -> exactly 2 motion-path lines
 *      exist in the scene (one per animated mesh).
 *   3. Each line has 61 vertices (frame 0..60 inclusive).
 *   4. Toggle OFF -> lines removed.
 */

const OUT = path.resolve(__dirname, 'screenshots', 'studio-motion-path');

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

async function motionPathStats(win) {
  return await win.evaluate(() => {
    const vp = window.__archdiscViewport;
    const lines = [];
    vp.scene.traverse(o => {
      if (o.userData && o.userData.archdiscStudioMotionPath) {
        lines.push({
          forUuid: o.userData.archdiscStudioMotionPathForUuid,
          vertCount: o.geometry.attributes.position.count,
        });
      }
    });
    return lines;
  });
}

async function moveAndKeyframe(win, kind, dx, dy, dz, frame) {
  await win.evaluate(({ k, x, y, z }) => {
    const vp = window.__archdiscViewport;
    let m = null;
    vp.scene.traverse(o => { if (o.userData && o.userData.archdiscStudioPrimitiveKind === k) m = o; });
    if (m) {
      m.position.x += x;
      m.position.y += y;
      m.position.z += z;
    }
  }, { k: kind, x: dx, y: dy, z: dz });
  await setRange(win, '[data-studio-timeline="frame"]', String(frame));
  await win.waitForTimeout(150);
}

test('Studio Motion Path — viewport poly-line of each animated mesh', async () => {
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

  // Stage: cube + sphere.
  await win.locator('[data-studio-primitive="cube"]').click();
  await win.waitForTimeout(250);
  await win.locator('[data-studio-primitive="sphere"]').click();
  await win.waitForTimeout(250);

  await win.locator('.workbench-ribbon-placeholder-tab[data-studio-discipline="animation"]').click();
  await win.waitForTimeout(300);

  // ---- Cube keyframes ----
  await selectByKind(win, 'cube');
  await win.waitForTimeout(300);
  await setRange(win, '[data-studio-timeline="frame"]', '0');
  await win.locator('[data-studio-action="insert-keyframe"]').click();
  await win.waitForTimeout(200);
  await moveAndKeyframe(win, 'cube', 0.06, 0.02, 0, 60);
  await win.locator('[data-studio-action="insert-keyframe"]').click();
  await win.waitForTimeout(200);

  // ---- Sphere keyframes ----
  await selectByKind(win, 'sphere');
  await win.waitForTimeout(300);
  await setRange(win, '[data-studio-timeline="frame"]', '0');
  await win.locator('[data-studio-action="insert-keyframe"]').click();
  await win.waitForTimeout(200);
  await moveAndKeyframe(win, 'sphere', -0.04, 0.04, 0.03, 60);
  await win.locator('[data-studio-action="insert-keyframe"]').click();
  await win.waitForTimeout(200);

  await expect(win.locator('[data-studio-keyframe-count]')).toHaveText('4 keyframes · idle');

  // ---- Toggle motion path ON ----
  await win.locator('[data-studio-timeline="show-motion-path"]').check();
  await win.waitForTimeout(400);

  const linesOn = await motionPathStats(win);
  expect(linesOn.length).toBe(2);
  // Each path covers frames 0..60 -> 61 vertices.
  for (const line of linesOn) {
    expect(line.vertCount).toBe(61);
  }
  await win.screenshot({ path: path.join(OUT, '01-motion-paths-on.png'), fullPage: false });

  // ---- 4-angle showcase ----
  for (const az of [0, 90, 180, 270]) {
    await win.evaluate((a) => window.__archdiscOrbitView && window.__archdiscOrbitView(a, 22, 1), az);
    await win.waitForTimeout(220);
    await win.screenshot({ path: path.join(OUT, `02-orbit-az${az}.png`), fullPage: false });
  }

  // ---- Toggle OFF — lines removed ----
  await win.locator('[data-studio-timeline="show-motion-path"]').uncheck();
  await win.waitForTimeout(400);
  const linesOff = await motionPathStats(win);
  expect(linesOff.length).toBe(0);

  // eslint-disable-next-line no-console
  console.log(`  motion path: 4 keyframes across 2 meshes -> 2 motion-path lines with 61 verts each; cleared cleanly when toggled off`);

  await app.close();
});
