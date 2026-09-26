"""SRT / WebVTT parsing for transcript import.

Cues become `Segment`s without word timings; callers either synthesize even
word timings or run forced alignment against the source audio.
"""
from __future__ import annotations

import re

from .models import Segment

_TIMESTAMP_RE = re.compile(
    r"(?:(\d+):)?(\d{1,2}):(\d{1,2})(?:[.,](\d{1,3}))?"
)
_TAG_RE = re.compile(r"<[^>]+>")
_INDEX_RE = re.compile(r"^\d+$")
_SKIP_BLOCKS = ("NOTE", "STYLE", "REGION")


def _parse_timestamp(text: str) -> float | None:
    m = _TIMESTAMP_RE.fullmatch(text.strip())
    if not m:
        return None
    hours, minutes, seconds, frac = m.groups()
    total = int(minutes) * 60 + int(seconds)
    if hours is not None:
        total += int(hours) * 3600
    if frac is not None:
        total += int(frac.ljust(3, "0")) / 1000.0
    return float(total)


def parse_subtitles(text: str) -> list[Segment]:
    """Parse SRT or WebVTT content into segments (words left empty).

    Tolerant to BOM, CRLF, missing cue indices, VTT headers/metadata blocks
    and cue settings (`align:start position:10%`). HTML-ish tags are stripped
    from cue text.
    """
    lines = text.lstrip("\ufeff").replace("\r\n", "\n").replace("\r", "\n").split("\n")
    segments: list[Segment] = []
    i = 0
    while i < len(lines):
        line = lines[i].strip()
        if not line or line.startswith("WEBVTT") or _INDEX_RE.match(line):
            i += 1
            continue
        if line.startswith(_SKIP_BLOCKS):
            i += 1
            while i < len(lines) and lines[i].strip():
                i += 1
            continue
        if "-->" in line:
            left, _, right = line.partition("-->")
            start = _parse_timestamp(left)
            end_token = right.strip().split(" ", 1)[0] if right.strip() else ""
            end = _parse_timestamp(end_token)
            i += 1
            body_lines: list[str] = []
            while i < len(lines) and lines[i].strip():
                body_lines.append(lines[i].strip())
                i += 1
            if start is None or end is None or end <= start:
                continue
            body = _TAG_RE.sub("", " ".join(body_lines)).strip()
            if body:
                segments.append(Segment(start=start, end=end, text=body, words=[]))
            continue
        # Cue identifier (VTT) or stray text — skip.
        i += 1

    segments.sort(key=lambda s: s.start)
    return segments
