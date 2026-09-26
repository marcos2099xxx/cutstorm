import type { Segment } from "./store";

/** [start, end] in seconds. */
export type KeepInterval = [number, number];

/**
 * Mirror of the backend's `silence.cuts_from_words` (backend/app/silence.py).
 * Keep intervals are derived from word gaps: any gap longer than
 * `thresholdSec` is cut, with `paddingSec` preserved around each word.
 * Both sides must agree — the timeline/cut preview promises what the export
 * renders.
 */
function keepsFromWords(
  words: Array<{ start: number; end: number }>,
  totalDuration: number,
  thresholdSec: number,
  paddingSec: number,
): KeepInterval[] {
  const sorted = [...words].sort((a, b) => a.start - b.start);
  if (sorted.length === 0) {
    return totalDuration > 0 ? [[0, totalDuration]] : [];
  }

  const keep: KeepInterval[] = [];
  let curStart = Math.max(0, sorted[0].start - paddingSec);
  let curEnd = sorted[0].end + paddingSec;

  for (let i = 1; i < sorted.length; i++) {
    const gap = sorted[i].start - sorted[i - 1].end;
    if (gap > thresholdSec) {
      keep.push([curStart, curEnd]);
      curStart = Math.max(curEnd, sorted[i].start - paddingSec);
    }
    curEnd = Math.max(curEnd, sorted[i].end + paddingSec);
  }

  if (totalDuration > 0) curEnd = Math.min(totalDuration, curEnd);
  if (curEnd > curStart) keep.push([curStart, curEnd]);

  // Merge intervals that touch/overlap (padding can bridge gaps).
  const merged: KeepInterval[] = [];
  for (const [s, e] of keep) {
    const last = merged[merged.length - 1];
    if (last && s <= last[1] + 1e-6) {
      last[1] = Math.max(last[1], e);
    } else {
      merged.push([s, e]);
    }
  }
  return merged;
}

/** Keep intervals for the full clip (no trim range). */
export function computeKeeps(
  segments: Segment[],
  duration: number,
  thresholdSec: number,
  paddingSec: number,
): KeepInterval[] {
  const words = segments.flatMap((s) => s.words ?? []);
  return keepsFromWords(words, duration, thresholdSec, paddingSec);
}

/**
 * Keep intervals in ORIGINAL timeline coordinates, clipped to [inSec, outSec].
 * Mirrors the export, which clips the transcript to the trim window before
 * computing cuts (`_clip_segments_to_trim` in backend/app/main.py).
 */
export function computeKeepsForRange(
  segments: Segment[],
  inSec: number,
  outSec: number,
  thresholdSec: number,
  paddingSec: number,
): KeepInterval[] {
  const clipDuration = Math.max(0, outSec - inSec);
  if (clipDuration <= 0) return [];
  const words = segments
    .flatMap((s) => s.words ?? [])
    .filter((w) => w.end > inSec && w.start < outSec)
    .map((w) => ({
      start: Math.max(w.start, inSec) - inSec,
      end: Math.min(w.end, outSec) - inSec,
    }));
  return keepsFromWords(words, clipDuration, thresholdSec, paddingSec).map(
    ([s, e]) => [s + inSec, e + inSec] as KeepInterval,
  );
}

export function keepsDuration(keeps: KeepInterval[]): number {
  return keeps.reduce((acc, [s, e]) => acc + (e - s), 0);
}

/** Cut regions (gaps between keeps) inside [inSec, outSec], minus slivers. */
export function cutGaps(
  keeps: KeepInterval[],
  inSec: number,
  outSec: number,
  minGapSec = 0.02,
): KeepInterval[] {
  const gaps: KeepInterval[] = [];
  let cursor = inSec;
  for (const [s, e] of keeps) {
    if (s - cursor > minGapSec) gaps.push([cursor, s]);
    cursor = Math.max(cursor, e);
  }
  if (outSec - cursor > minGapSec) gaps.push([cursor, outSec]);
  return gaps;
}

export function isInsideKeeps(t: number, keeps: KeepInterval[]): boolean {
  return keeps.some(([s, e]) => t >= s - 0.02 && t <= e + 0.02);
}

/** First keep start strictly after `t`, or null when past the last keep. */
export function nextKeepStart(t: number, keeps: KeepInterval[]): number | null {
  for (const [s] of keeps) {
    if (t < s) return s;
  }
  return null;
}

/** Pull `t` out of a cut gap: jump forward to the next keep. */
export function snapToKeep(t: number, keeps: KeepInterval[]): number {
  if (!keeps.length || isInsideKeeps(t, keeps)) return t;
  const next = nextKeepStart(t, keeps);
  return next !== null ? next : keeps[keeps.length - 1][1];
}

/**
 * Map an original-timeline time onto the cut timeline (0 = start of the first
 * keep). Used to keep the extra audio in sync with the cut preview: the export
 * cuts only the source track and lets the extra track run continuously.
 */
export function mapToCutTime(t: number, keeps: KeepInterval[]): number {
  let acc = 0;
  for (const [s, e] of keeps) {
    if (t <= s) return acc;
    if (t <= e) return acc + (t - s);
    acc += e - s;
  }
  return acc;
}

/**
 * Inverse of {@link mapToCutTime}: cut-timeline time → original time.
 * Used by the player scrub in cut mode; always lands inside a keep.
 */
export function cutTimeToOriginal(tau: number, keeps: KeepInterval[]): number {
  let acc = 0;
  for (const [s, e] of keeps) {
    const d = e - s;
    if (tau <= acc + d) return s + (tau - acc);
    acc += d;
  }
  return keeps.length ? keeps[keeps.length - 1][1] : 0;
}
