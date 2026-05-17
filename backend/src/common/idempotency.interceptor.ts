import {
  CallHandler,
  ConflictException,
  ExecutionContext,
  HttpException,
  Injectable,
  NestInterceptor,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Inject } from '@nestjs/common';
import { Observable, from, lastValueFrom } from 'rxjs';
import { createHash } from 'crypto';
import { Redis as RedisClient } from 'ioredis';
import { REDIS_CLIENT } from './redis.module';

type StoredOutcome =
  | { bodyHash: string; ok: true; value: unknown }
  | { bodyHash: string; ok: false; status: number; message: string | string[] };

@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  private readonly ttlSeconds = 60 * 60;
  private readonly waitMs = 50;
  private readonly maxWaitMs = 30_000;

  constructor(@Inject(REDIS_CLIENT) private readonly redis: RedisClient) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    return from(this.handle(context, next));
  }

  private async handle(context: ExecutionContext, next: CallHandler): Promise<unknown> {
    const req = context.switchToHttp().getRequest();
    const headerKey = req.headers['idempotency-key'] as string | undefined;
    if (!headerKey) return lastValueFrom(next.handle());

    const method = (req.method as string).toUpperCase();
    if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') {
      return lastValueFrom(next.handle());
    }

    if (typeof headerKey !== 'string' || headerKey.length === 0 || headerKey.length > 200) {
      throw new UnprocessableEntityException('Idempotency-Key inválido');
    }

    const userId: string = req.user?.id ?? 'anon';
    const path: string = req.originalUrl ?? req.url ?? '';
    const cacheKey = `idempotency:${userId}:${method}:${path}:${headerKey}`;
    const lockKey = `${cacheKey}:lock`;
    const bodyHash = this.hashBody(req.body);

    const cached = await this.redis.get(cacheKey);
    if (cached) return this.replay(cached, bodyHash);

    const acquired = await this.redis.set(lockKey, bodyHash, 'EX', this.ttlSeconds, 'NX');
    if (acquired !== 'OK') {
      return this.waitForOutcome(cacheKey, lockKey, bodyHash);
    }

    try {
      const value = await lastValueFrom(next.handle());
      await this.store(cacheKey, { bodyHash, ok: true, value });
      return value;
    } catch (err: any) {
      const status = err instanceof HttpException ? err.getStatus() : 500;
      const response = err instanceof HttpException ? err.getResponse() : err?.message;
      const message =
        typeof response === 'object' && response !== null && 'message' in response
          ? (response as any).message
          : String(response ?? 'Error interno');
      await this.store(cacheKey, { bodyHash, ok: false, status, message });
      throw err;
    } finally {
      await this.redis.del(lockKey).catch(() => undefined);
    }
  }

  private async waitForOutcome(cacheKey: string, lockKey: string, bodyHash: string): Promise<unknown> {
    const deadline = Date.now() + this.maxWaitMs;
    while (Date.now() < deadline) {
      const [cached, inFlightHash] = await Promise.all([
        this.redis.get(cacheKey),
        this.redis.get(lockKey),
      ]);
      if (cached) return this.replay(cached, bodyHash);
      if (inFlightHash && inFlightHash !== bodyHash) {
        throw new UnprocessableEntityException('Idempotency-Key fue reutilizada con parámetros diferentes');
      }
      await new Promise(r => setTimeout(r, this.waitMs));
    }
    throw new ConflictException('Solicitud idempotente aún en proceso');
  }

  private async store(cacheKey: string, outcome: StoredOutcome): Promise<void> {
    await this.redis.set(cacheKey, JSON.stringify(outcome), 'EX', this.ttlSeconds);
  }

  private replay(raw: string, bodyHash: string): unknown {
    const outcome = JSON.parse(raw) as StoredOutcome;
    if (outcome.bodyHash !== bodyHash) {
      throw new UnprocessableEntityException('Idempotency-Key fue reutilizada con parámetros diferentes');
    }
    if (!outcome.ok) {
      throw new HttpException({ message: outcome.message }, outcome.status);
    }
    return outcome.value;
  }

  private hashBody(body: unknown): string {
    const stable = JSON.stringify(this.sort(body ?? null));
    return createHash('sha256').update(stable).digest('hex');
  }

  private sort(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(v => this.sort(v));
    if (value && typeof value === 'object') {
      return Object.fromEntries(
        Object.entries(value as Record<string, unknown>)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([k, v]) => [k, this.sort(v)]),
      );
    }
    return value;
  }
}
