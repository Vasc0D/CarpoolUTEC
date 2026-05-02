import { Inject, Injectable, Logger } from '@nestjs/common';
import { Redis as RedisClient } from 'ioredis';
import { randomUUID } from 'crypto';
import { REDIS_CLIENT } from './redis.module';

/**
 * Distributed keyed mutex backed by Redis.
 *
 * Same contract as the in-memory KeyedMutex it replaces: serializes async
 * operations that share a key, automatic cleanup, errors don't poison the
 * queue. Difference: the lock spans every backend instance because the
 * coordination point is Redis SETNX with TTL, not an in-process Map.
 *
 * Lock acquisition uses SETNX with a per-attempt UUID stored as the value;
 * release runs a Lua CAS so we only delete the key if we still own it
 * (otherwise a slow holder whose lock expired could delete the next holder's
 * lock and break serialization).
 *
 * TTL is a safety net against crashed holders, not a soft deadline. If the
 * critical section legitimately runs longer than TTL the next holder may
 * acquire the lock concurrently — for our use case (route recalculation
 * via Routes API) the TTL must comfortably exceed Routes API timeout +
 * DB save. We default to 60s with that margin in mind.
 */
@Injectable()
export class KeyedMutex {
  private readonly logger = new Logger(KeyedMutex.name);

  // Lua: delete the key only if its value matches ours (compare-and-swap).
  // Atomic; guarantees we never delete another holder's lock.
  private static readonly RELEASE_SCRIPT = `
    if redis.call('get', KEYS[1]) == ARGV[1] then
      return redis.call('del', KEYS[1])
    else
      return 0
    end
  `;

  constructor(@Inject(REDIS_CLIENT) private readonly redis: RedisClient) {}

  async run<T>(key: string, fn: () => Promise<T>, opts: { ttlMs?: number; maxWaitMs?: number } = {}): Promise<T> {
    const ttlMs = opts.ttlMs ?? 60_000;
    const maxWaitMs = opts.maxWaitMs ?? 30_000;
    const lockKey = `lock:${key}`;
    const token = randomUUID();
    const deadline = Date.now() + maxWaitMs;
    const pollMs = 50;

    while (true) {
      // SET NX PX → set key only if absent, with TTL in ms. Returns 'OK' on acquisition.
      const acquired = await this.redis.set(lockKey, token, 'PX', ttlMs, 'NX');
      if (acquired === 'OK') break;
      if (Date.now() >= deadline) {
        throw new Error(`KeyedMutex: timed out waiting for lock on "${key}" after ${maxWaitMs}ms`);
      }
      // Brief backoff. Phase 1 keeps this simple; if contention is high enough
      // to matter, switch to Redis Pub/Sub notifications on lock release.
      await new Promise(r => setTimeout(r, pollMs));
    }

    try {
      return await fn();
    } finally {
      try {
        await this.redis.eval(KeyedMutex.RELEASE_SCRIPT, 1, lockKey, token);
      } catch (err: any) {
        this.logger.warn(`KeyedMutex release for "${key}" failed: ${err.message}`);
      }
    }
  }
}
