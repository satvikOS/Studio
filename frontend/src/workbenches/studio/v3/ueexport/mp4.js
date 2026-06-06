// Slice 729 — Unreal Sequencer MP4 export. Uses the browser's
// MediaRecorder API to capture the viewport canvas's stream as a
// webm/mp4 video; saves to a downloadable file. Mirrors UE's
// "Render Movie" output.

let _recorder = null;
let _chunks = [];

export function startRecording(opts) {
  const viewport = window.__archdiscViewport;
  const renderer = viewport?.renderer;
  if (!renderer) return { ok: false };
  const canvas = renderer.domElement;
  const fps = Number(opts?.fps) || 30;
  const mimeType = opts?.mimeType || 'video/webm;codecs=vp9';
  try {
    const stream = canvas.captureStream(fps);
    _chunks = [];
    _recorder = new MediaRecorder(stream, { mimeType });
    _recorder.ondataavailable = (e) => { if (e.data.size > 0) _chunks.push(e.data); };
    _recorder.start();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

export function stopRecording() {
  if (!_recorder) return { ok: false };
  return new Promise((resolve) => {
    _recorder.onstop = () => {
      const blob = new Blob(_chunks, { type: _recorder.mimeType });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `studio-render-${Date.now()}.webm`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      _recorder = null;
      _chunks = [];
      resolve({ ok: true });
    };
    _recorder.stop();
  });
}

export function isRecording() {
  return { ok: true, recording: !!_recorder };
}

export function getRecordingState() {
  return {
    ok: true,
    recording: !!_recorder,
    chunkCount: _chunks.length,
    mimeType: _recorder?.mimeType,
  };
}

// One-call helper: record N seconds while playing a cinematic.
export async function renderCine(cineId, durationSec, opts) {
  if (typeof window.__studioCinePlay !== 'function') return { ok: false };
  const r1 = startRecording(opts);
  if (!r1.ok) return r1;
  try { window.__studioCinePlay(cineId); } catch (_) {}
  await new Promise((res) => setTimeout(res, durationSec * 1000));
  return stopRecording();
}
