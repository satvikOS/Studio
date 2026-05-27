import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

/*
 * Slice 77 — Blender Build modifier.
 *
 * Blender source: blender/source/blender/modifiers/intern/MOD_build.cc
 *
 * Progressively reveal triangles via geometry.drawRange animation.
 * Verify drawRange grows from 0 to totalIdx over the configured
 * duration.
 */

const OUT = path.resolve(__dirname, 'screenshots', 'studio-blender-build');

async function selectByKind(win, kind) {
  await win.evaluate((k) => {
    const vp = window.__archdiscViewport;
    let m = null;
    vp.scene.traverse(o => { if (o.userData && o.userData.archdiscStudioPrimitiveKind === k) m = o; });
    if (m && window.__studioSelectMesh) window.__studioSelectMesh(m);
  }, kind);
}

async function buildState(win, kind) {
  return await win.evaluate((k) => {
    const vp = window.__archdiscViewport;
    let m = null;
    vp.scene.traverse(o => { if (o.userData && o.userData.archdiscStudioPrimitiveKind === k) m = o; });
    if (!m) return null;
    return {
      drawCount: m.geometry.drawRange.count,
      totalIdx:  m.geometry.index ? m.geometry.index.count : 0,
      building:  m.userData.archdiscStudioBuilding,
      built:     m.userData.archdiscStudioBuilt || 0,
    };
  }, kind);
}

test('Studio Blender Build — progressive triangle reveal animates drawRange', async () => {
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

  // Stage suzanne (968 tris -> lots to reveal progressively).
  await win.locator('[data-studio-primitive="suzanne"]').click();
  await win.waitForTimeout(300);
  await selectByKind(win, 'suzanne');
  await win.waitForTimeout(300);

  // Click Build — kicks off the 2s reveal animation.
  await win.locator('[data-studio-ribbon-action="build-anim"]').click();
  await win.waitForTimeout(50);

  // Immediately after starting, drawRange should be near 0.
  const at0 = await buildState(win, 'suzanne');
  expect(at0).not.toBeNull();
  expect(at0.totalIdx).toBeGreaterThan(1000); // suzanne has 484 tris = 1452 indices
  expect(at0.building).toBe(true);
  expect(at0.drawCount).toBeLessThan(at0.totalIdx);
  await win.screenshot({ path: path.join(OUT, '01-build-start.png'), fullPage: false });

  // Sample at ~1s — drawRange should be roughly half.
  await win.waitForTimeout(1000);
  const at1 = await buildState(win, 'suzanne');
  expect(at1.drawCount).toBeGreaterThan(at0.totalIdx * 0.3);
  expect(at1.drawCount).toBeLessThan(at0.totalIdx);
  await win.screenshot({ path: path.join(OUT, '02-build-mid.png'), fullPage: false });

  // Wait for completion (2s total + safety).
  await win.waitForTimeout(1500);
  const at2 = await buildState(win, 'suzanne');
  expect(at2.building).toBe(false);
  expect(at2.built).toBe(1);
  expect(at2.drawCount).toBe(at2.totalIdx);
  await win.screenshot({ path: path.join(OUT, '03-build-complete.png'), fullPage: false });

  // 4-angle showcase of the fully-built suzanne.
  for (const az of [0, 90, 180, 270]) {
    await win.evaluate((a) => window.__archdiscOrbitView && window.__archdiscOrbitView(a, 22, 1), az);
    await win.waitForTimeout(220);
    await win.screenshot({ path: path.join(OUT, `04-az${az}.png`), fullPage: false });
  }

  // eslint-disable-next-line no-console
  console.log(`  blender build: suzanne totalIdx=${at0.totalIdx} -> draw 0 -> ${at1.drawCount} (mid) -> ${at2.drawCount} (complete); built counter = 1`);

  await app.close();
});
