import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

/*
 * Slice 72 — Numeric transform editor in the Selection panel.
 *
 * The X/Y/Z position / rotation / scale inputs let users move,
 * rotate, and scale the selected mesh by typing values directly.
 */

const OUT = path.resolve(__dirname, 'screenshots', 'studio-transform-editor');

async function selectByKind(win, kind) {
  await win.evaluate((k) => {
    const vp = window.__archdiscViewport;
    let m = null;
    vp.scene.traverse(o => { if (o.userData && o.userData.archdiscStudioPrimitiveKind === k) m = o; });
    if (m && window.__studioSelectMesh) window.__studioSelectMesh(m);
  }, kind);
}

async function setNumber(win, selector, value) {
  await win.evaluate(({ sel, val }) => {
    const el = document.querySelector(sel);
    if (!el) return;
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(el, String(val));
    el.dispatchEvent(new Event('input',  { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }, { sel: selector, val: value });
}

test('Studio Transform editor — numeric X/Y/Z inputs drive selected mesh', async () => {
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

  await win.locator('[data-studio-primitive="cube"]').click();
  await win.waitForTimeout(300);
  await selectByKind(win, 'cube');
  await win.waitForTimeout(300);

  // Numeric inputs are visible.
  await expect(win.locator('[data-studio-selection-edit="position-x"]')).toBeVisible();
  await expect(win.locator('[data-studio-selection-edit="rotation-y"]')).toBeVisible();
  await expect(win.locator('[data-studio-selection-edit="scale-z"]')).toBeVisible();

  // Move cube to (0.05, 0.03, -0.02).
  await setNumber(win, '[data-studio-selection-edit="position-x"]', '0.05');
  await setNumber(win, '[data-studio-selection-edit="position-y"]', '0.03');
  await setNumber(win, '[data-studio-selection-edit="position-z"]', '-0.02');
  await win.waitForTimeout(200);

  // Rotate cube on Y by 0.5 rad.
  await setNumber(win, '[data-studio-selection-edit="rotation-y"]', '0.5');
  await win.waitForTimeout(200);

  // Scale uniformly to 1.5.
  await setNumber(win, '[data-studio-selection-edit="scale-x"]', '1.5');
  await setNumber(win, '[data-studio-selection-edit="scale-y"]', '1.5');
  await setNumber(win, '[data-studio-selection-edit="scale-z"]', '1.5');
  await win.waitForTimeout(200);

  // Read back the mesh's actual transform via scene.
  const t = await win.evaluate(() => {
    const vp = window.__archdiscViewport;
    let m = null;
    vp.scene.traverse(o => { if (o.userData && o.userData.archdiscStudioPrimitiveKind === 'cube') m = o; });
    if (!m) return null;
    return {
      px: m.position.x, py: m.position.y, pz: m.position.z,
      ry: m.rotation.y,
      sx: m.scale.x,    sy: m.scale.y,    sz: m.scale.z,
    };
  });
  expect(t.px).toBeCloseTo(0.05, 5);
  expect(t.py).toBeCloseTo(0.03, 5);
  expect(t.pz).toBeCloseTo(-0.02, 5);
  expect(t.ry).toBeCloseTo(0.5, 5);
  expect(t.sx).toBeCloseTo(1.5, 5);
  expect(t.sy).toBeCloseTo(1.5, 5);
  expect(t.sz).toBeCloseTo(1.5, 5);

  await win.screenshot({ path: path.join(OUT, '01-cube-moved-rotated-scaled.png'), fullPage: false });

  // ---- 4-angle orbit capture of the transformed cube ----
  for (const az of [0, 90, 180, 270]) {
    await win.evaluate((a) => window.__archdiscOrbitView && window.__archdiscOrbitView(a, 22, 1), az);
    await win.waitForTimeout(220);
    await win.screenshot({ path: path.join(OUT, `02-az${az}.png`), fullPage: false });
  }

  // eslint-disable-next-line no-console
  console.log(`  transform editor: cube moved to (0.05, 0.03, -0.02), rotated Y=0.5rad, scaled 1.5x — values drove mesh transform exactly`);

  await app.close();
});
