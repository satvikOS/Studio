import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

/*
 * Slice 23 — Cinematic lighting.
 *
 * Add N colored point lights to the scene with intensity + color
 * controls, each accompanied by a PointLightHelper sphere so the
 * user can see where in space the light sits. Clear All Lights
 * removes every Studio-added light + helper.
 */

const OUT = path.resolve(__dirname, 'screenshots', 'studio-lighting');

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

async function studioLightCount(win) {
  return await win.evaluate(() => {
    let n = 0;
    window.__archdiscScene.traverse(o => {
      if (o.userData && o.userData.archdiscStudioLight) n++;
    });
    return n;
  });
}

test('Studio cinematic lighting — add three colored lights + Clear All', async () => {
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

  await expect(win.locator('[data-studio-section="lighting"]')).toBeVisible();
  await expect(win.locator('[data-studio-light-count]')).toHaveText('0 added');
  await expect(win.locator('[data-studio-action="clear-lights"]')).toBeDisabled();

  // ---- Compose a small scene so lights have something to light ----
  for (const k of ['cube', 'sphere', 'cone']) {
    await win.locator(`[data-studio-primitive="${k}"]`).click();
    await win.waitForTimeout(250);
  }
  await win.evaluate(() => window.__archdiscOrbitView && window.__archdiscOrbitView(35, 25, 1));
  await win.waitForTimeout(300);
  await win.screenshot({ path: path.join(OUT, '00-scene-default-lighting.png'), fullPage: false });

  // ---- Light #1 — warm orange ----
  await win.locator('[data-studio-lighting="color"]').fill('#ffb56b');
  await setRange(win, '[data-studio-lighting="intensity"]', '2');
  await win.locator('[data-studio-action="add-light"]').click();
  await win.waitForTimeout(300);
  await expect(win.locator('[data-studio-light-count]')).toHaveText('1 added');
  expect(await studioLightCount(win)).toBe(1);
  await expect(win.locator('[data-studio-action="clear-lights"]')).toBeEnabled();
  await win.screenshot({ path: path.join(OUT, '01-one-warm-light.png'), fullPage: false });

  // ---- Light #2 — cool blue ----
  await win.locator('[data-studio-lighting="color"]').fill('#6bb5ff');
  await setRange(win, '[data-studio-lighting="intensity"]', '1.5');
  await win.locator('[data-studio-action="add-light"]').click();
  await win.waitForTimeout(300);
  await expect(win.locator('[data-studio-light-count]')).toHaveText('2 added');
  expect(await studioLightCount(win)).toBe(2);
  await win.screenshot({ path: path.join(OUT, '02-two-lights.png'), fullPage: false });

  // ---- Light #3 — magenta accent ----
  await win.locator('[data-studio-lighting="color"]').fill('#d469c4');
  await setRange(win, '[data-studio-lighting="intensity"]', '3');
  await win.locator('[data-studio-action="add-light"]').click();
  await win.waitForTimeout(300);
  await expect(win.locator('[data-studio-light-count]')).toHaveText('3 added');
  expect(await studioLightCount(win)).toBe(3);

  // Multi-angle showing the three lights illuminating the scene.
  await win.evaluate(() => window.__archdiscOrbitView && window.__archdiscOrbitView(45, 25, 1));
  await win.waitForTimeout(300);
  await win.screenshot({ path: path.join(OUT, '03-three-lights-az45.png'), fullPage: false });
  await win.evaluate(() => window.__archdiscOrbitView && window.__archdiscOrbitView(225, 25, 1));
  await win.waitForTimeout(300);
  await win.screenshot({ path: path.join(OUT, '04-three-lights-az225.png'), fullPage: false });

  // ---- Clear All Lights ----
  await win.locator('[data-studio-action="clear-lights"]').click();
  await win.waitForTimeout(300);
  await expect(win.locator('[data-studio-light-count]')).toHaveText('0 added');
  expect(await studioLightCount(win)).toBe(0);
  await expect(win.locator('[data-studio-action="clear-lights"]')).toBeDisabled();
  await win.screenshot({ path: path.join(OUT, '05-after-clear-lights.png'), fullPage: false });

  // eslint-disable-next-line no-console
  console.log('  lighting: +warm +cool +magenta (3 added) → cleared (0 left)');

  await app.close();
});
