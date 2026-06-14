import mysql, { type RowDataPacket } from "mysql2/promise";
import type { Llamada } from "./db.js";

const enabled = process.env.CDR_ENABLED !== "false";
const host = process.env.FREEPBX_DB_HOST ?? "freepbx-db";
const port = Number(process.env.FREEPBX_DB_PORT ?? 3306);
const user = process.env.FREEPBX_DB_USER ?? "freepbxuser";
const password = process.env.FREEPBX_DB_PASSWORD ?? "freepbx_dev";
const database = process.env.FREEPBX_CDR_DATABASE ?? "asteriskcdrdb";

let pool: mysql.Pool | null = null;

export interface CdrRecord {
  calldate: string;
  src: string;
  dst: string;
  duration: number;
  billsec: number;
  disposition: string;
  uniqueid: string;
  linkedid: string;
  recordingfile: string;
}

export async function checkCdr() {
  if (!enabled) {
    return { enabled, ok: true, error: null, host, database };
  }

  try {
    await getPool().query("SELECT 1");
    return { enabled, ok: true, error: null, host, database };
  } catch (error) {
    return {
      enabled,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      host,
      database
    };
  }
}

export async function listRecentCdr(limit = 20): Promise<CdrRecord[]> {
  if (!enabled) {
    return [];
  }

  const [rows] = await getPool().query<RowDataPacket[]>(
    `SELECT
       calldate,
       src,
       dst,
       duration,
       billsec,
       disposition,
       uniqueid,
       linkedid,
       recordingfile
     FROM cdr
     ORDER BY calldate DESC
     LIMIT ?`,
    [limit]
  );

  return rows.map((row) => ({
    calldate: normalizeDate(row.calldate),
    src: String(row.src ?? ""),
    dst: String(row.dst ?? ""),
    duration: Number(row.duration ?? 0),
    billsec: Number(row.billsec ?? 0),
    disposition: String(row.disposition ?? ""),
    uniqueid: String(row.uniqueid ?? ""),
    linkedid: String(row.linkedid ?? ""),
    recordingfile: String(row.recordingfile ?? "")
  }));
}

export async function listRecentCdrRecordings(limit = 20): Promise<CdrRecord[]> {
  if (!enabled) {
    return [];
  }

  const [rows] = await getPool().query<RowDataPacket[]>(
    `SELECT
       calldate,
       src,
       dst,
       duration,
       billsec,
       disposition,
       uniqueid,
       linkedid,
       recordingfile
     FROM cdr
     WHERE recordingfile IS NOT NULL AND recordingfile <> ''
     ORDER BY calldate DESC
     LIMIT ?`,
    [limit]
  );

  return rows.map((row) => ({
    calldate: normalizeDate(row.calldate),
    src: String(row.src ?? ""),
    dst: String(row.dst ?? ""),
    duration: Number(row.duration ?? 0),
    billsec: Number(row.billsec ?? 0),
    disposition: String(row.disposition ?? ""),
    uniqueid: String(row.uniqueid ?? ""),
    linkedid: String(row.linkedid ?? ""),
    recordingfile: String(row.recordingfile ?? "")
  }));
}

export async function reconcileCallsWithCdr(calls: Llamada[], cdrLimit = 100) {
  const cdrRecords = await listRecentCdr(cdrLimit).catch(() => []);

  return calls.map((call) => {
    const match = findCdrMatch(call, cdrRecords);

    return {
      llamadaId: call.id,
      fuente: call.fuente,
      estado: call.estado,
      extensionOrigen: call.extension_origen,
      extensionDestino: call.extension_destino,
      amiUniqueId: call.ami_uniqueid,
      amiLinkedId: call.ami_linkedid,
      cdr: match?.record ?? null,
      matchedBy: match?.matchedBy ?? null,
      consistent: match ? isConsistent(call, match.record) : call.fuente !== "ami" ? null : false
    };
  });
}

function getPool() {
  if (!pool) {
    pool = mysql.createPool({
      host,
      port,
      user,
      password,
      database,
      waitForConnections: true,
      connectionLimit: 4
    });
  }

  return pool;
}

function findCdrMatch(call: Llamada, records: CdrRecord[]) {
  const byLinkedId = records.find(
    (record) => call.ami_linkedid && record.linkedid && record.linkedid === call.ami_linkedid
  );

  if (byLinkedId) {
    return { record: byLinkedId, matchedBy: "linkedid" };
  }

  const byUniqueId = records.find(
    (record) => call.ami_uniqueid && record.uniqueid && record.uniqueid === call.ami_uniqueid
  );

  if (byUniqueId) {
    return { record: byUniqueId, matchedBy: "uniqueid" };
  }

  const callStartedAt = new Date(call.fecha_inicio).getTime();
  const byExtensionsAndTime = records.find((record) => {
    const cdrStartedAt = new Date(record.calldate).getTime();
    const sameLeg =
      record.src === call.extension_origen &&
      (record.dst === call.extension_destino || record.dst.includes(call.extension_destino ?? ""));

    return sameLeg && Math.abs(cdrStartedAt - callStartedAt) <= 10 * 60 * 1000;
  });

  if (byExtensionsAndTime) {
    return { record: byExtensionsAndTime, matchedBy: "extension-time" };
  }

  return null;
}

function isConsistent(call: Llamada, cdr: CdrRecord) {
  const disposition = cdr.disposition.toUpperCase();
  const state = call.estado.toUpperCase();

  if (disposition === "ANSWERED") {
    return ["ANSWERED", "COMPLETED", "HANGUP"].includes(state);
  }

  if (disposition === "NO ANSWER") {
    return ["NOANSWER", "HANGUP", "RINGING"].includes(state);
  }

  if (disposition === "BUSY") {
    return ["BUSY", "HANGUP"].includes(state);
  }

  return true;
}

function normalizeDate(value: unknown) {
  if (value instanceof Date) {
    return value.toISOString();
  }

  return String(value);
}
