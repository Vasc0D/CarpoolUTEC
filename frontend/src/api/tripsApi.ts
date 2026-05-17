/**
 * Typed fetchers for trip-related API calls.
 * All functions throw on HTTP error — React Query surfaces that as `error`.
 */
import { axiosClient } from './axiosClient';

// ─── Shared types ─────────────────────────────────────────────────────────────

export interface PlanLeg {
  legIndex: number;
  durationSeconds: number;
  startLat: number;
  startLng: number;
  endLat: number;
  endLng: number;
  passengerDropOffId: string | null;
}

export interface RoutePlanSummary {
  encodedPolyline: string;
  totalDurationSeconds: number;
  legs: PlanLeg[];
}

export interface TripMarker {
  id: string;
  driver: {
    id: string;
    name: string;
    vehicle?: { model: string; color: string; brand: string; plate: string };
  };
  availableSeats: number;
  departureTime: string;
  pricePerSeat: number;
  currentRoutePlan?: RoutePlanSummary | null;
  distanceToDestination?: number;
  matchType?: 'exact' | 'near' | 'detour';
  detourMinutes?: number;
}

export interface BookingSummary {
  id: string;
  status: 'PENDING' | 'PENDING_ROUTE_RECALC' | 'ACCEPTED' | 'ROUTE_RECALC_FAILED' | 'REJECTED' | 'CANCELED' | 'COMPLETED';
  isBoarded?: boolean;
  passenger: { id: string; name: string };
  destLat?: number;
  destLng?: number;
}

export interface DriverTripSummary {
  id: string;
  departureTime: string;
  status: 'SCHEDULED' | 'BOARDING' | 'ACTIVE';
  availableSeats: number;
  pricePerSeat: number;
  currentRoutePlan?: RoutePlanSummary | null;
  bookings: BookingSummary[];
}

export interface ActiveBooking {
  id: string;
  tripId: string;
  status: 'PENDING' | 'PENDING_ROUTE_RECALC' | 'ACCEPTED' | 'ROUTE_RECALC_FAILED';
  tripStatus: 'SCHEDULED' | 'BOARDING' | 'ACTIVE';
  departureTime?: string;
  passengerEtaSeconds?: number;
  destLat?: number;
  destLng?: number;
  driver?: {
    name: string;
    vehicle?: { brand: string; model: string; color: string; plate: string } | null;
  };
}

export interface StopCoverage {
  id: string;
  covered: boolean;
}

// ─── Fetchers ─────────────────────────────────────────────────────────────────

export const fetchAvailableTrips = async (
  userLat: number,
  userLng: number,
  destLat: number,
  destLng: number,
): Promise<TripMarker[]> => {
  const { data } = await axiosClient.get<TripMarker[]>('/trips', {
    params: { lat: userLat, lng: userLng, destLat, destLng },
  });
  return data ?? [];
};

export const fetchStopsCoverage = async (
  stops: Array<{ id: string; lat: number; lng: number }>,
): Promise<StopCoverage[]> => {
  const { data } = await axiosClient.get<StopCoverage[]>('/trips/stops-coverage', {
    params: { stops: JSON.stringify(stops) },
  });
  return data ?? [];
};

export const fetchActiveDriverTrip = async (): Promise<DriverTripSummary | null> => {
  const { data } = await axiosClient.get<DriverTripSummary[]>('/trips/my-trips');
  return (data as DriverTripSummary[]).find(
    t => t.status === 'SCHEDULED' || t.status === 'BOARDING' || t.status === 'ACTIVE',
  ) ?? null;
};

export const fetchMyActiveBooking = async (): Promise<ActiveBooking | null> => {
  const { data } = await axiosClient.get<any[]>('/bookings/me');
  const active = data.find(b =>
    b.status === 'PENDING' ||
    b.status === 'PENDING_ROUTE_RECALC' ||
    b.status === 'ACCEPTED' ||
    b.status === 'ROUTE_RECALC_FAILED',
  );
  if (!active) return null;
  return {
    id: active.id,
    tripId: active.trip.id,
    status: active.status,
    tripStatus: active.trip.status,
    departureTime: active.trip.departureTime,
    passengerEtaSeconds: active.trip.passengerEtaSeconds ?? undefined,
    driver: active.trip.driver,
    destLat: active.destLat ?? undefined,
    destLng: active.destLng ?? undefined,
  };
};
