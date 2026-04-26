import { IsNumber, IsOptional, Min, Max } from 'class-validator';

export class CreateBookingDto {
    @IsOptional()
    @IsNumber()
    @Min(-90)
    @Max(90)
    destLat?: number;

    @IsOptional()
    @IsNumber()
    @Min(-180)
    @Max(180)
    destLng?: number;
}
