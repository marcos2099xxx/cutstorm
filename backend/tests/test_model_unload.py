"""Unit tests for the idle model eviction (WHISPER_UNLOAD_AFTER_SEC)."""
from __future__ import annotations

from app import transcribe as t


def _reset() -> None:
    t._whisper_models.clear()
    t._align_models.clear()
    t._active_transcribes = 0
    t._touch_activity()


def test_unload_evicts_after_idle() -> None:
    _reset()
    t._whisper_models["large-v3"] = object()
    t._align_models["es"] = (object(), {})
    names = t._unload_idle_models(900, now=t._last_activity + 901)
    assert set(names) == {"asr:large-v3", "align:es"}
    assert t._whisper_models == {}
    assert t._align_models == {}


def test_unload_keeps_models_when_recent() -> None:
    _reset()
    t._whisper_models["tiny"] = object()
    assert t._unload_idle_models(900, now=t._last_activity + 10) == []
    assert "tiny" in t._whisper_models


def test_unload_skips_while_transcribing() -> None:
    _reset()
    t._whisper_models["tiny"] = object()
    t._active_transcribes = 1
    try:
        assert t._unload_idle_models(900, now=t._last_activity + 99999) == []
        assert "tiny" in t._whisper_models
    finally:
        t._active_transcribes = 0


def test_unload_disabled_with_zero() -> None:
    _reset()
    t._whisper_models["tiny"] = object()
    assert t._unload_idle_models(0, now=t._last_activity + 99999) == []
    assert "tiny" in t._whisper_models


def test_track_activity_marks_in_flight() -> None:
    _reset()
    seen: dict[str, int] = {}

    @t._track_activity
    def fake() -> int:
        seen["active"] = t._active_transcribes
        return 42

    assert fake() == 42
    assert seen["active"] == 1
    assert t._active_transcribes == 0
