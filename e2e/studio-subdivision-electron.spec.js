import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

/*
 * Slice 21 — Subdivision surface: midpoint subdivision (4× faces / pass).
 *
 * Pick a mesh, click Subdivide Selected → for every triangle, midpoints
 * are inserted on each edge and the triangle is replaced with 4 smaller
 * sub-triangles. Two passes should grow the face count to ~16× the
 * baseline. Sculpt brushes still apply on the denser geometry.
 */

const OUT = path.resolve(__dirname, 'screenshots', 'studio-subdivision');

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

test('Studio subdivision — Subdivide Selected grows face count ~4× per pass', async () => {
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

  await expect(win.locator('[data-studio-section="subdivision"]')).toBeVisible();
  await expect(win.locator('[data-studio-action="subdivide-selected"]')).toBeDisabled();

  // ---- Add an icosahedron (low baseline, dramatic subdivision growth). ----
  await win.locator('[data-studio-primitive="icosahedron"]').click();
  await win.waitForTimeout(300);
  const meshPos = await screenPosOfMesh(win, 0);
  await win.mouse.click(meshPos.x, meshPos.y);
  await win.waitForTimeout(400);
  await expect(win.locator('[data-studio-action="subdivide-selected"]')).toBeEnabled();
  await win.evaluate(() => window.__archdiscOrbitView && window.__archdiscOrbitView(35, 25, 1));
  await win.waitForTimeout(300);

  const baseStats = await win.evaluate(() => {
    const vp = window.__archdiscViewport;
    let m = null;
    vp.scene.traverse(o => {
      if (o.isMesh && o.userData && o.userData.archdiscStudioPrimitive) m = o;
    });
    return m
      ? {
          v: m.geometry.attributes.position.count,
          f: m.geometry.index
            ? m.geometry.index.count / 3
            : m.geometry.attributes.position.count / 3,
        }
      : null;
  });
  expect(baseStats).not.toBeNull();
  expect(baseStats.f).toBeGreaterThan(0);
  await win.screenshot({ path: path.join(OUT, '00-icosa-baseline.png'), fullPage: false });

  // ---- One subdivision pass ----
  await win.locator('[data-studio-action="subdivide-selected"]').click();
  await win.waitForTimeout(400);
  const after1 = await win.evaluate(() => {
    const vp = window.__archdiscViewport;
    let m = null;
    vp.scene.traverse(o => {
      if (o.isMesh && o.userData && o.userData.archdiscStudioPrimitive) m = o;
    });
    return m
      ? {
          v: m.geometry.attributes.position.count,
          f: m.geometry.index
            ? m.geometry.index.count / 3
            : m.geometry.attributes.position.count / 3,
        }
      : null;
  });
  // Midpoint subdivision: faces should multiply by exactly 4.
  expect(after1.f).toBe(baseStats.f * 4);
  await win.screenshot({ path: path.join(OUT, '01-after-1-pass.png'), fullPage: false });

  // ---- Second subdivision pass — 16× baseline faces ----
  await win.locator('[data-studio-action="subdivide-selected"]').click();
  await win.waitForTimeout(400);
  const after2 = await win.evaluate(() => {
    const vp = window.__archdiscViewport;
    let m = null;
    vp.scene.traverse(o => {
      if (o.isMesh && o.userData && o.userData.archdiscStudioPrimitive) m = o;
    });
    return m
      ? {
          v: m.geometry.attributes.position.count,
          f: m.geometry.index
            ? m.geometry.index.count / 3
            : m.geometry.attributes.position.count / 3,
        }
      : null;
  });
  expect(after2.f).toBe(baseStats.f * 16);
  await win.screenshot({ path: path.join(OUT, '02-after-2-passes.png'), fullPage: false });

  // ---- Sculpt → Smooth works on the densely-subdivided mesh ----
  await win.locator('[data-studio-action="sculpt-smooth"]').click();
  await win.waitForTimeout(400);
  const afterSmooth = await win.evaluate(() => {
    const vp = window.__archdiscViewport;
    let m = null;
    vp.scene.traverse(o => {
      if (o.isMesh && o.userData && o.userData.archdiscStudioPrimitive) m = o;
    });
    return m
      ? {
          f: m.geometry.index
            ? m.geometry.index.count / 3
            : m.geometry.attributes.position.count / 3,
        }
      : null;
  });
  // Smooth doesn't change topology, just vertex positions — same face count.
  expect(afterSmooth.f).toBe(after2.f);
  await win.evaluate(() => window.__archdiscOrbitView && window.__archdiscOrbitView(45, 30, 1));
  await win.waitForTimeout(300);
  await win.screenshot({ path: path.join(OUT, '03-after-subdiv-and-smooth.png'), fullPage: false });

  // eslint-disable-next-line no-console
  console.log(`  subdivision: baseline ${baseStats.f} faces → ${after1.f} → ${after2.f} (×${after2.f / baseStats.f})`);

  await app.close();
});
