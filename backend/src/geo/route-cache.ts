/**
 * Tiny LRU+TTL cache for Routes API v2 responses.
 *
 * Why inline (no `lru-cache` dep): scope is one consumer (DirectionsService),
 * the dataset is small (≤500 entries), and Map's insertion-order property
 * gives us LRU semantics for free. Avoiding the dep keeps the dependency
 * graph slim ahead of the BullMQ/Redis additions in Phase 1.
 *
 * Key construction (caller's responsibility): hash of
 *   - origin/destination/intermediates rounded to ~1m precision (5 decimals)
 *   - departureTime bucketed to 5-minute windows
 * so two near-identical Routes API requests within the same 5-min window
 * collide and reuse the result.
 *
 * TTL of 5 minutes: long enough that thundering-herd searches collapse to
 * one upstream call, short enough that traffic predictions stay realistic.
 */
export class RouteCache<V> {
  private readonly store = new Map<string, { value: V; expiresAt: number }>();

  constructor(
    private readonly maxEntries = 500,
    private readonly ttlMs = 5 * 60 * 1000,
  ) {}

  get(key: string): V | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return undefined;
    }
    // Promote to most-recently-used: delete + re-insert moves to the back of the Map.
    this.store.delete(key);
    this.store.set(key, entry);
    return entry.value;
  }

  set(key: string, value: V): void {
    if (this.store.size >= this.maxEntries && !this.store.has(key)) {
      // Evict the oldest (front of the Map).
      const oldestKey = this.store.keys().next().value;
      if (oldestKey !== undefined) this.store.delete(oldestKey);
    }
    this.store.set(key, { value, expiresAt: Date.now() + this.ttlMs });
  }

  /** Test/diagnostic only — do not rely on this in business logic. */
  size(): number {
    return this.store.size;
  }
}
