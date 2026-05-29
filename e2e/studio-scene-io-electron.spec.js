import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

/*
 * Slice 39 — Scene Save / Load (JSON snapshot).
 *
 * Save serialises the current Studio primitives + lights to a JSON
 * snapshot cached in component state; Load restores from the snapshot.
 * Spec builds a 4-primitive + 2-light scene, saves it, mutates the
 * scene heavily, then loads → verifies the loaded scene matches the
 * saved one (count + kinds + material colors).
 */

const OUT = path.resolve(__dirname, 'screenshots', 'studio-scene-io');

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

async function sceneSnapshot(win) {
  return await win.evaluate(() => {
    const vp = window.__archdiscViewport;
    const prims = [];
    let lights = 0;
    vp.scene.traverse(o => {
      if (o.userData && o.userData.archdiscStudioPrimitive) {
        prims.push({
          kind: o.userData.archdiscStudioPrimitiveKind,
          pos: [
            +o.position.x.toFixed(5),
            +o.position.y.toFixed(5),
            +o.position.z.toFixed(5),
          ],
          color: o.material && o.material.color ? '#' + o.material.color.getHexString() : null,
        });
      }
      if (o.userData && o.userData.archdiscStudioLight && o.isLight) lights++;
    });
    return { prims, lights };
  });
}

test('Studio scene I/O — save snapshot, mutate scene, load → original restored', async () => {
  fs.mkdirSync(OUT, { recursive: true });

  const app = await electron.launch({
    args: [path.join(__dirname, '..', 'electron', 'main.js')],
    slowMo: Number(process.env.STUDIO_SLOWMO) || 2200,
  });

  const win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');
  await expect(win.locator('.workbench-current .workbench-name')).toHaveText('ArchDisc Studio', { timeout: 30000 });
  await expect(win.locator('canvas').first()).toBeVisible({ timeout: 60000 });
  await win.waitForFunction(() => !!window.__archdiscViewport, null, { timeout: 30000 });
  await win.waitForTimeout(800);

  // ---- Build a 4-primitive scene with one preset material + 2 lights ----
  for (const k of ['cube', 'sphere', 'cone', 'suzanne']) {
    await win.locator(`[data-studio-primitive="${k}"]`).click();
    await win.waitForTimeout(250);
  }
  // Pick the sphere via the API and recolor it to a recognizable preset.
  await win.evaluate(() => {
    const vp = window.__archdiscViewport;
    let m = null;
    vp.scene.traverse(o => { if (o.userData && o.userData.archdiscStudioPrimitiveKind === 'sphere') m = o; });
    if (m && window.__studioSelectMesh) window.__studioSelectMesh(m);
  });
  await win.waitForTimeout(300);
  await win.locator('[data-studio-material-preset="gold"]').click();
  await win.waitForTimeout(200);

  // Two cinematic lights.
  await win.locator('.workbench-ribbon-placeholder-tab[data-studio-discipline="rendering"]').click();
  await win.waitForTimeout(200);
  await win.locator('[data-studio-lighting="color"]').fill('#ffb56b');
  await setRange(win, '[data-studio-lighting="intensity"]', '2.4');
  await win.locator('[data-studio-action="add-light"]').click();
  await win.waitForTimeout(150);
  await win.locator('[data-studio-lighting="color"]').fill('#6bb5ff');
  await setRange(win, '[data-studio-lighting="intensity"]', '1.6');
  await win.locator('[data-studio-action="add-light"]').click();
  await win.waitForTimeout(200);

  const beforeSnapshot = await sceneSnapshot(win);
  expect(beforeSnapshot.prims).toHaveLength(4);
  expect(beforeSnapshot.lights).toBe(2);

  await win.screenshot({ path: path.join(OUT, '00-built-scene.png'), fullPage: false });

  // ---- Save ----
  await win.locator('.workbench-ribbon-placeholder-tab[data-studio-discipline="modeling"]').click();
  await win.waitForTimeout(200);
  await expect(win.locator('[data-studio-scene-io-status]')).toHaveText('No save yet');
  await win.locator('[data-studio-action="save-scene"]').click();
  await win.waitForTimeout(200);
  await expect(win.locator('[data-studio-scene-io-status]')).toContainText('Saved');
  await expect(win.locator('[data-studio-action="load-scene"]')).toBeEnabled();

  // ---- Mutate aggressively ----
  await win.locator('[data-studio-action="clear-scene"]').click();
  await win.waitForTimeout(300);
  await expect(win.locator('[data-studio-primitive-count]')).toHaveText('0 primitives in scene');
  await win.locator('[data-studio-primitive="torus-knot"]').click();
  await win.waitForTimeout(250);
  await win.locator('[data-studio-primitive="icosahedron"]').click();
  await win.waitForTimeout(250);
  const midSnapshot = await sceneSnapshot(win);
  expect(midSnapshot.prims).toHaveLength(2);
  expect(midSnapshot.prims.map(p => p.kind).sort()).toEqual(['icosahedron', 'torus-knot']);
  await win.screenshot({ path: path.join(OUT, '01-mutated-scene.png'), fullPage: false });

  // ---- Load → original 4-primitive + 2-light scene restored ----
  await win.locator('[data-studio-action="load-scene"]').click();
  await win.waitForTimeout(500);
  const afterSnapshot = await sceneSnapshot(win);
  expect(afterSnapshot.prims).toHaveLength(4);
  expect(afterSnapshot.lights).toBe(2);
  // Kinds match.
  const beforeKinds = beforeSnapshot.prims.map(p => p.kind).sort();
  const afterKinds = afterSnapshot.prims.map(p => p.kind).sort();
  expect(afterKinds).toEqual(beforeKinds);
  // The recolored sphere kept its gold color through the save→load cycle.
  const beforeSphere = beforeSnapshot.prims.find(p => p.kind === 'sphere');
  const afterSphere = afterSnapshot.prims.find(p => p.kind === 'sphere');
  expect(afterSphere.color).toBe(beforeSphere.color);
  // Positions match to 5 decimal places.
  for (const kind of beforeKinds) {
    const b = beforeSnapshot.prims.find(p => p.kind === kind);
    const a = afterSnapshot.prims.find(p => p.kind === kind);
    expect(a.pos[0]).toBeCloseTo(b.pos[0], 4);
    expect(a.pos[1]).toBeCloseTo(b.pos[1], 4);
    expect(a.pos[2]).toBeCloseTo(b.pos[2], 4);
  }
  await win.screenshot({ path: path.join(OUT, '02-loaded-scene.png'), fullPage: false });

  // eslint-disable-next-line no-console
  console.log(`  scene I/O: saved ${beforeSnapshot.prims.length} prim + ${beforeSnapshot.lights} lt → mutated → loaded back identically`);

  await app.close();
});
