import type { NextFunction, Request, Response } from "express";

export type OperationalLevel = "INFO" | "WARN" | "ERROR";

export interface OperationalEvent {
  id: number;
  at: string;
  level: OperationalLevel;
  type: string;
  message: string;
  details?: Record<string, unknown>;
}

const maxEvents = 200;
const startedAt = new Date().toISOString();
const events: OperationalEvent[] = [];

let nextId = 1;
let requestCount = 0;
let errorCount = 0;
let totalDurationMs = 0;
let callEvents = 0;
let lastRequestAt: string | null = null;
let lastCallEventAt: string | null = null;

export function requestMetrics(request: Request, response: Response, next: NextFunction) {
  const started = Date.now();
  requestCount += 1;
  lastRequestAt = new Date().toISOString();

  response.on("finish", () => {
    totalDurationMs += Date.now() - started;

    if (response.statusCode >= 500) {
      errorCount += 1;
      recordOperationalEvent("ERROR", "http.error", "Error HTTP en API", {
        method: request.method,
        path: request.path,
        statusCode: response.statusCode
      });
    }
  });

  next();
}

export function recordCallMetric(details: Record<string, unknown>) {
  callEvents += 1;
  lastCallEventAt = new Date().toISOString();
  recordOperationalEvent("INFO", "call.event", "Evento de llamada procesado", details);
}

export function recordOperationalEvent(
  level: OperationalLevel,
  type: string,
  message: string,
  details?: Record<string, unknown>
) {
  events.unshift({
    id: nextId,
    at: new Date().toISOString(),
    level,
    type,
    message,
    details
  });
  nextId += 1;

  if (events.length > maxEvents) {
    events.pop();
  }
}

export function listOperationalEvents(limit = 50) {
  return events.slice(0, limit);
}

export function metricsSnapshot() {
  return {
    startedAt,
    uptimeSeconds: Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000),
    requestCount,
    errorCount,
    averageRequestMs: requestCount > 0 ? Math.round(totalDurationMs / requestCount) : 0,
    callEvents,
    lastRequestAt,
    lastCallEventAt
  };
}
