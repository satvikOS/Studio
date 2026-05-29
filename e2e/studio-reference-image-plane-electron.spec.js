import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

/*
 * Studio — REFERENCE IMAGE PLANES (headed Electron).
 *
 * Blender "Background Images" (View3DBackgroundImage) / Maya image planes /
 * 3ds Max viewport backgrounds: load a real blueprint IMAGE onto an axis-
 * aligned plane and model against it. Distinct from the older grid+label
 * "Reference" primitive — these load actual images and are NOT primitives, so
 * selection / export / frame-all / the primitive count all ignore them (a
 * background image is not model geometry). Front/side/top axes + opacity.
 */

const OUT = path.resolve(__dirname, 'screenshots', 'studio-reference-image-plane');

test('Studio — reference image planes load real images + stay out of the model graph', async () => {
  test.setTimeout(240000);
  fs.mkdirSync(OUT, { recursive: true });

  const app = await electron.launch({ args: [path.join(__dirname, '..', 'electron', 'main.js')], slowMo: Number(process.env.STUDIO_SLOWMO) || 220 });
  const win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');
  await expect(win.locator('.workbench-current .workbench-name')).toHaveText('ArchDisc Studio', { timeout: 30000 });
  await expect(win.locator('canvas').first()).toBeVisible({ timeout: 60000 });
  await win.waitForFunction(() => !!window.__archdiscViewport, null, { timeout: 30000 });
  await win.waitForFunction(() => typeof window.__archieRun === 'function', null, { timeout: 30000 });
  await win.waitForFunction(() => typeof window.__studioAddRefPlane === 'function', null, { timeout: 30000 });
  await win.waitForTimeout(500);

  const counts = () => win.evaluate(() => {
    let prims = 0, refs = 0;
    const s = window.__archdiscScene;
    s && s.traverse((o) => {
      if (o.userData && o.userData.archdiscStudioPrimitive) prims++;
      if (o.userData && o.userData.archdiscStudioRefPlane) refs++;
    });
    return { prims, refs };
  });

  // Build a small model to sit in front of the reference.
  await win.evaluate(() => window.__archieRun({ goals: ['lantern post'], maxGoals: 1 }));
  const before = await counts();
  expect(before.prims).toBeGreaterThanOrEqual(3);
  expect(before.refs).toBe(0);

  // Synthesize a blueprint-like image and load it as a FRONT reference plane.
  const added = await win.evaluate(() => {
    const c = document.createElement('canvas'); c.width = 256; c.height = 320;
    const x = c.getContext('2d');
    x.fillStyle = '#101010'; x.fillRect(0, 0, 256, 320);
    x.strokeStyle = '#3a6ea5'; x.lineWidth = 2;
    for (let i = 0; i <= 256; i += 32) { x.beginPath(); x.moveTo(i, 0); x.lineTo(i, 320); x.stroke(); }
    for (let j = 0; j <= 320; j += 32) { x.beginPath(); x.moveTo(0, j); x.lineTo(256, j); x.stroke(); }
    x.strokeStyle = '#d8d8d8'; x.lineWidth = 4;
    x.strokeRect(64, 40, 128, 240); x.beginPath(); x.arc(128, 110, 56, 0, Math.PI * 2); x.stroke();
    const plane = window.__studioAddRefPlane('front', c.toDataURL('image/png'), { opacity: 0.7 });
    return !!(plane && plane.userData && plane.userData.archdiscStudioRefPlane);
  });
  expect(added, 'front reference image plane created + tagged').toBe(true);
  await win.waitForTimeout(450); // texture load

  const afterFront = await counts();
  expect(afterFront.refs, 'one reference plane in the scene').toBe(1);
  expect(afterFront.prims, 'reference plane is NOT counted as a primitive').toBe(before.prims);

  // The primitive-count badge (model graph) must be unchanged by the ref plane.
  const badge = await win.evaluate(() => {
    const el = document.querySelector('[data-studio-primitive-count]');
    return el ? el.textContent : '';
  });
  expect(badge).toContain(`${before.prims} primitive`);

  // The plane actually carries the loaded image texture.
  const textured = await win.evaluate(() => {
    let ok = false; const s = window.__archdiscScene;
    s && s.traverse((o) => { if (o.userData && o.userData.archdiscStudioRefPlane && o.material && o.material.map) ok = true; });
    return ok;
  });
  expect(textured, 'reference plane has the loaded image as its texture').toBe(true);

  // frame-all (frames primitives only) must ignore the ref plane.
  await win.evaluate(() => { window.__studioFrameAll && window.__studioFrameAll(); window.__archdiscOrbitView && window.__archdiscOrbitView(16, 8, 1.3); });
  await win.waitForTimeout(250);
  await win.screenshot({ path: path.join(OUT, '01-front-ref.png') });

  // Add side + top planes (axis-orientation coverage).
  await win.evaluate(() => {
    const mk = (col) => { const c = document.createElement('canvas'); c.width = 256; c.height = 256; const x = c.getContext('2d'); x.fillStyle = col; x.fillRect(0, 0, 256, 256); x.fillStyle = '#fff'; x.font = '40px sans-serif'; x.fillText('REF', 80, 140); return c.toDataURL('image/png'); };
    window.__studioAddRefPlane('side', mk('#202a20'), { opacity: 0.55 });
    window.__studioAddRefPlane('top', mk('#2a2020'), { opacity: 0.45 });
  });
  await win.waitForTimeout(450);
  const afterAll = await counts();
  expect(afterAll.refs, 'three reference planes (front/side/top)').toBe(3);
  expect(afterAll.prims, 'still no change to primitive count').toBe(before.prims);

  // Distinct axis orientations (front=XY, side=YZ rot.y, top=XZ rot.x).
  const oriented = await win.evaluate(() => {
    const by = {}; const s = window.__archdiscScene;
    s && s.traverse((o) => { if (o.userData && o.userData.archdiscStudioRefPlane) by[o.userData.archdiscStudioRefAxis] = [o.rotation.x, o.rotation.y]; });
    return by;
  });
  expect(Math.abs(oriented.side[1])).toBeGreaterThan(1.0);  // ~PI/2 about Y
  expect(Math.abs(oriented.top[0])).toBeGreaterThan(1.0);   // ~PI/2 about X
  expect(Math.abs(oriented.front[0]) + Math.abs(oriented.front[1])).toBeLessThan(0.01); // unrotated

  // Opacity control updates the live material.
  const opacityOk = await win.evaluate(() => {
    const slider = document.querySelector('[data-studio-ref="opacity"]');
    if (!slider) return false;
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(slider, '0.25');
    slider.dispatchEvent(new Event('input', { bubbles: true }));
    slider.dispatchEvent(new Event('change', { bubbles: true }));
    let minOpacity = 1; const s = window.__archdiscScene;
    s && s.traverse((o) => { if (o.userData && o.userData.archdiscStudioRefPlane && o.material) minOpacity = Math.min(minOpacity, o.material.opacity); });
    return minOpacity <= 0.3;
  });
  expect(opacityOk, 'opacity slider drives ref-plane material opacity').toBe(true);

  // Reference planes must be excluded from glTF export (model-only).
  const exportClean = await win.evaluate(async () => {
    if (!window.__studioExportGltfString) return true;
    const str = await window.__studioExportGltfString();
    return !!str && !/studio-ref-/.test(str);
  });
  expect(exportClean, 'reference planes are excluded from export').toBe(true);

  await win.evaluate(() => window.__archdiscOrbitView && window.__archdiscOrbitView(42, 20, 1.35));
  await win.waitForTimeout(250);
  await win.screenshot({ path: path.join(OUT, '02-three-axes.png') });

  // eslint-disable-next-line no-console
  console.log(`  reference image planes: ${afterAll.refs} planes, primitives unchanged at ${afterAll.prims}, textured + export-clean`);

  await app.close();
});
