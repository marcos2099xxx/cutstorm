import type { Segment } from "./store";

export type SubsFormat = "srt" | "vtt";

function fmtTime(t: number, msSep: string): string {
  const ms = Math.max(0, Math.round(t * 1000));
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const rest = ms % 1000;
  const p2 = (n: number) => n.toString().padStart(2, "0");
  return `${p2(h)}:${p2(m)}:${p2(s)}${msSep}${rest.toString().padStart(3, "0")}`;
}

function buildSubtitles(segments: Segment[], msSep: string, header: string): string {
  const cues = segments
    .map((seg, i) => {
      const text = seg.text.trim();
      if (!text) return null;
      return `${i + 1}\n${fmtTime(seg.start, msSep)} --> ${fmtTime(seg.end, msSep)}\n${text}`;
    })
    .filter((c): c is string => c !== null);
  return (header ? header + "\n\n" : "") + cues.join("\n\n") + (cues.length ? "\n" : "");
}

export function toSrt(segments: Segment[]): string {
  return buildSubtitles(segments, ",", "");
}

export function toVtt(segments: Segment[]): string {
  return buildSubtitles(segments, ".", "WEBVTT");
}

export function downloadSubtitles(segments: Segment[], format: SubsFormat, filename: string): void {
  const body = format === "vtt" ? toVtt(segments) : toSrt(segments);
  const blob = new Blob([body], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    a.remove();
    URL.revokeObjectURL(url);
  }, 500);
}
