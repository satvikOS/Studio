# Slices 951v → 952 — the Hermes era (2026-06-08 → 2026-06-12)

What changed for you, in plain terms.

## Archie now runs on Hermes-3, quantized
The old R1-distill base physically could not stop "thinking" long
enough to emit tool calls. Hermes-3-Llama-3.1-8B replaced it (951v),
then moved to a 4-bit quant: **2.4× faster replies** (39.8 tok/s),
a fifth of the memory, identical quality at the probes. One server
now drives both Studio and Forge — Forge hot-swaps its own adapter
per request.

## Archie stages scenes like a cinematographer (951y/951z)
"build a coffee table hero shot" no longer dumps primitives at the
origin. The trace runs blockout → select → transform → material per
body, then a 3-point light rig, then frames the camera. New fn-channel
APIs make selection addressable (`__studioSelectByName`,
`__studioSelectNewest`) and the main camera scriptable
(`__studioMainCameraLook`).

## Every English noun decomposes (B.2 @ 100k)
100,000 nouns mapped onto ~55 decomposition archetypes via WordNet
ancestry + Wiktionary head-words. Ask for a kayak, a minaret, a
dachshund — never hand-written, all spawn sensible primitive
blockouts.

## A coherence gate guards every multi-body build (952)
After dispatch, the scene is checked — zero/negative/absurd scales are
caught instantly with exact reasons, the failed bodies are torn down,
and Archie rebuilds once with the correction appended. Every failure
also lands in a catalog (`archdisc-Models/data/failures/`) for
training feedback. The LLM half of the verifier stays off until its
corpus earns ≥90% on leakage-free tests — the first one scored 100%
on held-out data while being blind to real defects (it had learned
the data-generation jitter signature). The rule tier doesn't lie.

## Memory + vision prefixes no longer break builds
The first time the memory server was actually up during a build, every
staged prompt regressed — the model had never seen the
`<prior_context>` prefix the runtime injects. A third of the corpus
now carries those prefixes; behavior holds with the full sidecar
stack running.

## Ops now run themselves
Crontab: Monday distill, nightly session-export + cost report + disk
snapshot, daily adapter backup (logs honestly that NO external volume
is currently attached — plug one in and it starts working). Failure
catalog, stress suite, and the 10-prompt definition-of-done
scoreboard are in the tree.
