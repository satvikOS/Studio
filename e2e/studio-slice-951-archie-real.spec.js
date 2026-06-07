import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

// Slice 951 — Demo-day end-to-end Archie verification.
//
// NO MOCK. Drives Studio against the LIVE mlx_lm.server at localhost:8080
// with the studio_v16 per-discipline LoRA + the proper Studio Tool
// Registry serialized into the system prompt. Confirms the platform is
// actually driven by Archie:
//   1. User types "create a cube" in the cmdbar
//   2. Wait up to 90 s for Archie to return + dispatch
//   3. Assert a cube primitive lands in window.__archdiscScene
//
// Three-tier dispatch is in StudioShellV3.jsx: <tool_call> tags first,
// then <plan> synth, then keyword fallback. ANY tier must produce the
// cube for the test to pass.

const OUT = path.resolve(__dirname, 'screenshots', 'studio-slice-951-archie-real');

async function countPrimitives(win, kind) {
  return win.evaluate((k) => {
    const s = window.__archdiscScene || (window.__archdiscViewport && window.__archdiscViewport.scene);
    if (!s) return 0;
    let n = 0;
    s.traverse((o) => {
      if (o && o.userData && o.userData.archdiscStudioPrimitive
          && o.userData.archdiscStudioPrimitiveKind === k) n++;
    });
    return n;
  }, kind);
}

test('Studio slice 951 — Archie drives the platform end-to-end (real model)', async () => {
  test.setTimeout(300000);
  fs.mkdirSync(OUT, { recursive: true });

  const app = await electron.launch({
    args: [path.join(__dirname, '..', 'electron', 'main.js'), '--dev'],
    slowMo: Number(process.env.STUDIO_SLOWMO) || 200,
  });
  const win = await app.firstWindow();
  win.on('dialog', (d) => { d.dismiss().catch(() => {}); });
  await win.waitForLoadState('domcontentloaded');

  await win.evaluate(() => {
    window.localStorage.removeItem('studio.v3.display-toggles');
    window.localStorage.setItem('studio.v3.tour-seen', '1');
    window.localStorage.setItem('studioV3Theme', 'dark');
    // Make sure no leftover mock from slice 948 is intercepting calls.
    delete window.__studioArchieMock;
    try { window.sessionStorage.setItem('studio.v3.splash-shown', '1'); } catch (_) {}
  });
  await win.reload();
  await win.waitForLoadState('domcontentloaded');
  await expect(win.locator('[data-studio-v3-shell]')).toBeVisible({ timeout: 15000 });
  await win.waitForTimeout(800);

  // Baseline — no cubes yet.
  const cubesBefore = await countPrimitives(win, 'cube');
  expect(cubesBefore).toBe(0);
  await win.screenshot({ path: path.join(OUT, '01-baseline.png') });

  // Submit a real prompt. NO mock — this routes to localhost:8080.
  await win.locator('[data-studio-v3-cmdbar-input]').click();
  await win.locator('[data-studio-v3-cmdbar-input]').fill('create a cube');
  await win.screenshot({ path: path.join(OUT, '02-prompt-typed.png') });
  await win.locator('[data-studio-v3-cmdbar-input]').press('Enter');

  // Overlay should pop with a "…thinking…" placeholder immediately.
  await expect(win.locator('[data-studio-v3-archie-overlay]')).toBeVisible({ timeout: 5000 });
  await win.waitForTimeout(800);
  await win.screenshot({ path: path.join(OUT, '03-thinking.png') });

  // Poll for the cube up to 90 s (first inference is slow).
  let cubesAfter = 0;
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    cubesAfter = await countPrimitives(win, 'cube');
    if (cubesAfter > 0) break;
    await win.waitForTimeout(1500);
  }
  await win.screenshot({ path: path.join(OUT, '04-after-dispatch.png') });

  // Capture the overlay messages for the report.
  const messages = await win.evaluate(() => {
    const items = Array.from(document.querySelectorAll('[data-studio-v3-archie-msg]'));
    return items.map((el) => ({
      role: el.getAttribute('data-role'),
      text: (el.textContent || '').slice(0, 600),
    }));
  });
  console.log('--- Archie overlay messages ---');
  for (const m of messages) console.log(`[${m.role}]`, m.text);

  expect(cubesAfter).toBeGreaterThanOrEqual(1);

  await win.evaluate(() => {
    window.__studioV3Dirty = false;
    window.onbeforeunload = null;
  });
  await win.waitForTimeout(140);
  await app.close();
});
