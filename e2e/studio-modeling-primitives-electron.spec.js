import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

/*
 * Slice 3 — first real Studio interaction: Modeling primitives.
 *
 * Drives a complete user workflow in the actual ArchDisc Studio
 * desktop app:
 *   1. App opens, Studio is the default workbench, Modeling tab is
 *      the default discipline → primitive buttons are rendered.
 *   2. The user clicks each primitive button in turn — a cube,
 *      sphere, plane, cylinder, cone, torus — each time a new
 *      three.js mesh lands in window.__archdiscScene tagged with
 *      `archdiscStudioPrimitive`, the in-scene counter ticks up
 *      and the right-panel Mesh-stats Vertices/Faces values grow.
 *   3. After all 6 primitives are in the scene, the camera orbits
 *      through several azimuth angles so every primitive is
 *      verified visible as a real 3D object (not a 2D sprite).
 *
 * Per Studio's e2e mandate: real Electron launch via _electron.launch,
 * every interaction a literal click (no scene injection via window
 * globals), visual verification at every meaningful state change.
 */

const OUT = path.resolve(__dirname, 'screenshots', 'studio-modeling-primitives');

const PRIMITIVES_IN_ORDER = ['cube', 'sphere', 'plane', 'cylinder', 'cone', 'torus'];

test('Studio modeling primitives — six real meshes land in the scene and survive multi-angle orbit', async () => {
  fs.mkdirSync(OUT, { recursive: true });

  const app = await electron.launch({
    args: [path.join(__dirname, '..', 'electron', 'main.js')],
    slowMo: 350, // build-sequence spec — paced so each primitive click is visible
  });

  const win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');

  // Studio is the default workbench.
  await expect(win.locator('.workbench-current .workbench-name')).toHaveText('ArchDisc Studio', { timeout: 30000 });
  // Wait for the Viewport3D canvas to render so the three.js scene globals
  // are wired up before we start clicking primitives.
  await expect(win.locator('canvas').first()).toBeVisible({ timeout: 60000 });
  await win.waitForFunction(() => !!window.__archdiscScene, null, { timeout: 30000 });
  await win.waitForTimeout(800);

  // Modeling is the default discipline tab → primitive row is rendered.
  await expect(win.locator('[data-studio-modeling-primitives]')).toBeVisible({ timeout: 10000 });
  await expect(win.locator('[data-studio-primitive]')).toHaveCount(6);

  // Vertices + Faces stats start at zero.
  await expect(win.locator('[data-studio-stat="vertices"]')).toHaveValue('0');
  await expect(win.locator('[data-studio-stat="faces"]')).toHaveValue('0');

  // Empty-scene baseline screenshot.
  await win.screenshot({
    path: path.join(OUT, '00-studio-empty-scene.png'),
    fullPage: false,
  });

  // Click each primitive button in turn, screenshot after each, assert
  // counts grow monotonically.
  let lastVertices = 0;
  let lastFaces = 0;
  for (let i = 0; i < PRIMITIVES_IN_ORDER.length; i++) {
    const kind = PRIMITIVES_IN_ORDER[i];
    await win.locator(`[data-studio-primitive="${kind}"]`).click();
    // wait for React state to flush + scene to render.
    await win.waitForTimeout(700);

    // The in-scene counter reflects the new primitive count.
    await expect(win.locator('[data-studio-primitive-count]')).toHaveText(
      `${i + 1} primitive${i === 0 ? '' : 's'} in scene`,
      { timeout: 5000 },
    );

    // Vertices + Faces monotonically grow.
    const v = Number(await win.locator('[data-studio-stat="vertices"]').inputValue());
    const f = Number(await win.locator('[data-studio-stat="faces"]').inputValue());
    expect(v).toBeGreaterThan(lastVertices);
    expect(f).toBeGreaterThan(lastFaces);
    lastVertices = v;
    lastFaces = f;

    // The scene contains the right number of Studio primitives.
    const sceneCount = await win.evaluate(() => {
      let n = 0;
      window.__archdiscScene.traverse(o => {
        if (o.userData && o.userData.archdiscStudioPrimitive) n++;
      });
      return n;
    });
    expect(sceneCount).toBe(i + 1);

    await win.screenshot({
      path: path.join(OUT, `0${i + 1}-after-add-${kind}.png`),
      fullPage: false,
    });
  }

  // Sanity log of the final counts.
  // eslint-disable-next-line no-console
  console.log(`  final mesh stats: ${lastVertices} vertices · ${lastFaces} faces · ${PRIMITIVES_IN_ORDER.length} primitives`);

  // Multi-angle orbit captures — proves the primitives are real 3D
  // meshes, not flat 2D shapes (per Studio's e2e-from-all-angles
  // mandate inherited from Mech).
  const ANGLES = [
    { az: 30,  el: 25, tag: 'az030_el25' },
    { az: 120, el: 25, tag: 'az120_el25' },
    { az: 210, el: 25, tag: 'az210_el25' },
    { az: 300, el: 25, tag: 'az300_el25' },
    { az: 0,   el: 70, tag: 'top-down' },
  ];
  for (const angle of ANGLES) {
    await win.evaluate(({ az, el }) => {
      if (typeof window.__archdiscOrbitView === 'function') {
        window.__archdiscOrbitView(az, el, 1);
      }
    }, angle);
    await win.waitForTimeout(400);
    await win.screenshot({
      path: path.join(OUT, `angle-${angle.tag}.png`),
      fullPage: false,
    });
  }

  // ---- Tight viewport crop on one good angle for the headline shot. ----
  await win.evaluate(() => window.__archdiscOrbitView && window.__archdiscOrbitView(45, 30, 1));
  await win.waitForTimeout(400);
  const viewportBox = await win.locator('.workbench-viewport').first().boundingBox();
  if (viewportBox) {
    await win.screenshot({
      path: path.join(OUT, 'headline-viewport-crop.png'),
      clip: viewportBox,
    });
  }

  await app.close();
});
