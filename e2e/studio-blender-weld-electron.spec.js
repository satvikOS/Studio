import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

/*
 * Slice 75 — Blender Weld modifier.
 *
 * Blender source: blender/source/blender/modifiers/intern/MOD_weld.cc
 *
 * Spawn an Icosahedron (Three's PolyhedronGeometry which ships
 * non-indexed -> 60 verts for 20 faces). Click Weld with a 0.5mm
 * tolerance and verify the vertex count collapses to the
 * deduplicated 12 corners.
 */

const OUT = path.resolve(__dirname, 'screenshots', 'studio-blender-weld');

async function selectByKind(win, kind) {
  await win.evaluate((k) => {
    const vp = window.__archdiscViewport;
    let m = null;
    vp.scene.traverse(o => { if (o.userData && o.userData.archdiscStudioPrimitiveKind === k) m = o; });
    if (m && window.__studioSelectMesh) window.__studioSelectMesh(m);
  }, kind);
}

async function meshStats(win, kind) {
  return await win.evaluate((k) => {
    const vp = window.__archdiscViewport;
    let m = null;
    vp.scene.traverse(o => { if (o.userData && o.userData.archdiscStudioPrimitiveKind === k) m = o; });
    if (!m) return null;
    return {
      verts: m.geometry.attributes.position.count,
      tris: m.geometry.index ? m.geometry.index.count / 3 : m.geometry.attributes.position.count / 3,
      welded: m.userData.archdiscStudioWelded || 0,
      before: m.userData.archdiscStudioWeldBefore,
      after:  m.userData.archdiscStudioWeldAfter,
    };
  }, kind);
}

test('Studio Blender Weld — merge nearby vertices on icosahedron', async () => {
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

  await win.locator('[data-studio-primitive="icosahedron"]').click();
  await win.waitForTimeout(300);
  await selectByKind(win, 'icosahedron');
  await win.waitForTimeout(300);

  const baseline = await meshStats(win, 'icosahedron');
  // THREE's IcosahedronGeometry ships non-indexed -> 60 verts.
  expect(baseline.verts).toBe(60);
  expect(baseline.tris).toBe(20);
  await win.screenshot({ path: path.join(OUT, '00-baseline.png'), fullPage: false });

  // Weld at 0.5mm tolerance.
  await win.locator('[data-studio-ribbon-action="weld"]').click();
  await win.waitForTimeout(400);

  const afterWeld = await meshStats(win, 'icosahedron');
  expect(afterWeld.welded).toBe(1);
  // Welded down to icosa's 12 corners.
  expect(afterWeld.verts).toBe(12);
  expect(afterWeld.tris).toBe(20); // tri count preserved
  expect(afterWeld.before).toBe(60);
  expect(afterWeld.after).toBe(12);
  await win.screenshot({ path: path.join(OUT, '01-welded.png'), fullPage: false });

  // 4-angle showcase.
  for (const az of [0, 90, 180, 270]) {
    await win.evaluate((a) => window.__archdiscOrbitView && window.__archdiscOrbitView(a, 22, 1), az);
    await win.waitForTimeout(220);
    await win.screenshot({ path: path.join(OUT, `02-az${az}.png`), fullPage: false });
  }

  // eslint-disable-next-line no-console
  console.log(`  blender weld: icosa baseline ${baseline.verts}v -> after weld ${afterWeld.verts}v (60 -> 12), tris preserved (20)`);

  await app.close();
});
