// ArchDisc Studio V3 — render farm coordinator (slice 902).
// WebSocket-based render-pool distribution. Master holds the job queue;
// workers fetch jobs and stream PNG results back.

import { registerOps } from '../common/registry.js';
let _installed = false;
let _ws = null;
let _role = null;
const _jobs = new Map();
let _connected = false;
function _connect({ url, role = 'worker' } = {}) {
  if (typeof WebSocket === 'undefined') return { ok: false };
  try {
    _ws = new WebSocket(url);
    _role = role;
    _ws.onopen = () => { _connected = true; _ws.send(JSON.stringify({ type: 'hello', role })); };
    _ws.onmessage = async (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.type === 'job' && role === 'worker') {
        const r = await (window.__studioPathTraceRender?.(msg.params) || Promise.resolve({ ok: false }));
        _ws.send(JSON.stringify({ type: 'result', jobId: msg.jobId, result: r }));
      } else if (msg.type === 'result' && role === 'master') {
        const job = _jobs.get(msg.jobId); if (job?.callback) job.callback(msg.result);
        _jobs.delete(msg.jobId);
      }
    };
    _ws.onclose = () => { _connected = false; };
    return { ok: true };
  } catch (e) { return { ok: false, error: String(e) }; }
}
function _submit({ params, callback } = {}) {
  if (!_connected || _role !== 'master') return { ok: false };
  const jobId = `job_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  _jobs.set(jobId, { jobId, params, callback });
  _ws.send(JSON.stringify({ type: 'job', jobId, params }));
  return { ok: true, jobId };
}
export function installRenderFarm() {
  if (_installed) return { ok: true, already: true };
  _installed = true;
  const ops = {
    __studioRenderFarmConnect: _connect,
    __studioRenderFarmSubmit: _submit,
    __studioRenderFarmDisconnect: () => { _ws?.close(); _connected = false; return { ok: true }; },
    __studioRenderFarmStats: () => ({ ok: true, connected: _connected, role: _role, pending: _jobs.size }),
  };
  for (const [n, fn] of Object.entries(ops)) window[n] = fn;
  registerOps(ops, 'render', 'Render farm coordinator (WebSocket)');
  return { ok: true };
}
export default installRenderFarm;
