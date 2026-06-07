// ArchDisc Studio V3 — render farm queue + Deadline/Tractor/RR/AWS/GCP
// adapter shells (slice 945).
// Distinct from slice-902 v3/renderfarm/ (WebSocket worker pool); this slice
// adds the third-party farm-software job-spec + adapter interface.
import { registerOps } from '../common/registry.js';

const FARM_DEFAULTS = {
  deadline:       { envVar: 'DEADLINE_REPO_URL',     submitFormat: 'plugin-xml' },
  tractor:        { envVar: 'TRACTOR_ENGINE_URL',    submitFormat: 'alf-tcl' },
  royalrender:    { envVar: 'RR_ROOT',               submitFormat: 'rrjob-json' },
  'aws-thinkbox': { envVar: 'AWS_THINKBOX_QUEUE',    submitFormat: 'plugin-xml' },
  'gcp-renderq':  { envVar: 'GCP_RENDERQ_PROJECT',   submitFormat: 'gcp-json' },
};

const _adapters = new Map();
const _jobs = new Map();
let _jobCounter = 1, _installed = false;
const _localQueue = { capacity: typeof navigator !== 'undefined' ? (navigator.hardwareConcurrency || 4) : 4 };

function _validateSpec(s) {
  if (!s) return 'missing spec';
  if (!s.scene?.ref) return 'spec.scene.ref required';
  if (!s.frames || s.frames.start == null || s.frames.end == null) return 'spec.frames {start,end} required';
  if (!s.output?.dir) return 'spec.output.dir required';
  return null;
}

async function _runLocalFrame(spec, frame) {
  if (spec.renderer === 'cpu-pt' && typeof window !== 'undefined' && window.__studioPathTraceRender) {
    return window.__studioPathTraceRender({ width: spec.resolution?.[0] || 256, height: spec.resolution?.[1] || 192, samples: spec.samples || 4 });
  }
  return { ok: true, frame, descriptor: { spec, frame } };
}

async function _runLocalJob(jobId) {
  const job = _jobs.get(jobId);
  if (!job) return;
  job.status = 'running';
  const { start, end, step = 1 } = job.spec.frames;
  for (let f = start; f <= end; f += step) {
    if (job.cancelled) { job.status = 'cancelled'; return; }
    try {
      const r = await _runLocalFrame(job.spec, f);
      if (r?.ok) job.framesDone.push(f); else job.framesFailed.push(f);
    } catch { job.framesFailed.push(f); }
    job.progress = (job.framesDone.length + job.framesFailed.length) / Math.max(1, (end - start + 1) / step);
  }
  job.status = job.framesFailed.length === 0 ? 'done' : 'completed-with-errors';
}

export function installFarmQueue() {
  if (_installed) return { ok: true, already: true };
  _installed = true;
  const ops = {
    __studioFarmQueueSubmit: ({ jobSpec, farm = 'local' } = {}) => {
      const err = _validateSpec(jobSpec);
      if (err) return { ok: false, error: err };
      const id = `job-${_jobCounter++}`;
      const job = { id, spec: jobSpec, farm, status: 'pending', progress: 0, framesDone: [], framesFailed: [], submittedAt: Date.now(), cancelled: false };
      _jobs.set(id, job);
      if (farm === 'local') { Promise.resolve().then(() => _runLocalJob(id)); return { ok: true, jobId: id, farm }; }
      const cfg = FARM_DEFAULTS[farm];
      const adapter = _adapters.get(farm);
      if (!cfg) return { ok: false, error: `unknown farm: ${farm}` };
      if (!adapter) return { ok: false, error: `farm "${farm}" not configured — set ${cfg.envVar} and register adapter via __studioFarmQueueAdapterRegister`, envVar: cfg.envVar };
      Promise.resolve(adapter.submit(jobSpec)).then((remoteId) => { job.remoteId = remoteId; job.status = 'submitted'; }).catch((e) => { job.status = 'failed'; job.error = e.message; });
      return { ok: true, jobId: id, farm };
    },
    __studioFarmQueueStatus: ({ jobId }) => {
      const job = _jobs.get(jobId);
      if (!job) return { ok: false, error: 'no job' };
      if (job.farm !== 'local') {
        const adapter = _adapters.get(job.farm);
        if (adapter && job.remoteId) return Promise.resolve(adapter.status(job.remoteId)).then((s) => ({ ok: true, status: s, progress: job.progress, framesDone: job.framesDone.length }));
      }
      return { ok: true, status: job.status, progress: job.progress, framesDone: job.framesDone.length, framesFailed: job.framesFailed.length };
    },
    __studioFarmQueueCancel: ({ jobId }) => {
      const job = _jobs.get(jobId);
      if (!job) return { ok: false };
      job.cancelled = true;
      if (job.farm !== 'local' && _adapters.get(job.farm)?.cancel && job.remoteId) _adapters.get(job.farm).cancel(job.remoteId);
      return { ok: true };
    },
    __studioFarmQueueListJobs: () => ({ ok: true, jobs: [..._jobs.values()].map((j) => ({ id: j.id, status: j.status, progress: j.progress, farm: j.farm })) }),
    __studioFarmQueueAdapterRegister: ({ adapter }) => {
      if (!adapter?.id || typeof adapter.submit !== 'function' || typeof adapter.status !== 'function') return { ok: false, error: 'adapter must impl {id, submit, status, cancel?, fetchFrames?}' };
      _adapters.set(adapter.id, adapter);
      return { ok: true, adapterId: adapter.id };
    },
    __studioFarmQueueAdapterList: () => ({ ok: true, registered: [..._adapters.keys()], available: Object.keys(FARM_DEFAULTS), defaults: FARM_DEFAULTS }),
    __studioFarmQueueGetStats: () => ({ ok: true, jobCount: _jobs.size, adapterCount: _adapters.size, localCapacity: _localQueue.capacity }),
  };
  for (const [n, fn] of Object.entries(ops)) window[n] = fn;
  registerOps(ops, 'render', 'Render farm queue + Deadline/Tractor/RR/AWS/GCP adapter shells');
  return { ok: true };
}
export default installFarmQueue;
