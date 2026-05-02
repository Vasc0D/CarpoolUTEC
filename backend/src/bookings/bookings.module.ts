import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BookingsService } from './bookings.service';
import { BookingsController } from './bookings.controller';
import { TripsModule } from '../trips/trips.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { UsersModule } from '../users/users.module';
import { GeoModule } from '../geo/geo.module';
import { Booking } from './entities/booking.entity';
import { Trip } from '../trips/entities/trip.entity';
import { KeyedMutex } from '../common/keyed-mutex';

@Module({
  imports: [TypeOrmModule.forFeature([Booking, Trip]), TripsModule, NotificationsModule, UsersModule, GeoModule],
  controllers: [BookingsController],
  // KeyedMutex needs Redis (provided globally by RedisModule) so it lives in
  // providers here rather than as `new KeyedMutex()`.
  providers: [BookingsService, KeyedMutex],
  exports: [BookingsService]
})
export class BookingsModule { }
