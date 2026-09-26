import { useEffect, useRef, useState } from "react";
import { useT } from "../useT";

const isMac =
  typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
const MOD = isMac ? "\u2318" : "Ctrl";
const SHIFT = "\u21e7";

type Row = { keys: string[]; desc: string };

// `title`/`desc` are i18n keys (English source strings).
const GROUPS: { title: string; rows: Row[] }[] = [
  {
    title: "Playback",
    rows: [
      { keys: ["Space"], desc: "Play / Pause" },
      { keys: ["K"], desc: "Pause" },
      { keys: ["J"], desc: "\u22125 sec" },
      { keys: ["L"], desc: "+5 sec" },
      { keys: ["\u2190", "\u2192"], desc: "Frame step" },
    ],
  },
  {
    title: "Editing",
    rows: [
      { keys: ["Enter"], desc: "Split segment at playhead" },
      { keys: ["Del"], desc: "Delete segment at playhead" },
      { keys: [`${MOD}Z`], desc: "Undo" },
      { keys: [`${MOD}${SHIFT}Z`], desc: "Redo" },
    ],
  },
];

export function HotkeysHelp() {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const t = useT();

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="hotkeys-help" ref={rootRef}>
      <button
        className="icon"
        onClick={() => setOpen((o) => !o)}
        aria-label={t("Keyboard shortcuts")}
        aria-expanded={open}
        title={t("Keyboard shortcuts")}
        data-testid="hotkeys-help-button"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10" />
          <path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3" />
          <line x1="12" y1="17" x2="12" y2="17.01" />
        </svg>
      </button>
      {open && (
        <div className="hotkeys-popover" role="dialog" data-testid="hotkeys-popover">
          <div className="hotkeys-header">{t("Keyboard shortcuts")}</div>
          {GROUPS.map((g) => (
            <div className="hotkeys-group" key={g.title}>
              <div className="hotkeys-group-title">{t(g.title)}</div>
              {g.rows.map((r) => (
                <div className="hotkeys-row" key={r.desc}>
                  <div className="hotkeys-keys">
                    {r.keys.map((k, i) => (
                      <kbd key={i}>{k}</kbd>
                    ))}
                  </div>
                  <div className="hotkeys-desc">{t(r.desc)}</div>
                </div>
              ))}
            </div>
          ))}
          <div className="hotkeys-footer">{t("Shortcuts ignore focus on inputs.")}</div>
        </div>
      )}
    </div>
  );
}
