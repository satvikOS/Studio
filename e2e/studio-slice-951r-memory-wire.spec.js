import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

// Slice 951r — long-session memory wire.
//
// Proves that runArchie:
//   1. Calls /recall before dispatch and injects the returned turns as
//      <prior_context>...</prior_context> in the user message.
//   2. Calls /remember (fire-and-forget) after dispatch with the user
//      prompt and unwrapped assistant content.
//   3. Honours window.__archieMemoryOff as a hard opt-out — no /recall
//      hit, no <prior_context> in the chat body, no /remember either.
//
// All four endpoints (recall + remember + caption + chat) are stubbed
// via Playwright route() so the spec runs without the live Python
// services or mlx_lm.server.

const OUT = path.resolve(__dirname, 'screenshots', 'studio-slice-951r-memory');
const STUB_RECALL_TURNS = [
  { ts: '2026-06-01T12:00:00Z', app: 'studio',
    user_text: 'build a coffee table with cylinder legs',
    assistant_summary: 'spawned 4 cylinders + 1 cube top', score: 0.81 },
  { ts: '2026-06-02T15:30:00Z', app: 'studio',
    user_text: 'add a vase to the table',
    assistant_summary: 'spawned a torus + sphere', score: 0.62 },
];
const STUB_CAPTION = '{"bodies":[],"camera":{"angle_deg":35}}';
const STUB_REPLY = '<plan>{"goal":"new build"}</plan>\n<tool_call>{"name":"click-primitive","arguments":{"id":"cube"}}</tool_call>';

test('Studio slice 951r — recall + remember wired into runArchie', async () => {
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

  // Capture every outgoing request to the memory store + chat.
  let recallHits = 0;
  const rememberPayloads = [];
  const chatBodies = [];
  await win.route('**/recall', async (route) => {
    recallHits++;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ turns: STUB_RECALL_TURNS, ms: 12 }),
    });
  });
  await win.route('**/remember', async (route) => {
    try { rememberPayloads.push(JSON.parse(route.request().postData() || '{}')); } catch (_) {}
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ id: 999, ms: 8 }),
    });
  });
  await win.route('**/caption', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ caption: STUB_CAPTION }),
    });
  });
  await win.route('**/v1/chat/completions', async (route) => {
    try { chatBodies.push(JSON.parse(route.request().postData() || '{}')); } catch (_) {}
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        choices: [{ message: { role: 'assistant', content: STUB_REPLY } }],
      }),
    });
  });
  const findUserMsg = (body, needle) => {
    if (!body || !Array.isArray(body.messages)) return null;
    return body.messages.find((m) => m.role === 'user' && (m.content || '').includes(needle));
  };

  // ─── path 1: memory ON — recall + remember both fire ─────────────────
  chatBodies.length = 0;
  recallHits = 0;
  rememberPayloads.length = 0;
  const PROMPT_1 = 'recreate that coffee table in oak';
  await win.locator('[data-studio-v3-cmdbar-input]').click();
  await win.locator('[data-studio-v3-cmdbar-input]').fill(PROMPT_1);
  await win.locator('[data-studio-v3-cmdbar-input]').press('Enter');

  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    if (chatBodies.some((b) => findUserMsg(b, PROMPT_1))) break;
    await win.waitForTimeout(250);
  }
  // /remember is fire-and-forget so it might land after the chat — give
  // it a beat to arrive.
  await win.waitForTimeout(600);
  await win.screenshot({ path: path.join(OUT, 'after-memory-on.png') });

  expect(recallHits).toBeGreaterThanOrEqual(1);
  const onMsg = chatBodies.map((b) => findUserMsg(b, PROMPT_1)).find(Boolean);
  expect(onMsg).toBeTruthy();
  expect(onMsg.content).toContain('<prior_context>');
  expect(onMsg.content).toContain('coffee table with cylinder legs');
  expect(onMsg.content).toContain(PROMPT_1);
  // Order: prior_context BEFORE viewport_state BEFORE prompt.
  const pcIdx = onMsg.content.indexOf('<prior_context>');
  const promptIdx = onMsg.content.indexOf(PROMPT_1);
  expect(pcIdx).toBeLessThan(promptIdx);

  expect(rememberPayloads.length).toBeGreaterThanOrEqual(1);
  const remembered = rememberPayloads.find((p) => p.user_text === PROMPT_1);
  expect(remembered).toBeTruthy();
  expect(remembered.app).toBe('studio');
  expect(remembered.assistant_summary).toContain('tool_call');

  // ─── path 2: memory OFF — recall + remember both skipped ─────────────
  await win.evaluate(() => { window.__archieMemoryOff = true; });
  chatBodies.length = 0;
  recallHits = 0;
  rememberPayloads.length = 0;
  await win.waitForTimeout(400);
  const PROMPT_2 = 'blind run check';
  await win.locator('[data-studio-v3-cmdbar-input]').click();
  await win.locator('[data-studio-v3-cmdbar-input]').fill(PROMPT_2);
  await win.locator('[data-studio-v3-cmdbar-input]').press('Enter');

  const d2 = Date.now() + 20000;
  while (Date.now() < d2) {
    if (chatBodies.some((b) => findUserMsg(b, PROMPT_2))) break;
    await win.waitForTimeout(250);
  }
  await win.waitForTimeout(600);
  await win.screenshot({ path: path.join(OUT, 'after-memory-off.png') });

  expect(recallHits).toBe(0);
  const offMsg = chatBodies.map((b) => findUserMsg(b, PROMPT_2)).find(Boolean);
  expect(offMsg).toBeTruthy();
  expect(offMsg.content).not.toContain('<prior_context>');
  expect(rememberPayloads.length).toBe(0);

  await win.evaluate(() => {
    window.__studioV3Dirty = false;
    window.onbeforeunload = null;
  });
  await win.waitForTimeout(140);
  await app.close();
});
