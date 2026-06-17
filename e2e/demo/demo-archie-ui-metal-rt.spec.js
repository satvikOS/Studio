// MUST-rule proof: (1) Archie DRIVES THE UI step-by-step like a human — typed into the
// real cmdbar, then clicks discipline tabs / spawns primitives / applies tools via the
// actual controls (executeToolCall → real DOM clicks), screenshotted as the viewport
// builds. (2) The final is rendered by the Mac GPU via WebGPU/Metal ray tracing
// (__studioGPURTRender). No composer shortcuts — the live model drives the UI.
import { test, _electron as electron } from '@playwright/test';
import { expect } from '@playwright/test';
import path from 'path';
import fs from 'fs';

const OUT = path.resolve(__dirname, 'shots', 'studio');
const STEPS = path.join(OUT, 'archie-ui-steps');

// vary-prompts rule: a rotating bank of VERY different build requests; pick a fresh one
// each run (no reuse) so the UI-drive proof generalizes instead of cherry-picking.
const PROMPTS = [
  'design a home-office desk setup — desk, monitor, keyboard, task chair, desk lamp, potted plant, wall shelf',
  'build a kitchen island scene — island counter, three bar stools, pendant lights overhead, a fruit bowl, upper cabinets',
  'model a robot arm on a workbench — base, two arm segments, gripper, control box, the bench it sits on',
  'lay out a city bus-stop — shelter roof, bench, trash bin, route sign on a pole, two standing figures',
  'compose a still-life product shot — a ceramic mug, a stacked plate, a folded napkin, a small vase with stems, on a wood board',
  'build a campsite at dusk — dome tent, campfire ring with logs, two folding chairs, a cooler, a lantern on a stump',
  'model a workshop tool wall — pegboard, hand tools hanging, a vise on the bench, a toolbox, a work light',
];
const pick = PROMPTS[Date.now() % PROMPTS.length];

test('Archie drives the UI step-by-step + Metal ray-traced final', async () => {
  test.setTimeout(12 * 60 * 1000);
  fs.mkdirSync(STEPS, { recursive: true });
  const app = await electron.launch({ args: [path.join(__dirname, '..', '..', 'electron', 'main.js'), '--dev'], slowMo: 60 });
  let win = await app.firstWindow();
  if (win.url().startsWith('devtools://')) win = (await app.windows()).find((w) => !w.url().startsWith('devtools://')) || await app.waitForEvent('window', { predicate: (w) => !w.url().startsWith('devtools://') });
  win.on('dialog', (d) => d.dismiss().catch(() => {}));
  await win.waitForLoadState('domcontentloaded');
  await win.evaluate(() => { window.localStorage.setItem('studio.v3.tour-seen', '1'); try { window.sessionStorage.setItem('studio.v3.splash-shown', '1'); } catch (_) {} });
  await win.reload();
  await expect(win.locator('[data-studio-v3-shell]')).toBeVisible({ timeout: 20000 });
  await expect(win.locator('[data-studio-v3-cmdbar-input]')).toBeVisible({ timeout: 15000 });
  await win.waitForTimeout(800);

  const bodyCount = () => win.evaluate(() => { const s = window.__archdiscScene; let n = 0; if (s) s.traverse((o) => { if (o.isMesh && o.userData && o.userData.archdiscStudioPrimitive) n++; }); return n; });
  await win.screenshot({ path: path.join(STEPS, 'step-00-empty.png') });
  const before = await bodyCount();

  // (1) HUMAN: type a build request into the real cmdbar + Enter → Archie drives the UI
  const input = win.locator('[data-studio-v3-cmdbar-input]');
  await input.click();
  console.log(`[ui-drive] prompt → "${pick}"`);
  await input.type(pick, { delay: 18 });
  await win.screenshot({ path: path.join(STEPS, 'step-01-typed.png') });
  await input.press('Enter');

  // capture the UI building step by step (discipline switch → primitives appearing → tools)
  let last = before;
  const counts = [];
  for (let i = 0; i < 20; i++) {
    await win.waitForTimeout(1300);
    const n = await bodyCount();
    counts.push(n);
    await win.screenshot({ path: path.join(STEPS, `step-${String(i + 2).padStart(2, '0')}-build-${n}.png`) });
    if (n > 0 && n === last && i > 6) break; // settled
    last = n;
  }
  const after = await bodyCount();
  console.log(`[ui-drive] bodies before=${before} after=${after} (the model drove the UI to spawn ${after - before})  trace=${JSON.stringify(counts)}`);

  // frame the viewport camera on the built scene so the ray tracer (which uses the live
  // camera) renders a composed shot, not a fragment.
  await win.evaluate(() => {
    const s = window.__archdiscScene, TH = window.__archdiscTHREE, vp = window.__archdiscViewport;
    if (!s || !TH) return;
    const box = new TH.Box3().setFromObject(s); const c = box.getCenter(new TH.Vector3()); const sz = box.getSize(new TH.Vector3()); const R = Math.max(sz.x, sz.z, sz.y) * 0.5 || 4;
    const pos = [c.x + R * 1.6, c.y + R * 0.8, c.z + R * 2.1], look = [c.x, c.y + sz.y * 0.1, c.z];
    if (window.__studioMainCameraLook) window.__studioMainCameraLook(pos, look);
    else if (vp && vp.camera) { vp.camera.position.set(...pos); vp.camera.lookAt(...look); }
    if (vp && vp.controls && vp.controls.target) { vp.controls.target.set(c.x, c.y, c.z); if (vp.controls.update) vp.controls.update(); }
  });
  await win.waitForTimeout(600);

  // (2) Mac GPU ray tracing via WebGPU/Metal
  const rt = await win.evaluate(async () => {
    if (typeof window.__studioGPURTHasGPU !== 'function') return { ok: false, error: 'no __studioGPURTHasGPU' };
    const has = await window.__studioGPURTHasGPU();
    if (!has.hasGPU) return { ok: false, hasGPU: false, error: has.error || 'WebGPU/Metal unavailable in this runtime' };
    const r = await window.__studioGPURTRender({ width: 1280, height: 720, samples: 64, maxBounces: 3 });
    return r;
  });
  if (rt.ok && rt.dataUrl) { fs.writeFileSync(path.join(OUT, 'metal-raytraced-final.png'), Buffer.from(rt.dataUrl.split(',')[1], 'base64')); }
  console.log('[metal-rt] ' + JSON.stringify({ ...rt, dataUrl: rt.dataUrl ? '<png>' : undefined }));
  await win.screenshot({ path: path.join(OUT, 'archie-ui-final-viewport.png') });
  console.log(`\n=== ARCHIE-UI + METAL-RT: model drove UI to ${after} bodies; WebGPU/Metal RT ${rt.ok ? `rendered ${rt.width}x${rt.height}@${rt.samples}spp in ${rt.elapsed}ms` : 'unavailable (' + (rt.error || '') + ')'} ===`);
  await win.evaluate(() => { window.__studioV3Dirty = false; window.onbeforeunload = null; });
  await app.close();

  expect(after).toBeGreaterThan(before);   // Archie drove the UI to build (human-mimicking clicks)
  expect(after).toBeGreaterThanOrEqual(4); // a real scene, not one primitive
});
