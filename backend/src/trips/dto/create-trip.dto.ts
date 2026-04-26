import {
    IsBoolean, IsDateString, IsNotEmpty, IsArray, ArrayMinSize,
    IsOptional, IsString, IsNumber, IsInt, IsJSON, Min, Max, MaxLength,
    IsLatitude, IsLongitude, ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

// M-1: each route element is validated as a proper [lat, lng] pair
class RoutePointDto {
    @IsLatitude()
    0: number; // latitude

    @IsLongitude()
    1: number; // longitude
}

export class CreateTripDto {
    // M-1: ValidateNested ensures each [lat, lng] tuple has valid coordinate ranges
    @IsArray()
    @ArrayMinSize(2)
    @ValidateNested({ each: true })
    @Type(() => RoutePointDto)
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

    // M-2: @IsJSON() ensures the stored meetingPoint can always be parsed — rejects
    // plain strings like "hello" that would silently corrupt downstream GeoJSON parsing
    @IsJSON()
    @MaxLength(500)
    meetingPoint: string;
}
