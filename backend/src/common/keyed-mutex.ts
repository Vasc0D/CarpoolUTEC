/**
 * In-process keyed mutex.
 *
 * Serializes async operations that share the same key. Used to protect
 * recalculateRoute against concurrent execution for the same tripId — two
 * bookings being accepted in the same second would otherwise race on
 * `passengerWaypoints` (each loads the trip before the other persisted)
 * and one would overwrite the other.
 *
 * Limitations:
 *   - In-memory only. Multi-instance deployments need a distributed lock
 *     (Redis SETNX or Redlock). That lands in Phase 1 with BullMQ/Redis.
 *   - Holds memory while contention exists; freed when the queue drains.
 *
 * No external dep on purpose: the implementation is ~20 lines and the
 * scope is narrow (one consumer). Swapping for Redlock later only touches
 * BookingsService.
 */
export class KeyedMutex {
  private readonly tails = new Map<string, Promise<void>>();

  async run<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const previous = this.tails.get(key) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>(resolve => { release = resolve; });

    // Chain ourselves onto the queue so the next caller waits for `current`.
    this.tails.set(key, current);

    // Wait for the previous holder; ignore its outcome (errors must not
    // poison the chain — the next holder still gets to run).
    await previous.catch(() => undefined);
    try {
      return await fn();
    } finally {
      release();
      // If nobody enqueued after us, free the slot to keep the map small.
      if (this.tails.get(key) === current) {
        this.tails.delete(key);
      }
    }
  }
}
