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

  @Column({
    type: 'geometry',
    spatialFeatureType: 'LineString',
    srid: 4326,
  })
  // C-2: explicit type instead of any
  routePolyline: { type: string; coordinates: number[][] };

  @Column({ type: 'int', default: 5 })
  maxDetourMinutes: number;

  @Column({ default: false })
  detourEnabled: boolean;

  @Column({ type: 'int', default: 0 })
  originalDurationSeconds: number;

  @Column({ type: 'json', nullable: true })
  tripOrigin: { lat: number; lng: number } | null;

  @Column({ type: 'json', nullable: true })
  finalDestination: { lat: number; lng: number } | null;

  @Column({ type: 'json', nullable: true })
  passengerWaypoints: { passengerId: string; lat: number; lng: number }[] | null;

  @Column({ type: 'json', nullable: true })
  legDurationsSeconds: number[] | null;

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
  // PICKUP_POINT constant (see src/trips/constants.ts). If multi-campus support
  // is added later, replace the constant with a `pickupPointId` FK.

  @OneToMany(() => Booking, booking => booking.trip)
  bookings: Booking[];

  // Phase 2: pointer to the latest ACTIVE TripRoutePlan. Reads still hit the
  // legacy columns above (routePolyline, passengerWaypoints, etc.) until the
  // dual-write commit lands; this FK is populated alongside those writes
  // and consumers will switch over in a later commit. Nullable until every
  // existing trip has been backfilled.
  @ManyToOne(() => TripRoutePlan, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'currentRoutePlanId' })
  currentRoutePlan: TripRoutePlan | null;

  @Column({ type: 'uuid', nullable: true })
  currentRoutePlanId: string | null;

  // Inverse of TripRoutePlan.trip — convenience for history/audit reads;
  // hot-path code uses currentRoutePlanId directly.
  @OneToMany(() => TripRoutePlan, plan => plan.trip)
  routePlans: TripRoutePlan[];

  // B-3: audit timestamps — absent from original entity
  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
