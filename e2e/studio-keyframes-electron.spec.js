import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

/*
 * Slice 56 — Keyframe animation system.
 *
 * Inserts keyframes at frames N for a selected mesh, scrubs the
 * timeline, verifies linear interpolation between surrounding keys.
 *
 * Workflow:
 *   1. Add cube, select it. Cube sits at default grid position.
 *   2. Frame = 0, Insert KF -> records pose A.
 *   3. Move cube programmatically to position B (50 mm +X offset).
 *   4. Frame = 60 — out of range, cube stays at B (NOT snapped to A).
 *   5. Insert KF -> records pose B.
 *   6. Frame = 30 — in range [0,60]. Cube position must lerp to
 *      midpoint between A and B (t=0.5).
 *   7. Play Timeline -> wait 0.5 s -> cube moves on its own.
 *   8. Stop, verify keyframes preserved.
 */

const OUT = path.resolve(__dirname, 'screenshots', 'studio-keyframes');

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

async function meshPosition(win, kind) {
  return await win.evaluate((k) => {
    const vp = window.__archdiscViewport;
    let m = null;
    vp.scene.traverse(o => { if (o.userData && o.userData.archdiscStudioPrimitiveKind === k) m = o; });
    if (!m) return null;
    return { x: m.position.x, y: m.position.y, z: m.position.z };
  }, kind);
}

test('Studio Keyframes — record poses, scrub timeline, linear interpolation', async () => {
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

  // Animation tab.
  await win.locator('[data-studio-primitive="cube"]').click();
  await win.waitForTimeout(300);
  await selectByKind(win, 'cube');
  await win.waitForTimeout(300);

  await win.locator('.workbench-ribbon-placeholder-tab[data-studio-discipline="animation"]').click();
  await win.waitForTimeout(300);
  await expect(win.locator('[data-studio-section="animation"]')).toBeVisible();
  await expect(win.locator('[data-studio-keyframe-count]')).toHaveText('0 keyframes · idle');

  // ---- Step 1: Pose A = current position ----
  const poseA = await meshPosition(win, 'cube');
  expect(poseA).not.toBeNull();

  // ---- Step 2: Frame=0, Insert KF ----
  await setRange(win, '[data-studio-timeline="frame"]', '0');
  await win.locator('[data-studio-action="insert-keyframe"]').click();
  await win.waitForTimeout(200);
  await expect(win.locator('[data-studio-keyframe-count]')).toHaveText('1 keyframe · idle');

  // ---- Step 3: Move cube to pose B (+50 mm X) ----
  await win.evaluate((dx) => {
    const vp = window.__archdiscViewport;
    let m = null;
    vp.scene.traverse(o => { if (o.userData && o.userData.archdiscStudioPrimitiveKind === 'cube') m = o; });
    if (m) m.position.x += dx;
  }, 0.05);
  const poseB = await meshPosition(win, 'cube');
  expect(poseB.x).toBeCloseTo(poseA.x + 0.05, 5);

  // ---- Step 4: Frame=60 — out of range, cube stays at B ----
  await setRange(win, '[data-studio-timeline="frame"]', '60');
  await win.waitForTimeout(200);
  const atF60Before = await meshPosition(win, 'cube');
  expect(atF60Before.x).toBeCloseTo(poseB.x, 5); // not snapped back

  // ---- Step 5: Insert KF at frame 60 ----
  await win.locator('[data-studio-action="insert-keyframe"]').click();
  await win.waitForTimeout(200);
  await expect(win.locator('[data-studio-keyframe-count]')).toHaveText('2 keyframes · idle');

  // ---- Step 6: Frame=30 — should interpolate to midpoint ----
  await setRange(win, '[data-studio-timeline="frame"]', '30');
  await win.waitForTimeout(300);
  const atF30 = await meshPosition(win, 'cube');
  const expectedX = (poseA.x + poseB.x) / 2;
  expect(atF30.x).toBeCloseTo(expectedX, 5);
  await win.screenshot({ path: path.join(OUT, '01-frame30-midpoint.png'), fullPage: false });

  // ---- Step 7: Frame=15 — should interpolate to A+0.25*(B-A) ----
  await setRange(win, '[data-studio-timeline="frame"]', '15');
  await win.waitForTimeout(200);
  const atF15 = await meshPosition(win, 'cube');
  expect(atF15.x).toBeCloseTo(poseA.x + 0.25 * (poseB.x - poseA.x), 5);

  // ---- Step 8: Frame=0 -> back at A ----
  await setRange(win, '[data-studio-timeline="frame"]', '0');
  await win.waitForTimeout(200);
  const atF0 = await meshPosition(win, 'cube');
  expect(atF0.x).toBeCloseTo(poseA.x, 5);

  // ---- Step 9: Play Timeline for 0.5 s -> cube moved ----
  await win.locator('[data-studio-action="toggle-timeline"]').click();
  await expect(win.locator('[data-studio-keyframe-count]')).toHaveText('2 keyframes · playing');
  await win.waitForTimeout(500);
  await win.locator('[data-studio-action="toggle-timeline"]').click();
  await expect(win.locator('[data-studio-keyframe-count]')).toHaveText('2 keyframes · idle');
  // After 0.5 s of playback at 60 fps, currentFrame should be around 30.
  // Frame text reads as Math.round(currentFrame).
  const frameTextAfter = await win.locator('[data-studio-timeline-readout="frame"]').textContent();
  const frameAfter = Number(frameTextAfter);
  expect(frameAfter).toBeGreaterThan(15);

  // Animation tab orbital — 4-angle showcase of the animation.
  for (const az of [0, 90, 180, 270]) {
    await win.evaluate((a) => window.__archdiscOrbitView && window.__archdiscOrbitView(a, 18, 1), az);
    await win.waitForTimeout(220);
    await win.screenshot({ path: path.join(OUT, `02-orbit-az${az}.png`), fullPage: false });
  }

  // eslint-disable-next-line no-console
  console.log(`  keyframes: cube poseA.x=${poseA.x.toFixed(4)} -> poseB.x=${poseB.x.toFixed(4)}, lerp at frame 30 = ${atF30.x.toFixed(4)} (expected ${expectedX.toFixed(4)}), played to frame ${frameAfter}`);

  await app.close();
});
