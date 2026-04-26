import {
    IsBoolean, IsDateString, IsNotEmpty, IsArray, ArrayMinSize,
    IsOptional, IsString, IsNumber, IsInt, Min, Max, MaxLength,
} from 'class-validator';

export class CreateTripDto {
    @IsArray()
    @ArrayMinSize(2)
    route: [number, number][];

    @IsDateString()
    @IsNotEmpty()
    departureTime: string;

    @IsBoolean()
    @IsOptional()
    autoAccept?: boolean;

    @IsBoolean()
    @IsOptional()
    detourEnabled?: boolean;

    @IsInt()
    @Min(1)
    @Max(8)
    @IsOptional()
    availableSeats?: number;

    @IsInt()
    @Min(0)
    @Max(60)
    @IsOptional()
    maxDetourMinutes?: number;

    @IsNumber()
    @Min(0)
    @Max(999)
    @IsOptional()
    pricePerSeat?: number;

    @IsString()
    @IsNotEmpty()
    @MaxLength(500)
    meetingPoint: string;
}
