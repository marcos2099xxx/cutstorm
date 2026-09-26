from __future__ import annotations

from app.models import Segment, Word
from app.silence import (
    build_select_expr,
    cuts_from_words,
    kept_duration,
    retime_segments,
)


def _seg(start, end, words):
    ws = [Word(start=s, end=e, text=t) for s, e, t in words]
    return Segment(start=start, end=end, text=" ".join(w.text for w in ws), words=ws)


def test_no_words_returns_full_duration() -> None:
    keeps = cuts_from_words([], threshold_sec=0.5, padding_sec=0.1, total_duration=10.0)
    assert keeps == [(0.0, 10.0)]


def test_no_silences_single_interval() -> None:
    # All gaps are 0.1 < threshold 0.5.
    seg = _seg(0.0, 3.0, [(0.0, 1.0, "a"), (1.1, 2.0, "b"), (2.1, 3.0, "c")])
    keeps = cuts_from_words([seg], threshold_sec=0.5, padding_sec=0.05, total_duration=3.0)
    assert len(keeps) == 1
    s, e = keeps[0]
    assert abs(s - 0.0) < 1e-6
    assert abs(e - 3.0) < 1e-6  # clamped to duration


def test_single_long_silence_produces_two_intervals() -> None:
    seg = _seg(0.0, 10.0, [(0.0, 1.0, "hi"), (5.0, 6.0, "bye")])
    keeps = cuts_from_words([seg], threshold_sec=0.5, padding_sec=0.1, total_duration=10.0)
    assert len(keeps) == 2
    # First keep: from start to first word end + padding.
    assert abs(keeps[0][0] - 0.0) < 1e-6
    assert abs(keeps[0][1] - 1.1) < 1e-6
    # Second keep: from second word start - padding to end + padding, clamped to duration.
    assert abs(keeps[1][0] - 4.9) < 1e-6
    assert abs(keeps[1][1] - 6.1) < 1e-6


def test_intro_silence_trimmed() -> None:
    seg = _seg(0.0, 5.0, [(3.0, 4.0, "hi")])
    keeps = cuts_from_words([seg], threshold_sec=0.5, padding_sec=0.1, total_duration=5.0)
    # Starts at word.start - padding, not at 0 (because intro silence > threshold).
    assert len(keeps) == 1
    assert abs(keeps[0][0] - 2.9) < 1e-6
    assert abs(keeps[0][1] - 4.1) < 1e-6


def test_gap_exactly_at_threshold_not_cut() -> None:
    # gap = 0.5 exactly; threshold = 0.5 → NOT cut (strictly greater).
    seg = _seg(0.0, 3.0, [(0.0, 1.0, "a"), (1.5, 2.5, "b")])
    keeps = cuts_from_words([seg], threshold_sec=0.5, padding_sec=0.05, total_duration=3.0)
    assert len(keeps) == 1


def test_padding_bridges_gaps_merges_intervals() -> None:
    # Two gaps of 0.6s each with padding 0.4s would overlap → merged.
    seg = _seg(
        0.0, 10.0,
        [(0.0, 1.0, "a"), (1.6, 2.0, "b"), (2.6, 3.0, "c")],
    )
    keeps = cuts_from_words([seg], threshold_sec=0.5, padding_sec=0.4, total_duration=10.0)
    # padding 0.4 makes every gap <= padding*2, first keep extends to 1.4, next starts at 1.2 → merge.
    assert len(keeps) == 1


def test_retime_projects_words_onto_new_timebase() -> None:
    # Two kept intervals [0..1], [5..6]. Word at t=5.2 should map to 1 + 0.2 = 1.2.
    seg = _seg(0.0, 10.0, [(0.0, 0.5, "hi"), (5.2, 5.8, "bye")])
    keeps = [(0.0, 1.0), (5.0, 6.0)]
    new = retime_segments([seg], keeps)
    assert len(new) == 1
    assert [w.text for w in new[0].words] == ["hi", "bye"]
    assert abs(new[0].words[0].start - 0.0) < 1e-6
    assert abs(new[0].words[0].end - 0.5) < 1e-6
    assert abs(new[0].words[1].start - 1.2) < 1e-6
    assert abs(new[0].words[1].end - 1.8) < 1e-6


def test_retime_drops_words_inside_cut() -> None:
    seg = _seg(0.0, 10.0, [(0.0, 0.5, "kept"), (2.0, 2.5, "dropped"), (5.0, 5.5, "also_kept")])
    keeps = [(0.0, 1.0), (4.0, 6.0)]  # middle word at t=2..2.5 is in the cut
    new = retime_segments([seg], keeps)
    assert len(new) == 1
    assert [w.text for w in new[0].words] == ["kept", "also_kept"]


def test_retime_segment_entirely_in_cut_dropped() -> None:
    seg_a = _seg(0.0, 1.0, [(0.1, 0.5, "a")])
    seg_b = _seg(2.0, 3.0, [(2.1, 2.5, "b")])  # entirely in cut
    keeps = [(0.0, 1.0), (4.0, 5.0)]
    new = retime_segments([seg_a, seg_b], keeps)
    assert len(new) == 1
    assert new[0].words[0].text == "a"


def test_kept_duration() -> None:
    assert abs(kept_duration([(0.0, 1.0), (5.0, 6.5)]) - 2.5) < 1e-9


def test_select_expr_format() -> None:
    expr = build_select_expr([(0.0, 1.0), (5.0, 6.5)])
    assert expr == "(between(t,0.000,1.000)+between(t,5.000,6.500))"


def test_select_expr_large_stays_shallow() -> None:
    # ffmpeg's expression parser recurses per nested operator and bails out
    # with ENOMEM past 100 levels — a flat `+` chain of keeps breaks exports
    # with >100 silence cuts. Balanced grouping keeps depth logarithmic.
    expr = build_select_expr([(i * 3.0, i * 3.0 + 2.0) for i in range(300)])
    depth = max_depth = 0
    for ch in expr:
        if ch == "(":
            depth += 1
            max_depth = max(max_depth, depth)
        elif ch == ")":
            depth -= 1
    assert depth == 0
    assert max_depth <= 10


def test_select_expr_empty() -> None:
    assert build_select_expr([]) == "0"
