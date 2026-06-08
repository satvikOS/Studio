import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

// Slice 951u — no keyword/common-noun fallback.
//
// The old tier scanned the USER PROMPT for primitive ids and aliases. That
// made "make a sphere" spawn a sphere even when Archie failed to emit a
// tool_call, plan, quoted click, or decomposer result. This spec proves a
// failed model response is honest: no geometry appears just because the
// prompt contains a primitive word.

const OUT = path.resolve(__dirname, 'screenshots', 'studio-slice-951u-no-keyword-fallback');

function sseBody(text) {
  return `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n` + 'data: [DONE]\n\n';
}

test('Studio slice 951u — prompt keywords do not spawn geometry without model structure', async () => {
  test.setTimeout(180000);
  fs.mkdirSync(OUT, { recursive: true });

  const app = await electron.launch({
    args: [path.join(__dirname, '..', 'electron', 'main.js'), '--dev'],
    slowMo: Number(process.env.STUDIO_SLOWMO) || 600,
  });
  // --dev may auto-open a DevTools window; pick the real app window and
  // reload-retry because Vite + Electron can race the V3 bootstrap.
  let win = null;
  for (let i = 0; i < 30 && !win; i++) {
    win = app.windows().find((w) => {
      const u = (() => { try { return w.url(); } catch (_) { return ''; } })();
      return u && !u.startsWith('devtools://');
    }) || null;
    if (!win) await new Promise((r) => setTimeout(r, 500));
  }
  if (!win) win = await app.firstWindow();
  win.on('dialog', (d) => { d.dismiss().catch(() => {}); });
  await win.waitForLoadState('domcontentloaded');

  await win.evaluate(() => {
    window.localStorage.setItem('studioV3', '1');
    window.localStorage.setItem('studio.v3.tour-seen', '1');
    window.localStorage.setItem('studioV3Theme', 'dark');
    try { window.sessionStorage.setItem('studio.v3.splash-shown', '1'); } catch (_) {}
  });
  let shellUp = false;
  for (let attempt = 0; attempt < 4 && !shellUp; attempt++) {
    await win.reload();
    await win.waitForLoadState('domcontentloaded');
    await win.waitForTimeout(1500);
    try {
      await expect(win.locator('[data-studio-v3-shell]')).toBeVisible({ timeout: 40000 });
      shellUp = true;
    } catch (_) { /* retry */ }
  }
  expect(shellUp).toBe(true);
  await win.waitForFunction(() => !!window.__archdiscScene, null, { timeout: 30000 });

  await win.route('**/caption',  (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ caption: '' }) }));
  await win.route('**/recall',   (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ turns: [] }) }));
  await win.route('**/remember', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id: 1 }) }));
  await win.route('**/v1/chat/completions', async (r) => {
    const body = r.request().postDataJSON();
    const system = body?.messages?.[0]?.content || '';
    if (/primitive decomposer/i.test(system)) {
      return r.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ choices: [{ message: { content: 'I cannot decompose this without a clear plan.' } }] }),
      });
    }
    return r.fulfill({
      status: 200,
      headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' },
      body: sseBody('I understand you asked for a sphere, cylinder, and chair leg, but I am not emitting any dispatch protocol here.'),
    });
  });

  await win.locator('[data-studio-v3-cmdbar-input]').click();
  await win.locator('[data-studio-v3-cmdbar-input]').fill('make a sphere and a cylinder chair leg');
  await win.locator('[data-studio-v3-cmdbar-input]').press('Enter');

  await win.waitForTimeout(4000);
  const count = await win.evaluate(() => {
    const s = window.__archdiscScene
      || (window.__archdiscViewport && window.__archdiscViewport.scene);
    if (!s) return 0;
    let n = 0;
    s.traverse((o) => {
      if (o && o.userData && o.userData.archdiscStudioPrimitive) n++;
    });
    return n;
  });

  await win.screenshot({ path: path.join(OUT, 'honest-no-geometry.png') });
  expect(count).toBe(0);

  const toolMsgCount = await win.evaluate(() => {
    return document.querySelectorAll('[data-studio-v3-archie-msg][data-role="tool"]').length;
  });
  expect(toolMsgCount).toBe(0);

  const archieText = await win.locator('[data-studio-v3-archie-msg][data-role="archie"]').last().textContent();
  expect(archieText).toContain('sphere');

  await win.evaluate(() => {
    window.__studioV3Dirty = false;
    window.onbeforeunload = null;
  });
  await win.waitForTimeout(140);
  await app.close();
});
