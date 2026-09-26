"""Tests for SRT/VTT import: parser + /api/transcripts/{id}/import endpoint."""
from __future__ import annotations

import json

import pytest
from fastapi.testclient import TestClient

from app.main import UPLOADS_DIR, _meta_path, app
from app.subs_import import parse_subtitles

VIDEO_ID = "d1e2f3a4b5c60718"


# ---------------- parser ----------------

def test_parse_srt_basic() -> None:
    srt = (
        "1\n"
        "00:00:01,000 --> 00:00:04,000\n"
        "Hola mundo\n"
        "\n"
        "2\n"
        "00:00:05,500 --> 00:00:07,250\n"
        "Segunda línea\n"
    )
    segs = parse_subtitles(srt)
    assert len(segs) == 2
    assert segs[0].start == 1.0 and segs[0].end == 4.0
    assert segs[0].text == "Hola mundo"
    assert segs[1].start == 5.5 and segs[1].end == 7.25


def test_parse_vtt_header_note_and_cue_settings() -> None:
    vtt = (
        "WEBVTT\n"
        "\n"
        "NOTE this is a comment\n"
        "spanning two lines\n"
        "\n"
        "intro\n"
        "00:01.000 --> 00:03.500 align:start position:10%\n"
        "<v Ana>Hola</v>\n"
        "\n"
        "00:04.000 --> 00:06.000\n"
        "Adiós\n"
    )
    segs = parse_subtitles(vtt)
    assert [s.text for s in segs] == ["Hola", "Adiós"]
    assert segs[0].start == 1.0 and segs[0].end == 3.5


def test_parse_handles_crlf_bom_and_multiline() -> None:
    raw = "\ufeff1\r\n00:00:00.000 --> 00:00:02.000\r\nline one\r\nline two\r\n\r\n"
    segs = parse_subtitles(raw)
    assert len(segs) == 1
    assert segs[0].text == "line one line two"


def test_parse_skips_invalid_and_empty() -> None:
    assert parse_subtitles("") == []
    assert parse_subtitles("not subtitles at all") == []
    assert parse_subtitles("00:00:05,000 --> 00:00:05,000\nx\n") == []


# ---------------- endpoint ----------------

def _seed(video_id: str) -> None:
    UPLOADS_DIR.mkdir(parents=True, exist_ok=True)
    (UPLOADS_DIR / f"{video_id}.mp4").write_bytes(b"\x00" * 32)
    _meta_path(video_id).write_text(json.dumps({
        "video_id": video_id,
        "duration": 20.0,
        "width": 1280,
        "height": 720,
        "language": "es",
        "segments": [],
        "is_audio_only": False,
        "_cache_key": "__import__",
    }))


def _cleanup(video_id: str) -> None:
    p = UPLOADS_DIR / f"{video_id}.mp4"
    if p.exists():
        p.unlink()
    m = _meta_path(video_id)
    if m.exists():
        m.unlink()


@pytest.fixture()
def client():
    yield TestClient(app)


def test_import_replaces_transcript(client):
    _cleanup(VIDEO_ID)
    _seed(VIDEO_ID)
    srt = "1\n00:00:01,000 --> 00:00:03,000\nHola\n"
    try:
        r = client.post(
            f"/api/transcripts/{VIDEO_ID}/import",
            files={"file": ("subs.srt", srt.encode("utf-8"), "text/plain")},
            data={"align": "false"},
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert len(body["segments"]) == 1
        assert body["segments"][0]["text"] == "Hola"
        assert body["model"] == "imported"
        assert body["segments"][0]["words"], "words must be synthesized"
        meta = json.loads(_meta_path(VIDEO_ID).read_text())
        assert meta["segments"][0]["text"] == "Hola"
        assert "_cache_key" not in meta
    finally:
        _cleanup(VIDEO_ID)


def test_import_rejects_empty_file(client):
    _cleanup(VIDEO_ID)
    _seed(VIDEO_ID)
    try:
        r = client.post(
            f"/api/transcripts/{VIDEO_ID}/import",
            files={"file": ("subs.srt", b"nothing here", "text/plain")},
            data={"align": "false"},
        )
        assert r.status_code == 400
    finally:
        _cleanup(VIDEO_ID)


def test_import_missing_transcript_404(client):
    _cleanup(VIDEO_ID)
    r = client.post(
        f"/api/transcripts/{VIDEO_ID}/import",
        files={"file": ("subs.srt", b"1\n00:00:01,000 --> 00:00:02,000\nx\n", "text/plain")},
        data={"align": "false"},
    )
    assert r.status_code == 404
