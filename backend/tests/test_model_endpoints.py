"""Tests for the model watchdog/retries and the new endpoints:
- watchdog stall detection + bounded retries (transcribe.py)
- GET /api/model/status, POST /api/model/reload
- POST /api/transcripts/{id}/retranscribe
"""
from __future__ import annotations

import json
import shutil
import threading

import pytest
from fastapi.testclient import TestClient

from app import transcribe as t
from app import main as app_main
from app.main import _meta_path


# ---- watchdog unit tests ----------------------------------------------------


def test_watchdog_returns_value() -> None:
    assert t._run_with_download_watchdog(lambda: "model", "asr:test") == "model"


def test_watchdog_propagates_error() -> None:
    def load():
        raise ValueError("boom")

    with pytest.raises(ValueError, match="boom"):
        t._run_with_download_watchdog(load, "asr:test")


def test_watchdog_detects_stall(monkeypatch) -> None:
    """Growth observed for a few polls, then frozen → stall error."""
    monkeypatch.setenv("WHISPER_DOWNLOAD_STALL_SEC", "1")
    monkeypatch.setenv("WHISPER_DOWNLOAD_MAX_SEC", "30")
    polls = {"n": 0}

    def fake_incomplete() -> int:
        polls["n"] += 1
        return 100 * min(polls["n"], 3)

    monkeypatch.setattr(t, "_incomplete_bytes", fake_incomplete)
    release = threading.Event()

    def load():
        release.wait(30)

    try:
        with pytest.raises(RuntimeError, match="stalled"):
            t._run_with_download_watchdog(load, "asr:test")
    finally:
        release.set()


def test_watchdog_no_stall_without_growth(monkeypatch) -> None:
    """A cold disk-load (no download blobs, zero growth) must NOT trip the
    stall detector — it finishes whenever the loader finishes."""
    monkeypatch.setenv("WHISPER_DOWNLOAD_STALL_SEC", "0.5")
    monkeypatch.setattr(t, "_incomplete_bytes", lambda: 0)

    def load():
        import time as _t
        _t.sleep(1.2)  # > 2× stall budget
        return "slow-disk-load"

    assert t._run_with_download_watchdog(load, "asr:test") == "slow-disk-load"


def test_load_with_retries_gives_up(monkeypatch) -> None:
    monkeypatch.setattr(t, "_MODEL_RETRY_ATTEMPTS", 2)
    monkeypatch.setattr(t, "_MODEL_RETRY_BACKOFF_SEC", 0)
    calls = {"n": 0}

    def load():
        calls["n"] += 1
        raise ValueError("still stuck")

    with pytest.raises(RuntimeError, match="after 2 attempts"):
        t._load_model_with_retries("asr:test", load)
    assert calls["n"] == 2
    st = t.download_status()
    assert st["active"] is False
    assert "still stuck" in st["error"]
    t.reset_download_state()


def test_load_with_retries_succeeds_on_second_try(monkeypatch) -> None:
    monkeypatch.setattr(t, "_MODEL_RETRY_BACKOFF_SEC", 0)
    calls = {"n": 0}

    def load():
        calls["n"] += 1
        if calls["n"] == 1:
            raise ValueError("transient")
        return "ok"

    assert t._load_model_with_retries("asr:test", load) == "ok"
    assert t.download_status()["error"] is None
    t.reset_download_state()


# ---- /api/model/status + /api/model/reload ----------------------------------


@pytest.fixture
def fresh_uploads(tmp_path, monkeypatch):
    uploads = tmp_path / "uploads"
    outputs = tmp_path / "outputs"
    uploads.mkdir()
    outputs.mkdir()
    monkeypatch.setattr(app_main, "UPLOADS_DIR", uploads)
    monkeypatch.setattr(app_main, "OUTPUTS_DIR", outputs)
    return uploads


@pytest.fixture
def client(fresh_uploads, sample_video, monkeypatch):
    monkeypatch.setenv("WHISPER_MODEL", "small")
    t._whisper_models.clear()
    t._align_models.clear()
    t.reset_download_state()
    yield TestClient(app_main.app)
    t._whisper_models.clear()
    t._align_models.clear()
    t.reset_download_state()


def test_model_status_shape(client) -> None:
    r = client.get("/api/model/status")
    assert r.status_code == 200
    body = r.json()
    assert set(body) == {"model", "loaded", "downloading", "what", "downloaded_mb", "error"}
    assert body["model"] == "small"
    assert body["loaded"] is False
    assert body["downloading"] is False

    t._whisper_models["small"] = object()
    assert client.get("/api/model/status").json()["loaded"] is True


def test_model_reload_evicts_and_schedules_warmup(client, monkeypatch) -> None:
    t._whisper_models["small"] = object()
    t._align_models["es"] = (object(), {})
    warmed = []

    async def fake_warmup() -> None:
        warmed.append(True)

    monkeypatch.setattr(app_main, "_warmup_whisper", fake_warmup)
    r = client.post("/api/model/reload")
    assert r.status_code == 202
    assert r.json()["reloading"] is True
    assert set(r.json()["evicted"]) == {"asr:small", "align:es"}
    assert t._whisper_models == {}
    assert t._align_models == {}
    # Give the event loop a beat to run the scheduled warmup task.
    import time
    time.sleep(0.05)
    assert warmed == [True]


def test_model_reload_refused_while_transcribing(client) -> None:
    t._whisper_models["small"] = object()
    t._active_transcribes = 1
    try:
        r = client.post("/api/model/reload")
        assert r.status_code == 202
        assert r.json()["evicted"] == []
        assert "small" in t._whisper_models
    finally:
        t._active_transcribes = 0


# ---- /api/transcripts/{id}/retranscribe -------------------------------------


VID = "0123456789abcdef"


def _seed_project(uploads, sample_video, meta: dict) -> None:
    shutil.copy(sample_video, uploads / f"{VID}.mp4")
    (uploads / f"{VID}.json").write_text(json.dumps(meta))


def _mute_bg_transcribe(monkeypatch) -> list[dict]:
    calls: list[dict] = []

    async def _noop() -> None:
        return None

    def fake_run(**kwargs):
        calls.append(kwargs)
        return _noop()

    monkeypatch.setattr(app_main, "_run_transcribe_stream", fake_run)
    return calls


def test_retranscribe_kicks_bg_and_resets_meta(
    monkeypatch, fresh_uploads, sample_video, client,
) -> None:
    calls = _mute_bg_transcribe(monkeypatch)
    _seed_project(fresh_uploads, sample_video, {
        "video_id": VID,
        "language": "es",
        "model": "small",
        "status": "error",
        "error": "stalled",
        "segments": [{"start": 0.0, "end": 1.0, "text": "hola", "words": []}],
        "original_filename": "clip.mp4",
    })

    r = client.post(f"/api/transcripts/{VID}/retranscribe?job_id=job-x")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["status"] == "pending"
    assert body["segments"] == []
    assert body["model"] == "small"

    assert len(calls) == 1
    assert calls[0]["video_id"] == VID
    assert calls[0]["language"] == "es"
    assert calls[0]["model"] == "small"
    assert calls[0]["jid"] == "job-x"

    meta = json.loads(_meta_path(VID).read_text())
    assert meta["status"] == "pending"
    assert meta["percent"] == 0
    assert meta["segments"] == []
    assert meta["model"] == "small"


def test_retranscribe_defaults_from_meta(
    monkeypatch, fresh_uploads, sample_video, client,
) -> None:
    calls = _mute_bg_transcribe(monkeypatch)
    _seed_project(fresh_uploads, sample_video, {
        "video_id": VID,
        "language": "en",
        "model": "large-v3",
        "status": "cancelled",
        "segments": [],
    })

    r = client.post(f"/api/transcripts/{VID}/retranscribe")
    assert r.status_code == 200, r.text
    assert calls[0]["language"] == "en"
    assert calls[0]["model"] == "large-v3"


def test_retranscribe_404_unknown_video(fresh_uploads, sample_video, monkeypatch, client) -> None:
    _mute_bg_transcribe(monkeypatch)
    r = client.post(f"/api/transcripts/{VID}/retranscribe")
    assert r.status_code == 404


def test_retranscribe_400_bad_id_shape(fresh_uploads, sample_video, monkeypatch, client) -> None:
    _mute_bg_transcribe(monkeypatch)
    r = client.post("/api/transcripts/NOPE/retranscribe")
    # _validate_video_id answers 404 for malformed ids.
    assert r.status_code == 404
