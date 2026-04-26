import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { NotificationsService } from './notifications.service';
import { NotificationsGateway } from './notifications.gateway';
import { Booking } from '../bookings/entities/booking.entity';
import { Trip } from '../trips/entities/trip.entity';

@Module({
  imports: [
    // Trip needed for driver_location authz check in the gateway
    TypeOrmModule.forFeature([Booking, Trip]),
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
  exports: [NotificationsService],
})
export class NotificationsModule { }
