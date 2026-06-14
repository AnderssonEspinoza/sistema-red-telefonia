import fs from "node:fs/promises";
import path from "node:path";
import type { CdrRecord } from "./cdr.js";

const enabled = process.env.CALL_RECORDING_ENABLED !== "false";
const recordingsPath = process.env.ASTERISK_RECORDINGS_PATH ?? "/freepbx-var/spool/asterisk/monitor";

export interface RecordingSummary extends CdrRecord {
  file: string;
  available: boolean;
  sizeBytes: number | null;
  downloadUrl: string | null;
}

export function recordingConfig() {
  return {
    enabled,
    path: recordingsPath
  };
}

export async function enrichRecordings(records: CdrRecord[]): Promise<RecordingSummary[]> {
  const withFiles = records.filter((record) => record.recordingfile.trim() !== "");
  return Promise.all(withFiles.map((record) => toRecordingSummary(record)));
}

export async function resolveRecordingFile(filename: string, dateHint?: string | null) {
  if (!enabled) {
    return null;
  }

  const safeName = safeBasename(filename);

  if (!safeName) {
    return null;
  }

  for (const candidate of candidatePaths(safeName, dateHint)) {
    const stat = await fs.stat(candidate).catch(() => null);

    if (stat?.isFile()) {
      return {
        filename: safeName,
        path: candidate,
        sizeBytes: stat.size
      };
    }
  }

  return null;
}

async function toRecordingSummary(record: CdrRecord): Promise<RecordingSummary> {
  const file = safeBasename(record.recordingfile) ?? record.recordingfile;
  const resolved = await resolveRecordingFile(file, record.calldate);

  return {
    ...record,
    file,
    available: Boolean(resolved),
    sizeBytes: resolved?.sizeBytes ?? null,
    downloadUrl: resolved ? `/api/recordings/${encodeURIComponent(file)}?date=${encodeURIComponent(record.calldate)}` : null
  };
}

function candidatePaths(filename: string, dateHint?: string | null) {
  const candidates = [path.join(recordingsPath, filename)];
  const date = dateHint ? new Date(dateHint) : null;

  if (date && !Number.isNaN(date.getTime())) {
    const year = String(date.getFullYear());
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    candidates.push(path.join(recordingsPath, year, month, day, filename));
  }

  return candidates;
}

function safeBasename(value: string) {
  const file = path.basename(value.trim());

  if (!file || file === "." || file === ".." || file.includes("/") || file.includes("\\")) {
    return null;
  }

  return file;
}
