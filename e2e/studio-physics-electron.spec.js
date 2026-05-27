import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

/*
 * Slice 16 — Physics: gravity drop + ground-bounce simulation.
 *
 * Every Studio primitive in the scene picks up per-mesh velocity in
 * userData.studioVelocity, accumulates -g·dt each rAF tick, integrates
 * position by velocity, and bounces off a fixed ground plane with
 * configurable restitution. Settle threshold halts micro-bouncing.
 *
 * Spec adds three primitives at slightly different starting heights
 * (via Reset to Origin → push them down with one short simulation
 * pulse to verify positions diverge, then a longer pulse to verify
 * they all reach the ground).
 */

const OUT = path.resolve(__dirname, 'screenshots', 'studio-physics');

async function setRange(win, selector, value) {
  // Playwright's locator.fill() rejects some valid float values on range
  // inputs ("Malformed value"). React tracks input changes via a patched
  // value setter — calling the native setter (then firing 'input') makes
  // React's synthetic-event onChange handler fire as if the user moved
  // the slider, while bypassing fill()'s strict step validation.
  await win.evaluate(({ sel, val }) => {
    const el = document.querySelector(sel);
    if (!el) return;
    const proto = window.HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
    setter.call(el, String(val));
    el.dispatchEvent(new Event('input',  { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }, { sel: selector, val: value });
}

async function primitiveYs(win) {
  return await win.evaluate(() => {
    const vp = window.__archdiscViewport;
    const out = [];
    vp.scene.traverse(o => {
      if (o.userData && o.userData.archdiscStudioPrimitive) out.push(o.position.y);
    });
    return out.sort((a, b) => a - b);
  });
}

test('Studio physics — Drop with Gravity falls + bounces, Reset puts everything back', async () => {
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

  await expect(win.locator('[data-studio-section="physics"]')).toBeVisible();
  await expect(win.locator('[data-studio-physics-state]')).toHaveText('idle');
  await expect(win.locator('[data-studio-physics-readout="gravity"]')).toHaveText('9.8 m/s²');
  await win.screenshot({ path: path.join(OUT, '00-physics-panel-default.png'), fullPage: false });

  // ---- Add three primitives — all start at y=0 by addPrimitive default ----
  for (const k of ['cube', 'sphere', 'torus-knot']) {
    await win.locator(`[data-studio-primitive="${k}"]`).click();
    await win.waitForTimeout(300);
  }
  await expect(win.locator('[data-studio-primitive-count]')).toHaveText('3 primitives in scene');
  const ys0 = await primitiveYs(win);
  // All start near y=0 (within sub-mm).
  for (const y of ys0) expect(Math.abs(y)).toBeLessThan(0.001);
  await win.evaluate(() => window.__archdiscOrbitView && window.__archdiscOrbitView(35, 25, 1));
  await win.waitForTimeout(300);
  await win.screenshot({ path: path.join(OUT, '01-three-primitives-y0.png'), fullPage: false });

  // ---- Toggle Drop with Gravity ----
  await win.locator('[data-studio-action="toggle-physics"]').click();
  await expect(win.locator('[data-studio-physics-state]')).toHaveText('simulating');
  await expect(win.locator('[data-studio-action="toggle-physics"]')).toHaveText('Pause Physics');
  await win.waitForTimeout(150);
  const ysQuick = await primitiveYs(win);
  // After only ~150 ms of free-fall the meshes have moved down measurably.
  for (let i = 0; i < ysQuick.length; i++) expect(ysQuick[i]).toBeLessThan(ys0[i] - 0.0003);
  await win.screenshot({ path: path.join(OUT, '02-falling-mid.png'), fullPage: false });

  // ---- Wait long enough for bounces to settle (1.5 s is plenty at the
  //      default gravity / 45-mm drop / 0.55 restitution). ----
  await win.waitForTimeout(1500);
  const ysSettled = await primitiveYs(win);
  // All primitives should be at-or-just-above the ground (-0.045) once
  // micro-bouncing has been clamped by the settle threshold.
  for (const y of ysSettled) {
    expect(y).toBeLessThanOrEqual(-0.044);
    expect(y).toBeGreaterThanOrEqual(-0.046);
  }
  await win.screenshot({ path: path.join(OUT, '03-settled-on-ground.png'), fullPage: false });

  // ---- Pause Physics, then Reset to Origin restores y=0 ----
  await win.locator('[data-studio-action="toggle-physics"]').click();
  await expect(win.locator('[data-studio-physics-state]')).toHaveText('idle');
  await expect(win.locator('[data-studio-action="reset-physics"]')).toBeEnabled();
  await win.locator('[data-studio-action="reset-physics"]').click();
  await win.waitForTimeout(300);
  const ysReset = await primitiveYs(win);
  for (const y of ysReset) expect(Math.abs(y)).toBeLessThan(0.001);
  await win.screenshot({ path: path.join(OUT, '04-after-reset.png'), fullPage: false });

  // ---- Lower gravity, higher bounce — second pulse, settle pattern is
  //      taller (primitives sit slightly higher because the soft floor
  //      check still pulls them to GROUND_Y but with more residual
  //      velocity before the threshold clamps). ----
  await setRange(win, '[data-studio-physics="gravity"]',     '4');
  await setRange(win, '[data-studio-physics="restitution"]', '0.85');
  await expect(win.locator('[data-studio-physics-readout="gravity"]')).toHaveText('4.0 m/s²');
  await expect(win.locator('[data-studio-physics-readout="restitution"]')).toHaveText('0.85');
  await win.locator('[data-studio-action="toggle-physics"]').click();
  await win.waitForTimeout(2500);
  await win.locator('[data-studio-action="toggle-physics"]').click();
  await win.screenshot({ path: path.join(OUT, '05-low-g-high-bounce.png'), fullPage: false });

  // eslint-disable-next-line no-console
  console.log(`  physics: y0=${ys0.map(n => n.toFixed(4)).join(',')} → mid=${ysQuick.map(n => n.toFixed(4)).join(',')} → settled=${ysSettled.map(n => n.toFixed(4)).join(',')} → reset=${ysReset.map(n => n.toFixed(4)).join(',')}`);

  await app.close();
});
