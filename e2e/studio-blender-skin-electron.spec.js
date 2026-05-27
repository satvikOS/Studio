import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

/*
 * Slice 78 — Blender Skin modifier.
 *
 * Blender source: blender/source/blender/modifiers/intern/MOD_skin.cc
 *
 * Tube around edges + sphere at each vertex = "ball-and-stick" surface.
 */

const OUT = path.resolve(__dirname, 'screenshots', 'studio-blender-skin');

async function selectByKind(win, kind) {
  await win.evaluate((k) => {
    const vp = window.__archdiscViewport;
    let m = null;
    vp.scene.traverse(o => { if (o.userData && o.userData.archdiscStudioPrimitiveKind === k) m = o; });
    if (m && window.__studioSelectMesh) window.__studioSelectMesh(m);
  }, kind);
}

test('Studio Blender Skin — ball-and-stick on a dodecahedron', async () => {
  test.setTimeout(120000);
  fs.mkdirSync(OUT, { recursive: true });

  const app = await electron.launch({
    args: [path.join(__dirname, '..', 'electron', 'main.js')],
    slowMo: 220,
  });

  const win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');
  await expect(win.locator('.workbench-current .workbench-name')).toHaveText('ArchDisc Studio', { timeout: 30000 });
  await expect(win.locator('canvas').first()).toBeVisible({ timeout: 60000 });
  await win.waitForFunction(() => !!window.__archdiscViewport, null, { timeout: 30000 });
  await win.waitForTimeout(800);

  // Dodecahedron — 20 verts, 12 pentagonal faces (36 tris after
  // triangulation), 30 unique edges. Loop-subdivide it first to get
  // a denser ball-and-stick.
  await win.locator('[data-studio-primitive="dodecahedron"]').click();
  await win.waitForTimeout(300);
  await selectByKind(win, 'dodecahedron');
  await win.waitForTimeout(300);
  await win.locator('[data-studio-ribbon-action="loop-subdivide"]').click();
  await win.waitForTimeout(400);

  await win.locator('[data-studio-ribbon-action="skin-mod"]').click();
  await win.waitForTimeout(500);

  const state = await win.evaluate(() => {
    const vp = window.__archdiscViewport;
    let m = null;
    vp.scene.traverse(o => { if (o.userData && o.userData.archdiscStudioPrimitiveKind === 'dodecahedron') m = o; });
    if (!m) return null;
    return {
      skinned: m.userData.archdiscStudioSkinned || 0,
      edges: m.userData.archdiscStudioSkinEdges || 0,
      joints: m.userData.archdiscStudioSkinJoints || 0,
      verts: m.geometry.attributes.position.count,
    };
  });
  expect(state.skinned).toBe(1);
  expect(state.edges).toBeGreaterThan(50);    // subdivided dodecahedron has many edges
  expect(state.joints).toBeGreaterThan(20);   // subdivided -> more verts
  expect(state.verts).toBeGreaterThan(1000);  // edges + joints * geom verts
  await win.screenshot({ path: path.join(OUT, '01-skinned.png'), fullPage: false });

  // 4-angle showcase.
  for (const az of [0, 90, 180, 270]) {
    await win.evaluate((a) => window.__archdiscOrbitView && window.__archdiscOrbitView(a, 22, 1), az);
    await win.waitForTimeout(220);
    await win.screenshot({ path: path.join(OUT, `02-az${az}.png`), fullPage: false });
  }

  // eslint-disable-next-line no-console
  console.log(`  blender skin: subdivided dodecahedron -> ${state.edges} edges + ${state.joints} joints -> ${state.verts} verts in ball-and-stick surface`);

  await app.close();
});
