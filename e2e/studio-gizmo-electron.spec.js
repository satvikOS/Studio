import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

/*
 * Studio — Slice 201: TRANSFORM GIZMO (move/rotate/scale handles).
 *
 * Three.js TransformControls attached to the selected mesh. Mode
 * follows the existing gizmoMode state (translate / rotate / scale).
 * Detaches on deselect. Exposed as window.__studioGizmo so e2e + AI
 * can set mode programmatically.
 *
 * Headed Mac Electron run.
 */

const OUT = path.resolve(__dirname, 'screenshots', 'studio-gizmo');

test('Studio — TransformControls gizmo attaches on selection + flips mode', async () => {
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
  await win.waitForFunction(() => !!window.__studioGizmo, null, { timeout: 30000 });
  await win.waitForTimeout(1500);

  // Build + select a cube.
  await win.waitForFunction(() => typeof window.__archieRun === 'function', null, { timeout: 30000 });
  await win.evaluate(() => {
    const r = {
      goal: 'gizmo demo',
      scene: { discipline: 'modeling' },
      bodies: [
        { kind: 'cube', pos: [0, 0, 0], scale: [1, 1, 1], color: '#9ab' },
      ],
      expect: { bodies: 1, kinds: ['cube'] },
    };
    window.__archieEngine.skillStore.save(r.goal, r, 1.0);
    return window.__archieRun({ goals: [r.goal], maxGoals: 1 });
  });
  await win.waitForTimeout(700);
  await win.evaluate(() => {
    const s = window.__archdiscScene;
    let m = null;
    s.traverse((o) => { if (o.userData && o.userData.archdiscStudioPrimitiveKind === 'cube') m = o; });
    if (m && window.__studioSelectMesh) window.__studioSelectMesh(m);
  });
  await win.waitForTimeout(500);

  // Gizmo is attached to the cube + in 'translate' mode by default.
  const attached1 = await win.evaluate(() => {
    const g = window.__studioGizmo;
    return { mode: g.mode, attachedKind: g.object && g.object.userData
      && g.object.userData.archdiscStudioPrimitiveKind };
  });
  expect(attached1.attachedKind, 'gizmo attached to cube').toBe('cube');
  expect(attached1.mode, 'default translate mode').toBe('translate');
  await win.screenshot({ path: path.join(OUT, '00-translate.png') });
  await win.waitForTimeout(500);

  // Flip mode to rotate via the API.
  await win.evaluate(() => window.__studioGizmo.setMode('rotate'));
  await win.waitForTimeout(300);
  const rotateMode = await win.evaluate(() => window.__studioGizmo.mode);
  expect(rotateMode, 'rotate mode after setMode').toBe('rotate');
  await win.screenshot({ path: path.join(OUT, '01-rotate.png') });
  await win.waitForTimeout(500);

  // Flip to scale.
  await win.evaluate(() => window.__studioGizmo.setMode('scale'));
  await win.waitForTimeout(300);
  const scaleMode = await win.evaluate(() => window.__studioGizmo.mode);
  expect(scaleMode, 'scale mode after setMode').toBe('scale');
  await win.screenshot({ path: path.join(OUT, '02-scale.png') });
  await win.waitForTimeout(500);

  // Deselect (Alt+A) detaches the gizmo.
  await win.evaluate(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', altKey: true, bubbles: true })));
  await win.waitForTimeout(400);
  const afterDeselect = await win.evaluate(() => {
    const g = window.__studioGizmo;
    return g.object ? 'attached' : 'detached';
  });
  expect(afterDeselect, 'gizmo detached after Alt+A').toBe('detached');
  await win.screenshot({ path: path.join(OUT, '03-detached.png') });
  await win.waitForTimeout(2500);

  // eslint-disable-next-line no-console
  console.log('  slice 201: gizmo attach + mode flip + detach working end-to-end');

  await app.close();
});
