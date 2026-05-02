import {
  Column, Entity, Index,
  JoinColumn, ManyToOne, PrimaryGeneratedColumn,
} from 'typeorm';
import { TripRoutePlan } from './trip-route-plan.entity';
import { Booking } from '../../bookings/entities/booking.entity';

/**
 * Single leg of a TripRoutePlan: one segment between two consecutive points
 * in the optimized waypoint order. Replaces the parallel array
 * legDurationsSeconds + passengerWaypoints that used to live on Trip — that
 * shape made it impossible to associate a leg with the booking it ends at
 * without trusting array indexing.
 *
 * passengerDropOff is nullable: legs that end at the final destination
 * (or anywhere not associated with a specific drop-off) have NULL here.
 * The last leg of any plan typically does.
 */
@Entity('trip_route_legs')
@Index('trip_route_legs_plan_index', ['plan', 'legIndex'], { unique: true })
export class TripRouteLeg {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => TripRoutePlan, plan => plan.legs, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'planId' })
  plan: TripRoutePlan;

  @Column({ type: 'uuid' })
  planId: string;

  // 0-based position in the optimized order returned by Routes API.
  @Column({ type: 'int' })
  legIndex: number;

  // duration_in_traffic.value (seconds) when available, falling back to
  // duration.value otherwise. Set by RouteRecalcProcessor.
  @Column({ type: 'int' })
  durationSeconds: number;

  @Column({ type: 'decimal', precision: 9, scale: 6 })
  startLat: number;

  @Column({ type: 'decimal', precision: 9, scale: 6 })
  startLng: number;

  @Column({ type: 'decimal', precision: 9, scale: 6 })
  endLat: number;

  @Column({ type: 'decimal', precision: 9, scale: 6 })
  endLng: number;

  // FK to the booking whose passenger gets off at this leg's end. NULL for
  // legs ending at the trip's final destination. ON DELETE SET NULL so a
  // cancelled booking doesn't ripple into deleting historical plans.
  @ManyToOne(() => Booking, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'passengerDropOffId' })
  passengerDropOff: Booking | null;

  @Column({ type: 'uuid', nullable: true })
  passengerDropOffId: string | null;
}
