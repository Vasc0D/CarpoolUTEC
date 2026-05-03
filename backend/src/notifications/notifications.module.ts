import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { NotificationsService } from './notifications.service';
import { NotificationsGateway } from './notifications.gateway';
import { Booking } from '../bookings/entities/booking.entity';
import { Trip } from '../trips/entities/trip.entity';
import { TripRoutePlan } from '../trips/entities/trip-route-plan.entity';

@Module({
  imports: [
    // Trip + Booking: driver_location auth + ETA booking lookups
    // TripRoutePlan: active plan load for ETA computation on each GPS ping
    TypeOrmModule.forFeature([Booking, Trip, TripRoutePlan]),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        // A-2: getOrThrow — no silent fallback to 'super-secret' in production
        secret: configService.getOrThrow<string>('JWT_SECRET'),
      }),
    }),
  ],
  providers: [NotificationsGateway, NotificationsService],
  exports: [NotificationsService, NotificationsGateway],
})
export class NotificationsModule { }
