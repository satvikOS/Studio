import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

/*
 * Studio — NIAGARA PARTICLE EMITTER GRAPH (headed Electron).
 *
 * Closes the Unreal Niagara / Unity VFX Graph gap: a module graph (Spawn /
 * Initial Velocity / Force / Colour-over-Life -> Emitter Output) on the shared
 * node-graph engine, simulated as a deterministic particle burst (THREE.Points).
 * Verifies the graph evaluates to a particle system and that stepping the sim
 * makes the cloud (a) fall under the Force/gravity module (mean Y drops),
 * (b) spread from the velocity spread (X span grows), and (c) shift colour over
 * life (warm -> dark per the Colour-over-Life module).
 */

const OUT = path.resolve(__dirname, 'screenshots', 'studio-niagara');

const avgGreen = (win) => win.evaluate(() => {
  const s = window.__archdiscScene; let pts = null;
  s && s.traverse((o) => { if (o.userData && o.userData.archdiscStudioPrimitiveKind === 'niagara') pts = o; });
  const c = pts.geometry.attributes.color; let g = 0; for (let i = 0; i < c.count; i++) g += c.getY(i); return g / c.count;
});

test('Studio — niagara emitter graph simulates a particle burst', async () => {
  test.setTimeout(240000);
  fs.mkdirSync(OUT, { recursive: true });

  const app = await electron.launch({ args: [path.join(__dirname, '..', 'electron', 'main.js')], slowMo: Number(process.env.STUDIO_SLOWMO) || 220 });
  const win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');
  await expect(win.locator('.workbench-current .workbench-name')).toHaveText('ArchDisc Studio', { timeout: 30000 });
  await expect(win.locator('canvas').first()).toBeVisible({ timeout: 60000 });
  await win.waitForFunction(() => !!window.__archdiscViewport, null, { timeout: 30000 });
  await win.waitForFunction(() => typeof window.__studioNiagaraStep === 'function', null, { timeout: 30000 });
  await win.waitForTimeout(500);

  // ── open the Niagara editor; seed module graph present ──
  await win.locator('[data-studio-ribbon-action="niagara-editor"]').click();
  await expect(win.locator('[data-studio-nodegraph="niagara"]')).toBeVisible({ timeout: 10000 });
  await expect(win.locator('[data-studio-nodegraph-node="spawn"]')).toBeVisible();
  await expect(win.locator('[data-studio-nodegraph-node="emitter"]')).toBeVisible();
  await expect(win.locator('[data-studio-nodegraph-add="force"]')).toBeVisible();
  await win.screenshot({ path: path.join(OUT, '01-niagara-graph.png') });

  // ── evaluate the seed graph (real editor button) -> a particle system ──
  await win.locator('[data-studio-nodegraph-action="evaluate"]').click();
  await win.waitForTimeout(300);
  const made = await win.evaluate(() => {
    const s = window.__archdiscScene; let p = null;
    s && s.traverse((o) => { if (o.userData && o.userData.archdiscStudioPrimitiveKind === 'niagara') p = o; });
    return { count: p ? p.geometry.attributes.position.count : 0 };
  });
  expect(made.count, 'emitter spawned a particle burst').toBeGreaterThan(100);

  const g0 = await avgGreen(win);
  const s1 = await win.evaluate(() => window.__studioNiagaraStep(0.1));
  const s2 = await win.evaluate(() => window.__studioNiagaraStep(1.5)); // total t ~ 1.6
  const g2 = await avgGreen(win);

  expect(s2.count, 'particle count stable').toBe(made.count);
  expect(s2.meanY, 'the Force/gravity module pulls the cloud down over time').toBeLessThan(s1.meanY);
  expect(s2.spanX, 'the velocity spread fans the cloud out (X span grows)').toBeGreaterThan(s1.spanX + 0.1);
  expect(g0 - g2, 'Colour-over-Life shifts the cloud warm -> dark (green drops)').toBeGreaterThan(0.2);

  await win.locator('[data-studio-nodegraph-action="close"]').click();
  await win.evaluate(() => { window.__studioFrameAll && window.__studioFrameAll(); window.__archdiscOrbitView && window.__archdiscOrbitView(18, 8, 1.3); });
  await win.waitForTimeout(250);
  await win.screenshot({ path: path.join(OUT, '02-particle-burst.png') });

  // eslint-disable-next-line no-console
  console.log(`  niagara: count=${made.count}; meanY ${s1.meanY.toFixed(3)}->${s2.meanY.toFixed(3)}; spanX ${s1.spanX.toFixed(2)}->${s2.spanX.toFixed(2)}; avgGreen ${g0.toFixed(2)}->${g2.toFixed(2)}`);

  await app.close();
});
