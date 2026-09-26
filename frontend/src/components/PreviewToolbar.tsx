import { useEffect, useMemo, useState } from "react";
import { getAudioMix, resumeAudioContext } from "../audioMix";
import {
  computeKeepsForRange,
  cutTimeToOriginal,
  keepsDuration,
  mapToCutTime,
  snapToKeep,
} from "../silence";
import { useStore } from "../store";

/**
 * Custom video/audio controls rendered BELOW the preview frame (not inside
 * the media element). Native `<video controls>` overlays the bottom strip
 * and collides with the crop editor in custom-crop mode — this toolbar sits
 * outside the render area so controls stay reachable at every zoom.
 *
 * Includes: play/pause, stop (seek back to trim-in), scrubbable progress bar
 * constrained to the keep-range. Volume is intentionally omitted — the
 * Timeline below hosts per-track volume controls.
 */
export function PreviewToolbar() {
  const videoEl = useStore((s) => s.videoEl);
  const duration = useStore((s) => s.duration);
  const currentTime = useStore((s) => s.currentTime);
  const trimRange = useStore((s) => s.trimRange);
  const extraAudioId = useStore((s) => s.audio.extraAudioId);
  const extraAudioDuration = useStore((s) => s.audio.extraAudioDuration);
  const previewCut = useStore((s) => s.previewCut);
  const setPreviewCut = useStore((s) => s.setPreviewCut);
  const seekTo = useStore((s) => s.seekTo);
  const trim = useStore((s) => s.trim);
  const segmentsSource = useStore((s) => s.segmentsSource);
  const [playing, setPlaying] = useState(false);

  const trimIn = Math.max(0, trimRange.in_sec);
  const trimOut = trimRange.out_sec > 0 ? Math.min(trimRange.out_sec, duration || 0) : (duration || 0);
  const loopClipDuration = Math.max(0, trimOut - trimIn);
  const loopActive = !!trimRange.loop && extraAudioId !== null && extraAudioDuration > 0 && loopClipDuration > 0;

  const cutKeeps = useMemo(() => {
    if (!trim.enabled || !duration) return [];
    const out = trimRange.out_sec > 0 ? trimRange.out_sec : duration;
    return computeKeepsForRange(
      segmentsSource, trimRange.in_sec, out, trim.threshold_sec, trim.padding_sec,
    );
  }, [
    trim.enabled, trim.threshold_sec, trim.padding_sec,
    segmentsSource, trimRange.in_sec, trimRange.out_sec, duration,
  ]);
  // Cut mode only makes sense when there are real cuts and no loop clock.
  const hasCuts = !loopActive && cutKeeps.length > 0
    && keepsDuration(cutKeeps) < loopClipDuration - 0.05;
  const cutActive = previewCut && hasCuts;
  const cutDuration = keepsDuration(cutKeeps);

  useEffect(() => {
    if (!hasCuts && previewCut) setPreviewCut(false);
  }, [hasCuts, previewCut, setPreviewCut]);
  // In loop mode the master timeline is the extra audio (0 .. extraDur);
  // currentTime already mirrors extra.currentTime via the rAF loop. In cut
  // mode the scrub/clock track the CUT timeline (kept duration).
  const effectiveDuration = loopActive
    ? Math.max(0.01, extraAudioDuration)
    : cutActive
      ? Math.max(0.01, cutDuration)
      : Math.max(0.01, trimOut - trimIn);
  const progressVal = loopActive
    ? Math.max(0, Math.min(effectiveDuration, currentTime))
    : cutActive
      ? Math.max(0, Math.min(effectiveDuration, mapToCutTime(currentTime, cutKeeps)))
      : Math.max(0, Math.min(effectiveDuration, currentTime - trimIn));

  useEffect(() => {
    const v = videoEl;
    if (!v) { setPlaying(false); return; }
    setPlaying(!v.paused);
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    v.addEventListener("play", onPlay);
    v.addEventListener("pause", onPause);
    return () => {
      v.removeEventListener("play", onPlay);
      v.removeEventListener("pause", onPause);
    };
  }, [videoEl]);

  function togglePlay() {
    const v = videoEl;
    if (!v) return;
    // Resume the AudioContext INSIDE the click handler (user-gesture tick),
    // otherwise Chromium keeps it suspended and the extra track silently
    // drops all samples.
    resumeAudioContext();
    if (v.paused) v.play().catch(() => {});
    else v.pause();
  }

  function stop() {
    const v = videoEl;
    if (!v) return;
    v.pause();
    if (loopActive) {
      const extra = getAudioMix()?.extraEl;
      if (extra) try { extra.currentTime = 0; } catch { /* */ }
      v.currentTime = trimIn;
      return;
    }
    if (cutActive && cutKeeps.length) {
      v.currentTime = cutKeeps[0][0];
      return;
    }
    v.currentTime = trimIn;
  }

  function onSeek(e: React.ChangeEvent<HTMLInputElement>) {
    const v = videoEl;
    if (!v) return;
    const rel = Number(e.target.value);
    if (loopActive) {
      const extra = getAudioMix()?.extraEl;
      if (extra) {
        const m = Math.max(0, Math.min(extraAudioDuration, rel));
        try { extra.currentTime = m; } catch { /* */ }
        // Re-seat video into phase immediately for visual responsiveness.
        const phase = loopClipDuration > 0 ? (m % loopClipDuration) : 0;
        try { v.currentTime = trimIn + phase; } catch { /* */ }
      }
      return;
    }
    if (cutActive && cutKeeps.length) {
      // Scrub value is cut-timeline time → map back into the original clip.
      const tau = Math.max(0, Math.min(cutDuration, rel));
      v.currentTime = cutTimeToOriginal(tau, cutKeeps);
      return;
    }
    let target = Math.max(trimIn, Math.min(trimOut, trimIn + rel));
    // Cut mode: never land inside a silenced gap.
    if (previewCut && hasCuts) target = snapToKeep(target, cutKeeps);
    v.currentTime = target;
  }

  if (!videoEl) return null;

  return (
    <div className="player-toolbar" data-testid="player-toolbar">
      <button
        type="button"
        className="player-btn"
        data-testid="player-play"
        aria-label={playing ? "Pause" : "Play"}
        onClick={togglePlay}
      >
        {playing ? (
          <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden>
            <rect x="6" y="5" width="4" height="14" rx="1" />
            <rect x="14" y="5" width="4" height="14" rx="1" />
          </svg>
        ) : (
          <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden>
            <path d="M7 5 L19 12 L7 19 Z" />
          </svg>
        )}
      </button>
      <button
        type="button"
        className="player-btn"
        data-testid="player-stop"
        aria-label="Stop (return to trim in)"
        title="Stop — rewind to trim in"
        onClick={stop}
      >
        <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden>
          <rect x="6" y="6" width="12" height="12" rx="1" />
        </svg>
      </button>
      {hasCuts && (
        <div
          className="player-cut-toggle"
          data-testid="preview-cut-toggle"
          role="group"
          aria-label="Preview version"
        >
          <button
            type="button"
            className={`player-cut-btn${previewCut ? "" : " active"}`}
            data-testid="preview-mode-original"
            aria-pressed={!previewCut}
            onClick={() => setPreviewCut(false)}
            title="Play the original, uncut clip"
          >
            Original
          </button>
          <button
            type="button"
            className={`player-cut-btn${previewCut ? " active" : ""}`}
            data-testid="preview-mode-cut"
            aria-pressed={previewCut}
            onClick={() => {
              setPreviewCut(true);
              seekTo(useStore.getState().currentTime);
            }}
            title="Play the cut version — skips silenced gaps"
          >
            Cuts
          </button>
        </div>
      )}
      <input
        type="range"
        className="player-scrub"
        data-testid="player-scrub"
        min={0}
        max={effectiveDuration}
        step={0.05}
        value={progressVal}
        onChange={onSeek}
        aria-label="Seek"
      />
      <span className="player-time" data-testid="player-time">
        {fmt(cutActive ? mapToCutTime(currentTime, cutKeeps) : currentTime)}{" "}
        <span className="player-time-sep">/</span>{" "}
        {fmt(cutActive ? cutDuration : loopActive ? extraAudioDuration : duration)}
      </span>
    </div>
  );
}

function fmt(t: number): string {
  if (!Number.isFinite(t) || t < 0) t = 0;
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}
