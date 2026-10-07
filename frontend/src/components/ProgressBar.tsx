import { useStore } from "../store";
import { useT } from "../useT";

const PHASE_KEY: Record<string, string> = {
  upload: "Uploading",
  download: "Downloading",
  model_download: "Downloading model",
  transcribe: "Transcribing",
  align: "Aligning words",
  encode: "Rendering",
};

export function ProgressBar() {
  const phase = useStore((s) => s.progressPhase);
  const percent = useStore((s) => s.progressPercent);
  const detail = useStore((s) => s.progressDetail);
  const t = useT();

  if (phase === "idle" || phase === "done") return null;

  return (
    <div
      className="progress"
      data-testid="progress-bar"
      data-phase={phase}
      data-progress={percent}
    >
      <div className="progress-header">
        <span>
          {t(PHASE_KEY[phase] ?? phase)}
          {detail ? ` · ${detail}` : ""}
        </span>
        <span>{percent}%</span>
      </div>
      <div className="progress-bar-track">
        <div className="progress-bar-fill" style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}
