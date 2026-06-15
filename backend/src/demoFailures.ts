export type DemoSupplier =
  | "postgres"
  | "ami"
  | "floci-sqs"
  | "floci-s3"
  | "dialer"
  | "transcription"
  | "metrics";

export interface DemoFailureState {
  supplier: DemoSupplier;
  enabled: boolean;
  since: string | null;
}

const suppliers: DemoSupplier[] = ["postgres", "ami", "floci-sqs", "floci-s3", "dialer", "transcription", "metrics"];
const state = new Map<DemoSupplier, string>();

export function setDemoFailure(supplier: DemoSupplier, enabled: boolean) {
  if (!suppliers.includes(supplier)) {
    throw new Error(`Proveedor desconocido: ${supplier}`);
  }

  if (enabled) {
    state.set(supplier, new Date().toISOString());
  } else {
    state.delete(supplier);
  }
}

export function listDemoFailures(): DemoFailureState[] {
  return suppliers.map((supplier) => ({
    supplier,
    enabled: state.has(supplier),
    since: state.get(supplier) ?? null
  }));
}

export function assertSupplierAvailable(supplier: DemoSupplier) {
  if (state.has(supplier)) {
    throw new Error(`Falla simulada activa para ${supplier}`);
  }
}

export function isDemoFailureEnabled(supplier: DemoSupplier) {
  return state.has(supplier);
}
