import { TripStateMachine } from './trip-state-machine';
import { TripStatus } from './entities/trip.entity';

describe('TripStateMachine boarding state', () => {
  it('allows scheduled trips to enter boarding and then active', () => {
    expect(TripStateMachine.canTransition(TripStatus.SCHEDULED, TripStatus.BOARDING)).toBe(true);
    expect(TripStateMachine.canTransition(TripStatus.BOARDING, TripStatus.ACTIVE)).toBe(true);
  });

  it('keeps completed and canceled terminal', () => {
    expect(TripStateMachine.isTerminal(TripStatus.COMPLETED)).toBe(true);
    expect(TripStateMachine.isTerminal(TripStatus.CANCELED)).toBe(true);
  });
});
