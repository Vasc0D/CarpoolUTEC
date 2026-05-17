import { BookingStateMachine } from './booking-state-machine';
import { BookingStatus } from './entities/booking.entity';

describe('BookingStateMachine async route states', () => {
  it('allows pending bookings to enter route recalculation and then become accepted', () => {
    expect(BookingStateMachine.canTransition(
      BookingStatus.PENDING,
      BookingStatus.PENDING_ROUTE_RECALC,
    )).toBe(true);
    expect(BookingStateMachine.canTransition(
      BookingStatus.PENDING_ROUTE_RECALC,
      BookingStatus.ACCEPTED,
    )).toBe(true);
  });

  it('allows pending route recalculation to fail without allowing terminal recovery', () => {
    expect(BookingStateMachine.canTransition(
      BookingStatus.PENDING_ROUTE_RECALC,
      BookingStatus.ROUTE_RECALC_FAILED,
    )).toBe(true);
    expect(BookingStateMachine.isTerminal(BookingStatus.ROUTE_RECALC_FAILED)).toBe(true);
    expect(BookingStateMachine.canTransition(
      BookingStatus.ROUTE_RECALC_FAILED,
      BookingStatus.ACCEPTED,
    )).toBe(false);
  });
});
