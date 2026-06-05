// Studio V3 — VSE FX (transitions + effects) Blender-VSE parity depth.
//
// Exercises the six transitions + six effects:
//   • side-effect-import the autoload module (api.js untouched).
//   • list ops, assert all 12 kinds register.
//   • generate test strips A + B with the headless ops.
//   • apply every transition at t=0.5 + assert dataUrl + non-trivial diff.
//   • apply every effect + assert dataUrl + diff vs source.
//   • assert command-palette registration under category 'vse'.
//   • spawn a cube + capture multi-cam screenshots so the run is
//     verifiable on the remote desktop (front / top / right / iso / close).

import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-v3-vsefx');

const TRANSITIONS = ['CrossFade', 'Wipe', 'Slide', 'Dissolve', 'Iris', 'PushZoom'];
const EFFECTS     = ['Glow', 'MotionBlur', 'ChromaticAberration', 'Pixelate', 'Vignette', 'GammaShift'];

test('Studio V3 — VSE FX (6 transitions + 6 effects)', async () => {
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

  // ─── Install VSE FX (api.js untouched). ────────────────────────────
  await win.evaluate(async () => {
    if (typeof window.__studioVSEFXApplyTransition !== 'function') {
      await import('/src/workbenches/studio/v3/vsefx/autoload.js');
    }
  });
  await win.waitForFunction(
    () => typeof window.__studioVSEFXApplyTransition === 'function'
       && typeof window.__studioVSEFXApplyEffect === 'function'
       && typeof window.__studioVSEFXListTransitions === 'function'
       && typeof window.__studioVSEFXListEffects === 'function'
       && typeof window.__studioVSEFXTestStripA === 'function'
       && typeof window.__studioVSEFXTestStripB === 'function',
    null, { timeout: 15000 },
  );

  // ─── Spawn a cube so the viewport isn't blank for screenshots. ─────
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

  // ─── Listing ops: assert all 12 kinds. ─────────────────────────────
  const tlist = await win.evaluate(() => window.__studioVSEFXListTransitions());
  expect(tlist.ok).toBe(true);
  expect(Array.isArray(tlist.kinds)).toBe(true);
  for (const k of TRANSITIONS) expect(tlist.kinds).toContain(k);

  const elist = await win.evaluate(() => window.__studioVSEFXListEffects());
  expect(elist.ok).toBe(true);
  expect(Array.isArray(elist.kinds)).toBe(true);
  for (const k of EFFECTS) expect(elist.kinds).toContain(k);

  // ─── Generate test source images. ──────────────────────────────────
  const aFx = await win.evaluate(() => window.__studioVSEFXTestStripA());
  expect(aFx.ok).toBe(true);
  expect(aFx.dataUrl).toMatch(/^data:image\/png/);
  expect(aFx.width).toBeGreaterThan(0);
  expect(aFx.height).toBeGreaterThan(0);

  const bFx = await win.evaluate(() => window.__studioVSEFXTestStripB());
  expect(bFx.ok).toBe(true);
  expect(bFx.dataUrl).toMatch(/^data:image\/png/);

  // Persist the source frames so a human verifier can inspect them.
  fs.writeFileSync(path.join(OUT, '01-source-A.png'),
    Buffer.from(aFx.dataUrl.split(',')[1], 'base64'));
  fs.writeFileSync(path.join(OUT, '02-source-B.png'),
    Buffer.from(bFx.dataUrl.split(',')[1], 'base64'));

  // ─── Apply every transition at t = 0.5. ────────────────────────────
  for (const kind of TRANSITIONS) {
    const result = await win.evaluate(async ({ k, A, B }) =>
      window.__studioVSEFXApplyTransition(k, A, B, 0.5, {}),
      { k: kind, A: aFx.dataUrl, B: bFx.dataUrl });
    expect(result.ok, `transition ${kind}`).toBe(true);
    expect(result.dataUrl, `transition ${kind} dataUrl`).toMatch(/^data:image\/png/);
    expect(result.width).toBe(aFx.width);
    expect(result.height).toBe(aFx.height);
    // The transition output must differ from BOTH inputs (we picked
    // mid-t so neither all-A nor all-B is correct).
    expect(result.dataUrl).not.toBe(aFx.dataUrl);
    expect(result.dataUrl).not.toBe(bFx.dataUrl);
    fs.writeFileSync(path.join(OUT, `10-transition-${kind}.png`),
      Buffer.from(result.dataUrl.split(',')[1], 'base64'));
  }

  // ─── Edge case: t = 0 should match A; t = 1 should match B. ────────
  const crossAt0 = await win.evaluate(async ({ A, B }) =>
    window.__studioVSEFXApplyTransition('CrossFade', A, B, 0, {}),
    { A: aFx.dataUrl, B: bFx.dataUrl });
  expect(crossAt0.ok).toBe(true);
  expect(crossAt0.dataUrl).toBe(aFx.dataUrl);
  const crossAt1 = await win.evaluate(async ({ A, B }) =>
    window.__studioVSEFXApplyTransition('CrossFade', A, B, 1, {}),
    { A: aFx.dataUrl, B: bFx.dataUrl });
  expect(crossAt1.ok).toBe(true);
  expect(crossAt1.dataUrl).toBe(bFx.dataUrl);

  // ─── Apply every effect. ───────────────────────────────────────────
  for (const kind of EFFECTS) {
    // Pick a representative param set per effect so the visible diff
    // actually exercises the kernel.
    let params = {};
    if (kind === 'MotionBlur')          params = { angle: 30, distance: 6 };
    else if (kind === 'ChromaticAberration') params = { shift: 6 };
    else if (kind === 'Pixelate')       params = { size: 12 };
    else if (kind === 'Glow')           params = { threshold: 0.5, intensity: 0.7, radius: 3 };
    else if (kind === 'Vignette')       params = { strength: 0.7, softness: 1.0 };
    else if (kind === 'GammaShift')     params = { gamma: 2.0 };

    const result = await win.evaluate(async ({ k, A, p }) =>
      window.__studioVSEFXApplyEffect(k, A, p),
      { k: kind, A: aFx.dataUrl, p: params });
    expect(result.ok, `effect ${kind}`).toBe(true);
    expect(result.dataUrl, `effect ${kind} dataUrl`).toMatch(/^data:image\/png/);
    expect(result.width).toBe(aFx.width);
    expect(result.height).toBe(aFx.height);
    expect(result.dataUrl, `effect ${kind} differs from source`).not.toBe(aFx.dataUrl);
    fs.writeFileSync(path.join(OUT, `20-effect-${kind}.png`),
      Buffer.from(result.dataUrl.split(',')[1], 'base64'));
  }

  // ─── Bad inputs → ok:false rather than thrown. ─────────────────────
  const bad = await win.evaluate(() =>
    window.__studioVSEFXApplyTransition('NotARealKind', '', '', 0.5, {}));
  expect(bad.ok).toBe(false);
  expect(typeof bad.error).toBe('string');

  const badE = await win.evaluate(() =>
    window.__studioVSEFXApplyEffect('NotARealKind', '', {}));
  expect(badE.ok).toBe(false);

  // ─── Command-palette registration check. ───────────────────────────
  const palette = await win.evaluate(() => {
    if (typeof window.__studioCommandList !== 'function') return { ok: false };
    return window.__studioCommandList('vse');
  });
  expect(palette.ok).toBe(true);
  const names = (palette.commands || []).map((c) => c.name);
  for (const op of [
    '__studioVSEFXListTransitions',
    '__studioVSEFXListEffects',
    '__studioVSEFXApplyTransition',
    '__studioVSEFXApplyEffect',
    '__studioVSEFXTestStripA',
    '__studioVSEFXTestStripB',
  ]) {
    expect(names, `palette has ${op}`).toContain(op);
  }

  // ─── Multi-cam screenshots so the run is verifiable on the remote. ─
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
    await win.screenshot({ path: path.join(OUT, `30-cam-${view}.png`) });
  }

  // eslint-disable-next-line no-console
  console.log('  vsefx: transitions=%d effects=%d palette=%d',
    TRANSITIONS.length, EFFECTS.length, palette.count);

  await win.evaluate(() => {
    window.__studioV3Dirty = false;
    window.onbeforeunload = null;
  });
  await app.close();
});
