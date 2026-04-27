import { Injectable } from '@nestjs/common';
import { NotificationsGateway } from './notifications.gateway';
import type {
  NewBookingRequestPayload,
  BookingStatusChangedPayload,
  TripCanceledPayload,
  TripStartedPayload,
  TripFinishedPayload,
  PassengerBoardedPayload,
  NoShowUpdatedPayload,
  BookingCanceledPayload,
  TripAutoCanceledPayload,
  RouteUpdatedPayload,
  EtaUpdatedPayload,
} from './notifications.types';

@Injectable()
export class NotificationsService {
  constructor(private readonly notificationsGateway: NotificationsGateway) { }

  // H-1: all methods now use explicit payload types — typos in field names are caught at compile time

  notifyDriverNewRequest(driverId: string, payload: NewBookingRequestPayload): void {
    this.notificationsGateway.server.to(driverId).emit('new_booking_request', payload);
  }

  notifyPassengerStatusChange(passengerId: string, payload: BookingStatusChangedPayload): void {
    this.notificationsGateway.server.to(passengerId).emit('booking_status_changed', payload);
  }

  notifyPassengerTripCanceled(passengerId: string, payload: TripCanceledPayload): void {
    this.notificationsGateway.server.to(passengerId).emit('trip_canceled', payload);
  }

  notifyPassengerTripStarted(passengerId: string, payload: TripStartedPayload): void {
    this.notificationsGateway.server.to(passengerId).emit('trip_started', payload);
  }

  notifyPassengerTripFinished(passengerId: string, payload: TripFinishedPayload): void {
    this.notificationsGateway.server.to(passengerId).emit('trip_finished', payload);
  }

  notifyDriverPassengerBoarded(driverId: string, payload: PassengerBoardedPayload): void {
    this.notificationsGateway.server.to(driverId).emit('passengerBoarded', payload);
  }

  notifyPassengerNoShow(passengerId: string, payload: NoShowUpdatedPayload): void {
    this.notificationsGateway.server.to(passengerId).emit('noShowUpdated', payload);
  }

  notifyDriverBookingCanceled(driverId: string, payload: BookingCanceledPayload): void {
    this.notificationsGateway.server.to(driverId).emit('booking_canceled', payload);
  }

  notifyDriverTripAutoCanceled(driverId: string, payload: TripAutoCanceledPayload): void {
    this.notificationsGateway.server.to(driverId).emit('trip_auto_canceled', payload);
  }

  notifyDriverRouteUpdated(driverId: string, payload: RouteUpdatedPayload): void {
    this.notificationsGateway.server.to(driverId).emit('route_updated', payload);
  }

  notifyPassengerEtaUpdated(passengerId: string, payload: EtaUpdatedPayload): void {
    this.notificationsGateway.server.to(passengerId).emit('eta_updated', payload);
  }

  notifyTripPublished(): void {
    this.notificationsGateway.server.emit('trip_published');
  }
}
