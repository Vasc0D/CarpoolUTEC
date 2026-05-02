import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Booking } from '../bookings/entities/booking.entity';
import { Trip } from '../trips/entities/trip.entity';
import { TripRoutePlan } from '../trips/entities/trip-route-plan.entity';
import { TripRouteLeg } from '../trips/entities/trip-route-leg.entity';
import { GeoModule } from '../geo/geo.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { KeyedMutex } from '../common/keyed-mutex';
import { ROUTE_RECALC_QUEUE } from './route-recalc.types';
import { RouteRecalcQueue } from './route-recalc.queue';
import { RouteRecalcProcessor } from './route-recalc.processor';

/**
 * Houses the BullMQ queue, producer service, and processor for route
 * recalculation. Imported by BookingsModule (which uses the producer)
 * and registered in AppModule (so the processor starts at bootstrap).
 *
 * Note: the processor needs Trip + Booking + TripRoutePlan repositories
 * directly (not via BookingsService) to avoid a circular import —
 * BookingsService already depends on RouteRecalcQueue.
 */
@Module({
  imports: [
    BullModule.registerQueue({ name: ROUTE_RECALC_QUEUE }),
    TypeOrmModule.forFeature([Booking, Trip, TripRoutePlan, TripRouteLeg]),
    GeoModule,
    NotificationsModule,
  ],
  providers: [RouteRecalcQueue, RouteRecalcProcessor, KeyedMutex],
  exports: [RouteRecalcQueue],
})
export class RouteRecalcModule {}
