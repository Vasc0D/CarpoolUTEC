import { Column, Entity, ManyToOne, OneToMany, PrimaryGeneratedColumn } from 'typeorm';
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
  routePolyline: any; // LineString holding all route points

  @Column({ type: 'int', default: 5 })
  maxDetourMinutes: number;

  @Column({ type: 'timestamp' })
  departureTime: Date;

  @Column({ default: false })
  autoAccept: boolean;

  @Column({ type: 'int', default: 0 })
  availableSeats: number;

  @Column({
    type: 'enum',
    enum: TripStatus,
    default: TripStatus.SCHEDULED,
  })
  status: TripStatus;

  @OneToMany(() => Booking, booking => booking.trip)
  bookings: Booking[];
}
