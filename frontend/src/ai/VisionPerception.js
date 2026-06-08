// frontend/src/ai/VisionPerception.js
//
// Two-model multimodal pipeline for Archie:
//   1. Capture the live viewport (Studio canvas or any HTMLCanvasElement)
//   2. POST the PNG to the Qwen2.5-VL caption server (default :8081)
//   3. Receive structured viewport JSON ({bodies, lighting, camera})
//   4. Inject the caption into Archie's NEXT chat call as system context
//
// Why two models:
//   - Archie 7B (DeepSeek-R1-Distill-Qwen-7B) is TEXT-only but has the full
//     Studio/Mech reasoning brain from R15/R16 training.
//   - Qwen2.5-VL 7B is the eye — it sees images, outputs structured JSON.
//   - We pipe VL's caption → Archie's prompt. Archie's brain is unchanged;
//     vision is added upstream as a perception module.
//
// Usage in Studio's AI loop (e.g. ArchieLoop.js):
//   import { captureAndCaption } from './VisionPerception.js';
//   const snapshot = await captureAndCaption({ canvas: rendererCanvas });
//   const systemPrompt = baseSystem + '\n<viewport>' + snapshot + '</viewport>';
//   // pass systemPrompt to the chat API as usual

const DEFAULT_VISION_URL = 'http://localhost:8081/caption';

/**
 * Capture the current frame of an HTMLCanvasElement and POST it to the
 * vision caption server. Returns the structured caption string (JSON-like
 * text) for the renderer to attach to the next Archie chat call.
 *
 * @param {Object} opts
 * @param {HTMLCanvasElement} opts.canvas — the live viewport canvas
 * @param {string} [opts.url] — vision server endpoint (default :8081/caption)
 * @param {string} [opts.prompt] — override the default caption prompt
 * @param {AbortSignal} [opts.signal] — caller cancellation
 * @returns {Promise<string>} the structured viewport caption
 */
export async function captureAndCaption({ canvas, url = DEFAULT_VISION_URL,
                                          prompt, signal } = {}) {
  if (!canvas || typeof canvas.toBlob !== 'function') {
    throw new Error('captureAndCaption: HTMLCanvasElement required');
  }
  const blob = await new Promise((resolve, reject) => {
    canvas.toBlob((b) => b ? resolve(b) : reject(new Error('toBlob returned null')),
                   'image/png');
  });

  // If a custom prompt is provided we send JSON+base64; otherwise raw PNG.
  let body, headers;
  if (prompt) {
    const buf = await blob.arrayBuffer();
    const b64 = btoa(String.fromCharCode(...new Uint8Array(buf)));
    body = JSON.stringify({ image_base64: b64, prompt });
    headers = { 'Content-Type': 'application/json' };
  } else {
    body = blob;
    headers = { 'Content-Type': 'image/png' };
  }

  const res = await fetch(url, { method: 'POST', body, headers, signal });
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`vision server ${res.status}: ${txt.slice(0, 200)}`);
  }
  const data = await res.json();
  return data.caption || '';
}

/**
 * Wrap an Archie chat-request preparer so every plan includes the live
 * viewport caption automatically. Convenient to drop into runArchieLoop's
 * `plan` hook: visionWrap(plannerFn) returns a fn that captions first then
 * delegates to the planner with `viewport` in the prompt.
 */
export function visionWrap(plannerFn, { canvas, url } = {}) {
  return async function plannerWithVision(goal) {
    let caption = '';
    if (canvas) {
      try { caption = await captureAndCaption({ canvas, url }); }
      catch (e) { console.warn('[vision] capture failed:', e.message); }
    }
    return plannerFn(goal, { viewport: caption });
  };
}
