import type { Locale } from "../i18n";
import { useT } from "../useT";

/** EN | ES UI-language switch (persisted in the store). */
export function LocaleSwitch({
  locale,
  onChange,
}: {
  locale: Locale;
  onChange: (l: Locale) => void;
}) {
  const t = useT();
  return (
    <div
      className="locale-switch"
      data-testid="locale-switch"
      role="group"
      aria-label={t("Language")}
    >
      {(["en", "es"] as Locale[]).map((l) => (
        <button
          key={l}
          type="button"
          className={`locale-btn${locale === l ? " active" : ""}`}
          data-testid={`locale-${l}`}
          aria-pressed={locale === l}
          onClick={() => onChange(l)}
        >
          {l.toUpperCase()}
        </button>
      ))}
    </div>
  );
}
