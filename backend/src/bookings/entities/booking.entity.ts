import { Column, CreateDateColumn, Entity, Index, ManyToOne, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import { Trip } from '../../trips/entities/trip.entity';
import { User } from '../../users/entities/user.entity';

export enum BookingStatus {
    PENDING = 'PENDING',
    PENDING_ROUTE_RECALC = 'PENDING_ROUTE_RECALC',
    ACCEPTED = 'ACCEPTED',
    ROUTE_RECALC_FAILED = 'ROUTE_RECALC_FAILED',
    REJECTED = 'REJECTED',
    CANCELED = 'CANCELED',
    COMPLETED = 'COMPLETED',
}

@Entity('bookings')
export class Booking {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @ManyToOne(() => Trip, trip => trip.bookings)
    trip: Trip;

    @ManyToOne(() => User, user => user.bookings)
    passenger: User;

    // B-1: index for frequent status-filtered lookups (active booking checks, cron jobs)
    @Index()
    @Column({
        type: 'enum',
        enum: BookingStatus,
        default: BookingStatus.PENDING,
    })
    status: BookingStatus;

    @Column({ default: false })
    isBoarded: boolean;

    @Column({ type: 'decimal', precision: 9, scale: 6, nullable: true })
    destLat: number | null;

    @Column({ type: 'decimal', precision: 9, scale: 6, nullable: true })
    destLng: number | null;

    @CreateDateColumn()
    createdAt: Date;

    @UpdateDateColumn()
    updatedAt: Date;
}
