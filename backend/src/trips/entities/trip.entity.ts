import {
  Column, CreateDateColumn, Entity, Index,
  ManyToOne, OneToMany, PrimaryGeneratedColumn, UpdateDateColumn,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';
import { Booking } from '../../bookings/entities/booking.entity';

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
  passengerWaypoints: { passengerId: string; lat: number; lng: number }[] | null;

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

  @Column({ type: 'text', nullable: true })
  meetingPoint: string;

  @OneToMany(() => Booking, booking => booking.trip)
  bookings: Booking[];

  // B-3: audit timestamps — absent from original entity
  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
