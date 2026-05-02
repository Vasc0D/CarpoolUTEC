import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { BullModule } from '@nestjs/bullmq';

import { UsersModule } from './users/users.module';
import { TripsModule } from './trips/trips.module';
import { NotificationsModule } from './notifications/notifications.module';
import { GeoModule } from './geo/geo.module';
import { BookingsModule } from './bookings/bookings.module';
import { AuthModule } from './auth/auth.module';
import { RedisModule } from './common/redis.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ScheduleModule.forRoot(),

    // Rate limiting: max 60 requests per minute per IP globally
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 60 }]),

    // Shared ioredis client used by distributed locks and any component that
    // needs Redis directly (caches, idempotency, etc. as Phase 1 progresses).
    RedisModule,

    // BullMQ root config — every BullModule.registerQueue() in feature
    // modules inherits this connection. Concurrency and retries are set
    // per processor, not here.
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        connection: {
          host: config.getOrThrow<string>('REDIS_HOST'),
          port: config.getOrThrow<number>('REDIS_PORT'),
          password: config.get<string>('REDIS_PASSWORD') || undefined,
        },
      }),
    }),

    // C-1: forRootAsync lets ConfigService.getOrThrow validate every DB param at
    // startup — missing vars throw a clear error instead of a silent TypeORM failure
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'postgres',
        host: config.getOrThrow<string>('DB_HOST'),
        port: config.getOrThrow<number>('DB_PORT'),
        username: config.getOrThrow<string>('DB_USER'),
        password: config.getOrThrow<string>('DB_PASSWORD'),
        database: config.getOrThrow<string>('DB_NAME'),
        autoLoadEntities: true,
        // Only auto-sync schema in development; never in production
        synchronize: config.get<string>('NODE_ENV') !== 'production',
      }),
    }),

    UsersModule,
    TripsModule,
    NotificationsModule,
    GeoModule,
    BookingsModule,
    AuthModule,
  ],
  providers: [
    // Apply rate limiting globally via DI (works with guards that need injected services)
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule {}
