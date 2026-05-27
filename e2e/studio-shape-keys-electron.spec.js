import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

/*
 * Slice 37 — Face Shape Keys (Rigging discipline).
 *
 * Closes the final gap from the video-scope survey (FACEIT-style face
 * rig workflow visible in Video-779). Three procedural emotion blends
 * — smile, surprise, brow — each driven by a 0..1 slider; sliders
 * compose linearly on top of the selected mesh's source geometry,
 * and Reset Shape Keys restores the source exactly.
 *
 * Spec uses Suzanne (Blender-imported face mesh — naturally a good
 * subject) and verifies via vertex-checksum: source → smile=1 → checksum
 * changes; Reset → checksum returns to source; surprise=1 → different
 * checksum than smile.
 */

const OUT = path.resolve(__dirname, 'screenshots', 'studio-shape-keys');

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

async function suzanneChecksum(win) {
  return await win.evaluate(() => {
    const vp = window.__archdiscViewport;
    let m = null;
    vp.scene.traverse(o => {
      if (o.userData && o.userData.archdiscStudioPrimitiveKind === 'suzanne') m = o;
    });
    if (!m) return 0;
    const pos = m.geometry.attributes.position;
    let sum = 0;
    for (let i = 0; i < pos.count; i++) {
      sum += Math.abs(pos.getX(i)) + Math.abs(pos.getY(i)) + Math.abs(pos.getZ(i));
    }
    return sum;
  });
}

test('Studio face shape keys — smile / surprise / brow blends on Suzanne', async () => {
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

  // ---- Add Suzanne + select via the exposed API (raycast click is racy
  //      for Suzanne at the workbench grid's leftmost column). ----
  await win.locator('[data-studio-primitive="suzanne"]').click();
  await win.waitForTimeout(400);
  await win.evaluate(() => {
    const vp = window.__archdiscViewport;
    let m = null;
    vp.scene.traverse(o => { if (o.userData && o.userData.archdiscStudioPrimitiveKind === 'suzanne') m = o; });
    if (m && window.__studioSelectMesh) window.__studioSelectMesh(m);
  });
  await win.waitForTimeout(300);
  await expect(win.locator('[data-studio-selection="kind"]')).toHaveText('suzanne');

  // ---- Rigging tab shows the Face Shape Keys section ----
  await win.locator('.workbench-ribbon-placeholder-tab[data-studio-discipline="rigging"]').click();
  await win.waitForTimeout(300);
  await expect(win.locator('[data-studio-section="shape-keys"]')).toBeVisible();
  await expect(win.locator('[data-studio-shapekey-readout="smile"]')).toHaveText('0.00');
  await win.screenshot({ path: path.join(OUT, '00-baseline-suzanne.png'), fullPage: false });

  const source = await suzanneChecksum(win);
  expect(source).toBeGreaterThan(0);

  // ---- Smile to 1.0 ----
  await setRange(win, '[data-studio-shapekey="smile"]', '1');
  await expect(win.locator('[data-studio-shapekey-readout="smile"]')).toHaveText('1.00');
  await win.waitForTimeout(300);
  const smiled = await suzanneChecksum(win);
  // The displacement moves some verts up; checksum changes measurably.
  expect(Math.abs(smiled - source)).toBeGreaterThan(0.01);
  await win.screenshot({ path: path.join(OUT, '01-smile-1.0.png'), fullPage: false });

  // ---- Surprise to 1.0 alongside smile ----
  await setRange(win, '[data-studio-shapekey="surprise"]', '1');
  await expect(win.locator('[data-studio-shapekey-readout="surprise"]')).toHaveText('1.00');
  await win.waitForTimeout(300);
  const bothFull = await suzanneChecksum(win);
  // Adding surprise on top of smile changes the checksum further.
  expect(Math.abs(bothFull - smiled)).toBeGreaterThan(0.005);
  await win.screenshot({ path: path.join(OUT, '02-smile+surprise.png'), fullPage: false });

  // ---- Brow to 0.7 ----
  await setRange(win, '[data-studio-shapekey="brow"]', '0.7');
  await expect(win.locator('[data-studio-shapekey-readout="brow"]')).toHaveText('0.70');
  await win.waitForTimeout(300);
  const allThree = await suzanneChecksum(win);
  expect(Math.abs(allThree - bothFull)).toBeGreaterThan(0.001);
  await win.screenshot({ path: path.join(OUT, '03-all-three.png'), fullPage: false });

  // ---- Reset → exactly back to source ----
  await win.locator('[data-studio-action="reset-shape-keys"]').click();
  await win.waitForTimeout(300);
  await expect(win.locator('[data-studio-shapekey-readout="smile"]')).toHaveText('0.00');
  await expect(win.locator('[data-studio-shapekey-readout="surprise"]')).toHaveText('0.00');
  await expect(win.locator('[data-studio-shapekey-readout="brow"]')).toHaveText('0.00');
  const reset = await suzanneChecksum(win);
  // Reset restores from the cached source — checksum exactly equals source.
  expect(Math.abs(reset - source)).toBeLessThan(0.0001);
  await win.screenshot({ path: path.join(OUT, '04-reset.png'), fullPage: false });

  // ---- Each shape key alone for the final montage ----
  await setRange(win, '[data-studio-shapekey="smile"]', '0.8');
  await win.waitForTimeout(200);
  await win.screenshot({ path: path.join(OUT, '05-smile-only.png'), fullPage: false });
  await setRange(win, '[data-studio-shapekey="smile"]', '0');
  await setRange(win, '[data-studio-shapekey="surprise"]', '0.8');
  await win.waitForTimeout(200);
  await win.screenshot({ path: path.join(OUT, '06-surprise-only.png'), fullPage: false });
  await setRange(win, '[data-studio-shapekey="surprise"]', '0');
  await setRange(win, '[data-studio-shapekey="brow"]', '0.8');
  await win.waitForTimeout(200);
  await win.screenshot({ path: path.join(OUT, '07-brow-only.png'), fullPage: false });

  // eslint-disable-next-line no-console
  console.log(`  shape keys: source=${source.toFixed(3)} smile=${smiled.toFixed(3)} +surprise=${bothFull.toFixed(3)} +brow=${allThree.toFixed(3)} reset=${reset.toFixed(3)}`);

  await app.close();
});
