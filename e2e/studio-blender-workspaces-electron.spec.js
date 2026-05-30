import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

/*
 * Studio — Slice 185: BLENDER WORKSPACES STRIP.
 *
 * Studio's UI/UX baseline is Blender (per the user's mandate). This slice
 * adds the canonical Blender workspaces tab strip at the top of the window
 * — Layout / Modeling / Sculpting / UV Editing / Texture Paint / Shading /
 * Animation / Rendering / Compositing / Geometry Nodes / Scripting — each
 * mapped to one of Studio's existing disciplines so the right ribbon panel
 * surfaces underneath when the workspace is activated. This is the
 * foundation for the Blender-shaped layout (Outliner, Properties editor,
 * N-panel, T-panel, quad-view) that subsequent slices build on.
 *
 * The spec walks the full 11-workspace strip with a watchable slowMo so
 * the user can see each workspace activate live (per the "headed tests
 * on Mac Electron" rule).
 */

const OUT = path.resolve(__dirname, 'screenshots', 'studio-blender-workspaces');

const WORKSPACES = [
  { id: 'Layout',         discipline: 'modeling' },
  { id: 'Modeling',       discipline: 'modeling' },
  { id: 'Sculpting',      discipline: 'sculpting' },
  { id: 'UV Editing',     discipline: 'uv-texture' },
  { id: 'Texture Paint',  discipline: 'uv-texture' },
  { id: 'Shading',        discipline: 'uv-texture' },
  { id: 'Animation',      discipline: 'animation' },
  { id: 'Rendering',      discipline: 'rendering' },
  { id: 'Compositing',    discipline: 'compositing' },
  { id: 'Geometry Nodes', discipline: 'modeling' },
  { id: 'Scripting',      discipline: 'modeling' },
];

test('Studio — Blender workspaces strip activates each discipline live', async () => {
  test.setTimeout(180000);
  fs.mkdirSync(OUT, { recursive: true });

  const app = await electron.launch({
    args: [path.join(__dirname, '..', 'electron', 'main.js')],
    slowMo: Number(process.env.STUDIO_SLOWMO) || 320,
  });
  const win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');
  await expect(win.locator('.workbench-current .workbench-name'))
    .toHaveText('ArchDisc Studio', { timeout: 30000 });
  await expect(win.locator('canvas').first()).toBeVisible({ timeout: 60000 });
  await win.waitForFunction(() => !!window.__archdiscViewport, null, { timeout: 30000 });
  await win.waitForTimeout(400);

  // Strip is mounted with all 11 workspaces.
  const strip = win.locator('[data-blender-workspaces-strip="studio"]');
  await expect(strip).toBeVisible();
  for (const ws of WORKSPACES) {
    await expect(win.locator(`[data-blender-workspace="${ws.id}"]`)).toBeVisible();
  }

  // Default workspace is Layout, mapped to the modeling discipline.
  await expect(win.locator('[data-blender-workspace="Layout"]'))
    .toHaveAttribute('data-blender-workspace-active', '1');
  await expect(win.locator('[data-studio-discipline="modeling"]').first())
    .toHaveAttribute('data-studio-active', '1');
  await win.screenshot({ path: path.join(OUT, '00-default-layout.png') });

  // Walk every workspace; assert the active flag flips and the mapped
  // discipline ribbon activates underneath.
  let i = 1;
  for (const ws of WORKSPACES) {
    await win.locator(`[data-blender-workspace="${ws.id}"]`).click();
    await expect(win.locator(`[data-blender-workspace="${ws.id}"]`))
      .toHaveAttribute('data-blender-workspace-active', '1');
    await expect(win.locator(`[data-studio-discipline="${ws.discipline}"]`).first())
      .toHaveAttribute('data-studio-active', '1');
    await win.waitForTimeout(180);
    const slug = ws.id.toLowerCase().replace(/\s+/g, '-');
    await win.screenshot({ path: path.join(OUT, `${String(i).padStart(2, '0')}-${slug}.png`) });
    i++;
  }

  // eslint-disable-next-line no-console
  console.log(`  slice 185: walked ${WORKSPACES.length} Blender workspaces, each activated its mapped discipline`);

  await app.close();
});
