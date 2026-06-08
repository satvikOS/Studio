import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

// Slice 955 — honest second-pass decomposer failure.
//
// If Archie's first response is non-dispatchable prose and the model-driven
// decomposer pass fails, Studio must surface that real decomposer failure.
// A generic "try naming the parts" message hides the failed model subsystem and
// makes the user debug blind.

const OUT = path.resolve(__dirname, 'screenshots', 'studio-slice-955-honest-decomposer-failure');

function sseBody(text) {
  return `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n` + 'data: [DONE]\n\n';
}

async function bootStudio(win) {
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
}

test('Studio slice 955 — decomposer pass failures are visible, not generic', async () => {
  test.setTimeout(180000);
  fs.mkdirSync(OUT, { recursive: true });

  const app = await electron.launch({
    args: [path.join(__dirname, '..', 'electron', 'main.js')],
    slowMo: Number(process.env.STUDIO_SLOWMO) || 600,
  });

  let win = null;
  for (let i = 0; i < 30 && !win; i++) {
    win = app.windows().find((w) => {
      const u = (() => { try { return w.url(); } catch (_) { return ''; } })();
      return u && !u.startsWith('devtools://');
    }) || null;
    if (!win) await new Promise((r) => setTimeout(r, 500));
  }
  if (!win) win = await app.firstWindow();
  await bootStudio(win);

  await win.route('**/caption',  (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ caption: '' }) }));
  await win.route('**/recall',   (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ turns: [] }) }));
  await win.route('**/remember', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id: 1 }) }));
  await win.route('**/v1/chat/completions', async (r) => {
    const body = r.request().postDataJSON();
    const system = body?.messages?.[0]?.content || '';
    if (/primitive decomposer/i.test(system)) {
      return r.fulfill({
        status: 500,
        contentType: 'text/plain',
        body: 'decomposer adapter missing',
      });
    }
    return r.fulfill({
      status: 200,
      headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' },
      body: sseBody('I can make that scene, but I did not emit a tool call.'),
    });
  });

  await win.locator('[data-studio-v3-cmdbar-input]').click();
  await win.locator('[data-studio-v3-cmdbar-input]').fill('make a moon rover');
  await win.locator('[data-studio-v3-cmdbar-input]').press('Enter');

  const archie = win.locator('[data-studio-v3-archie-msg][data-role="archie"]').last();
  await expect(archie).toContainText('second-pass decomposer failed', { timeout: 30000 });
  await expect(archie).toContainText('decomposer adapter missing', { timeout: 30000 });

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
  expect(count).toBe(0);

  const archieText = await archie.textContent();
  expect(archieText).not.toMatch(/try naming the parts/i);
  expect(archieText).not.toMatch(/Added a|spawned/i);

  await win.screenshot({ path: path.join(OUT, 'honest-decomposer-failure.png') });
  await win.evaluate(() => {
    window.__studioV3Dirty = false;
    window.onbeforeunload = null;
  });
  await win.waitForTimeout(140);
  await app.close();
});
