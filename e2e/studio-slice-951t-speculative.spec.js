import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

// Slice 951t — speculative tool-call dispatch (Phase F.2).
//
// Proves that when the SSE stream emits multiple <tool_call> blocks,
// runArchie awaits onToolCall per block AND the post-stream tier-1
// dispatch loop dedupes by signature so each call fires exactly once.
//
// We verify two things end-to-end:
//   1. Exactly two primitives spawn in the scene (not four), proving
//      the speculative + post-stream paths don't double-dispatch.
//   2. The Archie overlay contains both tool messages emitted by the
//      speculative dispatch (one per executed call).

const OUT = path.resolve(__dirname, 'screenshots', 'studio-slice-951t-speculative');

const SSE_CHUNKS = [
  { delta: { content: '<plan>{"goal":"two prims"}</plan>\n' } },
  { delta: { content: '<tool_call>{"name":"click-primitive","arguments":{"id":"cube"}}</tool_call>\n' } },
  { delta: { content: '<tool_call>{"name":"click-primitive","arguments":{"id":"sphere"}}</tool_call>' } },
];

function sseBody(chunks) {
  return chunks.map((c) => `data: ${JSON.stringify({ choices: [c] })}\n\n`).join('') + 'data: [DONE]\n\n';
}

test('Studio slice 951t — speculative dispatch fires once per call', async () => {
  test.setTimeout(180000);
  fs.mkdirSync(OUT, { recursive: true });

  const app = await electron.launch({
    args: [path.join(__dirname, '..', 'electron', 'main.js'), '--dev'],
    slowMo: Number(process.env.STUDIO_SLOWMO) || 200,
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
  await win.waitForTimeout(600);

  await win.route('**/caption',  (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ caption: '' }) }));
  await win.route('**/recall',   (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ turns: [] }) }));
  await win.route('**/remember', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id: 1 }) }));
  await win.route('**/v1/chat/completions', (r) => r.fulfill({
    status: 200,
    headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' },
    body: sseBody(SSE_CHUNKS),
  }));

  await win.locator('[data-studio-v3-cmdbar-input]').click();
  await win.locator('[data-studio-v3-cmdbar-input]').fill('spawn a cube and a sphere');
  await win.locator('[data-studio-v3-cmdbar-input]').press('Enter');

  // Wait for both primitives to land.
  const deadline = Date.now() + 25000;
  let count = 0;
  while (Date.now() < deadline) {
    count = await win.evaluate(() => {
      const s = window.__archdiscScene
        || (window.__archdiscViewport && window.__archdiscViewport.scene);
      if (!s) return 0;
      let n = 0;
      s.traverse((o) => {
        if (o && o.userData && o.userData.archdiscStudioPrimitive) n++;
      });
      return n;
    });
    if (count >= 2) break;
    await win.waitForTimeout(200);
  }
  await win.waitForTimeout(600);
  await win.screenshot({ path: path.join(OUT, 'after-spec-dispatch.png') });

  // Exactly 2 primitives — no double-spawn from the post-stream loop.
  expect(count).toBe(2);

  // Both tool messages should be in the thread (one per executed call).
  const toolMsgCount = await win.evaluate(() => {
    return document.querySelectorAll('[data-studio-v3-archie-msg][data-role="tool"]').length;
  });
  expect(toolMsgCount).toBeGreaterThanOrEqual(2);

  await win.evaluate(() => {
    window.__studioV3Dirty = false;
    window.onbeforeunload = null;
  });
  await win.waitForTimeout(140);
  await app.close();
});
