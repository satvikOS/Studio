import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

// Slice 948 — Archie model wiring.
//
// Verifies that the cmdbar's NL path:
//   1. Calls Archie (localhost:8080 + foundational_studio adapter) — or
//      the window.__studioArchieMock if set
//   2. Renders the streamed-in user-visible reply as an "archie" message
//   3. Extracts <tool_call> tags from the reply
//   4. Dispatches each tool call against the V3 surface
//   5. Pushes a tool message per call with the success / failure summary
//
// We mock Archie via window.__studioArchieMock so the test runs
// deterministically without a live MLX server. The mock returns a known
// plan that switches discipline, spawns a cube, and switches back.

const OUT = path.resolve(__dirname, 'screenshots', 'studio-slice-948-archie-wiring');

test('Studio slice 948 — Archie wiring drives the platform via NL', async () => {
  test.setTimeout(240000);
  fs.mkdirSync(OUT, { recursive: true });

  const app = await electron.launch({
    args: [path.join(__dirname, '..', 'electron', 'main.js'), '--dev'],
    slowMo: Number(process.env.STUDIO_SLOWMO) || 260,
  });
  const win = await app.firstWindow();
  win.on('dialog', (d) => { d.dismiss().catch(() => {}); });
  await win.waitForLoadState('domcontentloaded');

  await win.evaluate(() => {
    window.localStorage.removeItem('studio.v3.accent');
    window.localStorage.setItem('studioV3Theme', 'dark');
    try { window.sessionStorage.setItem('studio.v3.splash-shown', '1'); } catch (_) {}
  });
  await win.reload();
  await win.waitForLoadState('domcontentloaded');
  await expect(win.locator('[data-studio-v3-shell]')).toBeVisible({ timeout: 15000 });
  await win.waitForTimeout(400);

  // Inject the deterministic Archie mock. The mock proves the wiring
  // calls runArchie + parses tool_call tags + dispatches them.
  await win.evaluate(() => {
    window.__studioArchieReceived = [];
    window.__studioArchieMock = (text) => {
      window.__studioArchieReceived.push(text);
      return [
        "I'll switch to the Model discipline and spawn a unit cube.",
        '<tool_call>{"name":"click-discipline","arguments":{"id":"model"}}</tool_call>',
        '<tool_call>{"name":"click-primitive","arguments":{"id":"cube"}}</tool_call>',
      ].join('\n');
    };
  });

  // CAM 1 — pre-prompt state, empty scene, no Archie overlay.
  await win.screenshot({ path: path.join(OUT, '01-pre-prompt.png') });

  // 2. Submit a natural-language prompt.
  await win.locator('[data-studio-v3-cmdbar-input]').click();
  await win.locator('[data-studio-v3-cmdbar-input]').fill('Make me a unit cube please');
  await win.waitForTimeout(160);
  await win.locator('[data-studio-v3-cmdbar-input]').press('Enter');
  // Allow Archie + tool execution to settle (mock is sync, tool execution
  // dispatches DOM clicks that re-render).
  await win.waitForTimeout(800);

  // 3. Mock received the user text.
  const received = await win.evaluate(() => window.__studioArchieReceived || []);
  expect(received).toContain('Make me a unit cube please');

  // 4. Overlay opened automatically; an archie + tool messages render.
  await expect(win.locator('[data-studio-v3-archie-overlay]')).toBeVisible();
  const msgRoles = await win.evaluate(() => Array.from(
    document.querySelectorAll('[data-studio-v3-archie-msg]')
  ).map((el) => el.getAttribute('data-role')));
  // Expected sequence: user, archie (reply), tool (click-discipline), tool (click-primitive)
  expect(msgRoles[0]).toBe('user');
  expect(msgRoles).toContain('archie');
  expect(msgRoles.filter((r) => r === 'tool').length).toBeGreaterThanOrEqual(2);
  await win.screenshot({ path: path.join(OUT, '02-after-prompt-overlay-open.png') });

  // 5. Tool dispatch SIDE EFFECTS — Model discipline active + a cube
  //    primitive present in the scene.
  const activeWb = await win.evaluate(() => {
    const a = document.querySelector('[data-studio-v3-wb][data-active="true"]');
    return a ? a.getAttribute('data-studio-v3-wb') : null;
  });
  expect(activeWb).toBe('model');

  const cubeCount = await win.evaluate(() => {
    const scene = window.__archdiscScene
      || (window.__archdiscViewport && window.__archdiscViewport.scene);
    if (!scene) return 0;
    let n = 0;
    scene.traverse((o) => {
      if (o && o.userData && o.userData.archdiscStudioPrimitive
          && o.userData.archdiscStudioPrimitiveKind === 'cube') n++;
    });
    return n;
  });
  expect(cubeCount).toBeGreaterThanOrEqual(1);
  await win.screenshot({ path: path.join(OUT, '03-cube-spawned.png') });

  // 6. Direct-call path STILL works in parallel — proves the NL path
  //    didn't break the existing studioFoo direct dispatch.
  await win.locator('[data-studio-v3-cmdbar-input]').click();
  await win.locator('[data-studio-v3-cmdbar-input]').fill('studioListSceneStats');
  await win.locator('[data-studio-v3-cmdbar-input]').press('Enter');
  await win.waitForTimeout(280);
  const lastToolText = await win.evaluate(() => {
    const items = Array.from(document.querySelectorAll('[data-studio-v3-archie-msg][data-role="tool"]'));
    return items.length ? items[items.length - 1].textContent : '';
  });
  expect(lastToolText).toContain('_studioListSceneStats');
  await win.screenshot({ path: path.join(OUT, '04-direct-call-still-works.png') });

  // 7. Failure path — mock returns an unknown tool name. Wiring should
  //    push a FAIL tool message without crashing the overlay.
  await win.evaluate(() => {
    window.__studioArchieMock = () => 'Trying a bogus call.\n<tool_call>{"name":"click-action","arguments":{"id":"this-action-does-not-exist"}}</tool_call>';
  });
  await win.locator('[data-studio-v3-cmdbar-input]').click();
  await win.locator('[data-studio-v3-cmdbar-input]').fill('do the impossible');
  await win.locator('[data-studio-v3-cmdbar-input]').press('Enter');
  await win.waitForTimeout(500);
  const failText = await win.evaluate(() => {
    const items = Array.from(document.querySelectorAll('[data-studio-v3-archie-msg][data-role="tool"]'));
    return items.length ? items[items.length - 1].textContent : '';
  });
  expect(failText).toContain('FAIL');
  expect(failText).toContain('unknown action');
  await win.screenshot({ path: path.join(OUT, '05-fail-path-handled.png') });

  // CAM 6 — switch to Sculpt via NL, verify the discipline tab updates.
  await win.evaluate(() => {
    window.__studioArchieMock = () => 'Switching to Sculpt.\n<tool_call>{"name":"click-discipline","arguments":{"id":"sculpt"}}</tool_call>';
  });
  await win.locator('[data-studio-v3-cmdbar-input]').click();
  await win.locator('[data-studio-v3-cmdbar-input]').fill('go to sculpt');
  await win.locator('[data-studio-v3-cmdbar-input]').press('Enter');
  await win.waitForTimeout(450);
  const activeAfter = await win.evaluate(() => {
    const a = document.querySelector('[data-studio-v3-wb][data-active="true"]');
    return a ? a.getAttribute('data-studio-v3-wb') : null;
  });
  expect(activeAfter).toBe('sculpt');
  await win.screenshot({ path: path.join(OUT, '06-nl-discipline-switch.png') });

  // Final teardown — clear the mock so subsequent specs land on the
  // real path.
  await win.evaluate(() => {
    delete window.__studioArchieMock;
    delete window.__studioArchieReceived;
    window.__studioV3Dirty = false;
    window.onbeforeunload = null;
    window.dispatchEvent(new CustomEvent('studio-autosaved', { detail: { ts: Date.now(), bytes: 0, primitives: 0 } }));
  });
  await win.waitForTimeout(140);
  await app.close();
});
