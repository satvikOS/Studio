import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

/*
 * Slice 31 — Boolean / CSG operations via manifold-3d.
 *
 * Source: manifold-3d (MIT, Emmett Lalish) — already vendored as part
 * of the Mech-inherited foundation. Studio's Boolean section runs
 * Union / Difference / Intersect against operand A = the previous
 * primitive in the scene stack and operand B = the selected primitive.
 * Operands are consumed; the result lands as a new
 * archdiscStudioPrimitiveKind="boolean-<op>" mesh.
 *
 * Spec drives one complete project per CSG operation: two overlapping
 * primitives → real click on the Boolean button → result mesh has the
 * expected post-Boolean topology.
 */

const OUT = path.resolve(__dirname, 'screenshots', 'studio-boolean-csg');

async function screenPosOfMesh(win, kind, occurrence) {
  return await win.evaluate(({ k, n }) => {
    const vp = window.__archdiscViewport;
    let hits = 0;
    let target = null;
    vp.scene.traverse(o => {
      if (o.userData && o.userData.archdiscStudioPrimitiveKind === k) {
        if (hits === n) target = o;
        hits++;
      }
    });
    if (!target) return null;
    const v = target.position.clone().project(vp.camera);
    const rect = vp.renderer.domElement.getBoundingClientRect();
    return {
      x: (v.x + 1) / 2 * rect.width + rect.left,
      y: (-v.y + 1) / 2 * rect.height + rect.top,
    };
  }, { k: kind, n: occurrence || 0 });
}

// Overlap the just-added pair (the last two Studio primitives) at the
// origin so manifold has a real intersection to operate on. Uses real
// scene-graph manipulation rather than a UI gesture because Studio
// doesn't yet ship a translate-via-drag tool; the operand-positioning
// helper is the same step a future translate gizmo would do.
async function overlapLastPair(win) {
  await win.evaluate(() => {
    const vp = window.__archdiscViewport;
    const primitives = [];
    vp.scene.traverse(o => {
      if (o.userData && o.userData.archdiscStudioPrimitive) primitives.push(o);
    });
    if (primitives.length < 2) return;
    const a = primitives[primitives.length - 2];
    const b = primitives[primitives.length - 1];
    a.position.set(0, 0, 0);
    b.position.set(0.008, 0, 0); // 8 mm offset — partial overlap
  });
}

test('Studio Boolean CSG — Union / Difference / Intersect via manifold-3d', async () => {
  fs.mkdirSync(OUT, { recursive: true });

  const app = await electron.launch({
    args: [path.join(__dirname, '..', 'electron', 'main.js')],
    slowMo: Number(process.env.STUDIO_SLOWMO) || 2200,
  });

  const win = await app.firstWindow();
  // Forward renderer console errors / warns so manifold failures surface.
  win.on('console', msg => {
    const t = msg.type();
    if (t === 'warning' || t === 'error') {
      // eslint-disable-next-line no-console
      console.log(`  [renderer:${t}]`, msg.text());
    }
  });
  await win.waitForLoadState('domcontentloaded');
  await expect(win.locator('.workbench-current .workbench-name')).toHaveText('ArchDisc Studio', { timeout: 30000 });
  await expect(win.locator('canvas').first()).toBeVisible({ timeout: 60000 });
  await win.waitForFunction(() => !!window.__archdiscViewport, null, { timeout: 30000 });
  await win.waitForTimeout(800);

  // ---- Boolean section visible (Modeling tab default); manifold loads ----
  await expect(win.locator('[data-studio-section="boolean"]')).toBeVisible();
  await expect(win.locator('[data-studio-boolean-state]')).toHaveText('manifold ready', { timeout: 30000 });
  // All 3 buttons disabled until 2+ primitives + selection.
  await expect(win.locator('[data-studio-action="boolean-union"]')).toBeDisabled();

  async function pair(kindA, kindB) {
    await win.locator(`[data-studio-primitive="${kindA}"]`).click();
    await win.waitForTimeout(250);
    await win.locator(`[data-studio-primitive="${kindB}"]`).click();
    await win.waitForTimeout(250);
    await overlapLastPair(win);
    await win.waitForTimeout(150);
    // Select the SECOND (latest) primitive via raycast.
    const pos = await screenPosOfMesh(win, kindB, 0);
    expect(pos).not.toBeNull();
    await win.mouse.click(pos.x, pos.y);
    await win.waitForTimeout(300);
    await expect(win.locator('[data-studio-selection="kind"]')).toHaveText(kindB);
    await expect(win.locator('[data-studio-action="boolean-union"]')).toBeEnabled();
  }

  async function recordResult(op) {
    return await win.evaluate((o) => {
      const vp = window.__archdiscViewport;
      let result = null;
      vp.scene.traverse(obj => {
        if (obj.userData && obj.userData.archdiscStudioPrimitiveKind === `boolean-${o}`) {
          result = obj;
        }
      });
      if (!result) return null;
      return {
        v: result.geometry.attributes.position.count,
        f: result.geometry.index ? result.geometry.index.count / 3 : 0,
      };
    }, op);
  }

  // ---- Union: cube + sphere ----
  await pair('cube', 'sphere');
  await win.evaluate(() => window.__archdiscOrbitView && window.__archdiscOrbitView(30, 25, 1));
  await win.waitForTimeout(300);
  await win.screenshot({ path: path.join(OUT, '00-pre-union-pair.png'), fullPage: false });
  await win.locator('[data-studio-action="boolean-union"]').click();
  await win.waitForTimeout(800);
  await expect(win.locator('[data-studio-primitive-count]')).toHaveText('1 primitive in scene');
  const u = await recordResult('union');
  expect(u).not.toBeNull();
  expect(u.v).toBeGreaterThan(0);
  expect(u.f).toBeGreaterThan(0);
  await win.screenshot({ path: path.join(OUT, '01-after-union.png'), fullPage: false });

  // ---- Difference: clear, then cube − sphere ----
  await win.locator('[data-studio-action="clear-scene"]').click();
  await win.waitForTimeout(300);
  await expect(win.locator('[data-studio-primitive-count]')).toHaveText('0 primitives in scene');
  await pair('cube', 'sphere');
  await win.locator('[data-studio-action="boolean-difference"]').click();
  await win.waitForTimeout(800);
  await expect(win.locator('[data-studio-primitive-count]')).toHaveText('1 primitive in scene');
  const d = await recordResult('difference');
  expect(d).not.toBeNull();
  expect(d.v).toBeGreaterThan(0);
  await win.screenshot({ path: path.join(OUT, '02-after-difference.png'), fullPage: false });

  // ---- Intersect: clear, then cube ∩ sphere ----
  await win.locator('[data-studio-action="clear-scene"]').click();
  await win.waitForTimeout(300);
  await expect(win.locator('[data-studio-primitive-count]')).toHaveText('0 primitives in scene');
  await pair('cube', 'sphere');
  // For intersect to have meaningful overlap, set both at origin.
  await win.evaluate(() => {
    const vp = window.__archdiscViewport;
    const prims = [];
    vp.scene.traverse(o => {
      if (o.userData && o.userData.archdiscStudioPrimitive) prims.push(o);
    });
    prims[0].position.set(0, 0, 0);
    prims[1].position.set(0.003, 0.003, 0.003);
  });
  await win.locator('[data-studio-action="boolean-intersect"]').click();
  await win.waitForTimeout(800);
  await expect(win.locator('[data-studio-primitive-count]')).toHaveText('1 primitive in scene');
  const itx = await recordResult('intersect');
  expect(itx).not.toBeNull();
  expect(itx.v).toBeGreaterThan(0);

  await win.evaluate(() => window.__archdiscOrbitView && window.__archdiscOrbitView(45, 25, 1));
  await win.waitForTimeout(300);
  await win.screenshot({ path: path.join(OUT, '03-after-intersect.png'), fullPage: false });
  await win.evaluate(() => window.__archdiscOrbitView && window.__archdiscOrbitView(225, 25, 1));
  await win.waitForTimeout(300);
  await win.screenshot({ path: path.join(OUT, '04-final-az225.png'), fullPage: false });

  // eslint-disable-next-line no-console
  console.log(`  csg: union=${u.v}v/${u.f}f  diff=${d.v}v/${d.f}f  intersect=${itx.v}v/${itx.f}f`);

  await app.close();
});
