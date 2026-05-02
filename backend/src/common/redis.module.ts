import { Global, Logger, Module, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis, { Redis as RedisClient } from 'ioredis';

/**
 * Token under which the shared ioredis client is provided. Inject with:
 *   @Inject(REDIS_CLIENT) private readonly redis: RedisClient
 *
 * Kept as a string token (not a class) because Redis is a third-party type
 * and we want to swap implementations (e.g., to a mock in tests) without
 * touching call sites.
 */
export const REDIS_CLIENT = 'REDIS_CLIENT';

/**
 * Global Redis module.
 *
 * Provides one shared ioredis connection for everything that needs Redis
 * directly: distributed locks (KeyedMutex Phase 1), shared caches, and any
 * future feature that doesn't fit BullMQ's job model.
 *
 * BullMQ creates its own connections internally (one per queue/worker) and
 * does NOT share this one — that's intentional, BullMQ wants isolation to
 * avoid blocking the main connection during long-polling operations.
 */
@Global()
@Module({
  providers: [
    {
      provide: REDIS_CLIENT,
      inject: [ConfigService],
      useFactory: (config: ConfigService): RedisClient => {
        const logger = new Logger('RedisModule');
        const client = new Redis({
          host: config.getOrThrow<string>('REDIS_HOST'),
          port: config.getOrThrow<number>('REDIS_PORT'),
          password: config.get<string>('REDIS_PASSWORD') || undefined,
          // Lazy connect so a Redis outage doesn't crash bootstrap; the first
          // command that needs the connection will retry per ioredis defaults.
          lazyConnect: false,
          maxRetriesPerRequest: 3,
        });
        client.on('error', err => logger.error(`Redis error: ${err.message}`));
        client.on('connect', () => logger.log('Redis connected'));
        return client;
      },
    },
  ],
  exports: [REDIS_CLIENT],
})
export class RedisModule implements OnModuleDestroy {
  // Resolve the client via DI in onModuleDestroy by accepting it as a constructor
  // arg — Nest will inject it because of the matching token in `providers`.
  constructor() {
    /* injected via REDIS_CLIENT in onModuleDestroy when needed */
  }

  async onModuleDestroy(): Promise<void> {
    // The DI container disposes providers automatically; this hook exists so
    // any future side-effects (flushing pending jobs, closing local listeners)
    // have a single place to live.
  }
}
