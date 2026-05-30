import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

/*
 * Studio — Slice 198: SPAWN AT 3D CURSOR (Blender default).
 *
 * When the 3D Cursor (slice 197) is at world origin, new primitives
 * fall onto the existing 4-column auto-grid. When the user places the
 * cursor somewhere else, new primitives spawn at the cursor position.
 * Matches Blender's "Cursor location is the spawn point" behaviour.
 *
 * Headed Mac Electron run.
 */

const OUT = path.resolve(__dirname, 'screenshots', 'studio-spawn-at-cursor');

test('Studio — primitive spawn lands at 3D cursor when off-origin', async () => {
  test.setTimeout(180000);
  fs.mkdirSync(OUT, { recursive: true });

  const app = await electron.launch({
    args: [path.join(__dirname, '..', 'electron', 'main.js')],
    slowMo: Number(process.env.STUDIO_SLOWMO) || 700,
  });
  const win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');
  await expect(win.locator('.workbench-current .workbench-name'))
    .toHaveText('ArchDisc Studio', { timeout: 30000 });
  await expect(win.locator('canvas').first()).toBeVisible({ timeout: 60000 });
  await win.waitForFunction(() => !!window.__archdiscViewport, null, { timeout: 30000 });
  await win.waitForFunction(() => typeof window.__studioSetCursor === 'function', null, { timeout: 30000 });
  await win.waitForTimeout(1500);

  // With cursor at origin, primitives go onto the grid (first slot is x=-0.045-ish).
  await win.locator('[data-studio-primitive="cube"]').click();
  await win.waitForTimeout(500);
  const gridSpawn = await win.evaluate(() => {
    const scene = window.__archdiscScene;
    let m = null;
    scene.traverse((o) => {
      if (o.userData && o.userData.archdiscStudioPrimitive && o.userData.archdiscStudioPrimitiveKind === 'cube') m = o;
    });
    return m ? [m.position.x, m.position.y, m.position.z] : null;
  });
  expect(gridSpawn, 'cube landed somewhere').not.toBeNull();
  // The grid spawn is NOT at the origin (it's offset) — that's expected.
  await win.screenshot({ path: path.join(OUT, '00-grid-spawn.png') });

  // Move cursor to [0.18, 0.04, -0.08], then spawn a sphere; it should
  // land AT the cursor, not on the auto-grid.
  await win.evaluate(() => window.__studioSetCursor([0.18, 0.04, -0.08]));
  await win.waitForTimeout(300);
  await win.locator('[data-studio-primitive="sphere"]').click();
  await win.waitForTimeout(500);
  const cursorSpawn = await win.evaluate(() => {
    const scene = window.__archdiscScene;
    let m = null;
    scene.traverse((o) => {
      if (o.userData && o.userData.archdiscStudioPrimitive && o.userData.archdiscStudioPrimitiveKind === 'sphere') m = o;
    });
    return m ? [m.position.x, m.position.y, m.position.z] : null;
  });
  expect(cursorSpawn, 'sphere spawned').not.toBeNull();
  expect(cursorSpawn[0]).toBeCloseTo(0.18, 3);
  expect(cursorSpawn[1]).toBeCloseTo(0.04, 3);
  expect(cursorSpawn[2]).toBeCloseTo(-0.08, 3);
  await win.screenshot({ path: path.join(OUT, '01-cursor-spawn.png') });

  // Snap cursor back to origin -> next spawn returns to auto-grid.
  await win.evaluate(() => window.__studioSnapCursorOrigin());
  await win.waitForTimeout(300);
  await win.locator('[data-studio-primitive="icosahedron"]').click();
  await win.waitForTimeout(500);
  const reGridSpawn = await win.evaluate(() => {
    const scene = window.__archdiscScene;
    let m = null;
    scene.traverse((o) => {
      if (o.userData && o.userData.archdiscStudioPrimitive && o.userData.archdiscStudioPrimitiveKind === 'icosahedron') m = o;
    });
    return m ? [m.position.x, m.position.y, m.position.z] : null;
  });
  // With cursor at origin, the icosa is on the grid (NOT at 0.18 etc.).
  expect(reGridSpawn).not.toBeNull();
  expect(Math.abs(reGridSpawn[0] - 0.18) > 0.05
      || Math.abs(reGridSpawn[2] + 0.08) > 0.05, 'icosa not at old cursor pos').toBe(true);
  await win.screenshot({ path: path.join(OUT, '02-back-to-grid.png') });
  await win.waitForTimeout(2500);

  // eslint-disable-next-line no-console
  console.log('  slice 198: spawn-at-cursor working — cube on grid, sphere at cursor, icosa back on grid');

  await app.close();
});
