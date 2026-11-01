export class QueryCache<T> {
  private readonly entries = new Map<string, { value: T; expires: number }>();
  private readonly pending = new Map<string, Promise<T>>();
  constructor(private readonly capacity = 256) {}

  get(key: string, load: () => Promise<{ value: T; ttlMs: number }>): Promise<T> {
    const cached = this.entries.get(key);
    if (cached && cached.expires > Date.now()) {
      this.entries.delete(key);
      this.entries.set(key, cached);
      return Promise.resolve(cached.value);
    }
    this.entries.delete(key);
    const existing = this.pending.get(key);
    if (existing) return existing;
    const promise = load().then(({ value, ttlMs }) => {
      this.entries.set(key, { value, expires: Date.now() + ttlMs });
      while (this.entries.size > this.capacity) this.entries.delete(this.entries.keys().next().value!);
      return value;
    }).finally(() => this.pending.delete(key));
    this.pending.set(key, promise);
    return promise;
  }
}
