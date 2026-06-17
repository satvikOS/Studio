// Mac/Metal ray-tracing proof — composes a properly-scaled DISTINCT scene + PBR materials +
// a cinematic lighting rig, then renders via __studioGPURTRender (navigator.gpu → Metal compute
// path tracer). The RT now frames the viewport camera onto the scene bbox INTERNALLY and refreshes
// its matrices before packing the inverse-VP, so the kernel rays are guaranteed to hit the geometry
// regardless of how the camera was last posed. We assert the returned PNG is a non-trivial image.
import { test, _electron as electron } from '@playwright/test';
import { expect } from '@playwright/test';
import path from 'path';
import fs from 'fs';

const OUT = path.resolve(__dirname, 'shots', 'studio');

// Minimal PNG header parser — pulls width/height from the IHDR chunk so we can
// assert the decoded image actually matches the requested render dimensions
// (a fragment / empty render would either be wrong-sized or trivially small).
function pngDimensions(buf) {
  // PNG signature is 8 bytes; IHDR length(4) + 'IHDR'(4) then width(4) height(4).
  if (buf.length < 24 || buf.toString('ascii', 12, 16) !== 'IHDR') return null;
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

// Reject a flat / single-colour frame (e.g. all-background) that decodes to the
// right size but contains no ray-traced geometry. A real lit/shaded render
// compresses to a large, high-variety IDAT stream; a flat frame collapses to a
// tiny, low-variety one. Counting distinct byte values across the PNG payload
// is a cheap, robust proxy for tonal variety.
function byteVariety(buf) {
  const seen = new Set();
  for (let i = 0; i < buf.length; i++) seen.add(buf[i]);
  return seen.size;
}

test('Mac/Metal WebGPU ray-traced render (composed scene)', async () => {
  test.setTimeout(10 * 60 * 1000);
  fs.mkdirSync(OUT, { recursive: true });
  const app = await electron.launch({ args: [path.join(__dirname, '..', '..', 'electron', 'main.js'), '--dev'], slowMo: 20 });
  let win = await app.firstWindow();
  if (win.url().startsWith('devtools://')) win = (await app.windows()).find((w) => !w.url().startsWith('devtools://')) || await app.waitForEvent('window', { predicate: (w) => !w.url().startsWith('devtools://') });
  win.on('dialog', (d) => d.dismiss().catch(() => {}));
  await win.waitForLoadState('domcontentloaded');
  await win.waitForFunction(() => location.protocol === 'http:' || location.protocol === 'https:' || location.protocol === 'file:', { timeout: 15000 }).catch(() => {});
  await win.evaluate(() => { try { window.localStorage.setItem('studio.v3.tour-seen', '1'); } catch (_) {} try { window.sessionStorage.setItem('studio.v3.splash-shown', '1'); } catch (_) {} });
  await win.reload();
  await expect(win.locator('[data-studio-v3-shell]')).toBeVisible({ timeout: 20000 });
  await win.waitForFunction(() => typeof window.__studioComposeScene === 'function' && typeof window.__studioGPURTRender === 'function' && !!window.__archdiscViewport, { timeout: 20000 });

  const r = await win.evaluate(async () => {
    // DISTINCT prompt per the vary-prompts rule: a product-hero studio shot
    // (NOT the living-room used elsewhere, NOT the cafe of the prior run),
    // with a fresh seed for a fresh layout.
    const composed = window.__studioComposeScene('product', 73);
    // PBR upgrade: tagged bodies → MeshPhysicalMaterial from the registry.
    const mats = (typeof window.__studioLookdevMaterials === 'function')
      ? window.__studioLookdevMaterials()
      : { ok: false };
    // Cinematic lighting rig (golden-hour key/fill/rim + hemisphere + bg).
    const light = (typeof window.__studioLight === 'function')
      ? window.__studioLight('golden-hour')
      : { ok: false };

    const has = await window.__studioGPURTHasGPU();
    if (!has.hasGPU) return { ok: false, hasGPU: false, error: has.error, composed, mats, light };

    // We intentionally DO NOT frame the camera here — the RT frames internally
    // onto the exact geometry it ray-traces and refreshes the camera matrices,
    // so the inverse-VP it packs is correct by construction. The render result
    // reports framed:true + the framed pose for verification.
    const res = await window.__studioGPURTRender({ width: 960, height: 540, samples: 48, maxBounces: 2 });
    return { ...res, composed, materialsApplied: mats.applied, lightPreset: light.preset };
  });

  let png = null;
  if (r.ok && r.dataUrl) {
    png = Buffer.from(r.dataUrl.split(',')[1], 'base64');
    fs.writeFileSync(path.join(OUT, 'metal-rt-hero.png'), png);
    delete r.dataUrl;
  }
  console.log('[metal-rt] ' + JSON.stringify(r));
  console.log(`\n=== MAC/METAL RT: ${r.ok ? `${r.width}x${r.height}@${r.samples}spp, ${r.triCount} tris, ${r.nodeCount} BVH nodes, framed=${r.framed}, device=${r.device}, ${Math.round(r.elapsed)}ms` : 'unavailable: ' + (r.error || '')} ===`);

  await win.evaluate(() => { window.__studioV3Dirty = false; window.onbeforeunload = null; });
  await app.close();

  // 1. The render succeeded on the real WebGPU/Metal path.
  expect(r.ok).toBe(true);
  expect(r.device).toBe('gpu');
  // 2. The composed scene produced a substantial mesh (not a stub / single prim).
  expect(r.triCount).toBeGreaterThan(100);
  // 3. The RT framed the camera onto the scene (the framing-fix guarantee).
  expect(r.framed).toBe(true);
  expect(Array.isArray(r.cameraPosition)).toBe(true);
  // 4. PBR materials + lighting rig were applied to the composed bodies.
  expect(r.materialsApplied).toBeGreaterThan(0);
  expect(r.lightPreset).toBe('golden-hour');
  // 5. The returned PNG is a non-trivial, correctly-sized image — proving the
  //    framed inverse-VP actually put the lit geometry in front of the camera.
  expect(png).not.toBeNull();
  const dims = pngDimensions(png);
  expect(dims).not.toBeNull();
  expect(dims.width).toBe(r.width);
  expect(dims.height).toBe(r.height);
  // A 960x540 lit render is tens of KB; an empty/flat frame collapses to a few KB.
  expect(png.length).toBeGreaterThan(12000);
  // And it must contain real tonal variety, not one flat colour.
  expect(byteVariety(png)).toBeGreaterThan(64);
});
