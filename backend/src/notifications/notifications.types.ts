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
  status: 'PENDING_ROUTE_RECALC' | 'ACCEPTED' | 'REJECTED' | 'ROUTE_RECALC_FAILED';
}

export interface TripCanceledPayload {
  tripId: string;
}

export interface TripBoardingPayload {
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

/**
 * Emitted to each participant of an active trip on every driver GPS ping.
 *
 * etaSeconds is personalized:
 *   - For a passenger it is seconds remaining until their own drop-off stop.
 *   - For the driver it is seconds remaining to the final destination.
 *   - null when the trip has no active route plan yet (Routes API still
 *     computing the first recalc).
 *
 * heading is degrees clockwise from true north, null if unavailable.
 */
export interface DriverLocationUpdatePayload {
  tripId: string;
  lat: number;
  lng: number;
  heading: number | null;
  etaSeconds: number | null;
}

/** Stored in Redis under `driver_location:{tripId}` (TTL 30 s). */
export interface StoredDriverLocation {
  lat: number;
  lng: number;
  heading: number | null;
  ts: number; // Date.now()
}
