import { BadRequestException } from '@nestjs/common';
import { BookingStatus } from './entities/booking.entity';

/**
 * Exhaustive map of every valid Booking status transition.
 *
 * Terminal states (COMPLETED, REJECTED, CANCELED) map to empty arrays.
 * isBoarded is not a status — it's a flag on an ACCEPTED booking and is not
 * modelled here.
 */
const BOOKING_TRANSITIONS: ReadonlyMap<BookingStatus, ReadonlyArray<BookingStatus>> = new Map([
  [BookingStatus.PENDING,   [BookingStatus.ACCEPTED, BookingStatus.REJECTED, BookingStatus.CANCELED]],
  [BookingStatus.ACCEPTED,  [BookingStatus.CANCELED, BookingStatus.COMPLETED]],
  [BookingStatus.COMPLETED, []],
  [BookingStatus.REJECTED,  []],
  [BookingStatus.CANCELED,  []],
]);

export class BookingStateMachine {
  /** True iff the from→to edge exists in the transition graph. */
  static canTransition(from: BookingStatus, to: BookingStatus): boolean {
    return BOOKING_TRANSITIONS.get(from)?.includes(to) ?? false;
  }

  /**
   * Throws BadRequestException if the transition is not in the graph.
   * Use this in service methods reachable from HTTP endpoints so the error
   * propagates as a 400 response.
   */
  static assertTransition(from: BookingStatus, to: BookingStatus): void {
    if (!this.canTransition(from, to)) {
      throw new BadRequestException(
        `Transición de estado inválida: reserva ${from} → ${to}`,
      );
    }
  }

  /** True iff the status has no valid outgoing edges. */
  static isTerminal(status: BookingStatus): boolean {
    return (BOOKING_TRANSITIONS.get(status)?.length ?? 0) === 0;
  }

  /** All statuses reachable from the given status in one step. */
  static nextStatuses(from: BookingStatus): ReadonlyArray<BookingStatus> {
    return BOOKING_TRANSITIONS.get(from) ?? [];
  }
}
