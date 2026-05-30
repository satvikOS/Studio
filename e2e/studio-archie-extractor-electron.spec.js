import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

/*
 * Studio — Slice 245: Archie response extractor.
 *
 * Validates the salvage path for the local Archie LoRA fleet (the
 * DeepSeek-R1-Distill-Qwen-7B + per-discipline adapters served by
 * mlx_lm.server at localhost:8080 in production).
 *
 * The Archie LoRAs often emit the plan JSON inside a <think> block and
 * never close it, never follow up with <tool_call> blocks. The
 * extractor (frontend/src/ai/ArchieExtractor.js) pulls the plan out of
 * the raw text and converts it to a Studio recipe the rest of the AI
 * scaffold (PlanExecutor, ArchieLoop, applySceneSetup) can run unchanged.
 *
 * This spec uses a STUBBED Archie response — no GPU server needed.
 * Headed Mac-Electron at slowMo 1000 (overridable via STUDIO_SLOWMO) so
 * the remote-desktop user can watch each step land.
 */

const OUT = path.resolve(__dirname, 'screenshots', 'studio-archie-extractor');

// Captured from a real DeepSeek-R1-Distill-Qwen-7B + modeling LoRA call.
// Note: plan JSON is INSIDE <think> with no </think> close and no
// <tool_call> blocks — exactly the failure mode the extractor exists to fix.
const STUB_ARCHIE_RESPONSE =
  '<think><plan>{"goal":"low-poly sci-fi cargo crate with weathered metal and rivet detail",' +
  '"scene":{"discipline":"modeling"},' +
  '"bodies":[' +
    '{"id":"crate","prim":"cube","pos":[-0.08,0,0],"scale":[1.4,1.0,1.4],' +
      '"material":{"color":"#454c52","metalness":0.85,"roughness":0.6}},' +
    '{"id":"rivet","prim":"sphere","pos":[0.08,0,0],"scale":[0.15,0.15,0.15],"count":4,' +
      '"material":{"color":"#9aa3a8","metalness":0.95,"roughness":0.3}}' +
  '],' +
  '"expect":{"bodies":5,"kinds":["cube","sphere"]}}</plan>';

test('Studio — Archie extractor salvages malformed LoRA response → executable recipe', async () => {
  test.setTimeout(180000);
  fs.mkdirSync(OUT, { recursive: true });

  const app = await electron.launch({
    args: [path.join(__dirname, '..', 'electron', 'main.js')],
    slowMo: Number(process.env.STUDIO_SLOWMO) || 1000,
  });
  const win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');
  await expect(win.locator('.workbench-current .workbench-name'))
    .toHaveText('ArchDisc Studio', { timeout: 30000 });
  await expect(win.locator('canvas').first()).toBeVisible({ timeout: 60000 });
  await win.waitForFunction(() => !!window.__archdiscViewport, null, { timeout: 30000 });
  await win.waitForFunction(() => typeof window.__archieExtract === 'function', null, { timeout: 30000 });
  await win.waitForTimeout(1500);
  await win.screenshot({ path: path.join(OUT, '00-initial.png') });

  // 1. Extractor pulls a recipe out of the malformed Archie response.
  const extracted = await win.evaluate((raw) => {
    const r = window.__archieExtract(raw, { discipline: 'modeling' });
    return {
      source: r.source,
      recipeBodyCount: r.recipe?.bodies?.length || 0,
      planStepCount: r.plan?.length || 0,
      firstBodyKind: r.recipe?.bodies?.[0]?.kind,
      firstBodyMaterial: r.recipe?.bodies?.[0]?.material,
    };
  }, STUB_ARCHIE_RESPONSE);

  expect(extracted.source).toBe('archie-synthesized');
  expect(extracted.recipeBodyCount, 'extractor pulled bodies out of <think>-trapped plan').toBeGreaterThan(0);
  expect(extracted.firstBodyKind).toBe('cube');
  expect(extracted.firstBodyMaterial?.metalness).toBe(0.85);
  await win.waitForTimeout(700);
  await win.screenshot({ path: path.join(OUT, '01-extractor-ran.png') });

  // 2. Apply the extracted recipe via the engine — watch primitives appear.
  await win.evaluate((raw) => {
    const r = window.__archieExtract(raw, { discipline: 'modeling' });
    if (!r.recipe || !window.__archieEngine?.applySceneSetup) {
      throw new Error('engine.applySceneSetup or extracted recipe missing');
    }
    return window.__archieEngine.applySceneSetup(r.recipe);
  }, STUB_ARCHIE_RESPONSE);
  await win.waitForTimeout(1500);
  await win.screenshot({ path: path.join(OUT, '02-recipe-applied.png') });

  // 3. Verify the scene actually contains the primitives the recipe asked for.
  const sceneState = await win.evaluate(() => {
    const kinds = new Set();
    let n = 0;
    window.__archdiscScene.traverse((o) => {
      const k = o?.userData?.archdiscStudioPrimitiveKind;
      if (k) { kinds.add(k); n++; }
    });
    return { count: n, kinds: [...kinds].sort() };
  });
  expect(sceneState.count, 'scene contains primitives applied by the recipe').toBeGreaterThan(0);
  // The recipe asked for cubes + spheres; verify both kinds landed.
  expect(sceneState.kinds, 'cube + sphere both present').toEqual(expect.arrayContaining(['cube', 'sphere']));
  await win.waitForTimeout(700);
  await win.screenshot({ path: path.join(OUT, '03-scene-verified.png') });

  await win.waitForTimeout(2500);

  // eslint-disable-next-line no-console
  console.log(`  slice 245: archie extractor → recipe → scene (${sceneState.count} primitives, kinds=${sceneState.kinds.join(',')})`);

  await app.close();
});
