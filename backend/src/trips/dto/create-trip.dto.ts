import { IsBoolean, IsDateString, IsNotEmpty, IsArray, ArrayMinSize, IsOptional, IsString, IsNumber, Min } from 'class-validator';

export class CreateTripDto {
    @IsArray()
    @ArrayMinSize(2)
    route: [number, number][]; // Formato esperado: tuple de [Latitud, Longitud]

    @IsDateString()
    @IsNotEmpty()
    departureTime: string;

    @IsBoolean()
    @IsOptional()
    autoAccept?: boolean;

    @IsOptional()
    availableSeats?: number;

    @IsOptional()
    maxDetourMinutes?: number;

    @IsNumber()
    @Min(0)
    @IsOptional()
    pricePerSeat?: number;

    @IsString()
    @IsNotEmpty()
    meetingPoint: string;
}
