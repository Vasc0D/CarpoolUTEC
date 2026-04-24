import { Injectable } from '@nestjs/common';
import { NotificationsGateway } from './notifications.gateway';

@Injectable()
export class NotificationsService {
  constructor(private readonly notificationsGateway: NotificationsGateway) { }

  notifyDriverNewRequest(driverId: string, bookingData: any) {
    this.notificationsGateway.server.to(driverId).emit('new_booking_request', bookingData);
  }

  notifyPassengerStatusChange(passengerId: string, bookingData: any) {
    this.notificationsGateway.server.to(passengerId).emit('booking_status_changed', bookingData);
  }

  notifyPassengerTripCanceled(passengerId: string, tripData: any) {
    this.notificationsGateway.server.to(passengerId).emit('trip_canceled', tripData);
  }

  notifyPassengerTripStarted(passengerId: string, data: any) {
    this.notificationsGateway.server.to(passengerId).emit('trip_started', data);
  }

  notifyPassengerTripFinished(passengerId: string, data: any) {
    this.notificationsGateway.server.to(passengerId).emit('trip_finished', data);
  }

  notifyDriverPassengerBoarded(driverId: string, data: any) {
    this.notificationsGateway.server.to(driverId).emit('passengerBoarded', data);
  }
}
