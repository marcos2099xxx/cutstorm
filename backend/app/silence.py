from __future__ import annotations

from typing import Iterable

from .models import Segment, Word


KeepInterval = tuple[float, float]


def cuts_from_words(
    segments: Iterable[Segment],
    threshold_sec: float,
    padding_sec: float,
    total_duration: float,
) -> list[KeepInterval]:
    """Compute KEEP intervals by removing silences longer than threshold between words.

    - `threshold_sec`: only gaps strictly longer than this are cut.
    - `padding_sec`: preserved on each side of every word (so we don't clip articulation).
    - `total_duration`: used to clamp the final interval and drop trailing silence.
    """
    words = sorted(
        (w for seg in segments for w in (seg.words or [])),
        key=lambda w: w.start,
    )
    if not words:
        if total_duration > 0:
            return [(0.0, total_duration)]
        return []

    keep: list[KeepInterval] = []
    cur_start = max(0.0, words[0].start - padding_sec)
    cur_end = words[0].end + padding_sec

    for prev_w, w in zip(words, words[1:]):
        gap = w.start - prev_w.end
        if gap > threshold_sec:
            keep.append((cur_start, cur_end))
            cur_start = max(cur_end, w.start - padding_sec)
        cur_end = max(cur_end, w.end + padding_sec)

    if total_duration > 0:
        cur_end = min(total_duration, cur_end)
    if cur_end > cur_start:
        keep.append((cur_start, cur_end))

    # Merge adjacent intervals that touch/overlap (can happen when padding bridges gaps).
    merged: list[KeepInterval] = []
    for s, e in keep:
        if merged and s <= merged[-1][1] + 1e-6:
            merged[-1] = (merged[-1][0], max(merged[-1][1], e))
        else:
            merged.append((s, e))
    return merged


def _map_time(t: float, keeps: list[KeepInterval]) -> float | None:
    offset = 0.0
    for ks, ke in keeps:
        if ks <= t <= ke:
            return offset + (t - ks)
        offset += ke - ks
    return None


def retime_segments(
    segments: Iterable[Segment],
    keeps: list[KeepInterval],
) -> list[Segment]:
    """Project segments/words onto the new time base after cuts."""
    out: list[Segment] = []
    for seg in segments:
        new_words: list[Word] = []
        for w in seg.words or []:
            ns = _map_time(w.start, keeps)
            ne = _map_time(w.end, keeps)
            if ns is None or ne is None or ne <= ns:
                continue
            new_words.append(Word(start=ns, end=ne, text=w.text))
        if new_words:
            out.append(
                Segment(
                    start=new_words[0].start,
                    end=new_words[-1].end,
                    text=seg.text,
                    words=new_words,
                )
            )
            continue
        # No word timings — fall back to projecting the segment bounds.
        ns = _map_time(seg.start, keeps)
        ne = _map_time(seg.end, keeps)
        if ns is not None and ne is not None and ne > ns:
            out.append(Segment(start=ns, end=ne, text=seg.text, words=[]))
    return out


def kept_duration(keeps: list[KeepInterval]) -> float:
    return sum(e - s for s, e in keeps)


def build_select_expr(keeps: list[KeepInterval]) -> str:
    """ffmpeg select/aselect expression that keeps frames within any interval.

    Terms are combined as a balanced tree of `+` instead of a flat chain:
    ffmpeg's expression parser recurses per nested operator and fails with
    ENOMEM past its 100-level stack guard (libavutil/eval.c), so a flat chain
    breaks exports of long videos with many silence cuts.
    """
    if not keeps:
        return "0"
    terms = [f"between(t,{s:.3f},{e:.3f})" for s, e in keeps]
    while len(terms) > 1:
        merged = [f"({a}+{b})" for a, b in zip(terms[0::2], terms[1::2])]
        if len(terms) % 2:
            merged.append(terms[-1])
        terms = merged
    return terms[0]
