import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

/*
 * Slice 9 — Sculpting discipline: procedural full-mesh deformations.
 *
 * Three brushes — Inflate (push along normals), Twist (rotate around
 * Y proportionally to Y), Smooth (Laplacian average against one-ring
 * neighbors). All operate on the selected mesh's geometry, mutate
 * position.array in place, recompute normals + bounds + Mesh stats.
 *
 * Verification: read back the geometry's vertex-position sum-of-
 * magnitudes BEFORE and AFTER each brush; deformations should move
 * the checksum measurably. Multi-angle screenshots at each phase
 * show the visible sculpt result.
 */

const OUT = path.resolve(__dirname, 'screenshots', 'studio-sculpting');

async function screenPosOfMesh(win, index) {
  return await win.evaluate(({ idx }) => {
    const vp = window.__archdiscViewport;
    const meshes = [];
    vp.scene.traverse(o => {
      if (o.isMesh && o.userData && o.userData.archdiscStudioPrimitive) meshes.push(o);
    });
    const mesh = meshes[idx];
    if (!mesh) return null;
    const v = mesh.position.clone().project(vp.camera);
    const rect = vp.renderer.domElement.getBoundingClientRect();
    return {
      x: (v.x + 1) / 2 * rect.width + rect.left,
      y: (-v.y + 1) / 2 * rect.height + rect.top,
    };
  }, { idx: index });
}

async function selectedGeometryChecksum(win) {
  return await win.evaluate(() => {
    const vp = window.__archdiscViewport;
    let mesh = null;
    vp.scene.traverse(o => {
      if (o.isMesh && o.userData && o.userData.archdiscStudioPrimitive) mesh = o;
    });
    if (!mesh) return null;
    const pos = mesh.geometry.attributes.position;
    let sum = 0;
    for (let i = 0; i < pos.count; i++) {
      sum += Math.abs(pos.getX(i)) + Math.abs(pos.getY(i)) + Math.abs(pos.getZ(i));
    }
    const radius = mesh.geometry.boundingSphere ? mesh.geometry.boundingSphere.radius : 0;
    return { sum, vCount: pos.count, radius };
  });
}

test('Studio sculpting — Inflate / Twist / Smooth deform the selected mesh measurably', async () => {
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

  // Sculpting panel is visible from app start; brushes disabled with no selection.
  await expect(win.locator('[data-studio-section="sculpting"]')).toBeVisible();
  await expect(win.locator('[data-studio-action="sculpt-inflate"]')).toBeDisabled();
  await expect(win.locator('[data-studio-action="sculpt-twist"]')).toBeDisabled();
  await expect(win.locator('[data-studio-action="sculpt-smooth"]')).toBeDisabled();

  // ---- Add a sphere (dense vertex layout = brushes have something to chew on). ----
  await win.locator('[data-studio-primitive="sphere"]').click();
  await win.waitForTimeout(400);
  const meshPos = await screenPosOfMesh(win, 0);
  expect(meshPos).not.toBeNull();
  await win.mouse.click(meshPos.x, meshPos.y);
  await win.waitForTimeout(500);

  await expect(win.locator('[data-studio-action="sculpt-inflate"]')).toBeEnabled();
  // Orbit slightly for a 3/4 view that shows deformations clearly.
  await win.evaluate(() => window.__archdiscOrbitView && window.__archdiscOrbitView(45, 25, 1));
  await win.waitForTimeout(400);
  await win.screenshot({ path: path.join(OUT, '00-sphere-selected.png'), fullPage: false });

  const baseline = await selectedGeometryChecksum(win);
  expect(baseline.vCount).toBeGreaterThan(100);

  // ---- Inflate ×3 — radius grows, vertex sum grows ----
  for (let i = 0; i < 3; i++) {
    await win.locator('[data-studio-action="sculpt-inflate"]').click();
    await win.waitForTimeout(300);
  }
  const afterInflate = await selectedGeometryChecksum(win);
  expect(afterInflate.sum).toBeGreaterThan(baseline.sum * 1.1);
  expect(afterInflate.radius).toBeGreaterThan(baseline.radius);
  await win.screenshot({ path: path.join(OUT, '01-after-inflate-3x.png'), fullPage: false });

  // ---- Bump strength to 0.3, Twist once ----
  await win.locator('[data-studio-sculpt="strength"]').fill('0.3');
  await win.dispatchEvent('[data-studio-sculpt="strength"]', 'input');
  await win.waitForTimeout(200);
  await expect(win.locator('[data-studio-sculpt-readout="strength"]')).toHaveText('0.30');
  await win.locator('[data-studio-action="sculpt-twist"]').click();
  await win.waitForTimeout(400);
  const afterTwist = await selectedGeometryChecksum(win);
  // Twist preserves Y but redistributes X/Z; sum-of-magnitudes typically drops
  // slightly because rotated points trade X for Z and vice-versa. Assert
  // that the checksum changed, not direction.
  expect(Math.abs(afterTwist.sum - afterInflate.sum)).toBeGreaterThan(0.005);
  await win.screenshot({ path: path.join(OUT, '02-after-twist.png'), fullPage: false });

  // ---- Smooth ×2 — Laplacian pulls extremes toward neighbors ----
  await win.locator('[data-studio-sculpt="strength"]').fill('0.5');
  await win.dispatchEvent('[data-studio-sculpt="strength"]', 'input');
  await win.waitForTimeout(200);
  for (let i = 0; i < 2; i++) {
    await win.locator('[data-studio-action="sculpt-smooth"]').click();
    await win.waitForTimeout(300);
  }
  const afterSmooth = await selectedGeometryChecksum(win);
  // Smoothing shrinks the boundary slightly toward the centroid; vertex
  // sum drops vs. the post-twist state.
  expect(afterSmooth.sum).toBeLessThan(afterTwist.sum);
  await win.screenshot({ path: path.join(OUT, '03-after-smooth-2x.png'), fullPage: false });

  // Multi-angle for the headline.
  await win.evaluate(() => window.__archdiscOrbitView && window.__archdiscOrbitView(135, 30, 1));
  await win.waitForTimeout(300);
  await win.screenshot({ path: path.join(OUT, '04-orbit-az135.png'), fullPage: false });
  await win.evaluate(() => window.__archdiscOrbitView && window.__archdiscOrbitView(225, 30, 1));
  await win.waitForTimeout(300);
  await win.screenshot({ path: path.join(OUT, '05-orbit-az225.png'), fullPage: false });

  // eslint-disable-next-line no-console
  console.log(`  sculpt: baseline sum=${baseline.sum.toFixed(2)} r=${baseline.radius.toFixed(4)} → inflate=${afterInflate.sum.toFixed(2)} r=${afterInflate.radius.toFixed(4)} → twist=${afterTwist.sum.toFixed(2)} → smooth=${afterSmooth.sum.toFixed(2)}`);

  await app.close();
});
