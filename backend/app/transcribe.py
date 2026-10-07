from __future__ import annotations

import functools
import json
import logging
import os
import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Iterator, Optional

from .models import Segment, Word

log = logging.getLogger(__name__)


@dataclass
class ProbeInfo:
    duration: float
    width: int
    height: int
    is_audio_only: bool = False
    has_audio: bool = True


def probe(video: Path) -> ProbeInfo:
    out = subprocess.run(
        [
            "ffprobe",
            "-v", "error",
            "-show_entries", "stream=codec_type,width,height:format=duration",
            "-of", "json",
            str(video),
        ],
        capture_output=True,
        check=True,
        text=True,
    )
    data = json.loads(out.stdout)
    streams = data.get("streams", [])
    fmt = data.get("format", {})
    duration = float(fmt.get("duration", 0.0))
    vid = next((s for s in streams if s.get("codec_type") == "video"), None)
    aud = next((s for s in streams if s.get("codec_type") == "audio"), None)
    if vid is None:
        if aud is None:
            raise RuntimeError(f"no media streams in {video}")
        return ProbeInfo(duration=duration, width=0, height=0, is_audio_only=True, has_audio=True)
    return ProbeInfo(
        duration=duration,
        width=int(vid.get("width", 0)),
        height=int(vid.get("height", 0)),
        is_audio_only=False,
        has_audio=aud is not None,
    )


import threading as _threading
import time as _time

_whisper_models: dict[str, object] = {}
_align_models: dict[str, tuple[object, dict]] = {}
# Guards model loading. Without it, two concurrent _get_fw_model calls both
# miss the cache, both load the same 3 GB blob from disk, and fight for
# CPU / I/O — observed taking 2× longer on parallel uploads.
_whisper_model_lock = _threading.Lock()
_align_model_lock = _threading.Lock()

# Idle-unload bookkeeping: `_last_activity` is touched whenever a model is
# loaded or a transcription finishes; `_active_transcribes` keeps the idle
# sweeper from evicting a model that a running job still needs.
_last_activity: float = _time.monotonic()
_active_transcribes: int = 0


def _touch_activity() -> None:
    global _last_activity
    _last_activity = _time.monotonic()


def _unload_idle_models(idle_sec: float, now: float | None = None, force: bool = False) -> list[str]:
    """Drop cached ASR/alignment models after `idle_sec` without activity.

    Returns the names of the evicted models (empty when nothing was evicted).
    Never evicts while a transcription is in flight — callers re-touch the
    activity timestamp when a run ends. `force=True` skips the idle-time
    check (manual reload) but keeps the in-flight guard.
    """
    if _active_transcribes > 0:
        return []
    if not force:
        if idle_sec <= 0:
            return []
        now = _time.monotonic() if now is None else now
        if now - _last_activity < idle_sec:
            return []
    unloaded: list[str] = []
    with _whisper_model_lock:
        for name in list(_whisper_models):
            unloaded.append(f"asr:{name}")
            del _whisper_models[name]
    with _align_model_lock:
        for lang in list(_align_models):
            unloaded.append(f"align:{lang}")
            del _align_models[lang]
    return unloaded


def _track_activity(fn):
    """Mark a transcription as in-flight so the idle sweeper can't evict the
    models it depends on, and re-touch activity when it finishes."""
    @functools.wraps(fn)
    def wrapper(*args, **kwargs):
        global _active_transcribes
        _active_transcribes += 1
        try:
            return fn(*args, **kwargs)
        finally:
            _active_transcribes -= 1
            _touch_activity()
    return wrapper


# --- model download watchdog ------------------------------------------------
# huggingface_hub has no stall timeout for in-flight downloads: a silently
# dropped connection leaves `snapshot_download` hung forever and the caller
# (and its model lock) with it. We load models in a supervised thread while
# polling the HF cache for `*.incomplete` blob growth; no growth for
# WHISPER_DOWNLOAD_STALL_SEC → raise so the retry loop can re-attempt.
_MODEL_RETRY_ATTEMPTS = 3
_MODEL_RETRY_BACKOFF_SEC = 2.0

_download_state_lock = _threading.Lock()
# what / bytes / active / error — snapshot for GET /api/model/status.
_download_state: dict = {"what": None, "bytes": 0, "active": False, "error": None}
_download_listeners: list[Callable[[str, int], None]] = []


def _incomplete_bytes() -> int:
    """Total size of every in-flight HF blob under MODELS_DIR. Concurrent
    downloads (asr + align) share one counter — fine for progress display and
    stall detection, which only care that *something* is still moving."""
    total = 0
    try:
        for p in Path(_models_dir()).glob("models--*/blobs/*.incomplete"):
            try:
                total += p.stat().st_size
            except OSError:
                pass
    except OSError:
        pass
    return total


def download_status() -> dict:
    with _download_state_lock:
        st = dict(_download_state)
    st["downloaded_mb"] = round(st.pop("bytes", 0) / (1024 * 1024), 1)
    return st


def reset_download_state() -> None:
    with _download_state_lock:
        _download_state.update(what=None, bytes=0, active=False, error=None)


def add_download_listener(cb: Callable[[str, int], None]):
    """Register a progress listener (what, bytes). Returns an unsubscribe fn."""
    with _download_state_lock:
        _download_listeners.append(cb)

    def _remove() -> None:
        try:
            with _download_state_lock:
                _download_listeners.remove(cb)
        except ValueError:
            pass

    return _remove


def _notify_download(what: str, nbytes: int) -> None:
    with _download_state_lock:
        _download_state.update(what=what, bytes=nbytes, active=True, error=None)
        listeners = list(_download_listeners)
    for cb in listeners:
        try:
            cb(what, nbytes)
        except Exception:  # pragma: no cover
            pass


def _run_with_download_watchdog(load_fn, what: str):
    """Run `load_fn` in a supervised thread; raise when its HF download stalls.

    Stall detection only engages after at least one byte of observed growth
    (a cold disk-load or a pre-restart stale blob must not trip it). An
    absolute cap bounds even the metadata-resolve phase.
    """
    stall_sec = float(os.environ.get("WHISPER_DOWNLOAD_STALL_SEC", "60"))
    max_sec = float(os.environ.get("WHISPER_DOWNLOAD_MAX_SEC", "1800"))
    result: dict = {}

    def runner() -> None:
        try:
            result["value"] = load_fn()
        except BaseException as exc:  # noqa: BLE001 — re-raised below
            result["error"] = exc

    th = _threading.Thread(target=runner, name=f"model-load-{what}", daemon=True)
    th.start()
    t_start = _time.monotonic()
    last_bytes = _incomplete_bytes()
    last_growth = t_start
    last_push = 0.0
    grew_once = False

    while th.is_alive():
        th.join(timeout=2.0)
        if not th.is_alive():
            break
        now = _time.monotonic()
        now_bytes = _incomplete_bytes()
        if now_bytes > last_bytes:
            last_bytes = now_bytes
            last_growth = now
            grew_once = True
        if now - last_push >= 1.0:
            _notify_download(what, now_bytes)
            last_push = now
        if grew_once and now - last_growth >= stall_sec:
            raise RuntimeError(
                f"model download {what} stalled for {stall_sec:.0f}s "
                f"({last_bytes} bytes) — connection to huggingface.co likely dropped"
            )
        if now - t_start >= max_sec:
            raise RuntimeError(
                f"model load {what} exceeded {max_sec:.0f}s — giving up"
            )

    if "error" in result:
        raise result["error"]
    _notify_download(what, last_bytes)
    return result.get("value")


def _load_model_with_retries(what: str, load_fn):
    """`load_fn` with stall-watchdog + bounded retries. Terminal state is
    mirrored into `_download_state` so /api/model/status can surface it."""
    last_exc: Exception | None = None
    for attempt in range(1, _MODEL_RETRY_ATTEMPTS + 1):
        try:
            value = _run_with_download_watchdog(load_fn, what)
            with _download_state_lock:
                _download_state.update(what=what, active=False, error=None)
            return value
        except Exception as exc:
            last_exc = exc
            log.warning(
                "model.load_retry what=%s attempt=%d/%d err=%s",
                what, attempt, _MODEL_RETRY_ATTEMPTS, exc,
            )
            _time.sleep(_MODEL_RETRY_BACKOFF_SEC * attempt)
    msg = str(last_exc)
    with _download_state_lock:
        _download_state.update(what=what, active=False, error=msg)
    raise RuntimeError(f"failed to load {what} after {_MODEL_RETRY_ATTEMPTS} attempts: {msg}") from last_exc


def _device() -> str:
    return os.environ.get("WHISPER_DEVICE", "cpu")


def _compute() -> str:
    return os.environ.get("WHISPER_COMPUTE", "int8")


def _models_dir() -> str:
    return os.environ.get("MODELS_DIR", "/data/models")


def _skip_align() -> bool:
    return os.environ.get("WHISPERX_SKIP_ALIGN", "0") == "1"


def _get_fw_model(name: Optional[str]):
    from faster_whisper import WhisperModel
    import time as _t

    env_name = os.environ.get("WHISPER_MODEL", "small")
    resolved = name or env_name
    if resolved in _whisper_models:
        log.info("whisper.model_cached name=%s", resolved)
        _touch_activity()
        return _whisper_models[resolved]
    with _whisper_model_lock:
        # Double-check: another thread may have finished loading while we
        # were waiting on the lock.
        if resolved in _whisper_models:
            log.info("whisper.model_cached name=%s (after wait)", resolved)
            _touch_activity()
            return _whisper_models[resolved]
        log.info("whisper.model_loading name=%s device=%s compute=%s", resolved, _device(), _compute())
        t0 = _t.perf_counter()
        m = _load_model_with_retries(
            f"asr:{resolved}",
            lambda: WhisperModel(
                resolved,
                device=_device(),
                compute_type=_compute(),
                download_root=_models_dir(),
            ),
        )
        log.info("whisper.model_loaded name=%s elapsed=%.1fs", resolved, _t.perf_counter() - t0)
        _whisper_models[resolved] = m
        _touch_activity()
        return m


def _get_align_model(language: str):
    import whisperx
    import time as _t

    if language in _align_models:
        log.info("align.model_cached lang=%s", language)
        _touch_activity()
        return _align_models[language]
    with _align_model_lock:
        if language in _align_models:
            log.info("align.model_cached lang=%s (after wait)", language)
            _touch_activity()
            return _align_models[language]
        log.info("align.model_loading lang=%s device=%s", language, _device())
        t0 = _t.perf_counter()
        model, meta = _load_model_with_retries(
            f"align:{language}",
            lambda: whisperx.load_align_model(
                language_code=language,
                device=_device(),
                model_dir=_models_dir(),
            ),
        )
        log.info("align.model_loaded lang=%s elapsed=%.1fs", language, _t.perf_counter() - t0)
        _align_models[language] = (model, meta)
        _touch_activity()
    return model, meta


def _interpolate_word_timings(
    raw_words: list[dict],
    seg_start: float,
    seg_end: float,
) -> list[Word]:
    """Fill in missing start/end via linear interpolation between aligned words.

    whisperX's forced alignment can fail to pin a precise start/end for short
    function words, OOV tokens or noisy spots. The library itself uses
    `interpolate_nans()` for segment ends; we do the same at the word level so
    word/karaoke modes don't drop any words.
    """
    items: list[list] = []
    for w in raw_words:
        txt = str(w.get("word", "")).strip()
        if not txt:
            continue
        s = w.get("start")
        e = w.get("end")
        items.append([
            txt,
            float(s) if s is not None else None,
            float(e) if e is not None else None,
        ])

    n = len(items)
    if n == 0:
        return []

    # If nothing was aligned at all, evenly split the segment.
    if all(it[1] is None for it in items):
        total = max(seg_end - seg_start, 0.01)
        step = total / n
        return [
            Word(start=seg_start + i * step, end=seg_start + (i + 1) * step, text=it[0])
            for i, it in enumerate(items)
        ]

    starts = [it[1] for it in items]
    ends = [it[2] for it in items]

    # Pass 1: fill missing starts via linear interpolation between known anchors.
    i = 0
    while i < n:
        if starts[i] is not None:
            i += 1
            continue
        prev_t = seg_start
        for k in range(i - 1, -1, -1):
            if ends[k] is not None:
                prev_t = ends[k]
                break
            if starts[k] is not None:
                prev_t = starts[k]
                break
        j = i
        while j < n and starts[j] is None:
            j += 1
        next_t = starts[j] if j < n else seg_end
        gap = max(next_t - prev_t, 0.01)
        step = gap / (j - i)
        for k in range(i, j):
            starts[k] = prev_t + (k - i) * step
            if ends[k] is None:
                ends[k] = prev_t + (k - i + 1) * step
        i = j

    # Pass 2: fill missing ends.
    for i in range(n):
        if ends[i] is None:
            ends[i] = starts[i + 1] if i + 1 < n and starts[i + 1] is not None else seg_end

    out: list[Word] = []
    for i, it in enumerate(items):
        s = float(starts[i]) if starts[i] is not None else seg_start
        e = float(ends[i]) if ends[i] is not None else max(s + 0.05, seg_end)
        if e <= s:
            e = s + 0.05
        out.append(Word(start=s, end=e, text=it[0]))
    return out


def _synthesize_words(text: str, start: float, end: float) -> list[Word]:
    toks = text.strip().split()
    if not toks:
        return []
    total = max(end - start, 0.01)
    step = total / len(toks)
    return [
        Word(
            start=start + i * step,
            end=start + (i + 1) * step,
            text=w,
        )
        for i, w in enumerate(toks)
    ]


def _raw_transcribe_stream(
    video: Path,
    language: Optional[str],
    model_name: Optional[str],
) -> Iterator[tuple[dict, object]]:
    """Yield (segment_dict, info) tuples from faster-whisper as they arrive."""
    model = _get_fw_model(model_name)
    lang = None if language in (None, "auto") else language
    segments, info = model.transcribe(
        str(video),
        language=lang,
        beam_size=5,
        # Anti-hallucination / anti-cross-lingual-leak: both taken from the
        # whisperX pipeline's defaults. Without condition_on_previous_text=False
        # a mis-detected first segment locks the model into the wrong language
        # for the whole file and it starts "translating" rather than
        # transcribing. VAD filter gives cleaner segment boundaries and avoids
        # the model inventing speech during silence.
        condition_on_previous_text=False,
        vad_filter=True,
    )
    for seg in segments:
        yield (
            {
                "start": float(seg.start),
                "end": float(seg.end),
                "text": seg.text.strip(),
            },
            info,
        )


ProgressCb = Callable[[str, int], None]
SegmentCb = Callable[[Segment, int, int], None]  # (segment, index, percent)
CancelCheck = Callable[[], bool]


def _align_one(
    raw_seg: dict,
    audio,
    align_model,
    meta,
    device: str,
) -> list[Word]:
    """Run wav2vec2 alignment on a single whisper segment. Returns words[]."""
    import whisperx
    try:
        aligned = whisperx.align(
            [raw_seg],
            align_model,
            meta,
            audio,
            device=device,
            return_char_alignments=False,
        )
    except Exception as exc:  # pragma: no cover
        log.warning("align.segment_failed t=%.2f-%.2f err=%s", raw_seg["start"], raw_seg["end"], exc)
        return _synthesize_words(raw_seg["text"], raw_seg["start"], raw_seg["end"])

    out_segs = aligned.get("segments", [])
    if not out_segs:
        return _synthesize_words(raw_seg["text"], raw_seg["start"], raw_seg["end"])
    s = out_segs[0]
    seg_start = float(s.get("start", raw_seg["start"]))
    seg_end = float(s.get("end", raw_seg["end"]))
    words = _interpolate_word_timings(s.get("words", []) or [], seg_start, seg_end)
    if not words:
        words = _synthesize_words(raw_seg["text"], seg_start, seg_end)
    return words


@_track_activity
def transcribe_stream(
    video: Path,
    language: Optional[str] = None,
    model_name: Optional[str] = None,
    on_segment: Optional[SegmentCb] = None,
    on_progress: Optional[ProgressCb] = None,
    cancel_check: Optional[CancelCheck] = None,
) -> tuple[list[Segment], Optional[str]]:
    """Streaming pipeline: each whisper segment is per-segment aligned and
    pushed via `on_segment(seg, index, percent)` as soon as its word timings
    are ready. Returns (all_segments, detected_language) when done.

    `cancel_check()` polled between segments; True → stop early.
    """
    import time as _t

    duration = probe(video).duration
    log.info(
        "transcribe_stream.start duration=%.2fs language_hint=%s model=%s",
        duration, language, model_name,
    )

    # Lazy-loaded on first segment; kept across iterations via closure-ish dict
    # (plain vars would reassign but numpy array truthiness confuses naive
    # comparisons, so we use explicit flags).
    audio = None
    align_model = None
    align_meta = None
    align_ready = False
    align_failed = False
    detected_lang: Optional[str] = None
    out: list[Segment] = []
    idx = 0
    t0 = _t.perf_counter()

    want_align = not _skip_align()

    for raw_seg, info in _raw_transcribe_stream(video, language, model_name):
        if cancel_check and cancel_check():
            log.info("transcribe_stream.cancelled after %d segments", len(out))
            return (out, detected_lang)

        # Resolve detected language once (on first segment) so we can load
        # align model lazily.
        if detected_lang is None:
            if language and language != "auto":
                detected_lang = language
            elif info is not None:
                detected_lang = getattr(info, "language", None)
            log.info("transcribe_stream.language detected=%s", detected_lang)

        # Lazy-load audio + align model on first segment.
        if want_align and detected_lang and not align_ready and not align_failed:
            try:
                import whisperx
                audio = whisperx.load_audio(str(video))
                align_model, align_meta = _get_align_model(detected_lang)
                align_ready = True
            except Exception as exc:
                log.warning("align.setup_failed err=%s — falling back to synthesized words", exc)
                align_failed = True

        words: list[Word]
        if align_ready:
            words = _align_one(raw_seg, audio, align_model, align_meta, _device())
        else:
            words = _synthesize_words(raw_seg["text"], raw_seg["start"], raw_seg["end"])

        seg = Segment(
            start=raw_seg["start"],
            end=raw_seg["end"],
            text=raw_seg["text"],
            words=words,
        )
        out.append(seg)
        pct = max(0, min(99, int(raw_seg["end"] / duration * 100))) if duration > 0 else 0
        log.debug("transcribe_stream.segment idx=%d t=%.2f-%.2f words=%d pct=%d",
                  idx, seg.start, seg.end, len(words), pct)
        if on_segment:
            on_segment(seg, idx, pct)
        if on_progress:
            on_progress("transcribe", pct)
        idx += 1

    if on_progress:
        on_progress("transcribe", 100)
    log.info(
        "transcribe_stream.done segments=%d lang=%s elapsed=%.1fs",
        len(out), detected_lang, _t.perf_counter() - t0,
    )
    return (out, detected_lang)


@_track_activity
def transcribe(
    video: Path,
    language: Optional[str] = None,
    model_name: Optional[str] = None,
    on_progress: Optional[ProgressCb] = None,
) -> tuple[list[tuple[float, float, str, list[Word]]], Optional[str]]:
    """Transcribe with word-level timings. Returns (segments, detected_language)."""
    import time as _t

    duration = probe(video).duration
    log.info(
        "transcribe.start duration=%.2fs language_hint=%s model_hint=%s",
        duration,
        language,
        model_name,
    )
    raw: list[dict] = []
    info = None
    t_asr = _t.perf_counter()
    for seg, inf in _raw_transcribe_stream(video, language, model_name):
        raw.append(seg)
        info = inf
        log.debug("asr.segment t=%.2f-%.2f text=%r", seg["start"], seg["end"], seg["text"][:80])
        if on_progress and duration > 0:
            pct = max(0, min(99, int(seg["end"] / duration * 100)))
            on_progress("transcribe", pct)
    log.info(
        "asr.done segments=%d elapsed=%.1fs",
        len(raw),
        _t.perf_counter() - t_asr,
    )

    if on_progress:
        on_progress("transcribe", 100)

    detected_lang: Optional[str] = None
    if language and language != "auto":
        detected_lang = language
    elif info is not None:
        detected_lang = getattr(info, "language", None)
    log.info("asr.language detected=%s (user_hint=%s)", detected_lang, language)

    if not raw:
        log.warning("asr.empty no segments produced — returning empty result")
        return ([], detected_lang)

    if _skip_align():
        log.info("align.skipped WHISPERX_SKIP_ALIGN=1 — using synthesized word timings")
        if on_progress:
            on_progress("align", 100)
        return (
            [
                (r["start"], r["end"], r["text"], _synthesize_words(r["text"], r["start"], r["end"]))
                for r in raw
            ],
            detected_lang,
        )
    if not detected_lang:
        log.warning("align.skipped no detected_lang — using synthesized word timings")
        if on_progress:
            on_progress("align", 100)
        return (
            [
                (r["start"], r["end"], r["text"], _synthesize_words(r["text"], r["start"], r["end"]))
                for r in raw
            ],
            detected_lang,
        )

    log.info("align.start lang=%s segments=%d", detected_lang, len(raw))
    if on_progress:
        on_progress("align", 0)
    t_align = _t.perf_counter()

    try:
        import whisperx

        align_model, meta = _get_align_model(detected_lang)
        audio = whisperx.load_audio(str(video))
        aligned = whisperx.align(
            raw,
            align_model,
            meta,
            audio,
            device=_device(),
            return_char_alignments=False,
        )
    except Exception as exc:  # pragma: no cover
        log.warning("align.failed lang=%s err=%s — falling back to synthesized timings", detected_lang, exc)
        if on_progress:
            on_progress("align", 100)
        return (
            [
                (r["start"], r["end"], r["text"], _synthesize_words(r["text"], r["start"], r["end"]))
                for r in raw
            ],
            detected_lang,
        )

    if on_progress:
        on_progress("align", 100)

    out: list[tuple[float, float, str, list[Word]]] = []
    total_words = 0
    skipped_in_align = 0
    for seg in aligned.get("segments", []):
        seg_start = float(seg.get("start", 0.0))
        seg_end = float(seg.get("end", seg_start))
        seg_text = str(seg.get("text", "")).strip()
        raw_words = seg.get("words", []) or []
        skipped_in_align += sum(
            1 for w in raw_words if w.get("start") is None or w.get("end") is None
        )
        words = _interpolate_word_timings(raw_words, seg_start, seg_end)
        if not words:
            words = _synthesize_words(seg_text, seg_start, seg_end)
        total_words += len(words)
        out.append((seg_start, seg_end, seg_text, words))
    if skipped_in_align:
        log.info("align.interpolated %d words had missing timings (filled in)", skipped_in_align)
    log.info(
        "align.done lang=%s segments=%d words=%d elapsed=%.1fs",
        detected_lang,
        len(out),
        total_words,
        _t.perf_counter() - t_align,
    )
    return (out, detected_lang)
