import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BookingsService } from './bookings.service';
import { BookingsController } from './bookings.controller';
import { TripsModule } from '../trips/trips.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { UsersModule } from '../users/users.module';
import { Booking } from './entities/booking.entity';
import { Trip } from '../trips/entities/trip.entity';
import { RouteRecalcModule } from '../route-recalc/route-recalc.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Booking, Trip]),
    TripsModule,
    NotificationsModule,
    UsersModule,
    // BookingsService uses RouteRecalcQueue.enqueue() to defer Routes API work
    // off the request thread; the queue is exported by RouteRecalcModule.
    RouteRecalcModule,
  ],
  controllers: [BookingsController],
  providers: [BookingsService],
  exports: [BookingsService]
})
export class BookingsModule { }
