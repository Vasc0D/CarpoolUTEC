import { BadRequestException } from '@nestjs/common';
import { TripStatus } from './entities/trip.entity';

/**
 * Exhaustive map of every valid Trip status transition.
 *
 * Keeping it here rather than scattered across service methods means a new
 * business rule (e.g. ACTIVE → CANCELED) is a single-line addition with one
 * obvious place to look — and the compiler will remind us if we add a new
 * TripStatus value and forget to map it.
 *
 * Terminal states (COMPLETED, CANCELED) map to empty arrays.
 */
const TRIP_TRANSITIONS: ReadonlyMap<TripStatus, ReadonlyArray<TripStatus>> = new Map([
  [TripStatus.SCHEDULED, [TripStatus.ACTIVE, TripStatus.CANCELED]],
  [TripStatus.ACTIVE,    [TripStatus.COMPLETED, TripStatus.CANCELED]],
  [TripStatus.COMPLETED, []],
  [TripStatus.CANCELED,  []],
]);

export class TripStateMachine {
  /** True iff the from→to edge exists in the transition graph. */
  static canTransition(from: TripStatus, to: TripStatus): boolean {
    return TRIP_TRANSITIONS.get(from)?.includes(to) ?? false;
  }

  /**
   * Throws BadRequestException if the transition is not in the graph.
   * Use this in service methods that are reachable from HTTP endpoints so
   * the error propagates as a 400 response.
   */
  static assertTransition(from: TripStatus, to: TripStatus): void {
    if (!this.canTransition(from, to)) {
      throw new BadRequestException(
        `Transición de estado inválida: viaje ${from} → ${to}`,
      );
    }
  }

  /** True iff the status has no valid outgoing edges (COMPLETED or CANCELED). */
  static isTerminal(status: TripStatus): boolean {
    return (TRIP_TRANSITIONS.get(status)?.length ?? 0) === 0;
  }

  /** All statuses reachable from the given status in one step. */
  static nextStatuses(from: TripStatus): ReadonlyArray<TripStatus> {
    return TRIP_TRANSITIONS.get(from) ?? [];
  }
}
