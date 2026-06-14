export type CircuitState = "CLOSED" | "OPEN" | "HALF_OPEN";

export interface CircuitSnapshot {
  name: string;
  state: CircuitState;
  failures: number;
  openedAt: string | null;
  nextRetryAt: string | null;
  failureThreshold: number;
}

export class CircuitBreaker {
  private state: CircuitState = "CLOSED";
  private failures = 0;
  private openedAt: number | null = null;

  constructor(
    private readonly name: string,
    private readonly failureThreshold = 3,
    private readonly resetTimeoutMs = 15000
  ) {}

  async execute<T>(operation: () => Promise<T>): Promise<T> {
    if (this.state === "OPEN") {
      const canRetry = this.openedAt !== null && Date.now() - this.openedAt >= this.resetTimeoutMs;

      if (!canRetry) {
        throw new Error(`Circuit ${this.name} is OPEN`);
      }

      this.state = "HALF_OPEN";
    }

    try {
      const result = await operation();
      this.success();
      return result;
    } catch (error) {
      this.failure();
      throw error;
    }
  }

  success() {
    this.state = "CLOSED";
    this.failures = 0;
    this.openedAt = null;
  }

  failure() {
    this.failures += 1;

    if (this.state === "HALF_OPEN" || this.failures >= this.failureThreshold) {
      this.state = "OPEN";
      this.openedAt = Date.now();
    }
  }

  forceOpen() {
    this.failures = Math.max(this.failures, this.failureThreshold);
    this.state = "OPEN";
    this.openedAt = Date.now();
  }

  snapshot(): CircuitSnapshot {
    const nextRetryAt =
      this.openedAt === null ? null : new Date(this.openedAt + this.resetTimeoutMs).toISOString();

    return {
      name: this.name,
      state: this.state,
      failures: this.failures,
      openedAt: this.openedAt === null ? null : new Date(this.openedAt).toISOString(),
      nextRetryAt,
      failureThreshold: this.failureThreshold
    };
  }
}
