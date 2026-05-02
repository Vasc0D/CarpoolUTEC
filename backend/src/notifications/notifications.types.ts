/**
 * H-1: Typed payloads for every socket event emitted by NotificationsService.
 * Keeping the types here (co-located with the service) makes it easy to keep
 * server payloads and client handlers in sync.
 */

export interface NewBookingRequestPayload {
  bookingId: string;
  passengerId: string;
  passengerName: string;
  tripId: string;
  autoAccepted: boolean;
}

export interface BookingStatusChangedPayload {
  bookingId: string;
  status: 'ACCEPTED' | 'REJECTED';
}

export interface TripCanceledPayload {
  tripId: string;
}

export interface TripStartedPayload {
  tripId: string;
}

export interface TripFinishedPayload {
  tripId: string;
}

export interface PassengerBoardedPayload {
  bookingId: string;
}

export interface NoShowUpdatedPayload {
  bookingId: string;
}

export interface BookingCanceledPayload {
  bookingId: string;
  tripId: string;
  passengerName: string;
}

export interface TripAutoCanceledPayload {
  tripId: string;
}

export interface RouteUpdatedPayload {
  tripId: string;
}

export interface EtaUpdatedPayload {
  bookingId: string;
  passengerEtaSeconds: number;
}

/**
 * Emitted to the passenger when their booking is auto-cancelled because the
 * async route-recalc job exhausted its retries (Routes API outage, etc.).
 * Distinct from `booking_status_changed: REJECTED` so the frontend can show
 * a "couldn't compute route, try again" toast rather than a "driver rejected"
 * one — the user did nothing wrong.
 */
export interface BookingRouteFailedPayload {
  bookingId: string;
  tripId: string;
  reason: string;
}
