import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

/*
 * Slice 29 — Reference Plane primitive (photo-to-3D workflow).
 *
 * Type a label, set size, click Add Reference Plane → a textured
 * THREE.Mesh (PlaneGeometry + CanvasTexture grid with the chosen
 * label in the top-left) lands as a Studio primitive. Same workflow
 * the reel at Video-29 (hooded character photo→model) and Video-402
 * (sewing iron photo→model) shows: artists drop a reference image
 * into the workspace and model against it.
 */

const OUT = path.resolve(__dirname, 'screenshots', 'studio-reference-plane');

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

test('Studio reference plane — drop three labeled reference grids, model a primitive against them', async () => {
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

  await expect(win.locator('[data-studio-section="reference"]')).toBeVisible();
  await expect(win.locator('[data-studio-reference="label"]')).toHaveValue('FRONT');
  await expect(win.locator('[data-studio-reference-readout="size"]')).toHaveText('60 mm');

  // ---- Drop FRONT reference at default 60 mm ----
  await win.locator('[data-studio-action="add-reference-plane"]').click();
  await win.waitForTimeout(400);
  await expect(win.locator('[data-studio-primitive-count]')).toHaveText('1 primitive in scene');
  await win.screenshot({ path: path.join(OUT, '00-front-reference.png'), fullPage: false });

  // ---- Drop SIDE reference, larger ----
  await win.locator('[data-studio-reference="label"]').fill('SIDE');
  await setRange(win, '[data-studio-reference="size"]', '0.08');
  await expect(win.locator('[data-studio-reference-readout="size"]')).toHaveText('80 mm');
  await win.locator('[data-studio-action="add-reference-plane"]').click();
  await win.waitForTimeout(400);
  await expect(win.locator('[data-studio-primitive-count]')).toHaveText('2 primitives in scene');

  // ---- Drop TOP reference ----
  await win.locator('[data-studio-reference="label"]').fill('TOP');
  await setRange(win, '[data-studio-reference="size"]', '0.08');
  await win.locator('[data-studio-action="add-reference-plane"]').click();
  await win.waitForTimeout(400);
  await expect(win.locator('[data-studio-primitive-count]')).toHaveText('3 primitives in scene');

  // Scene-traversal: 3 reference planes with the right labels + each
  // carries a CanvasTexture map.
  const refState = await win.evaluate(() => {
    const vp = window.__archdiscViewport;
    const labels = [];
    let mapped = 0;
    vp.scene.traverse(o => {
      if (o.userData && o.userData.archdiscStudioPrimitiveKind === 'reference-plane') {
        labels.push(o.userData.archdiscStudioReferenceLabel);
        if (o.material && o.material.map) mapped++;
      }
    });
    return { labels: labels.sort(), mapped };
  });
  expect(refState.labels).toEqual(['FRONT', 'SIDE', 'TOP']);
  expect(refState.mapped).toBe(3);
  await win.evaluate(() => window.__archdiscOrbitView && window.__archdiscOrbitView(30, 25, 1));
  await win.waitForTimeout(300);
  await win.screenshot({ path: path.join(OUT, '01-three-reference-planes.png'), fullPage: false });

  // ---- Model an actual primitive (icosahedron) against the references ----
  await win.locator('[data-studio-primitive="icosahedron"]').click();
  await win.waitForTimeout(400);
  await expect(win.locator('[data-studio-primitive-count]')).toHaveText('4 primitives in scene');
  await win.evaluate(() => window.__archdiscOrbitView && window.__archdiscOrbitView(45, 25, 1));
  await win.waitForTimeout(300);
  await win.screenshot({ path: path.join(OUT, '02-modeling-against-references.png'), fullPage: false });
  await win.evaluate(() => window.__archdiscOrbitView && window.__archdiscOrbitView(135, 25, 1));
  await win.waitForTimeout(300);
  await win.screenshot({ path: path.join(OUT, '03-references-from-az135.png'), fullPage: false });

  // eslint-disable-next-line no-console
  console.log(`  reference planes: FRONT + SIDE + TOP placed, primitive modeled against them. labels=${refState.labels.join(',')} mapped=${refState.mapped}`);

  await app.close();
});
