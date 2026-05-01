/**
 * Fixed pickup point for all trips. Mirrors backend/src/trips/constants.ts.
 *
 * Centralised here so screens (CreateTrip, Home, ActiveTrip) never hardcode
 * coordinates inline. If the backend ever exposes /config/pickup-point, swap
 * this for a fetched value behind the same shape.
 */
export const PICKUP_POINT = {
  id: 'utec-car-exit',
  label: 'Salida de carros UTEC',
  latitude: -12.135570,
  longitude: -77.021908,
} as const;

export type PickupPoint = typeof PICKUP_POINT;
