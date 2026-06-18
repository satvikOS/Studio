import { test, _electron as electron } from '@playwright/test';
import { expect } from '@playwright/test';
import path from 'path'; import fs from 'fs';
const OUT = path.resolve(__dirname, 'shots', 'studio', 'realscene');
const LAYOUT = process.env.RS_LAYOUT || 'living-room';
test(`real-model photoreal — ${LAYOUT}`, async () => {
  test.setTimeout(12 * 60 * 1000);
  fs.mkdirSync(OUT, { recursive: true });
  const app = await electron.launch({ args: [path.join(__dirname, '..', '..', 'electron', 'main.js')], slowMo: 20 });
  let win = await app.firstWindow();
  if (win.url().startsWith('devtools://')) win = (await app.windows()).find((w) => !w.url().startsWith('devtools://')) || await app.waitForEvent('window', { predicate: (w) => !w.url().startsWith('devtools://') });
  win.on('dialog', (d) => d.dismiss().catch(() => {}));
  await win.waitForLoadState('domcontentloaded');
  await win.evaluate(() => { try { window.localStorage.setItem('studio.v3.tour-seen','1'); } catch(_){} }).catch(()=>{});
  await win.reload().catch(()=>{});
  await expect(win.locator('[data-studio-v3-shell]')).toBeVisible({ timeout: 25000 });
  await win.waitForFunction(() => typeof window.__studioComposeRealScene === 'function' && typeof window.__studioRunPathTracedRender === 'function', { timeout: 25000 });
  const r = await win.evaluate(async (layout) => {
    const composed = await window.__studioComposeRealScene(layout, 1337);
    let out; try { out = await window.__studioRunPathTracedRender({ room: true, resolutionId: '1440p', samples: 160, envPresetId: 'daylight', angle: 'eye-level' }); }
    catch(e){ try { out = await window.__studioRunPathTracedRender({ room:true, resolutionId:'1080p', samples:96, envPresetId:'daylight', angle:'hero' }); } catch(e2){ return { error:String(e2&&e2.message||e2), composed }; } }
    return { composed, w: out.width, h: out.height, samples: out.samples, dataUrl: out.dataUrl };
  }, LAYOUT);
  if (r.dataUrl) { fs.writeFileSync(path.join(OUT, `${LAYOUT}-real.png`), Buffer.from(r.dataUrl.split(',')[1],'base64')); delete r.dataUrl; }
  console.log(`\n=== REALSCENE ${LAYOUT}: ${JSON.stringify(r)} ===`);
  await win.evaluate(()=>{ window.__studioV3Dirty=false; window.onbeforeunload=null; }).catch(()=>{});
  await app.close();
  expect(r.error, r.error||'').toBeFalsy();
});
