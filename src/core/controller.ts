interface Intent {
  key: string;
  target: string;
  valid: () => boolean;
  epoch: number;
}
export class Controller {
  private pending?: Intent;
  private running?: Promise<void>;
  private timer?: ReturnType<typeof setTimeout>;
  private epoch = 0;
  private key?: string;
  failures = 0;
  desired?: string;
  lastRequest?: string;
  error?: string;
  constructor(
    private execute: (target: string, valid: () => boolean) => Promise<void>,
    public delay = 20,
    private changed: () => void = () => {},
  ) {}
  accept(
    region: string,
    target: string,
    valid: () => boolean,
    immediate = false,
  ) {
    const key = region + "\0" + target;
    if (key === this.key && !this.pending) return;
    // Only a completed, still-valid transaction owns a region.
    this.key = undefined;
    this.desired = target;
    this.pending = { key, target, valid, epoch: this.epoch };
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    if (immediate) {
      this.drain();
      return;
    }
    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.drain();
    }, this.delay);
  }
  private drain() {
    if (this.running || this.timer || !this.pending || this.failures >= 3)
      return;
    const intent = this.pending;
    this.pending = undefined;
    const valid = () =>
      intent.epoch === this.epoch &&
      intent.valid() &&
      (!this.pending || this.pending.key === intent.key);
    if (!valid()) {
      if (this.key === intent.key) this.key = undefined;
      return;
    }
    this.lastRequest = intent.target;
    this.changed();
    this.running = (async () => {
      try {
        await this.execute(intent.target, valid);
        if (valid()) {
          this.key = intent.key;
          if (this.pending?.key === intent.key) this.pending = undefined;
          this.failures = 0;
          this.error = undefined;
        }
      } catch (e) {
        if (valid()) {
          this.failures++;
          this.error = e instanceof Error ? e.message : "BACKEND_FAILED";
        }
      }
    })().finally(() => {
      this.running = undefined;
      this.changed();
      this.drain();
    });
  }
  cancel() {
    this.epoch++;
    this.pending = undefined;
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
  }
  reset() {
    this.cancel();
    this.key = undefined;
    this.failures = 0;
    this.error = undefined;
  }
  async idle() {
    // A completed transaction may drain the latest queued intent.
    while (this.running) await this.running;
  }
  dispose() {
    this.reset();
  }
}
