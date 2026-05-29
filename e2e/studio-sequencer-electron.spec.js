import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

/*
 * Studio — SEQUENCER / TIMELINE TRACK EDITOR (headed Electron).
 *
 * Closes the named gap (the inherited blue, display-only TimelineEditor): a
 * native monotone Sequencer (Unreal Sequencer / Unity Timeline / Blender Dope
 * Sheet) wired to the real keyframe engine. Verifies a real animation: key a
 * cube's transform at frame 0 and frame 60, and scrubbing to frame 30
 * INTERPOLATES position AND scale to the halfway pose; the track view shows the
 * object's track with its two keyframe diamonds; transport + playhead work.
 */

const OUT = path.resolve(__dirname, 'screenshots', 'studio-sequencer');

test('Studio — sequencer keys a transform and scrubbing interpolates the pose', async () => {
  test.setTimeout(240000);
  fs.mkdirSync(OUT, { recursive: true });

  const app = await electron.launch({ args: [path.join(__dirname, '..', 'electron', 'main.js')], slowMo: 25 });
  const win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');
  await expect(win.locator('.workbench-current .workbench-name')).toHaveText('ArchDisc Studio', { timeout: 30000 });
  await expect(win.locator('canvas').first()).toBeVisible({ timeout: 60000 });
  await win.waitForFunction(() => !!window.__archdiscViewport, null, { timeout: 30000 });
  await win.waitForFunction(() => typeof window.__studioInsertKeyframeAt === 'function', null, { timeout: 30000 });
  await win.waitForTimeout(500);

  // ── add a cube (modeling tab) + select it ──
  await win.locator('[data-studio-primitive="cube"]').click();
  await win.waitForTimeout(250);
  await win.evaluate(() => { const s = window.__archdiscScene; let m = null; s && s.traverse((o) => { if (o.userData && o.userData.archdiscStudioPrimitive) m = o; }); if (m) window.__studioSelectMesh(m); });
  await win.waitForTimeout(150);

  // ── open the Sequencer from the Animation ribbon ──
  await win.locator('[data-studio-discipline="animation"]').click();
  await win.waitForTimeout(150);
  await win.locator('[data-studio-ribbon-action="sequencer"]').click();
  await expect(win.locator('[data-studio-sequencer="editor"]')).toBeVisible({ timeout: 8000 });

  const readSel = () => win.evaluate(() => { const m = window.__studioSelectedMesh(); return m ? { x: m.position.x, sx: m.scale.x } : null; });

  // ── key the cube at frame 0 (pose A) ──
  await win.evaluate(() => window.__studioSetFrame(0)); await win.waitForTimeout(150);
  await win.evaluate(() => { const m = window.__studioSelectedMesh(); m.position.set(0, 0, 0); m.scale.set(1, 1, 1); });
  await win.evaluate(() => window.__studioInsertKeyframeAt(0)); await win.waitForTimeout(200);

  // ── move to frame 60, set a different pose B, key it ──
  await win.evaluate(() => window.__studioSetFrame(60)); await win.waitForTimeout(150);
  await win.evaluate(() => { const m = window.__studioSelectedMesh(); m.position.set(0.4, 0, 0); m.scale.set(2, 2, 2); });
  await win.evaluate(() => window.__studioInsertKeyframeAt(60)); await win.waitForTimeout(200);

  // keyframe model: 2 keys for this mesh at 0 and 60, scale captured
  const keys = await win.evaluate(() => window.__studioGetKeyframes());
  expect(keys.length, 'two keyframes recorded').toBe(2);
  expect(keys.map((k) => k.frame).sort((a, b) => a - b), 'keys at frame 0 and 60').toEqual([0, 60]);
  const k60 = keys.find((k) => k.frame === 60);
  expect(Math.abs(k60.sx - 2), 'scale captured in the keyframe (sx=2 @60)').toBeLessThan(1e-6);

  // ── the track view shows the object's track + its two keyframe diamonds ──
  expect(await win.locator('[data-studio-seq-track]').count(), 'one animated track').toBeGreaterThanOrEqual(1);
  expect(await win.locator('[data-studio-seq-key]').count(), 'two keyframe diamonds on the track').toBe(2);

  // ── scrub: endpoints + midpoint interpolation (linear) of pos AND scale ──
  await win.evaluate(() => window.__studioSetFrame(0)); await win.waitForTimeout(200);
  const at0 = await readSel();
  await win.evaluate(() => window.__studioSetFrame(60)); await win.waitForTimeout(200);
  const at60 = await readSel();
  await win.evaluate(() => window.__studioSetFrame(30)); await win.waitForTimeout(250);
  const at30 = await readSel();

  expect(Math.abs(at0.x - 0), 'frame 0 -> pose A position').toBeLessThan(0.02);
  expect(Math.abs(at0.sx - 1), 'frame 0 -> pose A scale').toBeLessThan(0.02);
  expect(Math.abs(at60.x - 0.4), 'frame 60 -> pose B position').toBeLessThan(0.02);
  expect(Math.abs(at60.sx - 2), 'frame 60 -> pose B scale').toBeLessThan(0.02);
  expect(Math.abs(at30.x - 0.2), 'frame 30 -> halfway position (linear interp)').toBeLessThan(0.03);
  expect(Math.abs(at30.sx - 1.5), 'frame 30 -> halfway scale (linear interp)').toBeLessThan(0.05);

  // playhead reads frame 30
  await expect(win.locator('[data-studio-seq-frame]')).toHaveText('30 / 240');

  await win.evaluate(() => { window.__studioFrameAll && window.__studioFrameAll(); window.__archdiscOrbitView && window.__archdiscOrbitView(22, 12, 1.2); });
  await win.waitForTimeout(250);
  await win.screenshot({ path: path.join(OUT, '01-sequencer-frame30.png') });

  // eslint-disable-next-line no-console
  console.log(`  sequencer: keys=${keys.length} @[0,60]; pose x ${at0.x.toFixed(3)}->${at60.x.toFixed(3)}, mid@30 ${at30.x.toFixed(3)}; scale ${at0.sx.toFixed(2)}->${at60.sx.toFixed(2)}, mid ${at30.sx.toFixed(2)}`);

  await app.close();
});
