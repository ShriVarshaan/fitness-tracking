import { AppleHealthParser } from "./apple-health";
import { garminExportKind, mapGarminExportActivities, mapGarminExportDaily, mapGarminExportSleep } from "./garmin-export";
import { activityRow, BATCH_SIZE, dailyRow, sleepRow, vo2Row, weightRow, type ImportBatch, type ImportKind } from "./rows";
import { listZip, openEntry, readEntryText, streamText, type ZipSource } from "./zip";

/**
 * Runs an import in the browser: read the export file, map it to canonical
 * rows, check each row against the same schemas the server uses, and hand
 * batches to `send` (a server action). Rows that fail the check are counted,
 * not sent. The file itself never leaves the device.
 */

export interface KindSummary {
  read: number;
  written: number;
  /** Already present from a higher-precedence source (e.g. the Garmin API). */
  superseded: number;
  /** Failed validation (out-of-range values), or unreadable records. */
  invalid: number;
}

export type ImportSummary = Partial<Record<ImportKind, KindSummary>> & { problems: string[] };

export type SendBatch = (batch: ImportBatch) => Promise<{ ok: true; written: number; superseded: number } | { ok: false; message: string }>;
export type Progress = (stage: string, fraction: number | null) => void;

const SCHEMAS = { daily: dailyRow, sleep: sleepRow, activities: activityRow, weight: weightRow, vo2max: vo2Row } as const;

/** Let the page repaint between chunks of work. */
const yieldToUi = () => new Promise<void>((r) => setTimeout(r, 0));

async function sendAll(kind: ImportKind, rows: unknown[], invalidAlready: number, send: SendBatch, summary: ImportSummary, progress: Progress, label: string): Promise<void> {
  if (!rows.length && !invalidAlready) return;
  const s = (summary[kind] ??= { read: 0, written: 0, superseded: 0, invalid: 0 });
  s.read += rows.length + invalidAlready;
  s.invalid += invalidAlready;
  const schema = SCHEMAS[kind];
  const valid: unknown[] = [];
  for (const r of rows) {
    if (schema.safeParse(r).success) valid.push(r);
    else s.invalid++;
  }
  for (let i = 0; i < valid.length; i += BATCH_SIZE) {
    progress(`Saving ${label}`, valid.length ? i / valid.length : null);
    const res = await send({ kind, rows: valid.slice(i, i + BATCH_SIZE) } as ImportBatch);
    if (!res.ok) {
      summary.problems.push(res.message);
      return;
    }
    s.written += res.written;
    s.superseded += res.superseded;
  }
}

/** Garmin account export ZIP (DI_CONNECT/...). */
export async function runGarminExport(file: ZipSource, send: SendBatch, progress: Progress): Promise<ImportSummary> {
  const summary: ImportSummary = { problems: [] };
  progress("Reading the ZIP", null);
  const entries = (await listZip(file)).filter((e) => garminExportKind(e.name) !== null);
  if (!entries.length) {
    summary.problems.push("No Garmin daily, sleep or activity files were found. Is this the ZIP from Garmin's \"Export your data\"?");
    return summary;
  }
  // Activities first so the sport list fills in; then days and nights.
  const order = { activities: 0, daily: 1, sleep: 2 } as const;
  entries.sort((a, b) => order[garminExportKind(a.name)!] - order[garminExportKind(b.name)!]);
  for (const [i, e] of entries.entries()) {
    const kind = garminExportKind(e.name)!;
    const label = { daily: "daily summaries", sleep: "sleep", activities: "activities" }[kind];
    progress(`Reading ${label} (file ${i + 1} of ${entries.length})`, i / entries.length);
    await yieldToUi();
    let json: unknown;
    try {
      json = JSON.parse(await readEntryText(file, e));
    } catch {
      summary.problems.push(`${e.name.split("/").pop()} couldn't be read as JSON and was skipped.`);
      continue;
    }
    try {
      const mapped = kind === "daily" ? mapGarminExportDaily(json) : kind === "sleep" ? mapGarminExportSleep(json) : mapGarminExportActivities(json);
      await sendAll(kind, mapped.rows, mapped.skipped, send, summary, progress, label);
    } catch (err) {
      summary.problems.push(`${e.name.split("/").pop()}: ${err instanceof Error ? err.message : "unexpected content"}; skipped.`);
    }
  }
  return summary;
}

/** Apple Health export: the export.zip, or export.xml on its own. */
export async function runAppleHealth(file: ZipSource & { name?: string }, send: SendBatch, progress: Progress): Promise<ImportSummary> {
  const summary: ImportSummary = { problems: [] };
  let stream: ReadableStream<Uint8Array>;
  let total = file.size;
  if (file.name?.toLowerCase().endsWith(".xml")) {
    stream = (file as Blob).stream() as ReadableStream<Uint8Array>;
  } else {
    progress("Reading the ZIP", null);
    const entry = (await listZip(file)).find((e) => /(^|\/)export\.xml$/i.test(e.name));
    if (!entry) {
      summary.problems.push("No export.xml was found. Is this the export.zip from the Health app?");
      return summary;
    }
    stream = await openEntry(file, entry);
    total = entry.size;
  }

  const parser = new AppleHealthParser();
  let lastYield = 0;
  await streamText(stream, async (text, seen) => {
    parser.push(text);
    // Repaint about every 4 MB.
    if (seen - lastYield > 4_000_000) {
      lastYield = seen;
      progress("Reading Apple Health records", total ? seen / total : null);
      await yieldToUi();
    }
  });
  const r = parser.finish();
  // The night's stage list isn't stored yet: send the night itself.
  const nights = r.sleep.map((n) => {
    const night: Partial<typeof n> = { ...n };
    delete night.stages;
    return night;
  });
  await sendAll("activities", r.activities, 0, send, summary, progress, "workouts");
  await sendAll("daily", r.daily, 0, send, summary, progress, "daily totals");
  await sendAll("sleep", nights, 0, send, summary, progress, "sleep");
  await sendAll("weight", r.weight, 0, send, summary, progress, "weight");
  await sendAll("vo2max", r.vo2max, 0, send, summary, progress, "VO2 max");
  if (r.skipped) summary.problems.push(`${r.skipped.toLocaleString("en-GB")} records had dates or values that couldn't be read and were skipped.`);
  return summary;
}
