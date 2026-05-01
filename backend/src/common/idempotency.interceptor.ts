import {
  CallHandler,
  ConflictException,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Observable, from, throwError } from 'rxjs';
import { catchError, tap } from 'rxjs/operators';
import { createHash, randomUUID } from 'crypto';

type CacheEntry = {
  bodyHash: string;
  expiresAt: number;
  // null while in-flight; set to {value} on success or {error} on failure.
  outcome: { value: unknown } | { error: unknown } | null;
  // Resolves when the in-flight handler finishes (any outcome).
  done: Promise<void>;
  resolveDone: () => void;
};

/**
 * Idempotency-Key interceptor.
 *
 * Clients can opt in by sending `Idempotency-Key: <opaque-string>` on a
 * mutating request. The first response (success or error) for a given
 * (user, method, path, key) is cached for 1 hour and replayed verbatim
 * on subsequent calls — the handler runs at most once.
 *
 * Concurrent retries that arrive while the original handler is still
 * running await the same outcome instead of double-executing. This is
 * what protects POST /bookings/:tripId from the React-StrictMode-style
 * double-fire and from network-layer retries.
 *
 * If the same key is reused with a different request body, we return
 * 422 Unprocessable Entity per the de-facto Idempotency-Key spec
 * (Stripe, IETF draft-ietf-httpapi-idempotency-key-header).
 *
 * In-process cache only; multi-instance deploys need a shared store
 * (Redis), which lands in Phase 1 alongside BullMQ.
 */
@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  private readonly logger = new Logger(IdempotencyInterceptor.name);
  private readonly store = new Map<string, CacheEntry>();
  private readonly ttlMs = 60 * 60 * 1000; // 1 hour
  private readonly maxEntries = 10_000;

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest();
    const headerKey = req.headers['idempotency-key'] as string | undefined;

    // Idempotency is opt-in. Without the header, behave normally.
    if (!headerKey) return next.handle();

    // Only safeguard mutating verbs — GET/HEAD/OPTIONS are idempotent by HTTP semantics.
    const method = (req.method as string).toUpperCase();
    if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') {
      return next.handle();
    }

    if (typeof headerKey !== 'string' || headerKey.length === 0 || headerKey.length > 200) {
      return throwError(() => new UnprocessableEntityException('Idempotency-Key inválido'));
    }

    const userId: string = req.user?.id ?? 'anon';
    const path: string = req.originalUrl ?? req.url ?? '';
    const cacheKey = `${userId}:${method}:${path}:${headerKey}`;
    const bodyHash = this.hashBody(req.body);

    this.evictExpiredIfNeeded();
    const existing = this.store.get(cacheKey);

    if (existing) {
      if (existing.bodyHash !== bodyHash) {
        // Spec: reusing a key with different params is a client bug, not a retry.
        return throwError(() =>
          new UnprocessableEntityException(
            'Idempotency-Key fue reutilizada con parámetros diferentes',
          ),
        );
      }
      this.logger.debug(`Idempotency replay: ${cacheKey}`);
      return from(this.replay(existing));
    }

    // Register in-flight entry up front so concurrent retries await the same handler.
    let resolveDone!: () => void;
    const done = new Promise<void>(r => { resolveDone = r; });
    const entry: CacheEntry = {
      bodyHash,
      expiresAt: Date.now() + this.ttlMs,
      outcome: null,
      done,
      resolveDone,
    };
    this.store.set(cacheKey, entry);

    return next.handle().pipe(
      tap(value => {
        entry.outcome = { value };
        entry.resolveDone();
      }),
      catchError(error => {
        // We deliberately cache the error too: a 400 returned to the first
        // call must be the same response on the retry (idempotency means
        // "ran once" — not "kept retrying until success").
        entry.outcome = { error };
        entry.resolveDone();
        return throwError(() => error);
      }),
    );
  }

  private async replay(entry: CacheEntry): Promise<unknown> {
    if (!entry.outcome) await entry.done;
    if (!entry.outcome) throw new ConflictException('Solicitud idempotente sin resolver');
    if ('error' in entry.outcome) throw entry.outcome.error;
    return entry.outcome.value;
  }

  private hashBody(body: unknown): string {
    // Stable JSON: stringify with sorted keys so {a,b} and {b,a} share the same hash.
    const stable = JSON.stringify(body ?? null, Object.keys(body ?? {}).sort());
    return createHash('sha256').update(stable).digest('hex');
  }

  private evictExpiredIfNeeded(): void {
    if (this.store.size < this.maxEntries) return;
    const now = Date.now();
    for (const [key, entry] of this.store) {
      if (entry.expiresAt < now) this.store.delete(key);
      if (this.store.size < this.maxEntries * 0.9) return;
    }
    // If still over cap (no expirations), drop the oldest insertion.
    if (this.store.size >= this.maxEntries) {
      const oldest = this.store.keys().next().value;
      if (oldest !== undefined) this.store.delete(oldest);
    }
  }

  /** Test/diagnostic only. */
  // istanbul ignore next
  generateKey(): string {
    return randomUUID();
  }
}
