/**
 * React Query hooks used by HomeScreen and its sub-components.
 *
 * Design notes:
 * - All queries are disabled when the relevant appMode is inactive, so
 *   switching modes doesn't accidentally fire irrelevant requests.
 * - `staleTime: 30_000` — treat data as fresh for 30 s so focus refetches
 *   don't hammer the server on every tab switch.
 * - `refetchOnWindowFocus: true` (React Query default) replaces the manual
 *   `useFocusEffect(() => fetchX())` pattern in the original HomeScreen.
 * - Socket events call `queryClient.invalidateQueries({ queryKey })` to
 *   trigger a background re-fetch without clearing the cached data first.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  fetchAvailableTrips,
  fetchStopsCoverage,
  fetchActiveDriverTrip,
  fetchMyActiveBooking,
} from '../api/tripsApi';
import { axiosClient } from '../api/axiosClient';

const POPULAR_STOPS = [
  { id: 'jockey',     name: 'Jockey Plaza',           lat: -12.0869, lng: -76.9750 },
  { id: 'rambla',     name: 'La Rambla San Borja',     lat: -12.0956, lng: -76.9997 },
  { id: 'arequipa_jp',name: 'Arequipa con Javier Prado', lat: -12.0887, lng: -77.0283 },
  { id: 'san_luis',   name: 'San Luis',                lat: -12.0750, lng: -76.9820 },
];

// ─── Query keys (stable references, used for invalidation) ───────────────────

export const QUERY_KEYS = {
  availableTrips: (userLat: number, userLng: number, destLat: number, destLng: number) =>
    ['trips', 'available', userLat, userLng, destLat, destLng] as const,
  stopsCoverage: () => ['trips', 'stops-coverage'] as const,
  activeDriverTrip: () => ['trips', 'active-driver'] as const,
  myActiveBooking: () => ['bookings', 'active'] as const,
} as const;

// ─── Hooks ───────────────────────────────────────────────────────────────────

export const useAvailableTrips = (
  appMode: string,
  userLat: number | null,
  userLng: number | null,
  destLat: number | null,
  destLng: number | null,
) =>
  useQuery({
    queryKey: QUERY_KEYS.availableTrips(
      userLat ?? 0, userLng ?? 0, destLat ?? 0, destLng ?? 0,
    ),
    queryFn: () => fetchAvailableTrips(userLat!, userLng!, destLat!, destLng!),
    enabled:
      appMode === 'passenger' &&
      userLat !== null &&
      userLng !== null &&
      destLat !== null &&
      destLng !== null,
    staleTime: 30_000,
  });

export const useStopsCoverage = (appMode: string) =>
  useQuery({
    queryKey: QUERY_KEYS.stopsCoverage(),
    queryFn: () => fetchStopsCoverage(POPULAR_STOPS.map(s => ({ id: s.id, lat: s.lat, lng: s.lng }))),
    enabled: appMode === 'passenger',
    staleTime: 60_000,
    select: (data) => data.filter(s => s.covered).map(s => s.id),
  });

export const useActiveDriverTrip = (appMode: string, isDriver: boolean) =>
  useQuery({
    queryKey: QUERY_KEYS.activeDriverTrip(),
    queryFn: fetchActiveDriverTrip,
    enabled: appMode === 'driver' && isDriver,
    staleTime: 30_000,
  });

export const useMyActiveBooking = (appMode: string) =>
  useQuery({
    queryKey: QUERY_KEYS.myActiveBooking(),
    queryFn: fetchMyActiveBooking,
    enabled: appMode === 'passenger',
    staleTime: 30_000,
  });

export const useCreateBooking = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ tripId, destLat, destLng }: { tripId: string; destLat?: number; destLng?: number }) =>
      axiosClient.post(`/bookings/${tripId}`, { destLat, destLng }).then(r => r.data),
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['trips', 'available'] });
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.myActiveBooking() });
    },
  });
};

export const useAcceptBooking = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (bookingId: string) => axiosClient.patch(`/bookings/${bookingId}/accept`).then(r => r.data),
    onSettled: () => queryClient.invalidateQueries({ queryKey: QUERY_KEYS.activeDriverTrip() }),
  });
};

export const useRejectBooking = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (bookingId: string) => axiosClient.patch(`/bookings/${bookingId}/reject`).then(r => r.data),
    onSettled: () => queryClient.invalidateQueries({ queryKey: QUERY_KEYS.activeDriverTrip() }),
  });
};

export const useCancelBooking = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (bookingId: string) => axiosClient.patch(`/bookings/${bookingId}/cancel`).then(r => r.data),
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.myActiveBooking() });
      queryClient.invalidateQueries({ queryKey: ['trips', 'available'] });
    },
  });
};

export const useConfirmBoarding = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (bookingId: string) => axiosClient.patch(`/bookings/${bookingId}/board`).then(r => r.data),
    onSettled: () => queryClient.invalidateQueries({ queryKey: QUERY_KEYS.myActiveBooking() }),
  });
};

export const useCancelTrip = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (tripId: string) => axiosClient.patch(`/trips/${tripId}/cancel`).then(r => r.data),
    onSettled: () => queryClient.invalidateQueries({ queryKey: QUERY_KEYS.activeDriverTrip() }),
  });
};

export const useStartTrip = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (tripId: string) => axiosClient.patch(`/trips/${tripId}/start`).then(r => r.data),
    onSettled: () => queryClient.invalidateQueries({ queryKey: QUERY_KEYS.activeDriverTrip() }),
  });
};

export const useFinishTrip = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (tripId: string) => axiosClient.patch(`/trips/${tripId}/finish`).then(r => r.data),
    onSettled: () => queryClient.invalidateQueries({ queryKey: QUERY_KEYS.activeDriverTrip() }),
  });
};

// ─── Convenience hook for cache invalidation (used by socket events) ─────────

export const useHomeInvalidators = () => {
  const queryClient = useQueryClient();
  return {
    invalidateDriverTrip: () =>
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.activeDriverTrip() }),
    invalidateMyBooking: () =>
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.myActiveBooking() }),
    invalidateAvailableTrips: () =>
      queryClient.invalidateQueries({ queryKey: ['trips', 'available'] }),
    invalidateStopsCoverage: () =>
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.stopsCoverage() }),
  };
};
