import { useRef, useState } from "react";
import { importSubtitles } from "../api";
import { getAudioMix } from "../audioMix";
import { newJobId, openProgressWs } from "../progress";
import { useStore } from "../store";

function fmtTimestamp(t: number): string {
  if (!Number.isFinite(t) || t < 0) t = 0;
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  const cs = Math.floor((t - Math.floor(t)) * 100);
  return `${m}:${s.toString().padStart(2, "0")}.${cs.toString().padStart(2, "0")}`;
}

/** Accent/case-insensitive match key for the transcript search. */
function norm(s: string): string {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

export function SegmentList() {
  const segments = useStore((s) => s.segments);
  const segmentsSource = useStore((s) => s.segmentsSource);
  const segmentsExtra = useStore((s) => s.segmentsExtra);
  const subtitleTrack = useStore((s) => s.subtitleTrack);
  const setSubtitleTrack = useStore((s) => s.setSubtitleTrack);
  const updateSegment = useStore((s) => s.updateSegment);
  const deleteSegment = useStore((s) => s.deleteSegment);
  const currentTime = useStore((s) => s.currentTime);
  const hasVideo = useStore((s) => !!s.videoUrl);
  const videoId = useStore((s) => s.videoId);
  const subsStreaming = useStore((s) => s.subsStreaming);
  const extraSubsStreaming = useStore((s) => s.extraSubsStreaming);
  const progressPhase = useStore((s) => s.progressPhase);
  const progressPercent = useStore((s) => s.progressPercent);
  const seekTo = useStore((s) => s.seekTo);
  const setError = useStore((s) => s.setError);
  const setProgress = useStore((s) => s.setProgress);
  const replaceSourceSegments = useStore((s) => s.replaceSourceSegments);
  const replaceInSegments = useStore((s) => s.replaceInSegments);
  const mergeSegmentWithNext = useStore((s) => s.mergeSegmentWithNext);

  const [query, setQuery] = useState("");
  const [showReplace, setShowReplace] = useState(false);
  const [findText, setFindText] = useState("");
  const [replaceText, setReplaceText] = useState("");
  const [alignImport, setAlignImport] = useState(false);
  const [importing, setImporting] = useState(false);
  const importRef = useRef<HTMLInputElement>(null);

  if (!hasVideo) return null;

  // Clicking a row jumps the playhead to that segment. Extra-track captions
  // live on the extra-audio timeline, so seek the extra element and let the
  // video follow at trim-in offset.
  function jumpTo(t: number) {
    const s = useStore.getState();
    if (s.subtitleTrack === "extra") {
      const extra = getAudioMix()?.extraEl;
      if (extra) {
        try { extra.currentTime = t; } catch { /* */ }
      }
      s.seekTo(t + s.trimRange.in_sec);
      return;
    }
    seekTo(t);
  }

  async function onImportFile(file: File) {
    if (!videoId) return;
    if (
      useStore.getState().segmentsSource.length > 0 &&
      !window.confirm("Replace the current transcript with the imported subtitles?")
    ) {
      return;
    }
    setImporting(true);
    setError(null);
    const jobId = newJobId();
    let ws: WebSocket | null = null;
    try {
      if (alignImport) {
        setProgress("align", 0);
        ws = await openProgressWs(jobId);
      }
      const res = await importSubtitles(videoId, file, { align: alignImport, jobId });
      replaceSourceSegments(res.segments);
      setSubtitleTrack("source");
      setProgress("done", 100);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setProgress("idle", 0);
    } finally {
      try { ws?.close(); } catch { /* */ }
      setImporting(false);
    }
  }

  const activeIdx = segments.findIndex(
    (seg) => currentTime >= seg.start && currentTime <= seg.end,
  );

  // The strip + spinner indicators show whichever track is currently being
  // transcribed AND is the active tab in the editor.
  const sourceTranscribing = subsStreaming && progressPhase === "transcribe";
  const extraTranscribing = extraSubsStreaming;
  const transcribing =
    subtitleTrack === "extra" ? extraTranscribing : sourceTranscribing;
  const extraAvailable = segmentsExtra.length > 0 || extraSubsStreaming;

  const q = norm(query.trim());
  const rows = q
    ? segments
        .map((seg, i) => ({ seg, i }))
        .filter(({ seg }) => norm(seg.text).includes(q))
    : segments.map((seg, i) => ({ seg, i }));

  return (
    <div className="pane scroll" data-testid="segments-panel">
      <div className="pane-header">
        <h2>Transcript</h2>
        <span className="topbar-meta">{segments.length}</span>
      </div>
      <div className="subtitle-track-tabs" data-testid="subtitle-track-tabs">
        <button
          type="button"
          className={`subtitle-track-tab${subtitleTrack === "source" ? " active" : ""}`}
          data-testid="subtitle-track-source"
          aria-pressed={subtitleTrack === "source"}
          onClick={() => setSubtitleTrack("source")}
        >
          Source <span className="subtitle-track-count">{segmentsSource.length}</span>
          {sourceTranscribing && <span className="subtitle-track-dot" aria-label="transcribing" />}
        </button>
        <button
          type="button"
          className={`subtitle-track-tab${subtitleTrack === "extra" ? " active" : ""}`}
          data-testid="subtitle-track-extra"
          aria-pressed={subtitleTrack === "extra"}
          disabled={!extraAvailable}
          onClick={() => setSubtitleTrack("extra")}
          title={extraAvailable ? "Switch to extra-audio captions" : "Generate captions from extra audio first"}
        >
          Extra <span className="subtitle-track-count">{segmentsExtra.length}</span>
          {extraTranscribing && <span className="subtitle-track-dot" aria-label="transcribing" />}
        </button>
      </div>
      <div className="subtitle-tools">
        <input
          type="text"
          className="segment-search"
          data-testid="segment-search"
          placeholder="Search transcript…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {q && (
          <span className="segment-search-count" data-testid="segment-search-count">
            {rows.length} of {segments.length}
          </span>
        )}
        <button
          type="button"
          className="segment-tool"
          data-testid="segment-replace-toggle"
          aria-pressed={showReplace}
          onClick={() => setShowReplace((v) => !v)}
        >
          Replace
        </button>
        <button
          type="button"
          className="segment-tool"
          data-testid="import-subs-button"
          disabled={importing}
          onClick={() => importRef.current?.click()}
          title="Replace the transcript with an .srt/.vtt file"
        >
          {importing ? "Importing…" : "Import .srt/.vtt"}
        </button>
        <label
          className="segment-align"
          title="Run forced alignment against the audio for accurate word timings (slower)"
        >
          <input
            type="checkbox"
            data-testid="import-align"
            checked={alignImport}
            onChange={(e) => setAlignImport(e.target.checked)}
          />
          Align
        </label>
        <input
          ref={importRef}
          type="file"
          accept=".srt,.vtt,text/plain"
          data-testid="import-subs-input"
          style={{ display: "none" }}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void onImportFile(f);
            e.target.value = "";
          }}
        />
      </div>
      {showReplace && (
        <div className="segment-replace" data-testid="segment-replace-panel">
          <input
            type="text"
            data-testid="segment-replace-find"
            placeholder="Find"
            value={findText}
            onChange={(e) => setFindText(e.target.value)}
          />
          <input
            type="text"
            data-testid="segment-replace-with"
            placeholder="Replace with"
            value={replaceText}
            onChange={(e) => setReplaceText(e.target.value)}
          />
          <button
            type="button"
            data-testid="segment-replace-all"
            disabled={!findText}
            onClick={() => replaceInSegments(findText, replaceText)}
          >
            Replace all
          </button>
        </div>
      )}
      <div className="pane-body compact">
        {transcribing && segments.length > 0 && (
          <div className="transcribing-strip" data-testid="transcribing-strip">
            <span className="transcribing-dot" aria-hidden />
            <span>Transcribing… {segments.length} segment{segments.length === 1 ? "" : "s"} so far · {progressPercent}%</span>
          </div>
        )}
        {segments.length === 0 ? (
          transcribing ? (
            <div className="transcribing-empty" data-testid="transcribing-empty">
              <div className="transcribing-spinner-wrap" aria-hidden>
                <div className="transcribing-spinner" />
                <span className="transcribing-percent">{progressPercent}%</span>
              </div>
              <div className="transcribing-title">Transcribing with Whisper…</div>
              <div className="transcribing-hint">Segments will appear here as they're recognised.</div>
            </div>
          ) : (
            <p style={{ color: "var(--fg-muted)", fontSize: 13 }}>
              No speech detected yet.
            </p>
          )
        ) : rows.length === 0 ? (
          <p style={{ color: "var(--fg-muted)", fontSize: 13 }} data-testid="segment-search-empty">
            No matches for “{query.trim()}”.
          </p>
        ) : (
          <div className="segments" data-testid="segments-list">
            {rows.map(({ seg, i }) => (
              <div
                key={i}
                className={`segment${i === activeIdx ? " active" : ""}`}
                data-testid={`segment-${i}`}
                data-active={i === activeIdx ? "1" : "0"}
                title="Click to jump to this segment"
                onClick={(e) => {
                  if ((e.target as HTMLElement).closest("input,button")) return;
                  jumpTo(seg.start);
                }}
              >
                <button
                  type="button"
                  className="segment-jump"
                  data-testid={`segment-${i}-jump`}
                  aria-label={`jump to segment ${i}`}
                  title="Jump to this segment"
                  onClick={() => jumpTo(seg.start)}
                >
                  <svg viewBox="0 0 24 24" width="10" height="10" fill="currentColor" aria-hidden>
                    <path d="M8 5 L18 12 L8 19 Z" />
                  </svg>
                </button>
                <div className="segment-time">
                  <input
                    type="number"
                    step="0.1"
                    value={seg.start}
                    data-testid={`segment-${i}-start`}
                    aria-label={`start ${fmtTimestamp(seg.start)}`}
                    onMouseDown={(e) => {
                      if (document.activeElement !== e.currentTarget) jumpTo(seg.start);
                    }}
                    onChange={(e) =>
                      updateSegment(i, { start: Number(e.target.value) })
                    }
                  />
                  <input
                    type="number"
                    step="0.1"
                    value={seg.end}
                    data-testid={`segment-${i}-end`}
                    aria-label={`end ${fmtTimestamp(seg.end)}`}
                    onMouseDown={(e) => {
                      if (document.activeElement !== e.currentTarget) jumpTo(seg.end);
                    }}
                    onChange={(e) =>
                      updateSegment(i, { end: Number(e.target.value) })
                    }
                  />
                </div>
                <input
                  type="text"
                  className="segment-text"
                  value={seg.text}
                  data-testid={`segment-${i}-text`}
                  onMouseDown={(e) => {
                    if (document.activeElement !== e.currentTarget) jumpTo(seg.start);
                  }}
                  onChange={(e) => updateSegment(i, { text: e.target.value })}
                />
                <button
                  type="button"
                  className="segment-merge"
                  data-testid={`segment-${i}-merge`}
                  aria-label={`merge segment ${i} with next`}
                  title="Merge with next segment"
                  disabled={i + 1 >= segments.length}
                  onClick={() => mergeSegmentWithNext(i)}
                >
                  <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <path d="M6 5v4a4 4 0 0 0 4 4h8" />
                    <path d="M6 19v-4a4 4 0 0 1 4-4h8" />
                    <path d="M15 6l3 3-3 3" />
                  </svg>
                </button>
                <button
                  className="segment-del"
                  onClick={() => deleteSegment(i)}
                  data-testid={`segment-${i}-delete`}
                  aria-label={`delete segment ${i}`}
                  title="Delete segment (Del at playhead)"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
