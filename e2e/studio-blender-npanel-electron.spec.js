import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

/*
 * Studio — Slice 187: BLENDER N-PANEL VIEWPORT SIDEBAR.
 *
 * Adds Blender's iconic N-key sidebar inside the 3D viewport: a 240-px
 * right-edge overlay with three tabs (Item / Tool / View) and a floating
 * "N" toggle on the viewport's right edge. The tabs mirror Blender:
 *   - Item: selected mesh name + location/rotation/scale
 *   - Tool: active tool, discipline, workspace
 *   - View: scene stats (primitive / light counts, vertex / face totals)
 *
 * Default state: open + Item tab active. Toggles closed/open via the N
 * button so the viewport reclaims the right 240 px.
 *
 * Headed Mac Electron run per the watchable-tests rule.
 */

const OUT = path.resolve(__dirname, 'screenshots', 'studio-blender-npanel');

test('Studio — Blender N-panel: tabs, transform readout, toggle (headed)', async () => {
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

  // N-panel mounted open, Item tab active by default.
  await expect(win.locator('[data-studio-npanel="open"]')).toBeVisible();
  await expect(win.locator('[data-studio-npanel="open"]'))
    .toHaveAttribute('data-studio-npanel-tab', 'Item');
  await expect(win.locator('[data-studio-npanel-tab-button="Item"]'))
    .toHaveAttribute('data-studio-npanel-tab-active', '1');
  await expect(win.locator('[data-studio-npanel-empty]')).toBeVisible(); // no selection yet
  await win.screenshot({ path: path.join(OUT, '00-default-item.png') });

  // Build a 2-body scene + select the cube so the Item tab populates.
  await win.waitForFunction(() => typeof window.__archieRun === 'function', null, { timeout: 30000 });
  await win.evaluate(() => {
    const r = {
      goal: 'npanel demo',
      scene: { discipline: 'modeling' },
      bodies: [
        { kind: 'cube',   pos: [-0.06, 0, 0], scale: [1, 1, 1], color: '#9ab' },
        { kind: 'sphere', pos: [ 0.06, 0, 0], scale: [1, 1, 1], color: '#c9a' },
      ],
      expect: { bodies: 2, kinds: ['cube', 'sphere'] },
    };
    window.__archieEngine.skillStore.save(r.goal, r, 1.0);
    return window.__archieRun({ goals: [r.goal], maxGoals: 1 });
  });
  await win.waitForTimeout(300);
  // Select the cube programmatically so the Item tab fills in.
  await win.evaluate(() => {
    const scene = window.__archdiscScene;
    let cube = null;
    scene.traverse((o) => {
      if (o.userData && o.userData.archdiscStudioPrimitive
          && o.userData.archdiscStudioPrimitiveKind === 'cube') cube = o;
    });
    if (cube && window.__studioSelectMesh) window.__studioSelectMesh(cube);
  });
  await win.waitForTimeout(200);

  // Item tab now shows the cube's transform.
  await expect(win.locator('[data-studio-npanel-selected-kind]')).toHaveText('cube');
  await expect(win.locator('[data-studio-npanel-section="transform"]')).toBeVisible();
  await expect(win.locator('[data-studio-npanel-loc-x]')).toBeVisible();
  await win.screenshot({ path: path.join(OUT, '01-item-cube-selected.png') });

  // Switch to Tool tab — shows active tool + discipline + workspace.
  await win.evaluate(() => document.querySelector('[data-studio-npanel-tab-button="Tool"]').click());
  await expect(win.locator('[data-studio-npanel="open"]'))
    .toHaveAttribute('data-studio-npanel-tab', 'Tool');
  await expect(win.locator('[data-studio-npanel-tool]')).toBeVisible();
  await expect(win.locator('[data-studio-npanel-discipline]')).toHaveText('modeling');
  await expect(win.locator('[data-studio-npanel-workspace]')).toHaveText('Layout');
  await win.screenshot({ path: path.join(OUT, '02-tool-tab.png') });

  // Switch to View tab — shows scene stats (primitives, vertices, etc.).
  await win.evaluate(() => document.querySelector('[data-studio-npanel-tab-button="View"]').click());
  await expect(win.locator('[data-studio-npanel="open"]'))
    .toHaveAttribute('data-studio-npanel-tab', 'View');
  await expect(win.locator('[data-studio-npanel-primitives]')).toHaveText('2');
  await expect(win.locator('[data-studio-npanel-verts]')).toBeVisible();
  await expect(win.locator('[data-studio-npanel-faces]')).toBeVisible();
  await win.screenshot({ path: path.join(OUT, '03-view-tab.png') });

  // Toggle N-panel closed via the floating N button; sidebar disappears.
  await win.evaluate(() => document.querySelector('[data-studio-npanel-toggle]').click());
  await expect(win.locator('[data-studio-npanel="open"]')).toHaveCount(0);
  await expect(win.locator('[data-studio-npanel-toggle]'))
    .toHaveAttribute('aria-pressed', 'false');
  await win.screenshot({ path: path.join(OUT, '04-collapsed.png') });

  // Toggle back open — defaults retained.
  await win.evaluate(() => document.querySelector('[data-studio-npanel-toggle]').click());
  await expect(win.locator('[data-studio-npanel="open"]')).toBeVisible();
  await expect(win.locator('[data-studio-npanel-toggle]'))
    .toHaveAttribute('aria-pressed', 'true');

  // eslint-disable-next-line no-console
  console.log('  slice 187: N-panel Item/Tool/View tabs + toggle working end-to-end');

  await app.close();
});
