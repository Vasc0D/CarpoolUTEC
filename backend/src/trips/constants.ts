/**
 * Fixed pickup point for all trips.
 *
 * The product currently runs out of a single campus (UTEC), so every trip
 * starts at the same boarding spot — the car exit on Av. del Bosque. We keep
 * this as a constant rather than per-trip data because:
 *   - it is invariant by business rule today
 *   - removing it from the Trip row eliminates a JSON-in-text column that had
 *     no schema validation and was a known footgun
 *   - if multi-campus support is added later, this constant becomes a row in
 *     a `pickup_points` table and Trip gets a FK — a small, contained change
 */
export const PICKUP_POINT = {
  id: 'utec-car-exit',
  label: 'Salida de carros UTEC',
  lat: -12.135570,
  lng: -77.021908,
} as const;

export type PickupPoint = typeof PICKUP_POINT;
