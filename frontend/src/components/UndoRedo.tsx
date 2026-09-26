import { useSyncExternalStore } from "react";
import { useStore } from "../store";
import { useT } from "../useT";

const isMac =
  typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
const MOD = isMac ? "\u2318" : "Ctrl+";

const subscribe = (cb: () => void) => useStore.temporal.subscribe(cb);
const getPast = () => useStore.temporal.getState().pastStates.length;
const getFuture = () => useStore.temporal.getState().futureStates.length;

export function UndoRedo() {
  const past = useSyncExternalStore(subscribe, getPast, () => 0);
  const future = useSyncExternalStore(subscribe, getFuture, () => 0);
  const undo = () => useStore.temporal.getState().undo();
  const redo = () => useStore.temporal.getState().redo();
  const t = useT();

  return (
    <div className="undo-redo">
      <button
        className="icon"
        onClick={undo}
        disabled={past === 0}
        title={`${t("Undo")} (${MOD}Z)`}
        aria-label={t("Undo")}
        data-testid="undo-button"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 7v6h6" />
          <path d="M21 17a9 9 0 0 0-15-6.7L3 13" />
        </svg>
      </button>
      <button
        className="icon"
        onClick={redo}
        disabled={future === 0}
        title={`${t("Redo")} (${MOD}\u21e7Z)`}
        aria-label={t("Redo")}
        data-testid="redo-button"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 7v6h-6" />
          <path d="M3 17a9 9 0 0 1 15-6.7L21 13" />
        </svg>
      </button>
    </div>
  );
}
