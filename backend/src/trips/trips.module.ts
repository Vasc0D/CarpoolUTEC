import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TripsService } from './trips.service';
import { TripsController } from './trips.controller';
import { Trip } from './entities/trip.entity';
import { TripRoutePlan } from './entities/trip-route-plan.entity';
import { TripRouteLeg } from './entities/trip-route-leg.entity';
import { Booking } from '../bookings/entities/booking.entity';
import { UsersModule } from '../users/users.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { GeoModule } from '../geo/geo.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Trip, TripRoutePlan, TripRouteLeg, Booking]),
    UsersModule,
    NotificationsModule,
    GeoModule,
  ],
  controllers: [TripsController],
  providers: [TripsService],
  // Export TypeOrmModule so other modules (RouteRecalcModule) can inject the
  // TripRoutePlan / TripRouteLeg repositories without re-registering them.
  exports: [TripsService, TypeOrmModule],
})
export class TripsModule { }
