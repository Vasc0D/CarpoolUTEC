/**
 * BullMQ queue name. Used by both the producer (RouteRecalcQueue) and the
 * consumer (@Processor decorator) — keeping it as a constant prevents drift.
 */
export const ROUTE_RECALC_QUEUE = 'route-recalc';

/**
 * Operations the worker can perform. Modeled as a discriminated union so the
 * processor can switch on `op` without ambiguity and TypeScript narrows the
 * fields accordingly.
 *
 * - `add`: a new (or re-added) passenger waypoint was just accepted on the
 *   trip. The worker fetches the trip, splices in the new waypoint, calls
 *   Routes API, and persists the updated route.
 *
 * - `remove`: a passenger booking was just cancelled and the trip has detour
 *   enabled. The worker filters their waypoint out and recalculates.
 *
 * `bookingId` is included even on `remove` so the worker can fire targeted
 * compensation notifications if the recalc itself fails (rare for `remove`,
 * but keeps the failure path symmetric).
 */
export type RouteRecalcJobData =
  | {
      op: 'add';
      tripId: string;
      bookingId: string;
      passengerId: string;
      destLat: number;
      destLng: number;
    }
  | {
      op: 'remove';
      tripId: string;
      bookingId: string;
      passengerId: string;
    };
