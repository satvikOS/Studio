import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

/*
 * Studio — Slice 252: Archie provider discipline routing.
 *
 * Bug fix proof: before this slice, planFor() did NOT pass `discipline`
 * to provider.generate(args). The archie provider (slice 190) reads
 * args.discipline to pick adapters/archie/studio/{discipline} for the
 * per-request `adapters` field on mlx_lm.server — without it, every
 * request used just the foundational adapter, never the per-discipline
 * LoRA. This spec captures provider.generate's args via a stubbed
 * provider and asserts `discipline` flows through.
 *
 * Headed Mac-Electron at slowMo 700 (no canvas mutation in this spec —
 * it's a pure planner integration check — so we don't need the full
 * 1000ms pace; bumps to 1000 for the canvas-mount linger).
 */

const OUT = path.resolve(__dirname, 'screenshots', 'studio-archie-discipline-routing');

test('Studio — Archie provider receives discipline from Planner (adapter routing wired)', async () => {
  test.setTimeout(120000);
  fs.mkdirSync(OUT, { recursive: true });

  const app = await electron.launch({
    args: [path.join(__dirname, '..', 'electron', 'main.js')],
    slowMo: Number(process.env.STUDIO_SLOWMO) || 700,
  });
  const win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');
  await expect(win.locator('.workbench-current .workbench-name'))
    .toHaveText('ArchDisc Studio', { timeout: 30000 });
  await expect(win.locator('canvas').first()).toBeVisible({ timeout: 60000 });
  await win.waitForFunction(() => !!window.__archdiscViewport, null, { timeout: 30000 });
  await win.waitForTimeout(1500);
  await win.screenshot({ path: path.join(OUT, '00-initial.png') });

  // Drive planFor against a stubbed provider and read back what args
  // arrived. Each iteration uses a different domain so we can see
  // discipline actually varies per call.
  const runs = await win.evaluate(async () => {
    const planner = await import('/src/ai/Planner.js');
    const out = [];
    const fake = {
      async generate(args) {
        out.push({
          discipline: args.discipline,
          hasSystem: typeof args.system === 'string' && args.system.length > 0,
          hasUserMessage: typeof args.userMessage === 'string' && args.userMessage.length > 0,
        });
        // Return a minimal valid archie response so planFor doesn't fall back
        return '<plan>{"goal":"stub","scene":{"discipline":"' + args.discipline + '"},' +
               '"bodies":[{"id":"a","prim":"cube"}],"expect":{"bodies":1}}</plan>';
      },
    };
    for (const dom of ['modeling', 'sculpting', 'uv-texture', 'rigging', 'animation', 'vfx-sim', 'rendering', 'compositing']) {
      const r = await planner.planFor({
        userPrompt: `test ${dom}`,
        domain: dom,
        providerCfg: { provider: 'archie' },
        providerOverride: fake,
      });
      out[out.length - 1].plannerSource = r.source;
      out[out.length - 1].plannerRecipeOk = Boolean(r.recipe);
    }
    return out;
  });

  // Each of the 8 disciplines must arrive at the provider with its own discipline string.
  for (const r of runs) {
    expect(r.hasSystem, `system prompt passed for ${r.discipline}`).toBe(true);
    expect(r.hasUserMessage, `user message passed for ${r.discipline}`).toBe(true);
    expect(typeof r.discipline, `discipline passed for ${r.discipline}`).toBe('string');
  }
  const seenDisciplines = new Set(runs.map(r => r.discipline));
  expect(seenDisciplines.size, 'all 8 disciplines routed distinctly').toBe(8);
  for (const d of ['modeling', 'sculpting', 'uv-texture', 'rigging', 'animation', 'vfx-sim', 'rendering', 'compositing']) {
    expect(seenDisciplines.has(d), `${d} routed`).toBe(true);
  }

  await win.waitForTimeout(700);
  await win.screenshot({ path: path.join(OUT, '01-routing-verified.png') });
  await win.waitForTimeout(2500);

  // eslint-disable-next-line no-console
  console.log(`  slice 252: 8/8 disciplines routed to provider (${[...seenDisciplines].join(', ')})`);

  await app.close();
});
