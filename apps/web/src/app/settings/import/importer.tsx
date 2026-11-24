"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { ImportSource } from "@/lib/import/rows";
import { runAppleHealth, runGarminExport, type ImportSummary, type KindSummary } from "@/lib/import/run";
import { finishImport, importBatchAction, startImport } from "./actions";

const LABEL = { daily: "Days", sleep: "Nights", activities: "Activities", weight: "Weights", vo2max: "VO2 max values" } as const;

type State =
  | { phase: "idle" }
  | { phase: "running"; stage: string; fraction: number | null }
  | { phase: "done"; summary: ImportSummary }
  | { phase: "error"; message: string };

/** Pick an export file; it is read on this device and only the parsed rows are sent. */
export function Importer({ source, accept }: { source: ImportSource; accept: string }) {
  const [state, setState] = useState<State>({ phase: "idle" });
  const router = useRouter();

  async function run(file: File) {
    setState({ phase: "running", stage: "Starting", fraction: null });
    try {
      await startImport();
      const progress = (stage: string, fraction: number | null) => setState({ phase: "running", stage, fraction });
      const send = (batch: Parameters<typeof importBatchAction>[1]) => importBatchAction(source, batch);
      const summary = source === "apple_health" ? await runAppleHealth(file, send, progress) : await runGarminExport(file, send, progress);
      setState({ phase: "running", stage: "Updating your estimates", fraction: null });
      await finishImport();
      setState({ phase: "done", summary });
      router.refresh();
    } catch (err) {
      setState({ phase: "error", message: err instanceof Error && err.message ? `The import stopped: ${err.message}.` : "The import stopped unexpectedly." });
    }
  }

  const running = state.phase === "running";
  return (
    <div className="space-y-3">
      <label className="block">
        <span className="sr-only">Choose the export file</span>
        <input
          type="file"
          accept={accept}
          disabled={running}
          onChange={(e) => {
            const f = e.currentTarget.files?.[0];
            if (f) void run(f);
            e.currentTarget.value = "";
          }}
          className="block w-full text-sm file:mr-3 file:rounded-md file:border-0 file:bg-accent file:px-3 file:py-2 file:text-sm file:font-medium file:text-accent-fg disabled:opacity-60"
        />
      </label>

      {state.phase === "running" && (
        <div className="space-y-1" role="status" aria-live="polite">
          <p className="text-sm">{state.stage}…</p>
          <div className="h-1.5 overflow-hidden rounded bg-border">
            <div
              className={`h-full bg-accent ${state.fraction === null ? "w-1/3 animate-pulse" : ""}`}
              style={state.fraction === null ? undefined : { width: `${Math.round(state.fraction * 100)}%` }}
            />
          </div>
          <p className="text-xs text-muted">Keep this page open until it finishes.</p>
        </div>
      )}

      {state.phase === "error" && (
        <p role="alert" className="text-sm text-danger">
          {state.message} Rows already saved stay, and running the import again won&rsquo;t duplicate them.
        </p>
      )}

      {state.phase === "done" && <Summary summary={state.summary} />}
    </div>
  );
}

function Summary({ summary }: { summary: ImportSummary }) {
  const kinds = (Object.keys(LABEL) as Array<keyof typeof LABEL>).filter((k) => summary[k]);
  return (
    <div className="space-y-2" role="status">
      <p className="text-sm font-medium">{kinds.length ? "Import finished." : "Nothing was imported."}</p>
      {kinds.length > 0 && (
        <ul className="space-y-0.5 text-sm">
          {kinds.map((k) => {
            const s = summary[k] as KindSummary;
            return (
              <li key={k}>
                {LABEL[k]}: <strong className="tabular-nums">{s.written.toLocaleString("en-GB")}</strong> saved
                {s.superseded > 0 && <span className="text-muted"> · {s.superseded.toLocaleString("en-GB")} already there from Garmin</span>}
                {s.invalid > 0 && <span className="text-muted"> · {s.invalid.toLocaleString("en-GB")} skipped (unreadable or out of range)</span>}
              </li>
            );
          })}
        </ul>
      )}
      {summary.problems.map((p) => (
        <p key={p} className="text-sm text-muted">
          {p}
        </p>
      ))}
    </div>
  );
}
