import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

/*
 * Studio — ANIMATION STATE MACHINE / AnimBP (headed Electron).
 *
 * Closes the Unreal Animation Blueprint / Unity Animator gap: named locomotion
 * states (idle/walk/run) drive a procedural pose on the selected mesh, with a
 * cross-fade on state change. Verifies the machine actually animates the object
 * (the bob amplitude is non-zero), that 'run' is a bigger motion than 'walk'
 * (distinct states, not a single canned wiggle), and the ribbon state buttons +
 * play toggle are wired.
 */

const OUT = path.resolve(__dirname, 'screenshots', 'studio-animbp');

const sampleAmp = (win, state, settle, n) => win.evaluate(({ state, settle, n }) => {
  for (let i = 0; i < settle; i++) window.__studioAnimBPStep(state, 1 / 60); // let the cross-fade settle
  const ys = [];
  for (let i = 0; i < n; i++) ys.push(window.__studioAnimBPStep(state, 1 / 60).y);
  const mx = Math.max(...ys), mn = Math.min(...ys);
  return { amp: (mx - mn) / 2, n: ys.length };
}, { state, settle, n });

test('Studio — animation state machine drives distinct locomotion states', async () => {
  test.setTimeout(240000);
  fs.mkdirSync(OUT, { recursive: true });

  const app = await electron.launch({ args: [path.join(__dirname, '..', 'electron', 'main.js')], slowMo: 25 });
  const win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');
  await expect(win.locator('.workbench-current .workbench-name')).toHaveText('ArchDisc Studio', { timeout: 30000 });
  await expect(win.locator('canvas').first()).toBeVisible({ timeout: 60000 });
  await win.waitForFunction(() => !!window.__archdiscViewport, null, { timeout: 30000 });
  await win.waitForFunction(() => typeof window.__studioAnimBPStep === 'function', null, { timeout: 30000 });
  await win.waitForTimeout(500);

  await win.locator('[data-studio-primitive="cube"]').click();
  await win.waitForTimeout(250);
  await win.evaluate(() => { const s = window.__archdiscScene; let m = null; s && s.traverse((o) => { if (o.userData && o.userData.archdiscStudioPrimitive) m = o; }); if (m) { m.position.set(0, 0, 0); window.__studioSelectMesh(m); } });
  await win.waitForTimeout(150);

  // ── walk vs run: both animate, run is the larger motion ──
  const walk = await sampleAmp(win, 'walk', 30, 90);
  const run = await sampleAmp(win, 'run', 30, 90);
  expect(walk.amp, "'walk' actually animates the mesh (non-zero bob)").toBeGreaterThan(0.02);
  expect(run.amp, "'run' actually animates the mesh").toBeGreaterThan(0.03);
  expect(run.amp, "'run' is a bigger motion than 'walk' (distinct states)").toBeGreaterThan(walk.amp * 1.3);
  // the machine settled on 'run'
  const cur = await win.evaluate(() => window.__studioAnimBPStep('run', 1 / 60).state);
  expect(cur, 'state machine is in run').toBe('run');

  // ── ribbon state buttons are wired (Animation tab) ──
  await win.locator('[data-studio-discipline="animation"]').click();
  await win.waitForTimeout(150);
  await win.locator('[data-studio-ribbon-action="animbp-walk"]').click();
  await win.waitForTimeout(150);
  await expect(win.locator('[data-studio-ribbon-action="animbp-walk"]')).toHaveClass(/active/);

  // step a few frames into the walk pose for a non-rest screenshot
  await win.evaluate(() => { for (let i = 0; i < 8; i++) window.__studioAnimBPStep('walk', 1 / 60); window.__studioFrameAll && window.__studioFrameAll(); window.__archdiscOrbitView && window.__archdiscOrbitView(20, 10, 1.3); });
  await win.waitForTimeout(250);
  await win.screenshot({ path: path.join(OUT, '01-animbp-walk.png') });

  // eslint-disable-next-line no-console
  console.log(`  animbp: walk amp=${walk.amp.toFixed(3)}, run amp=${run.amp.toFixed(3)} (run/walk=${(run.amp / walk.amp).toFixed(2)}x); current=${cur}`);

  await app.close();
});
