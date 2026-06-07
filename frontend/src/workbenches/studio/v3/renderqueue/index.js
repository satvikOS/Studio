// ArchDisc Studio V3 — render queue / batch render (slice 873).
// Queues frame-range render jobs (camera + time + output settings) and
// processes them sequentially.

import { registerOps } from '../common/registry.js';
let _installed = false;
const _queue = [];
let _running = false;
let _completed = 0;
let _failed = 0;
async function _process() {
  if (_running) return; _running = true;
  while (_queue.length) {
    const job = _queue.shift();
    try {
      const r = await (window.__studioPathTraceRender?.(job.params) || Promise.resolve({ ok: false, error: 'no PT' }));
      job.result = r; job.status = r?.ok ? 'done' : 'failed';
      if (r?.ok) _completed++; else _failed++;
      job.callback?.(r);
    } catch (e) {
      job.status = 'failed'; job.error = String(e); _failed++; job.callback?.({ ok: false, error: String(e) });
    }
  }
  _running = false;
}
export function installRenderQueue() {
  if (_installed) return { ok: true, already: true };
  _installed = true;
  const ops = {
    __studioRenderQueueAdd: ({ params, callback } = {}) => {
      const id = `rj_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      _queue.push({ id, params: params || {}, status: 'pending', callback });
      return { ok: true, id, queueLength: _queue.length };
    },
    __studioRenderQueueStart: () => { _process(); return { ok: true, running: _running }; },
    __studioRenderQueueStats: () => ({ ok: true, pending: _queue.length, completed: _completed, failed: _failed, running: _running }),
    __studioRenderQueueClear: () => { _queue.length = 0; return { ok: true }; },
    __studioRenderQueueAddRange: ({ params, startFrame = 0, endFrame = 24, callback } = {}) => {
      const ids = [];
      for (let f = startFrame; f <= endFrame; f++) {
        const id = `rj_${Date.now()}_${f}_${Math.random().toString(36).slice(2, 4)}`;
        _queue.push({ id, params: { ...params, frame: f }, status: 'pending', callback });
        ids.push(id);
      }
      return { ok: true, ids, count: ids.length };
    },
  };
  for (const [n, fn] of Object.entries(ops)) window[n] = fn;
  registerOps(ops, 'render', 'Render queue / batch render');
  return { ok: true };
}
export default installRenderQueue;
