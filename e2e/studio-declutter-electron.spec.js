import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

/*
 * Studio — Slice 196: DECLUTTER PASS.
 *
 * Hides the redundant discipline-tab strip (the Blender workspaces strip
 * drives discipline switching now), hides the legacy left workbench-tools
 * (viewport header + Mode dropdown + workspaces strip cover all those
 * entries), removes EquationManager + CutListPanel Mech modals from the
 * always-on overlay set. Lets the viewport canvas extend to the window
 * left edge.
 *
 * Headed Mac Electron + visible-state assertions.
 */

const OUT = path.resolve(__dirname, 'screenshots', 'studio-declutter');

test('Studio — declutter: discipline tabs + left toolbar hidden, viewport extends to edge', async () => {
  test.setTimeout(180000);
  fs.mkdirSync(OUT, { recursive: true });

  const app = await electron.launch({
    args: [path.join(__dirname, '..', 'electron', 'main.js')],
    slowMo: Number(process.env.STUDIO_SLOWMO) || 600,
  });
  const win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');
  await expect(win.locator('.workbench-current .workbench-name'))
    .toHaveText('ArchDisc Studio', { timeout: 30000 });
  await expect(win.locator('canvas').first()).toBeVisible({ timeout: 60000 });
  await win.waitForFunction(() => !!window.__archdiscViewport, null, { timeout: 30000 });
  await win.waitForTimeout(1500);

  const layout = await win.evaluate(() => {
    const get = (sel) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const cs = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      return { display: cs.display, visibility: cs.visibility, w: r.width, h: r.height, left: r.left };
    };
    return {
      ribbonTabs: get('.ribbon-tabs'),
      tools:      get('.workbench-tools'),
      viewport:   get('.workbench-viewport'),
      strip:      get('[data-blender-workspaces-strip="studio"]'),
      canvas:     get('canvas'),
      equationDialog: !!document.querySelector('[data-archdisc-equation-manager]'),
      cutListDialog:  !!document.querySelector('[data-archdisc-cut-list]'),
    };
  });
  // eslint-disable-next-line no-console
  console.log('  declutter layout:', JSON.stringify(layout));

  // Discipline-tab strip is hidden.
  expect(layout.ribbonTabs && layout.ribbonTabs.display, 'discipline tabs hidden').toBe('none');
  // Left toolbar is hidden.
  expect(layout.tools && layout.tools.display, 'left toolbar hidden').toBe('none');
  // Viewport reaches the left edge (left=0).
  expect(layout.viewport && layout.viewport.left, 'viewport flush left').toBeLessThanOrEqual(1);
  // Workspaces strip is still on top.
  expect(layout.strip, 'workspaces strip present').not.toBeNull();
  // Canvas is rendering with positive size.
  expect(layout.canvas && layout.canvas.w, 'canvas wider').toBeGreaterThan(800);

  await win.screenshot({ path: path.join(OUT, '00-declutter.png') });

  // Build a teapot so we can see the cleaner viewport.
  await win.waitForFunction(() => typeof window.__archieRun === 'function', null, { timeout: 30000 });
  await win.evaluate(() => {
    const r = {
      goal: 'declutter demo',
      scene: { discipline: 'modeling' },
      bodies: [
        { kind: 'teapot', pos: [0, 0, 0], scale: [1, 1, 1], color: '#bfa14a' },
      ],
      expect: { bodies: 1, kinds: ['teapot'] },
    };
    window.__archieEngine.skillStore.save(r.goal, r, 1.0);
    return window.__archieRun({ goals: [r.goal], maxGoals: 1 });
  });
  await win.waitForTimeout(700);
  await win.screenshot({ path: path.join(OUT, '01-teapot-clean.png') });
  await win.waitForTimeout(2500);

  // eslint-disable-next-line no-console
  console.log('  slice 196: declutter — discipline tabs + left toolbar hidden, viewport flush left');

  await app.close();
});
