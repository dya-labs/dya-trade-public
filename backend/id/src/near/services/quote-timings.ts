type Stage = 'catalog' | 'token_discovery' | 'pair_access' | 'balances' | 'session' | 'fees' | 'preview' | 'oneclick' | 'executable' | 'signing_payload' | 'prepare' | 'challenge' | 'cache';

/** Numeric diagnostics only: never record account, amount, token, or provider payloads. */
export class QuoteTimings {
  constructor(private operation: "preview" | "prepare" = "preview") {}
  private started = performance.now();
  private durations: Partial<Record<Stage, number>> = {};
  async measure<T>(stage: Stage, run: () => Promise<T> | T): Promise<T> {
    const started = performance.now();
    try { return await run(); }
    finally { this.durations[stage] = Math.round((performance.now() - started) * 10) / 10; }
  }
  snapshot() { return { ...this.durations, total: Math.round((performance.now() - this.started) * 10) / 10 }; }
  header() { return Object.entries(this.snapshot()).map(([stage, duration]) => `quote_${stage};dur=${duration}`).join(', '); }
  log(outcome: 'success' | 'error') { console.info('trading.quote.backend', { operation: this.operation, outcome, ...this.snapshot() }); }
}
