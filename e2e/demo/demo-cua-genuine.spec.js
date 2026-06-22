// ─────────────────────────────────────────────────────────────────────────────
// GENUINE-CUA CAPTURE — the LIVE TRAINED MODEL drives Studio's UI end-to-end.
//
// This is NOT a re-implementation of executeToolCall in the page (that's what
// demo-studio-cua-photoreal.spec.js does, to prove the op surface deterministically).
// Here the spec does the ONE thing only the real model can do:
//
//   1. launch the headed Electron app,
//   2. open the Archie console,
//   3. TYPE a complex prompt into the real chat input,  ← the video STARTS here
//   4. press Enter, and then DO NOTHING but watch —
//   5. the live console (StudioShellV3.runArchie → :8080 → the trained adapter)
//      streams <tool_call>s; the shell's own onToolCall dispatches each one via
//      the real executeToolCall (genuine DOM clicks on the Asset/Construct
//      libraries + render control); the scene populates, discipline tabs switch,
//      a character appears, an HDRI sky loads, the animation plays, and the
//      path-traced render is requested — ALL by the model.
//   6. capture viewport frames THROUGHOUT (from the typed prompt onward),
//   7. harvest the final path-traced render (window.__studioLastRender),
//   8. ffmpeg the frames → cua-genuine-human-city.mp4.
//
// Because the MODEL is in the loop, the exact ops vary run to run — so this spec
// asserts on OUTCOMES (scene grew, a render was produced), logs EVERY tool_call
// the model emitted (read from the live thread DOM the shell writes per dispatch),
// and is GENEROUS on timeouts. It requires a live serve on :8080 with the
// genuine-CUA adapter (archdisc-Models/serve_studio_cua.sh). With no serve the
// runArchie fetch fails and the test reports an honest skip-like failure — it is
// NOT a deterministic CI test, it is the demo-capture harness.
//
// Configurable via env:
//   STUDIO_CUA_PROMPT   — the prompt typed into the chat (default: soldier/city).
//   STUDIO_CUA_ADAPTER  — informational only; the served adapter is whatever
//                         serve_studio_cua.sh / _archieAdapterPath route. Logged
//                         so the capture records which fold drove it.
//   STUDIO_CUA_BUILD_MS — how long to watch the model build before forcing the
//                         close-out (default 360000 = 6 min).
//   STUDIO_CUA_OUT      — output basename (default cua-genuine-human-city).
//
// Loads the BUILT dist headed in Electron (mirrors demo-studio-cua-photoreal +
// demo-cua-pipeline-video). Run:
//   npx playwright test e2e/demo/demo-cua-genuine.spec.js --project=chromium
// ─────────────────────────────────────────────────────────────────────────────
import { test, _electron as electron } from '@playwright/test';
import { expect } from '@playwright/test';
import path from 'path';
import fs from 'fs';
import { execSync } from 'child_process';

const OUT_NAME = process.env.STUDIO_CUA_OUT || 'cua-genuine-human-city';
const OUT = path.resolve(__dirname, 'shots', 'studio', 'flagship');
const FR = path.join(OUT, `${OUT_NAME}-frames`);

const PROMPT = process.env.STUDIO_CUA_PROMPT
  || 'A soldier runs across a sunlit downtown intersection — build the city, drop him in, '
   + 'set a clear daytime sky, animate the run, and render it cinematically';
const ADAPTER_LABEL = process.env.STUDIO_CUA_ADAPTER
  || 'adapters/archie/hermes_studio/cua-realassets-20260618';
const BUILD_MS = Number(process.env.STUDIO_CUA_BUILD_MS || 360000); // 6 min watch window

test('GENUINE-CUA — type a prompt → live trained model drives Studio → render → mp4', async () => {
  // Very generous: launch + cold adapter swap + a long real-asset trace
  // (construct + character + HDRI + props + animation + path trace) + ffmpeg.
  test.setTimeout(20 * 60 * 1000);
  fs.rmSync(FR, { recursive: true, force: true });
  fs.mkdirSync(FR, { recursive: true });
  fs.mkdirSync(OUT, { recursive: true });

  console.log(`[cua-genuine] adapter (routed by the live console): ${ADAPTER_LABEL}`);
  console.log(`[cua-genuine] prompt: ${PROMPT}`);

  // ── launch headed Electron on the built dist ───────────────────────────────
  const app = await electron.launch({
    args: [path.join(__dirname, '..', '..', 'electron', 'main.js')],
    slowMo: 30,
  });
  let win = await app.firstWindow();
  if (win.url().startsWith('devtools://')) {
    win = (await app.windows()).find((w) => !w.url().startsWith('devtools://'))
      || await app.waitForEvent('window', { predicate: (w) => !w.url().startsWith('devtools://') });
  }
  win.on('dialog', (d) => d.dismiss().catch(() => {}));
  // surface the page console so the model's [studio]/dispatch logs land in our log
  win.on('console', (msg) => {
    const t = msg.text();
    if (/tool_call|dispatch|archie|cua|render|construct|import-character|set-environment|play-animation/i.test(t)) {
      console.log(`[page] ${t}`);
    }
  });
  await win.waitForLoadState('domcontentloaded');
  await win.evaluate(() => {
    try {
      window.localStorage.setItem('studio.v3.tour-seen', '1');
      window.sessionStorage.setItem('studio.v3.splash-shown', '1');
    } catch (_) {}
  }).catch(() => {});
  await win.reload().catch(() => {});
  await expect(win.locator('[data-studio-v3-shell]')).toBeVisible({ timeout: 30000 });
  // the real chat input must be mounted before we type.
  await expect(win.locator('[data-studio-v3-cmdbar-input]')).toBeVisible({ timeout: 20000 });
  // give the asset libraries a beat to register their window-exposed sets so the
  // model's construct/import/set-environment ops resolve against live lists.
  // Only __studioConstructSubjects + __studioFurnitureTypes are exposed on window
  // (character/HDRI/prop ids live in the realCharacter module and are validated
  // inside executeToolCall against the imported consts), so we gate on those two.
  await win.waitForFunction(
    () => Array.isArray(window.__studioConstructSubjects)
       && Array.isArray(window.__studioFurnitureTypes),
    { timeout: 25000 },
  ).catch(() => {});
  await win.waitForTimeout(600);

  // ── frame recorder ─────────────────────────────────────────────────────────
  let fi = 0;
  const shot = async (tag) => {
    try { await win.screenshot({ path: path.join(FR, `f-${String(fi++).padStart(4, '0')}.png`) }); }
    catch (_) { /* a transient nav during a heavy op must not kill the capture */ }
    if (tag) console.log(`[cua-genuine] frame ${fi - 1} :: ${tag}`);
  };

  // ── live signals (read-only) ───────────────────────────────────────────────
  // scene body count (primitives + real assets — anything the model added).
  const sceneCount = () => win.evaluate(() => {
    const s = window.__archdiscScene || (window.__archdiscViewport && window.__archdiscViewport.scene);
    if (!s) return 0;
    let n = 0;
    s.traverse((o) => {
      if (!o || !o.userData) return;
      if (o.userData.archdiscStudioPrimitive || o.userData.archdiscRealMaterial || o.isSkinnedMesh) n++;
    });
    return n;
  });
  // did a real character / placed group land?
  const sceneSignals = () => win.evaluate(() => {
    const s = window.__archdiscScene || (window.__archdiscViewport && window.__archdiscViewport.scene);
    let skinned = 0; let realBodies = 0;
    if (s) s.traverse((o) => {
      if (o && o.isSkinnedMesh) skinned++;
      if (o && o.userData && o.userData.archdiscRealMaterial) realBodies++;
    });
    return {
      skinned,
      realBodies,
      placedGroup: !!(window.__studioLastPlacedGroup && window.__studioLastPlacedGroup.parent),
      lastRender: !!(window.__studioLastRender && window.__studioLastRender.dataUrl),
    };
  });
  // The shell pushes a `tool` role message to the Archie thread per dispatched
  // tool_call (humanized). We read those straight off the live overlay DOM so we
  // can log EXACTLY which ops the model drove — proof the model is in the loop.
  const toolMessages = () => win.evaluate(() => Array.from(
    document.querySelectorAll('[data-studio-v3-archie-msg][data-role="tool"] .studio-archie-overlay-msg-text'),
  ).map((el) => (el.textContent || '').trim()).filter(Boolean));
  const archieMessages = () => win.evaluate(() => Array.from(
    document.querySelectorAll('[data-studio-v3-archie-msg][data-role="archie"] .studio-archie-overlay-msg-text'),
  ).map((el) => (el.textContent || '').trim()).filter(Boolean));

  // ── (1) hold on the empty viewport so the video opens clean ─────────────────
  for (let i = 0; i < 5; i++) { await shot(i === 0 ? 'empty viewport' : null); await win.waitForTimeout(150); }

  // ── (2) THE VIDEO STARTS ON THE TYPED PROMPT ───────────────────────────────
  // Focus the real chat input, type the prompt visibly (so the capture shows the
  // human authoring it), capture frames during the type, then press Enter.
  const input = win.locator('[data-studio-v3-cmdbar-input]');
  await input.click();
  // type in a few chunks, snapping frames between, so the typed prompt is the
  // unmistakable opening of the deliverable.
  const chunks = PROMPT.match(/.{1,18}(\s|$)/g) || [PROMPT];
  for (const c of chunks) {
    await input.type(c, { delay: 14 });
    await shot('typing prompt');
  }
  await shot('prompt typed — about to submit');
  await input.press('Enter');
  console.log('[cua-genuine] prompt submitted — handing the wheel to the live model.');

  // ── (3) WATCH THE MODEL DRIVE ──────────────────────────────────────────────
  // Poll for model-driven UI changes and capture frames throughout. The
  // COMPLETION CONDITION (the model "finished driving") is:
  //   • a render was produced (window.__studioLastRender.dataUrl is set), OR
  //   • the scene grew AND has been STABLE for a sustained window AND Archie has
  //     posted its final assistant reply (the per-turn humanized summary the
  //     shell writes once all tool_calls are dispatched).
  // We log every NEW tool message as it appears so the console shows the model
  // driving step by step.
  const tStart = Date.now();
  let lastCount = -1;
  let stableMs = 0;
  let seenTools = 0;
  let renderDone = false;
  let archieReplied = false;
  let peakCount = 0;

  while (Date.now() - tStart < BUILD_MS) {
    await win.waitForTimeout(500);
    await shot(null);

    // log newly-dispatched tool_calls (the model driving).
    const tools = await toolMessages();
    if (tools.length > seenTools) {
      for (let i = seenTools; i < tools.length; i++) {
        console.log(`[cua-genuine] TOOL_CALL #${i + 1} :: ${tools[i]}`);
      }
      seenTools = tools.length;
    }

    const sig = await sceneSignals();
    const n = await sceneCount();
    if (n > peakCount) peakCount = n;
    if (n === lastCount) stableMs += 500; else { stableMs = 0; lastCount = n; }

    renderDone = sig.lastRender;
    // The shell writes the final assistant ('archie' role) summary AFTER all
    // tool_calls are dispatched for the turn — that is the turn-complete marker.
    archieReplied = (await archieMessages()).length > 0;

    // COMPLETION: render produced is the strongest signal the model finished.
    if (renderDone) { console.log('[cua-genuine] completion: render produced.'); break; }
    // OR: model built something, it has settled, and the turn-complete reply is in.
    if (n >= 2 && stableMs >= 12000 && archieReplied && seenTools > 0) {
      console.log(`[cua-genuine] completion: scene stable (${n} bodies) + turn reply posted; no render yet.`);
      break;
    }
  }

  // capture a few extra frames on whatever the model produced.
  for (let i = 0; i < 6; i++) { await shot(null); await win.waitForTimeout(200); }

  const finalSig = await sceneSignals();
  const finalCount = await sceneCount();
  const allTools = await toolMessages();
  console.log(`[cua-genuine] watch ended after ${Math.round((Date.now() - tStart) / 1000)}s`);
  console.log(`[cua-genuine] scene bodies=${finalCount} (peak ${peakCount}) skinned=${finalSig.skinned} realBodies=${finalSig.realBodies} render=${finalSig.lastRender}`);
  console.log(`[cua-genuine] MODEL EMITTED ${allTools.length} TOOL CALLS:`);
  allTools.forEach((t, i) => console.log(`   ${i + 1}. ${t}`));

  // ── (4) harvest the path-traced render the MODEL requested ──────────────────
  // If the model never emitted render, we DO NOT silently click it for the model
  // (that would fake the deliverable). We record the honest absence; the frames
  // already captured the model-built scene. If a render IS present, write it as
  // the hero still + append it as the final, held frames of the video.
  let render = await win.evaluate(() => {
    const r = window.__studioLastRender;
    return r && r.dataUrl ? { dataUrl: r.dataUrl, width: r.width, height: r.height, samples: r.samples } : null;
  });
  if (render) {
    const heroPath = path.join(OUT, `${OUT_NAME}.png`);
    fs.writeFileSync(heroPath, Buffer.from(render.dataUrl.split(',')[1], 'base64'));
    console.log(`[cua-genuine] hero render ${render.width}x${render.height} @ ${render.samples}spp → ${heroPath}`);
    // hold the render on screen for the tail of the video (more frames of it).
    for (let i = 0; i < 18; i++) { await shot(null); await win.waitForTimeout(120); }
  } else {
    console.warn('[cua-genuine] NO render produced by the model — video shows the model-built scene only.');
  }

  // ── close cleanly ──────────────────────────────────────────────────────────
  await win.evaluate(() => { window.__studioV3Dirty = false; window.onbeforeunload = null; }).catch(() => {});
  await app.close();

  // ── (5) stitch frames → mp4 (the video opens on the typed prompt) ───────────
  const mp4 = path.join(OUT, `${OUT_NAME}.mp4`);
  execSync(
    `ffmpeg -y -framerate 12 -i ${FR}/f-%04d.png -pix_fmt yuv420p `
    + `-vf "scale=trunc(iw/2)*2:trunc(ih/2)*2" ${mp4}`,
    { stdio: 'inherit' },
  );
  console.log(`[cua-genuine] mp4 → ${mp4}  (${fi} frames @ 12fps)`);

  // ── assertions (outcome-based, because the MODEL is in the loop) ────────────
  // The mp4 must exist and open on the typed prompt (we captured the type).
  expect(fs.existsSync(mp4), 'no mp4 produced').toBeTruthy();
  expect(fi, 'too few frames captured').toBeGreaterThan(20);
  // The model must have actually driven SOMETHING — at least one dispatched
  // tool_call OR a grown scene. (If serve is down, runArchie fails and both are
  // empty — that fails here loudly, which is the correct signal pre-serve.)
  expect(
    allTools.length > 0 || finalCount > 0,
    'the live model drove nothing — is serve up on :8080 with the genuine-CUA adapter?',
  ).toBeTruthy();
});
