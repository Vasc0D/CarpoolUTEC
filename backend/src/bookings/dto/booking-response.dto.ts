import { BookingStatus } from '../entities/booking.entity';
import { TripStatus } from '../../trips/entities/trip.entity';

export class BookingResponseDto {
    id: string;
    status: BookingStatus;
    isBoarded: boolean;
    destLat: number | null;
    destLng: number | null;
    trip: {
        id: string;
        status: TripStatus;
        departureTime: Date;
        passengerEtaSeconds: number;
        driver: {
            id: string;
            name: string;
            vehicle: { brand: string; model: string; color: string; plate: string } | null;
        };
    };
    passenger: {
        id: string;
        name: string;
    };
    createdAt: Date;
}
