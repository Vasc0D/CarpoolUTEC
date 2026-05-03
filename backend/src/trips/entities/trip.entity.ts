import {
  Column, CreateDateColumn, Entity, Index,
  JoinColumn, ManyToOne, OneToMany, PrimaryGeneratedColumn, UpdateDateColumn,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';
import { Booking } from '../../bookings/entities/booking.entity';
import { TripRoutePlan } from './trip-route-plan.entity';

export enum TripStatus {
  SCHEDULED = 'SCHEDULED',
  ACTIVE = 'ACTIVE',
  COMPLETED = 'COMPLETED',
  CANCELED = 'CANCELED',
}

@Entity('trips')
export class Trip {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => User, user => user.trips)
  driver: User;

  @Column({ type: 'int', default: 5 })
  maxDetourMinutes: number;

  @Column({ default: false })
  detourEnabled: boolean;

  // B-1: index for cron jobs and availability queries that filter by departureTime
  @Index()
  @Column({ type: 'timestamp' })
  departureTime: Date;

  @Column({ default: false })
  autoAccept: boolean;

  @Column({ type: 'int', default: 0 })
  availableSeats: number;

  // B-1: index for cron jobs and status-filtered queries
  @Index()
  @Column({
    type: 'enum',
    enum: TripStatus,
    default: TripStatus.SCHEDULED,
  })
  status: TripStatus;

  @Column({ type: 'decimal', precision: 6, scale: 2, default: 0 })
  pricePerSeat: number;

  // meetingPoint removed in migration 1745700000000 — pickup is now the fixed
  // PICKUP_POINT constant (see src/trips/constants.ts).

  @OneToMany(() => Booking, booking => booking.trip)
  bookings: Booking[];

  // Pointer to the latest ACTIVE TripRoutePlan. Updated atomically by
  // RouteRecalcProcessor whenever a new recalc succeeds (old plan is
  // SUPERSEDED, new plan is inserted, this FK is swapped — all in one
  // transaction). NULL only for trips whose initial Routes API call failed;
  // those trips won't appear in proximity search results.
  @ManyToOne(() => TripRoutePlan, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'currentRoutePlanId' })
  currentRoutePlan: TripRoutePlan | null;

  @Column({ type: 'uuid', nullable: true })
  currentRoutePlanId: string | null;

  // Inverse of TripRoutePlan.trip — convenience for history/audit reads;
  // hot-path code uses currentRoutePlanId directly.
  @OneToMany(() => TripRoutePlan, plan => plan.trip)
  routePlans: TripRoutePlan[];

  // B-3: audit timestamps
  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
