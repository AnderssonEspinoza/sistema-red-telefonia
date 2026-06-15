const localLatencySloMs = Number(process.env.LOCAL_LATENCY_SLO_MS ?? 200);
const localLatencyTargetPercent = Number(process.env.LOCAL_LATENCY_TARGET_PERCENT ?? 99);
const localLatencySampleWindow = Number(process.env.LOCAL_LATENCY_SAMPLE_WINDOW ?? 20);

export function sliConfig() {
  return {
    localLatency: {
      name: "dashboard_to_backend_rtt_ms",
      description: "Tiempo de ida y vuelta medido desde el navegador del dashboard hasta la API local.",
      sloMs: positiveOrDefault(localLatencySloMs, 200),
      targetPercent: boundedPercent(localLatencyTargetPercent),
      sampleWindow: positiveOrDefault(localLatencySampleWindow, 20)
    }
  };
}

function positiveOrDefault(value: number, fallback: number) {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function boundedPercent(value: number) {
  if (!Number.isFinite(value)) {
    return 99;
  }

  return Math.min(100, Math.max(1, value));
}
