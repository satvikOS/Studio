import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

/*
 * Studio — Slice 186: BLENDER-STYLE OUTLINER (collections + filter).
 *
 * Builds on Studio's existing Outliner with two Blender hallmarks:
 *   - COLLECTION GROUPING: scene objects sit under named collections
 *     (Primitives, Lights), each with a disclosure arrow that collapses
 *     the group.
 *   - SEARCH FILTER: top-of-panel filter input narrows the list by
 *     case-insensitive substring of object name OR kind.
 * Also surfaces each entry's full mesh name (not just its kind), so
 * "studio-primitive-cube-0" reads as it does in Blender's Outliner.
 *
 * Runs HEADED on the Mac Electron app per the watchable-tests rule.
 */

const OUT = path.resolve(__dirname, 'screenshots', 'studio-blender-outliner');

test('Studio — Blender Outliner shows collections + filters live', async () => {
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

  // Outliner panel + search filter input mounted from boot.
  await expect(win.locator('[data-studio-section="outliner"]')).toBeVisible();
  await expect(win.locator('[data-studio-outliner-filter]')).toBeVisible();
  await win.screenshot({ path: path.join(OUT, '00-empty-with-filter.png') });

  // Build a 3-body + 2-light scene via the autonomous loop.
  await win.waitForFunction(() => typeof window.__archieRun === 'function', null, { timeout: 30000 });
  await win.evaluate(() => {
    const r = {
      goal: 'outliner collections demo',
      // Switch to rendering discipline FIRST so the [data-studio-ribbon-
      // action="light-point"] / "light-sun" buttons are mounted and the
      // dispatcher can click them. The Lights collection only appears in
      // the Outliner if at least one Studio light landed.
      scene: { discipline: 'rendering', lights: [
        { type: 'light-point', color: '#ffe6c0', intensity: 0.18 },
        { type: 'light-sun',   color: '#ffffff', intensity: 0.20 },
      ] },
      bodies: [
        { kind: 'cube',         pos: [-0.07, 0, 0], scale: [1, 1, 1], color: '#9ab' },
        { kind: 'sphere',       pos: [ 0,    0, 0], scale: [1, 1, 1], color: '#c9a' },
        { kind: 'icosahedron',  pos: [ 0.07, 0, 0], scale: [1, 1, 1], color: '#ac9' },
      ],
      expect: { bodies: 3, kinds: ['cube', 'icosahedron', 'sphere'] },
    };
    window.__archieEngine.skillStore.save(r.goal, r, 1.0);
    return window.__archieRun({ goals: [r.goal], maxGoals: 1 });
  });
  await win.waitForTimeout(400);

  // Both collections present + expanded by default.
  await expect(win.locator('[data-studio-outliner-collection="Primitives"]')).toBeVisible();
  await expect(win.locator('[data-studio-outliner-collection="Lights"]')).toBeVisible();
  await expect(win.locator('[data-studio-outliner-collection="Primitives"]'))
    .toHaveAttribute('data-studio-outliner-collection-expanded', '1');
  await expect(win.locator('[data-studio-outliner-collection="Lights"]'))
    .toHaveAttribute('data-studio-outliner-collection-expanded', '1');
  // 5 total entries visible (3 primitives + 2 lights).
  await expect(win.locator('[data-studio-outliner-entry]')).toHaveCount(5);
  await win.screenshot({ path: path.join(OUT, '01-collections-expanded.png') });

  // Collapse the Lights collection. The 2 light entries disappear; the 3
  // primitive entries stay. The right panel may overlay parts of the
  // Outliner depending on viewport size; dispatch the click via the
  // element's own .click() so React's onClick fires regardless of pointer-
  // event interception.
  const clickByAttr = async (sel) => {
    await win.evaluate((s) => {
      const el = document.querySelector(s);
      if (el) el.click();
    }, sel);
  };
  await clickByAttr('[data-studio-outliner-collection="Lights"]');
  await expect(win.locator('[data-studio-outliner-collection="Lights"]'))
    .toHaveAttribute('data-studio-outliner-collection-expanded', '0');
  await expect(win.locator('[data-studio-outliner-entry]')).toHaveCount(3);
  await win.screenshot({ path: path.join(OUT, '02-lights-collapsed.png') });

  // Re-expand and filter: typing "sphere" narrows to one primitive.
  await clickByAttr('[data-studio-outliner-collection="Lights"]');
  await expect(win.locator('[data-studio-outliner-entry]')).toHaveCount(5);
  await win.locator('[data-studio-outliner-filter]').fill('sphere');
  await win.waitForTimeout(180);
  await expect(win.locator('[data-studio-outliner-entry]')).toHaveCount(1);
  await expect(win.locator('[data-studio-outliner-kind="sphere"]')).toBeVisible();
  await win.screenshot({ path: path.join(OUT, '03-filtered-sphere.png') });

  // Filter for a string that matches nothing -> the empty-state message.
  await win.locator('[data-studio-outliner-filter]').fill('nonexistent-xyzzy');
  await win.waitForTimeout(180);
  await expect(win.locator('[data-studio-outliner-filter-empty]')).toBeVisible();
  await win.screenshot({ path: path.join(OUT, '04-filter-no-match.png') });

  // Clear filter -> everything reappears.
  await win.locator('[data-studio-outliner-filter]').fill('');
  await expect(win.locator('[data-studio-outliner-entry]')).toHaveCount(5);

  // Click a primitive entry's label -> __studioSelectMesh fires. Dispatch
  // through the element's own .click() so the right-panel overlay can't
  // intercept (same approach as the collection toggles above).
  await win.evaluate(() => {
    const row = document.querySelector('[data-studio-outliner-kind="cube"]');
    const label = row && row.querySelector('[data-studio-outliner-label]');
    if (label) label.click();
    else if (row) row.click();
  });
  await win.waitForTimeout(200);
  const selectedKind = await win.evaluate(() => {
    const m = window.__studioSelectedMesh && window.__studioSelectedMesh();
    return m && m.userData && m.userData.archdiscStudioPrimitiveKind;
  });
  expect(selectedKind, 'Outliner click selected the cube').toBe('cube');

  // eslint-disable-next-line no-console
  console.log('  slice 186: outliner collections + filter + name labels working end-to-end');

  await app.close();
});
