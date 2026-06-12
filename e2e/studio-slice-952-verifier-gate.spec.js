import { test, expect, _electron as electron } from '@playwright/test';
import path from 'path';

// Slice 952 — B.4 coherence gate, end-to-end against the LIVE
// verifier_q4 adapter (100 % on held-out pairs). The MODEL side is
// mocked (two-shot queue) so the spec deterministically produces a
// degenerate scene; the GATE machinery — body collection, metre
// conversion, verifier call, failure logging, teardown, single
// rebuild — runs for real.
//
//   shot 1: snowman with one ZERO-SCALED sphere  → verifier must flag
//   shot 2: clean snowman                        → verifier must pass
//
// Requires mlx_lm.server on :8080 (any boot adapter — the gate
// hot-swaps to verifier_q4 per request).

const DEGENERATE = [
  '<plan>{"goal":"snowman","bodies":3}</plan>',
  '<tool_call>{"name":"click-discipline","arguments":{"id":"modeling"}}</tool_call>',
  '<tool_call>{"name":"click-primitive","arguments":{"id":"sphere"}}</tool_call>',
  '<tool_call>{"name":"fn","arguments":{"name":"__studioSelectNewest","args":[]}}</tool_call>',
  '<tool_call>{"name":"fn","arguments":{"name":"__studioSelectionApplyTransform","args":[{"position":[0,0.5,0],"scale":[13.89,13.89,13.89]}]}}</tool_call>',
  '<tool_call>{"name":"click-primitive","arguments":{"id":"sphere"}}</tool_call>',
  '<tool_call>{"name":"fn","arguments":{"name":"__studioSelectNewest","args":[]}}</tool_call>',
  '<tool_call>{"name":"fn","arguments":{"name":"__studioSelectionApplyTransform","args":[{"position":[0,1.2,0],"scale":[0,0,0]}]}}</tool_call>',
  '<tool_call>{"name":"click-primitive","arguments":{"id":"sphere"}}</tool_call>',
  '<tool_call>{"name":"fn","arguments":{"name":"__studioSelectNewest","args":[]}}</tool_call>',
  '<tool_call>{"name":"fn","arguments":{"name":"__studioSelectionApplyTransform","args":[{"position":[0,1.75,0],"scale":[6.94,6.94,6.94]}]}}</tool_call>',
].join('\n');

const CLEAN = [
  '<plan>{"goal":"snowman","bodies":3}</plan>',
  '<tool_call>{"name":"click-discipline","arguments":{"id":"modeling"}}</tool_call>',
  '<tool_call>{"name":"click-primitive","arguments":{"id":"sphere"}}</tool_call>',
  '<tool_call>{"name":"fn","arguments":{"name":"__studioSelectNewest","args":[]}}</tool_call>',
  '<tool_call>{"name":"fn","arguments":{"name":"__studioSelectionApplyTransform","args":[{"position":[0,0.5,0],"scale":[13.89,13.89,13.89]}]}}</tool_call>',
  '<tool_call>{"name":"click-primitive","arguments":{"id":"sphere"}}</tool_call>',
  '<tool_call>{"name":"fn","arguments":{"name":"__studioSelectNewest","args":[]}}</tool_call>',
  '<tool_call>{"name":"fn","arguments":{"name":"__studioSelectionApplyTransform","args":[{"position":[0,1.2,0],"scale":[9.72,9.72,9.72]}]}}</tool_call>',
  '<tool_call>{"name":"click-primitive","arguments":{"id":"sphere"}}</tool_call>',
  '<tool_call>{"name":"fn","arguments":{"name":"__studioSelectNewest","args":[]}}</tool_call>',
  '<tool_call>{"name":"fn","arguments":{"name":"__studioSelectionApplyTransform","args":[{"position":[0,1.75,0],"scale":[6.94,6.94,6.94]}]}}</tool_call>',
].join('\n');

test('Studio slice 952 — coherence gate flags zero-scale, rebuilds once, passes', async () => {
  test.setTimeout(300000);
  const app = await electron.launch({
    args: [path.join(__dirname, '..', 'electron', 'main.js'), '--dev'],
    slowMo: Number(process.env.STUDIO_SLOWMO) || 120,
  });
  const win = await app.firstWindow();
  win.on('dialog', (d) => { d.dismiss().catch(() => {}); });
  await win.waitForLoadState('domcontentloaded');
  await win.evaluate(() => {
    window.localStorage.setItem('studio.v3.tour-seen', '1');
    try { window.sessionStorage.setItem('studio.v3.splash-shown', '1'); } catch (_) {}
  });
  await win.reload();
  await expect(win.locator('[data-studio-v3-shell]')).toBeVisible({ timeout: 15000 });
  await win.waitForTimeout(600);

  await win.evaluate(([deg, clean]) => {
    let n = 0;
    window.__studioArchieMock = () => (n++ === 0 ? deg : clean);
  }, [DEGENERATE, CLEAN]);

  await win.locator('[data-studio-v3-cmdbar-input]').click();
  await win.locator('[data-studio-v3-cmdbar-input]').fill('build a snowman');
  await win.locator('[data-studio-v3-cmdbar-input]').press('Enter');

  // Gate: dispatch (~2 s) + verifier hot-swap call (~5-20 s) + teardown
  // + rebuild + second verify.
  const deadline = Date.now() + 180000;
  let msgs = [];
  while (Date.now() < deadline) {
    msgs = await win.evaluate(() =>
      Array.from(document.querySelectorAll('[data-studio-v3-archie-msg]'))
        .map((el) => (el.textContent || '').trim()));
    if (msgs.some((m) => m.includes('[verifier] coherent'))) break;
    await win.waitForTimeout(1500);
  }
  for (const m of msgs.slice(-12)) console.log(m.slice(0, 120));

  const joined = msgs.join(' | ');
  expect(joined, 'gate must flag the zero-scaled body').toContain('[verifier] incoherent');
  expect(joined, 'gate must announce the single rebuild').toContain('rebuilding once');
  expect(joined, 'rebuild must pass verification').toContain('[verifier] coherent ✓');

  // Failed bodies torn down: exactly the clean build's 3 spheres remain.
  const prims = await win.evaluate(() => {
    const s = window.__archdiscScene || (window.__archdiscViewport && window.__archdiscViewport.scene);
    let n = 0;
    if (s) s.traverse((o) => { if (o?.userData?.archdiscStudioPrimitive) n++; });
    return n;
  });
  expect(prims, 'degenerate bodies must be removed before the rebuild').toBe(3);

  await win.evaluate(() => { window.__studioV3Dirty = false; window.onbeforeunload = null; });
  await app.close();
});
