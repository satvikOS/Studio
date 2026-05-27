import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

/*
 * Slice 18 — Procedural generation: recursive Tree generator.
 *
 * Pick depth (1–5) + branch count per node (2–4), click Generate Tree
 * → a merged-geometry tree (cylindrical branches + spherical leaf
 * tips) drops as one Studio primitive. Larger depths exponentially
 * grow vertex counts, so the spec asserts that growth.
 */

const OUT = path.resolve(__dirname, 'screenshots', 'studio-procedural');

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

test('Studio procedural tree — depth 2 / 3 / 4 each produce a larger merged mesh', async () => {
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

  await expect(win.locator('[data-studio-section="procedural"]')).toBeVisible();
  await expect(win.locator('[data-studio-proc-readout="depth"]')).toHaveText('4');
  await expect(win.locator('[data-studio-proc-readout="branches"]')).toHaveText('3');
  await win.screenshot({ path: path.join(OUT, '00-proc-panel-default.png'), fullPage: false });

  async function lastTreeVCount() {
    return await win.evaluate(() => {
      const vp = window.__archdiscViewport;
      let last = null;
      vp.scene.traverse(o => {
        if (o.userData && o.userData.archdiscStudioPrimitiveKind === 'procedural-tree') {
          last = o;
        }
      });
      return last ? last.geometry.attributes.position.count : 0;
    });
  }

  // ---- Depth 2, branches 2 — small tree ----
  await setRange(win, '[data-studio-proc="depth"]',    '2');
  await setRange(win, '[data-studio-proc="branches"]', '2');
  await win.locator('[data-studio-action="generate-tree"]').click();
  await win.waitForTimeout(500);
  await expect(win.locator('[data-studio-primitive-count]')).toHaveText('1 primitive in scene');
  const v2 = await lastTreeVCount();
  expect(v2).toBeGreaterThan(0);
  await win.evaluate(() => window.__archdiscOrbitView && window.__archdiscOrbitView(35, 15, 1));
  await win.waitForTimeout(300);
  await win.screenshot({ path: path.join(OUT, '01-tree-d2-b2.png'), fullPage: false });

  // ---- Depth 3, branches 3 — medium tree (more branches, more leaves) ----
  await setRange(win, '[data-studio-proc="depth"]',    '3');
  await setRange(win, '[data-studio-proc="branches"]', '3');
  await win.locator('[data-studio-action="generate-tree"]').click();
  await win.waitForTimeout(500);
  const v3 = await lastTreeVCount();
  expect(v3).toBeGreaterThan(v2);
  await win.screenshot({ path: path.join(OUT, '02-tree-d3-b3.png'), fullPage: false });

  // ---- Depth 4, branches 3 — biggest tree ----
  await setRange(win, '[data-studio-proc="depth"]', '4');
  await win.locator('[data-studio-action="generate-tree"]').click();
  await win.waitForTimeout(800);
  await expect(win.locator('[data-studio-primitive-count]')).toHaveText('3 primitives in scene');
  const v4 = await lastTreeVCount();
  expect(v4).toBeGreaterThan(v3);
  await win.evaluate(() => window.__archdiscOrbitView && window.__archdiscOrbitView(45, 10, 1));
  await win.waitForTimeout(300);
  await win.screenshot({ path: path.join(OUT, '03-tree-d4-b3.png'), fullPage: false });
  await win.evaluate(() => window.__archdiscOrbitView && window.__archdiscOrbitView(225, 10, 1));
  await win.waitForTimeout(300);
  await win.screenshot({ path: path.join(OUT, '04-trees-az225.png'), fullPage: false });

  // eslint-disable-next-line no-console
  console.log(`  procedural trees: d2b2=${v2}v → d3b3=${v3}v → d4b3=${v4}v`);

  await app.close();
});
