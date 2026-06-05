// Studio V3 — VSE (Video Sequence Editor) Blender-VSE parity.
//
// Exercises the multi-channel horizontal timeline:
//   • side-effect-import the autoload module via the Vite dev server
//     (api.js isn't touched by this slice, so we install ourselves the
//     same way the anim + compositor e2e specs do).
//   • spawn a primitive so the viewport has something live to capture.
//   • add image / viewport / colorcorrect strips with the headless ops,
//     assert listing + state.
//   • scrub: assert dataUrl comes back and looks like a PNG, assert
//     activeCount jumps when the playhead is inside a strip.
//   • drive the playhead drag in the React editor and re-evaluate.
//   • export a sequence at 12 fps × 2 s and assert frame count.
//   • cover serialize / deserialize round-trip.
//   • multi-camera screenshots (front / top / right / iso / close).

import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-v3-vse');

// A tiny 2×2 red PNG, used as the "image strip" source.
const RED_2x2 =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAGUlEQVR42mP8/5+hngEJMDExMjAwMDD8BwAvBgL+P5W8aQAAAABJRU5ErkJggg==';

test('Studio V3 — VSE multi-channel timeline (image + viewport + colorcorrect)', async () => {
  test.setTimeout(180000);
  fs.mkdirSync(OUT, { recursive: true });

  const app = await electron.launch({
    args: [path.join(__dirname, '..', 'electron', 'main.js'), '--dev'],
    slowMo: Number(process.env.STUDIO_SLOWMO) || 250,
  });
  const win = await app.firstWindow();
  win.on('dialog', (d) => { d.dismiss().catch(() => {}); });
  await win.waitForLoadState('domcontentloaded');

  await win.evaluate(() => {
    window.localStorage.setItem('studioV3', '1');
    window.localStorage.setItem('studio.v3.tour-seen', '1');
    window.localStorage.removeItem('studio.v3.theme');
    window.localStorage.removeItem('studio.v3.wb');
    try { window.sessionStorage.setItem('studio.v3.splash-shown', '1'); } catch (_) {}
  });
  await win.reload();
  await win.waitForLoadState('domcontentloaded');
  await expect(win.locator('[data-studio-v3-shell]')).toBeVisible({ timeout: 15000 });
  await win.waitForFunction(() => typeof window.__studioSelectedMesh === 'function', null, { timeout: 15000 });

  // ─── Install the VSE (api.js isn't wired by this slice). ────────────
  await win.evaluate(async () => {
    if (typeof window.__studioVSEAddStrip !== 'function') {
      await import('/src/workbenches/studio/v3/vse/autoload.js');
    }
  });
  await win.waitForFunction(
    () => typeof window.__studioVSEAddStrip === 'function'
       && typeof window.__studioVSEEditorOpen === 'function',
    null, { timeout: 15000 },
  );

  // ─── Spawn a cube so __studioExportSnapshotPng has scene content. ───
  await win.locator('[data-studio-v3-tool="cube"][data-studio-v3-tool-group="add"]').click();
  await win.waitForTimeout(400);
  await win.evaluate(() => {
    const vp = window.__archdiscViewport;
    let cube = null;
    vp.scene.traverse((o) => { if (o.userData && o.userData.archdiscStudioPrimitiveKind === 'cube') cube = o; });
    if (cube) {
      cube.scale.set(40, 40, 40);
      cube.updateMatrixWorld(true);
    }
    if (vp.camera) { vp.camera.position.set(3, 3, 3); vp.camera.lookAt(0, 0, 0); }
  });
  await win.waitForTimeout(200);
  await win.screenshot({ path: path.join(OUT, '00-scene.png') });

  // ─── Empty timeline initially. ──────────────────────────────────────
  const empty = await win.evaluate(() => window.__studioVSEListStrips());
  expect(empty.ok).toBe(true);
  expect(empty.count).toBe(0);

  // ─── Add 3 strips at increasing channels. ──────────────────────────
  const img = await win.evaluate((url) =>
    window.__studioVSEAddStrip('image', 1, 0, 2, { dataUrl: url }), RED_2x2);
  expect(img.ok).toBe(true);
  expect(typeof img.uuid).toBe('string');
  expect(img.kind).toBe('image');
  expect(img.channel).toBe(1);

  const vp = await win.evaluate(() =>
    window.__studioVSEAddStrip('viewport', 2, 0.5, 2.5, { width: 320, height: 180 }));
  expect(vp.ok).toBe(true);
  expect(vp.kind).toBe('viewport');

  const cc = await win.evaluate(() =>
    window.__studioVSEAddStrip('colorcorrect', 3, 1.0, 2.0, { gain: 1.3, gamma: 1.2, contrast: 1.1 }));
  expect(cc.ok).toBe(true);
  expect(cc.kind).toBe('colorcorrect');

  const listed = await win.evaluate(() => window.__studioVSEListStrips());
  expect(listed.count).toBe(3);
  const kinds = listed.strips.map((s) => s.kind).sort();
  expect(kinds).toEqual(['colorcorrect', 'image', 'viewport']);

  // ─── Scrub to t=0.25: only the image strip is active. ──────────────
  const scrubA = await win.evaluate(() => window.__studioVSEScrub(0.25));
  expect(scrubA.ok).toBe(true);
  expect(typeof scrubA.dataUrl).toBe('string');
  expect(scrubA.dataUrl).toMatch(/^data:image\/png/);
  expect(scrubA.activeCount).toBe(1);

  // ─── Scrub to t=1.5: all 3 strips overlap. ─────────────────────────
  const scrubB = await win.evaluate(() => window.__studioVSEScrub(1.5));
  expect(scrubB.ok).toBe(true);
  expect(scrubB.activeCount).toBe(3);
  expect(scrubB.dataUrl).toMatch(/^data:image\/png/);
  expect(scrubB.width).toBeGreaterThan(0);
  expect(scrubB.height).toBeGreaterThan(0);

  // ─── Transport state. ──────────────────────────────────────────────
  await win.evaluate(() => window.__studioVSEPlay());
  await win.waitForTimeout(120);
  const playing = await win.evaluate(() => window.__studioVSEGetState());
  expect(playing.playing).toBe(true);
  await win.evaluate(() => window.__studioVSEPause());
  const paused = await win.evaluate(() => window.__studioVSEGetState());
  expect(paused.playing).toBe(false);

  // SetSpeed.
  const sp = await win.evaluate(() => window.__studioVSESetSpeed(2.0));
  expect(sp.ok).toBe(true);
  expect(sp.speed).toBe(2);

  // ─── Edit ops: retime + rechannel + reparam. ──────────────────────
  const move = await win.evaluate((u) => window.__studioVSESetStripTime(u, 0, 3), img.uuid);
  expect(move.ok).toBe(true);
  const chan = await win.evaluate((u) => window.__studioVSESetStripChannel(u, 4), img.uuid);
  expect(chan.ok).toBe(true);
  const par = await win.evaluate((u) => window.__studioVSESetStripParams(u, { gain: 1.5 }), cc.uuid);
  expect(par.ok).toBe(true);

  const after = await win.evaluate((u) => window.__studioVSEGetStrip(u), img.uuid);
  expect(after.channel).toBe(4);
  expect(after.startTime).toBe(0);
  expect(after.endTime).toBe(3);

  // ─── Editor: open, expect blocks for every strip + playhead. ──────
  await win.evaluate(() => window.__studioVSEEditorOpen());
  await expect(win.locator('[data-studio-v3-vse-editor]')).toBeVisible({ timeout: 5000 });
  for (const u of [img.uuid, vp.uuid, cc.uuid]) {
    await expect(win.locator(`[data-studio-v3-vse-strip="${u}"]`)).toBeVisible();
  }
  await expect(win.locator('[data-studio-v3-vse-playhead]')).toBeVisible();
  await win.screenshot({ path: path.join(OUT, '01-editor-open.png') });

  // Click the ruler to scrub.
  const ruler = win.locator('[data-studio-v3-vse-ruler]');
  await ruler.click({ position: { x: 120, y: 12 } });
  await win.waitForTimeout(150);
  await win.screenshot({ path: path.join(OUT, '02-editor-scrubbed.png') });

  // Add a strip via the toolbar button.
  await win.locator('[data-studio-v3-vse-add="viewport"]').click();
  await win.waitForTimeout(120);
  const listed2 = await win.evaluate(() => window.__studioVSEListStrips());
  expect(listed2.count).toBe(4);

  // Press Play / Pause from the toolbar.
  await win.locator('[data-studio-v3-vse-play]').click();
  await win.waitForTimeout(160);
  await win.locator('[data-studio-v3-vse-play]').click();
  await win.screenshot({ path: path.join(OUT, '03-editor-after-play.png') });

  // Close editor.
  await win.locator('[data-studio-v3-vse-close]').click();
  await expect(win.locator('[data-studio-v3-vse-editor]')).toBeHidden();

  // ─── Export sequence: 12 fps × 2 s = 24 frames. ───────────────────
  const exp = await win.evaluate(() => window.__studioVSEExportSequence(12, 2));
  expect(exp.ok).toBe(true);
  expect(exp.count).toBe(24);
  expect(exp.frames.length).toBe(24);
  expect(exp.frames[0]).toMatch(/^data:image\/png/);
  expect(exp.frames[exp.frames.length - 1]).toMatch(/^data:image\/png/);

  // ─── Serialize / deserialize round-trip. ───────────────────────────
  const ser = await win.evaluate(() => window.__studioVSESerialize());
  expect(ser.ok).toBe(true);
  expect(Array.isArray(ser.json.strips)).toBe(true);
  const beforeCount = ser.json.strips.length;

  await win.evaluate(() => window.__studioVSEReset());
  const reset = await win.evaluate(() => window.__studioVSEListStrips());
  expect(reset.count).toBe(0);

  const restored = await win.evaluate((j) => window.__studioVSEDeserialize(j), ser.json);
  expect(restored.ok).toBe(true);
  expect(restored.count).toBe(beforeCount);

  // ─── Command-palette registration check. ───────────────────────────
  const palette = await win.evaluate(() => {
    if (typeof window.__studioCommandList !== 'function') return { ok: false };
    return window.__studioCommandList('vse');
  });
  expect(palette.ok).toBe(true);
  expect(palette.count).toBeGreaterThan(0);
  const names = (palette.commands || []).map((c) => c.name);
  expect(names).toContain('__studioVSEAddStrip');
  expect(names).toContain('__studioVSEScrub');
  expect(names).toContain('__studioVSEExportSequence');
  expect(names).toContain('__studioVSEEditorToggle');

  // ─── Re-open editor and capture multi-cam angles for verification. ─
  await win.evaluate(() => window.__studioVSEEditorOpen());
  await expect(win.locator('[data-studio-v3-vse-editor]')).toBeVisible({ timeout: 5000 });

  for (const view of ['front', 'top', 'right', 'iso', 'close']) {
    await win.evaluate((v) => {
      const vp2 = window.__archdiscViewport; if (!vp2 || !vp2.camera) return;
      const c = vp2.camera;
      if (v === 'front') c.position.set(0, 0, 6);
      else if (v === 'top') c.position.set(0, 6, 0.001);
      else if (v === 'right') c.position.set(6, 0, 0);
      else if (v === 'iso') c.position.set(4, 4, 4);
      else if (v === 'close') c.position.set(1.5, 1.5, 1.5);
      c.lookAt(0, 0, 0);
    }, view);
    await win.waitForTimeout(180);
    await win.evaluate(() => window.__studioVSEScrub(1.5));
    await win.waitForTimeout(120);
    await win.screenshot({ path: path.join(OUT, `04-cam-${view}.png`) });
  }

  // eslint-disable-next-line no-console
  console.log('  vse: strips=%d exportFrames=%d palette=%d',
    listed2.count, exp.count, palette.count);

  await win.evaluate(() => {
    window.__studioV3Dirty = false;
    window.onbeforeunload = null;
  });
  await app.close();
});
