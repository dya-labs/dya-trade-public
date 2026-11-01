export class QueueTimeout extends Error {
  constructor() { super("ClickHouse query queue timed out"); }
}

type Waiter = { grant(): void; timer: Timer };

export class Semaphore {
  private active = 0;
  private readonly waiting: Waiter[] = [];
  constructor(private readonly capacity = 8, private readonly timeoutMs = 2000) {}

  async run<T>(operation: () => Promise<T>): Promise<T> {
    if (this.active < this.capacity) this.active++;
    else await new Promise<void>((resolve, reject) => {
      const waiter: Waiter = {
        grant: resolve,
        timer: setTimeout(() => {
          const index = this.waiting.indexOf(waiter);
          if (index !== -1) this.waiting.splice(index, 1);
          reject(new QueueTimeout());
        }, this.timeoutMs),
      };
      this.waiting.push(waiter);
    });
    try { return await operation(); }
    finally {
      const next = this.waiting.shift();
      if (next) { clearTimeout(next.timer); next.grant(); }
      else this.active--;
    }
  }
}
