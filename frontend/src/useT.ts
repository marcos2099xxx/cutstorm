import { useMemo } from "react";
import { makeT } from "./i18n";
import { useStore } from "./store";

/** Bound translator that re-renders when the UI locale changes. */
export function useT() {
  const locale = useStore((s) => s.locale);
  return useMemo(() => makeT(locale), [locale]);
}
