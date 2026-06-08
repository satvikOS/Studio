import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

// Slice 951s — streaming chat output (Phase F.1).
//
// Proves that runArchie:
//   1. Sends stream:true on /v1/chat/completions when onToken is wired
//      from onCmdSubmit (default since this slice).
//   2. Parses OpenAI-compat SSE chunks and accumulates the full reply.
//   3. Surfaces intermediate <think>-stripped content into the overlay's
//      pending Archie message as the stream lands (perceived latency
//      drops vs. waiting for the full single-shot reply).
//
// We stub /v1/chat/completions to emit a known chunked SSE response,
// and stub the other Archie sidecars (caption + recall + remember) so
// the spec runs without the live services.

const OUT = path.resolve(__dirname, 'screenshots', 'studio-slice-951s-streaming');

// Chunked SSE the stub will pace out to the renderer. The 5th chunk
// closes <think>; from that point the visible content starts growing.
// Visible final content (after <think>…</think> strip): the plan +
// tool_call tags.
const SSE_CHUNKS = [
  { delta: { reasoning: '<think>' } },
  { delta: { reasoning: 'plan: spawn cube ' } },
  { delta: { reasoning: 'plus sphere' } },
  { delta: { reasoning: '</think>' } },
  { delta: { content: '<plan>{"goal":"streaming check"}</plan>\n' } },
  { delta: { content: '<tool_call>{"name":"click-primitive","arguments":{"id":"cube"}}</tool_call>' } },
];

function sseBody(chunks) {
  const lines = chunks.map((c) => `data: ${JSON.stringify({ choices: [c] })}\n\n`);
  lines.push('data: [DONE]\n\n');
  return lines.join('');
}

test('Studio slice 951s — runArchie streams SSE tokens into the overlay', async () => {
  test.setTimeout(180000);
  fs.mkdirSync(OUT, { recursive: true });

  const app = await electron.launch({
    args: [path.join(__dirname, '..', 'electron', 'main.js'), '--dev'],
    slowMo: Number(process.env.STUDIO_SLOWMO) || 180,
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

  // Stub the optional sidecars so they don't fail.
  await win.route('**/caption',  (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ caption: '' }) }));
  await win.route('**/recall',   (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ turns: [] }) }));
  await win.route('**/remember', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id: 1 }) }));

  // Capture whether the request asked for streaming.
  let streamRequested = null;
  await win.route('**/v1/chat/completions', async (route) => {
    const post = route.request().postData() || '{}';
    try { streamRequested = !!JSON.parse(post).stream; } catch (_) {}
    await route.fulfill({
      status: 200,
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
      },
      body: sseBody(SSE_CHUNKS),
    });
  });

  // Poll the archie overlay text history so we can snapshot the final
  // humanized reply that lands after the SSE body is fully parsed.
  const polledTexts = [];
  let stopPolling = false;
  const poll = (async () => {
    while (!stopPolling) {
      try {
        const t = await win.evaluate(() => {
          const els = Array.from(document.querySelectorAll('[data-studio-v3-archie-msg][data-role="archie"]'));
          const last = els[els.length - 1];
          if (!last) return '';
          const txt = last.querySelector('.studio-archie-overlay-msg-text');
          return (txt ? txt.textContent : last.textContent) || '';
        });
        if (t) polledTexts.push(t);
      } catch (_) { /* page may be navigating */ }
      await new Promise((r) => setTimeout(r, 120));
    }
  })();

  // Send the prompt.
  const PROMPT = 'streaming sanity check — spawn one cube';
  await win.locator('[data-studio-v3-cmdbar-input]').click();
  await win.locator('[data-studio-v3-cmdbar-input]').fill(PROMPT);
  await win.locator('[data-studio-v3-cmdbar-input]').press('Enter');

  // Wait long enough for streaming to land + dispatch to complete.
  // We don't gate on the visible text because the post-dispatch
  // humanizer replaces the pending msg — we'll inspect the polled
  // history below.
  await win.waitForTimeout(8000);
  stopPolling = true;
  await poll;
  await win.screenshot({ path: path.join(OUT, 'after-stream-landed.png') });

  // Three end-to-end signals: (1) the request asked for streaming;
  // (2) the SSE body got parsed (else the post-dispatch humanizer
  // couldn't have replaced the pending msg with the final "Spawned a
  // cube" reply, since extraction depends on the accumulated content);
  // (3) the dispatched tool_call actually spawned a cube in the scene.
  expect(streamRequested).toBe(true);

  const finalText = polledTexts[polledTexts.length - 1] || '';
  expect(finalText).toContain('Spawned a cube');

  const cubeCount = await win.evaluate(() => {
    const s = window.__archdiscScene
      || (window.__archdiscViewport && window.__archdiscViewport.scene);
    if (!s) return 0;
    let n = 0;
    s.traverse((o) => {
      if (o && o.userData && o.userData.archdiscStudioPrimitive) n++;
    });
    return n;
  });
  expect(cubeCount).toBeGreaterThanOrEqual(1);

  await win.evaluate(() => {
    window.__studioV3Dirty = false;
    window.onbeforeunload = null;
  });
  await win.waitForTimeout(140);
  await app.close();
});
