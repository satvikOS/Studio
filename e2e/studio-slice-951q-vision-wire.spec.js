import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

// Slice 951q — viewport perception wire.
//
// Proves that runArchie captures the live canvas, captions it via the
// local VL server on :8081, and injects the structured caption into the
// outgoing chat request as <viewport_state>...</viewport_state>.
//
// Both endpoints are stubbed via Playwright route() so the spec runs
// without the Qwen2.5-VL server or mlx_lm.server being up — the contract
// we verify is that the WIRE is intact end to end.
//
// Captures five named camera angles (front / top / right / iso / close)
// of a known cube blockout — remote-desktop verification per
// [[feedback-forge-multicam-e2e]].

const OUT = path.resolve(__dirname, 'screenshots', 'studio-slice-951q-vision');
const STUB_CAPTION = '{"bodies":[{"kind":"cube","color_hex":"#cc9966"}],"lighting":{"kind":"directional"},"camera":{"angle_deg":35,"framing":"iso"}}';
const STUB_REPLY = '<think>Cube already there. Spawn a sphere on top.</think>\n<plan>{"goal":"stack sphere"}</plan>\n<tool_call>{"name":"click-primitive","arguments":{"id":"sphere"}}</tool_call>';

const ANGLES = [
  { name: 'front', pos: [0, 0, 5] },
  { name: 'top',   pos: [0, 5, 0.001] },
  { name: 'right', pos: [5, 0, 0] },
  { name: 'iso',   pos: [3, 3, 3] },
  { name: 'close', pos: [1.5, 1.2, 1.5] },
];

test('Studio slice 951q — viewport caption reaches runArchie chat payload', async () => {
  test.setTimeout(180000);
  fs.mkdirSync(OUT, { recursive: true });

  const app = await electron.launch({
    args: [path.join(__dirname, '..', 'electron', 'main.js'), '--dev'],
    slowMo: Number(process.env.STUDIO_SLOWMO) || 220,
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
  await win.waitForTimeout(700);

  // Capture EVERY outgoing chat payload (runArchie + decomposer fallback)
  // so we can inspect the full set of what Archie sees on each turn.
  const chatBodies = [];
  let visionHit = 0;
  await win.route('**/caption', async (route) => {
    visionHit++;
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

  // Spawn a cube via the slice 457 helper so the canvas has visible geometry.
  await win.evaluate(() => {
    const s = window.__archdiscScene
      || (window.__archdiscViewport && window.__archdiscViewport.scene);
    if (s && typeof window.__spawnPrimitive === 'function') window.__spawnPrimitive('cube', s);
  });
  await win.waitForTimeout(400);

  // ─── multi-cam proof: 5 angles of the cube blockout ──────────────────
  for (const a of ANGLES) {
    await win.evaluate(({ pos }) => {
      const vp = window.__archdiscViewport;
      if (!vp || !vp.camera) return;
      vp.camera.position.set(pos[0], pos[1], pos[2]);
      vp.camera.lookAt(0, 0, 0);
      vp.camera.updateMatrixWorld(true);
      if (vp.renderer && vp.scene) vp.renderer.render(vp.scene, vp.camera);
    }, { pos: a.pos });
    await win.waitForTimeout(280);
    await win.screenshot({ path: path.join(OUT, `cam-${a.name}.png`) });
  }

  // ─── path 1: vision ON — the caption must land in the chat body ──────
  chatBodies.length = 0;
  visionHit = 0;
  const PROMPT_1 = 'add a sphere on top of the cube';
  await win.locator('[data-studio-v3-cmdbar-input]').click();
  await win.locator('[data-studio-v3-cmdbar-input]').fill(PROMPT_1);
  await win.locator('[data-studio-v3-cmdbar-input]').press('Enter');

  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    if (chatBodies.some((b) => findUserMsg(b, PROMPT_1))) break;
    await win.waitForTimeout(250);
  }
  await win.screenshot({ path: path.join(OUT, 'after-vision-on.png') });

  expect(visionHit).toBeGreaterThanOrEqual(1);
  const onMsg = chatBodies.map((b) => findUserMsg(b, PROMPT_1)).find(Boolean);
  expect(onMsg).toBeTruthy();
  expect(onMsg.content).toContain('<viewport_state>');
  expect(onMsg.content).toContain(STUB_CAPTION);
  expect(onMsg.content).toContain(PROMPT_1);

  // ─── path 2: vision OFF — opt-out must skip the caption entirely ─────
  await win.evaluate(() => { window.__studioArchieVisionOff = true; });
  chatBodies.length = 0;
  visionHit = 0;
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
  await win.screenshot({ path: path.join(OUT, 'after-vision-off.png') });

  expect(visionHit).toBe(0);
  const offMsg = chatBodies.map((b) => findUserMsg(b, PROMPT_2)).find(Boolean);
  expect(offMsg).toBeTruthy();
  expect(offMsg.content).not.toContain('<viewport_state>');

  await win.evaluate(() => {
    window.__studioV3Dirty = false;
    window.onbeforeunload = null;
  });
  await win.waitForTimeout(140);
  await app.close();
});
