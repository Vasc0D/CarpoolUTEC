import { Column, Entity, OneToMany, OneToOne, PrimaryGeneratedColumn } from 'typeorm';
import { Vehicle } from './vehicle.entity';
import { Trip } from '../../trips/entities/trip.entity';
import { Booking } from '../../bookings/entities/booking.entity';

@Entity('users')
export class User {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @Column()
    name: string;

    @Column({ unique: true })
    email: string;

    @Column({ nullable: true })
    phone: string;

    @OneToOne(() => Vehicle, vehicle => vehicle.user)
    vehicle: Vehicle;

    @OneToMany(() => Trip, trip => trip.driver)
    trips: Trip[];

    @OneToMany(() => Booking, booking => booking.passenger)
    bookings: Booking[];
}
