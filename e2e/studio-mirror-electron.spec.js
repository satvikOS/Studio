import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

/*
 * Slice 22 — Mirror modifier.
 *
 * Clone the selected mesh's geometry, flip across the chosen axis (with
 * face-winding reversed so normals stay outward), merge with the
 * original. Vertex count and face count both roughly double per pass.
 */

const OUT = path.resolve(__dirname, 'screenshots', 'studio-mirror');

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

async function selectedStats(win) {
  return await win.evaluate(() => {
    const vp = window.__archdiscViewport;
    let m = null;
    vp.scene.traverse(o => {
      if (o.isMesh && o.userData && o.userData.archdiscStudioPrimitive) m = o;
    });
    if (!m) return null;
    return {
      v: m.geometry.attributes.position.count,
      f: m.geometry.index
        ? m.geometry.index.count / 3
        : m.geometry.attributes.position.count / 3,
    };
  });
}

test('Studio mirror — duplicate-and-flip across X / Y; vertex count doubles each pass', async () => {
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

  await expect(win.locator('[data-studio-section="mirror"]')).toBeVisible();
  await expect(win.locator('[data-studio-action="mirror-selected"]')).toBeDisabled();

  // ---- Add a cone (asymmetric, mirrors dramatically) ----
  await win.locator('[data-studio-primitive="cone"]').click();
  await win.waitForTimeout(300);
  const meshPos = await screenPosOfMesh(win, 0);
  await win.mouse.click(meshPos.x, meshPos.y);
  await win.waitForTimeout(400);
  await expect(win.locator('[data-studio-action="mirror-selected"]')).toBeEnabled();
  await win.evaluate(() => window.__archdiscOrbitView && window.__archdiscOrbitView(35, 25, 1));
  await win.waitForTimeout(300);
  const s0 = await selectedStats(win);
  await win.screenshot({ path: path.join(OUT, '00-cone-baseline.png'), fullPage: false });

  // ---- Mirror across Y (axis default 'x' → switch to 'y' first) ----
  await win.locator('[data-studio-mirror="axis"]').selectOption('y');
  await win.locator('[data-studio-action="mirror-selected"]').click();
  await win.waitForTimeout(400);
  const s1 = await selectedStats(win);
  expect(s1.v).toBe(s0.v * 2);
  expect(s1.f).toBe(s0.f * 2);
  await win.screenshot({ path: path.join(OUT, '01-after-mirror-y.png'), fullPage: false });

  // ---- Mirror across X ----
  await win.locator('[data-studio-mirror="axis"]').selectOption('x');
  await win.locator('[data-studio-action="mirror-selected"]').click();
  await win.waitForTimeout(400);
  const s2 = await selectedStats(win);
  expect(s2.v).toBe(s1.v * 2);
  expect(s2.f).toBe(s1.f * 2);
  await win.screenshot({ path: path.join(OUT, '02-after-mirror-x.png'), fullPage: false });

  // ---- Mirror across Z (final pass, the result is a 4-armed symmetric cluster) ----
  await win.locator('[data-studio-mirror="axis"]').selectOption('z');
  await win.locator('[data-studio-action="mirror-selected"]').click();
  await win.waitForTimeout(400);
  const s3 = await selectedStats(win);
  expect(s3.v).toBe(s2.v * 2);
  await win.evaluate(() => window.__archdiscOrbitView && window.__archdiscOrbitView(45, 30, 1));
  await win.waitForTimeout(300);
  await win.screenshot({ path: path.join(OUT, '03-after-mirror-z.png'), fullPage: false });
  await win.evaluate(() => window.__archdiscOrbitView && window.__archdiscOrbitView(225, 30, 1));
  await win.waitForTimeout(300);
  await win.screenshot({ path: path.join(OUT, '04-mirror-az225.png'), fullPage: false });

  // eslint-disable-next-line no-console
  console.log(`  mirror: cone ${s0.v}v / ${s0.f}f → Y → ${s1.v}v / ${s1.f}f → X → ${s2.v}v → Z → ${s3.v}v`);

  await app.close();
});
