import { BookingStatus } from '../entities/booking.entity';

export class BookingResponseDto {
    id: string;
    status: BookingStatus;
    isBoarded: boolean;
    trip: {
        id: string;
        origin: any;
        destination: any;
        departureTime: Date;
        driver: {
            id: string;
            name: string;
        };
    };
    passenger: {
        id: string;
        name: string;
    };
    createdAt: Date;
}
