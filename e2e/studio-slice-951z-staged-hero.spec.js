import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

// Slice 951z — staged-workflow acceptance. Drives the LIVE Hermes
// adapter (no mock) with a hero-shot prompt and asserts the trace went
// beyond spawning: bodies were COMPOSED (transformed off origin),
// MATERIALS applied (physical-material delta), LIGHTS added, and the
// CAMERA framed the scene. This is the MUST-references bar: a staged
// shot, not primitives stacked at origin.
//
// Requires mlx_lm.server on :8080 with the staged-corpus adapter at
// adapters/archie/hermes_studio/modeling.

const OUT = path.resolve(__dirname, 'screenshots', 'studio-slice-951z-staged-hero');

const PROMPT = 'build a coffee table hero shot';

async function sceneStats(win) {
  return win.evaluate(() => {
    const vp = window.__archdiscViewport;
    const s = window.__archdiscScene || (vp && vp.scene);
    const out = { prims: 0, lights: 0, physMats: 0, offOrigin: 0, cam: null };
    if (!s) return out;
    s.traverse((o) => {
      if (o && o.userData && o.userData.archdiscStudioPrimitive) {
        out.prims++;
        if (o.position && (Math.abs(o.position.x) > 1e-3 || Math.abs(o.position.y) > 1e-3 || Math.abs(o.position.z) > 1e-3)) {
          out.offOrigin++;
        }
        const m = Array.isArray(o.material) ? o.material[0] : o.material;
        if (m && m.isMeshPhysicalMaterial) out.physMats++;
      }
      if (o && o.isLight) out.lights++;
    });
    if (vp && vp.camera) out.cam = vp.camera.position.toArray().map((v) => +v.toFixed(3));
    return out;
  });
}

test('Studio slice 951z — staged hero shot: compose + material + light + camera', async () => {
  test.setTimeout(420000);
  fs.mkdirSync(OUT, { recursive: true });

  const app = await electron.launch({
    args: [path.join(__dirname, '..', 'electron', 'main.js'), '--dev'],
    slowMo: Number(process.env.STUDIO_SLOWMO) || 150,
  });
  const win = await app.firstWindow();
  win.on('dialog', (d) => { d.dismiss().catch(() => {}); });
  await win.waitForLoadState('domcontentloaded');
  await win.evaluate(() => {
    window.localStorage.setItem('studio.v3.tour-seen', '1');
    window.localStorage.setItem('studioV3Theme', 'dark');
    try { window.sessionStorage.setItem('studio.v3.splash-shown', '1'); } catch (_) {}
  });
  await win.reload();
  await win.waitForLoadState('domcontentloaded');
  await expect(win.locator('[data-studio-v3-shell]')).toBeVisible({ timeout: 15000 });
  await win.waitForTimeout(800);

  const before = await sceneStats(win);
  console.log('before:', JSON.stringify(before));

  await win.locator('[data-studio-v3-cmdbar-input]').click();
  await win.locator('[data-studio-v3-cmdbar-input]').fill(PROMPT);
  await win.locator('[data-studio-v3-cmdbar-input]').press('Enter');
  await win.screenshot({ path: path.join(OUT, '01-typed.png') });

  // Staged traces are long (~30 calls, ~40 s of generation + dispatch).
  // Poll until the camera moved AND ≥1 light landed, or 150 s.
  const deadline = Date.now() + 150000;
  let after = before;
  while (Date.now() < deadline) {
    after = await sceneStats(win);
    const camMoved = JSON.stringify(after.cam) !== JSON.stringify(before.cam);
    if (after.lights > before.lights && camMoved && after.prims >= 3) break;
    await win.waitForTimeout(1500);
  }
  await win.waitForTimeout(1500);
  after = await sceneStats(win);
  console.log('after:', JSON.stringify(after));

  // Thread tail for the log — proves real fn dispatches, not fallbacks.
  const msgs = await win.evaluate(() =>
    Array.from(document.querySelectorAll('[data-studio-v3-archie-msg]')).slice(-14)
      .map((el) => `[${el.getAttribute('data-role')}] ${(el.textContent || '').trim().slice(0, 130)}`));
  for (const m of msgs) console.log(m);

  await win.screenshot({ path: path.join(OUT, '02-hero.png') });

  // The staged bar (MUST references): composed, dressed, lit, framed.
  expect(after.prims, 'expected ≥3 primitives').toBeGreaterThanOrEqual(3);
  expect(after.offOrigin, 'bodies must be COMPOSED off origin, not stacked').toBeGreaterThanOrEqual(2);
  expect(after.physMats, 'expected ≥2 preset materials applied').toBeGreaterThanOrEqual(2);
  expect(after.lights, 'expected ≥1 light added by the trace').toBeGreaterThan(before.lights);
  expect(JSON.stringify(after.cam), 'camera must reframe for the hero shot')
    .not.toBe(JSON.stringify(before.cam));

  // Multi-cam wrap: orbit a few angles via the main-camera setter for
  // remote-desktop verification (scale-to-viewer).
  const ANGLES = [
    { name: 'iso',   pos: [3.2, 2.0, 3.6] },
    { name: 'front', pos: [0, 1.0, 4.6] },
    { name: 'top',   pos: [0, 5.2, 0.01] },
    { name: 'right', pos: [4.6, 1.2, 0] },
    { name: 'low',   pos: [2.2, 0.5, 2.6] },
  ];
  for (const a of ANGLES) {
    await win.evaluate((arg) => {
      window.__studioMainCameraLook && window.__studioMainCameraLook(arg.pos, [0, 0.4, 0]);
    }, a);
    await win.waitForTimeout(450);
    await win.screenshot({ path: path.join(OUT, `cam-${a.name}.png`) });
  }

  await win.evaluate(() => {
    window.__studioV3Dirty = false;
    window.onbeforeunload = null;
  });
  await win.waitForTimeout(140);
  await app.close();
});
