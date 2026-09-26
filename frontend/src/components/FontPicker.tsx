import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  CATEGORY_LABEL,
  fontsByCategory,
  type FontCategory,
  type FontEntry,
  useFontStore,
} from "../fonts";
import { useT } from "../useT";

type Props = {
  value: string;
  onChange: (family: string) => void;
};

const POPOVER_MAX_H = 360;
const POPOVER_MIN_W = 280;

export function FontPicker({ value, onChange }: Props) {
  const fonts = useFontStore((s) => s.fonts);
  const loaded = useFontStore((s) => s.loaded);
  const [open, setOpen] = useState(false);
  const [placement, setPlacement] = useState<{ v: "down" | "up"; h: "left" | "right" }>(
    { v: "down", h: "left" },
  );
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
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

  useLayoutEffect(() => {
    if (!open || !triggerRef.current) return;
    const r = triggerRef.current.getBoundingClientRect();
    const spaceBelow = window.innerHeight - r.bottom;
    const spaceAbove = r.top;
    const spaceRight = window.innerWidth - r.left;
    setPlacement({
      v: spaceBelow < POPOVER_MAX_H + 16 && spaceAbove > spaceBelow ? "up" : "down",
      h: spaceRight < POPOVER_MIN_W + 16 ? "right" : "left",
    });
  }, [open]);

  const groups = useMemo(() => fontsByCategory(fonts), [fonts]);

  function pick(family: string) {
    onChange(family);
    setOpen(false);
  }

  const displayLabel = value || (loaded ? t("Pick a font") : t("Loading fonts…"));

  return (
    <div className="font-select" ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        className="font-trigger"
        onClick={() => setOpen((o) => !o)}
        data-testid="style-font-family"
        data-value={value}
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={!loaded}
      >
        <span className="font-trigger-label">{displayLabel}</span>
        <span className="font-chevron" aria-hidden>▾</span>
      </button>
      {open && (
        <div
          className={`font-popover font-popover-${placement.v} font-popover-${placement.h}`}
          role="listbox"
          data-testid="font-popover"
        >
          <div className="font-list" ref={listRef}>
            {groups.length === 0 && (
              <div className="font-empty">{t("No fonts available")}</div>
            )}
            {groups.map((g) => (
              <div key={g.category} className="font-group">
                <div className="font-group-label">{t(CATEGORY_LABEL[g.category as FontCategory])}</div>
                {g.items.map((f: FontEntry) => (
                  <button
                    key={f.family}
                    type="button"
                    role="option"
                    aria-selected={f.family === value}
                    className={`font-option${f.family === value ? " selected" : ""}`}
                    onClick={() => pick(f.family)}
                    data-testid={`font-option-${f.family.replace(/\s+/g, "-")}`}
                    style={{ fontFamily: `"${f.family}"` }}
                  >
                    {f.family}
                    {f.family === value && <span className="font-option-check" aria-hidden>✓</span>}
                  </button>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
