import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

// Slice 953 — honest Archie tool-call failure.
//
// A model-emitted <tool_call> is legitimate model-derived structure, but Studio
// must not claim it succeeded until the command actually executes. This spec
// feeds Archie an unknown primitive id and proves the chat says the command did
// not execute, no geometry appears, and the real tool error remains visible.

const OUT = path.resolve(__dirname, 'screenshots', 'studio-slice-953-honest-tool-failure');

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

test('Studio slice 953 — failed model tool calls do not get success summaries', async () => {
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
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ choices: [{ message: { content: '[]' } }] }),
      });
    }
    return r.fulfill({
      status: 200,
      headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' },
      body: sseBody('<tool_call>{"name":"click-primitive","arguments":{"id":"diamond"}}</tool_call>'),
    });
  });

  await win.locator('[data-studio-v3-cmdbar-input]').click();
  await win.locator('[data-studio-v3-cmdbar-input]').fill('make a diamond');
  await win.locator('[data-studio-v3-cmdbar-input]').press('Enter');

  await expect(win.locator('[data-studio-v3-archie-msg][data-role="tool"]')).toContainText('unknown primitive "diamond"', { timeout: 30000 });
  await expect(win.locator('[data-studio-v3-archie-msg][data-role="archie"]').last()).toContainText('Studio did not execute it', { timeout: 30000 });

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

  const archieText = await win.locator('[data-studio-v3-archie-msg][data-role="archie"]').last().textContent();
  expect(archieText).not.toMatch(/spawned|Added a/i);

  await win.screenshot({ path: path.join(OUT, 'honest-tool-failure.png') });
  await win.evaluate(() => {
    window.__studioV3Dirty = false;
    window.onbeforeunload = null;
  });
  await win.waitForTimeout(140);
  await app.close();
});
