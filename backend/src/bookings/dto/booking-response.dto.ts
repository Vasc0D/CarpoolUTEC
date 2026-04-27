import { BookingStatus } from '../entities/booking.entity';

export class BookingResponseDto {
    id: string;
    status: BookingStatus;
    isBoarded: boolean;
    destLat: number | null;
    destLng: number | null;
    trip: {
        id: string;
        departureTime: Date;
        originalDurationSeconds: number;
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
