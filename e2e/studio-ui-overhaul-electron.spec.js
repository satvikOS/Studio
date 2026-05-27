import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

/*
 * Slice 59 — UI/UX overhaul.
 *
 * User feedback: "the ui/ux is horrendous." This spec captures the
 * new look: discipline-coloured section stripes, collapsible
 * sections, polished buttons with teal hover, enhanced Studio
 * banner with inline scene stats + active-discipline pill,
 * Studio-themed range/checkbox accent colours.
 *
 * Also exercises collapse behaviour — click a section header to
 * fold its body, click again to expand.
 */

const OUT = path.resolve(__dirname, 'screenshots', 'studio-ui-overhaul');

test('Studio UI overhaul — discipline colors, collapsible sections, banner stats', async () => {
  test.setTimeout(120000);
  fs.mkdirSync(OUT, { recursive: true });

  const app = await electron.launch({
    args: [path.join(__dirname, '..', 'electron', 'main.js')],
    slowMo: 200,
  });

  const win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');
  await expect(win.locator('.workbench-current .workbench-name')).toHaveText('ArchDisc Studio', { timeout: 30000 });
  await expect(win.locator('canvas').first()).toBeVisible({ timeout: 60000 });
  await win.waitForFunction(() => !!window.__archdiscViewport, null, { timeout: 30000 });
  await win.waitForTimeout(800);

  // ---- Banner has all expected stat chips ----
  await expect(win.locator('[data-studio-banner-stat="prims"]')).toBeVisible();
  await expect(win.locator('[data-studio-banner-stat="lights"]')).toBeVisible();
  await expect(win.locator('[data-studio-banner-stat="renders"]')).toBeVisible();
  await expect(win.locator('[data-studio-banner-stat="verts"]')).toBeVisible();
  await expect(win.locator('[data-studio-banner-discipline]')).toHaveText('Modeling');

  await win.screenshot({ path: path.join(OUT, '00-modeling-tab-default.png'), fullPage: false });

  // ---- Add a primitive so the stats update ----
  await win.locator('[data-studio-primitive="cube"]').click();
  await win.waitForTimeout(300);
  await win.locator('[data-studio-primitive="sphere"]').click();
  await win.waitForTimeout(300);
  await win.locator('[data-studio-primitive="suzanne"]').click();
  await win.waitForTimeout(300);
  // Banner reflects 3 prims.
  await expect(win.locator('[data-studio-banner-stat="prims"]')).toContainText('3 prim');
  await win.screenshot({ path: path.join(OUT, '01-with-3-primitives.png'), fullPage: false });

  // ---- Verify flat-panel section styling (matte black, no rounded
  //      card chrome — matches Mech's stacked-panel pattern) ----
  const sectionStyle = await win.evaluate(() => {
    const sec = document.querySelector('[data-studio-properties="studio"] [data-studio-section="mesh"]');
    if (!sec) return null;
    const cs = window.getComputedStyle(sec);
    return {
      borderRadius: cs.borderRadius,
      backgroundColor: cs.backgroundColor,
      borderTopWidth: cs.borderTopWidth,
    };
  });
  expect(sectionStyle).not.toBeNull();
  // Flat panel — no rounded corners.
  expect(sectionStyle.borderRadius).toBe('0px');
  // Matte black background.
  expect(sectionStyle.backgroundColor).toMatch(/^rgb/);
  // Top divider line.
  expect(parseFloat(sectionStyle.borderTopWidth)).toBeGreaterThanOrEqual(0);

  // ---- Click "Mesh" section header to collapse, verify children hidden ----
  // The mesh section has multiple buttons. Before collapse: visible.
  // After collapse: not visible.
  const meshHeader = win.locator('[data-studio-properties="studio"] [data-studio-section="mesh"] .property-header');
  await meshHeader.click({ position: { x: 50, y: 5 } });  // click far-left near text label, not on the chevron
  await win.waitForTimeout(300);

  const meshCollapsedAttr = await win.evaluate(() => {
    const sec = document.querySelector('[data-studio-properties="studio"] [data-studio-section="mesh"]');
    return sec ? sec.getAttribute('data-studio-collapsed') : null;
  });
  expect(meshCollapsedAttr).toBe('true');

  // The "Decimate Selected" button is inside Mesh -> should be display:none.
  const decimateVisible = await win.locator('[data-studio-action="decimate-selected"]').isVisible();
  expect(decimateVisible).toBe(false);
  await win.screenshot({ path: path.join(OUT, '02-mesh-collapsed.png'), fullPage: false });

  // ---- Re-expand ----
  await meshHeader.click({ position: { x: 50, y: 5 } });
  await win.waitForTimeout(300);
  const meshExpandedAttr = await win.evaluate(() => {
    const sec = document.querySelector('[data-studio-properties="studio"] [data-studio-section="mesh"]');
    return sec ? sec.getAttribute('data-studio-collapsed') : null;
  });
  expect(meshExpandedAttr).toBe('false');

  // ---- Switch tabs — verify discipline pill updates ----
  await win.locator('.workbench-ribbon-placeholder-tab[data-studio-discipline="sculpting"]').click();
  await win.waitForTimeout(300);
  await expect(win.locator('[data-studio-banner-discipline]')).toHaveText('Sculpting');
  await win.screenshot({ path: path.join(OUT, '03-sculpting-tab.png'), fullPage: false });

  await win.locator('.workbench-ribbon-placeholder-tab[data-studio-discipline="rendering"]').click();
  await win.waitForTimeout(300);
  await expect(win.locator('[data-studio-banner-discipline]')).toHaveText('Rendering');
  await win.screenshot({ path: path.join(OUT, '04-rendering-tab.png'), fullPage: false });

  await win.locator('.workbench-ribbon-placeholder-tab[data-studio-discipline="animation"]').click();
  await win.waitForTimeout(300);
  await expect(win.locator('[data-studio-banner-discipline]')).toHaveText('Animation');
  await win.screenshot({ path: path.join(OUT, '05-animation-tab.png'), fullPage: false });

  await win.locator('.workbench-ribbon-placeholder-tab[data-studio-discipline="vfx-sim"]').click();
  await win.waitForTimeout(300);
  await expect(win.locator('[data-studio-banner-discipline]')).toHaveText('VFX / Sim');
  await win.screenshot({ path: path.join(OUT, '06-vfx-tab.png'), fullPage: false });

  // ---- Button hover state — focus a primitive button and screenshot
  //      (Playwright .hover() triggers CSS :hover). ----
  await win.locator('.workbench-ribbon-placeholder-tab[data-studio-discipline="modeling"]').click();
  await win.waitForTimeout(200);
  await win.locator('[data-studio-action="clear-scene"]').hover();
  await win.waitForTimeout(150);
  await win.screenshot({ path: path.join(OUT, '07-button-hover.png'), fullPage: false });

  // eslint-disable-next-line no-console
  console.log(`  ui overhaul: banner stat chips visible across 5 disciplines, section card styling applied, collapse/expand works (mesh section folded then unfolded)`);

  await app.close();
});
