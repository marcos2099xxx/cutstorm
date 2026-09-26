/**
 * WebAudio-based preview mixer.
 *
 * Goal: what the user hears in preview matches what the export produces —
 * original track at `sourceVolume`, extra track at `extraVolume`, mixed.
 *
 * Graph:
 *   [video]     → MediaElementSource → srcGain ─┐
 *                                                ├─→ destination
 *   [extra <audio>] → MediaElementSource → extraGain ─┘
 *
 * Caveats:
 * - `createMediaElementSource` can be called ONCE per element for the lifetime
 *   of the AudioContext. We cache the source node keyed by the element so
 *   React re-renders don't try to re-wrap it.
 * - AudioContext starts suspended in modern browsers; we resume() on the
 *   first user-gesture-triggered play().
 * - Extra element is kept in sync with the video: play/pause/seek mirror.
 *   When the extra audio runs out before the video, it just goes silent.
 */

type NodeSet = {
  ctx: AudioContext;
  srcNode: MediaElementAudioSourceNode;
  srcGain: GainNode;
  extraGain: GainNode;
  extraEl: HTMLAudioElement;
  extraNode: MediaElementAudioSourceNode | null;
};

let current: NodeSet | null = null;

// Track which HTMLMediaElement has already been wrapped in a MediaElementSource.
// WebAudio forbids wrapping the same element twice per AudioContext lifetime.
const wrappedElements = new WeakMap<HTMLMediaElement, MediaElementAudioSourceNode>();

function getOrCreateCtx(): AudioContext {
  if (current?.ctx) return current.ctx;
  const Ctor: typeof AudioContext =
    (window as any).AudioContext || (window as any).webkitAudioContext;
  return new Ctor();
}

export function getAudioMix(): NodeSet | null {
  return current;
}

/**
 * Attach the WebAudio graph to the given video element and (optionally) an
 * extra <audio> URL. Call again when the extra URL changes — the source node
 * for the video is preserved (wrapping an element twice throws), only the
 * extra chain is rewired.
 */
export function attachAudioMix(
  videoEl: HTMLMediaElement,
  extraUrl: string | null,
): NodeSet {
  const ctx = getOrCreateCtx();
  let srcNode = wrappedElements.get(videoEl);
  if (!srcNode) {
    srcNode = ctx.createMediaElementSource(videoEl);
    wrappedElements.set(videoEl, srcNode);
  }
  const srcGain = current?.srcGain ?? ctx.createGain();
  try { srcNode.disconnect(); } catch { /* first wire */ }
  srcNode.connect(srcGain).connect(ctx.destination);

  // Extra chain. Reuse audio element if url unchanged, otherwise rebuild.
  let extraEl = current?.extraEl ?? null;
  let extraNode = current?.extraNode ?? null;
  let extraGain = current?.extraGain ?? ctx.createGain();

  const needNewExtra = extraUrl !== (extraEl?.src ?? null);
  if (needNewExtra) {
    // Tear down previous extra node (can be re-created for a new element).
    if (extraNode) {
      try { extraNode.disconnect(); } catch { /* */ }
    }
    if (extraEl) {
      try { extraEl.pause(); } catch { /* */ }
    }
    if (extraUrl) {
      extraEl = new Audio();
      extraEl.preload = "auto";
      // NO crossOrigin: blob: URLs are same-origin; setting `anonymous` on a
      // blob in Chromium can taint the node and silence it through WebAudio.
      extraEl.src = extraUrl;
      extraEl.load();
      extraNode = ctx.createMediaElementSource(extraEl);
      extraNode.connect(extraGain).connect(ctx.destination);
      // On some tabs, `play()` on the extra is ignored when metadata isn't
      // ready yet (even though duration will resolve shortly after). Force
      // a re-sync once metadata arrives so a user that already hit play
      // doesn't sit in silence for the rest of the clip.
      extraEl.addEventListener("loadedmetadata", () => {
        if (!current) return;
        // Caller handles sync by listening to video events; we re-emit one
        // here via a micro event the preview component can listen to.
        window.dispatchEvent(new CustomEvent("cutstorm:extra-ready"));
      }, { once: true });
    } else {
      extraEl = null;
      extraNode = null;
    }
  }

  current = { ctx, srcNode, srcGain, extraGain, extraEl: extraEl as HTMLAudioElement, extraNode };
  // Debug handle for e2e tests: lets Playwright inspect the graph state
  // without mocking WebAudio. Not used in production.
  (window as any).__cutstorm_mix = current;
  return current;
}

export function setSourceVolume(v: number): void {
  if (!current) return;
  current.srcGain.gain.value = Math.max(0, Math.min(2, v));
}

export function setExtraVolume(v: number): void {
  if (!current) return;
  current.extraGain.gain.value = Math.max(0, Math.min(2, v));
}

export async function resumeAudioContext(): Promise<void> {
  if (!current) return;
  if (current.ctx.state === "suspended") {
    try { await current.ctx.resume(); } catch { /* */ }
  }
}

/**
 * Sync the extra <audio> element to the video's current time / play state.
 * Call whenever the video's play, pause, seeking, ratechange fires.
 *
 * We play the extra element unconditionally while the video plays — if the
 * cursor is past extra.duration, the element naturally ends and emits
 * silence through the WebAudio graph. Gating by `extra.duration` was a bug
 * on first play, when metadata hadn't loaded yet (duration=NaN).
 */
export function syncExtraToVideo(
  video: HTMLMediaElement,
  trimIn: number = 0,
  mapTarget?: (videoTime: number) => number,
): void {
  const c = current;
  if (!c || !c.extraEl) return;
  const extra = c.extraEl;
  // Cut-preview mode passes a mapper: the extra track rides the CUT timeline
  // (the export cuts only the source, the extra track runs continuously).
  const target = mapTarget
    ? Math.max(0, mapTarget(video.currentTime))
    : Math.max(0, video.currentTime - trimIn);
  if (Number.isFinite(target) && Math.abs(extra.currentTime - target) > 0.15) {
    try { extra.currentTime = target; } catch { /* */ }
  }
  if (video.paused) {
    if (!extra.paused) extra.pause();
  } else {
    if (extra.paused) extra.play().catch(() => {});
  }
}

/**
 * Inverse of {@link syncExtraToVideo}: in loop mode the extra audio drives
 * the master clock and the video is repositioned every animation frame.
 *
 * `master` = `extraEl.currentTime`; phase = `master % loopClipDuration`;
 * video target = `trimIn + phase`. Returns the master clock so the caller
 * can publish it as `currentTime` for the rest of the editor.
 */
export function syncVideoToLoopedExtra(
  video: HTMLMediaElement,
  trimIn: number,
  loopClipDuration: number,
): { master: number; videoTarget: number } | null {
  const c = current;
  if (!c || !c.extraEl) return null;
  const extra = c.extraEl;
  const master = extra.currentTime;
  if (!Number.isFinite(master)) return null;
  const phase = loopClipDuration > 0 ? (master % loopClipDuration) : 0;
  const target = trimIn + phase;
  if (Number.isFinite(target) && Math.abs(video.currentTime - target) > 0.05) {
    try { video.currentTime = target; } catch { /* */ }
  }
  // Mirror play/pause from the video element to the extra (the user's
  // play button still targets the video element). When extra is the master,
  // pausing video must also pause extra.
  if (video.paused) {
    if (!extra.paused) extra.pause();
  } else {
    if (extra.paused) extra.play().catch(() => {});
  }
  return { master, videoTarget: target };
}
